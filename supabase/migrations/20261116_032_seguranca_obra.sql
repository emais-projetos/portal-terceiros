-- Segurança da obra: a rotina dos TSTs (checklists de máquinas, alojamentos e canteiro) dentro do portal.
-- Vem do ObraCheck (artefato + Supabase separado). Aqui tudo passa a ter login e regra de acesso por perfil:
--   admin: tudo. TST: as obras dele (preenche). Engenharia: as obras dele (só consulta).
--   Fornecedor: os alojamentos da empresa dele, a vistoria concluída e as não conformidades a regularizar.
-- Fotos e assinaturas ficam na pasta privada "seguranca". As fotos das vistorias são excluídas 30 dias depois da
-- conclusão; o TST é avisado para baixar o PDF da vistoria com as fotos antes disso.

-- ---------------------------------------------------------------------------------------------- Acesso
-- TST da obra (preenche) ou admin.
create or replace function app.tst_da_obra(p_obra uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.eh_admin() or p_obra in (select app.minhas_obras_tst());
$$;

-- Admin, TST ou engenharia da obra (consulta).
create or replace function app.ve_obra_seguranca(p_obra uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.eh_admin() or p_obra in (select app.minhas_obras_painel());
$$;

-- ---------------------------------------------------------------------------------------------- Modelos
-- Itens de cada checklist. Máquinas: um modelo por tipo de equipamento. Alojamento: NR-18. Canteiro: a incluir.
create table public.seg_modelos (
  codigo text primary key,
  grupo text not null check (grupo in ('maquina', 'alojamento', 'canteiro')),
  nome text not null,
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  ativo boolean not null default true,
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------- Máquinas
create table public.seg_maquinas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras (id),
  modelo_codigo text not null references public.seg_modelos (codigo),
  identificacao text not null check (length(btrim(identificacao)) > 0),
  empresa_id uuid references public.empresas (id),          -- vazio = máquina da Emais
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id)
);
create unique index seg_maquinas_unica on public.seg_maquinas (obra_id, modelo_codigo, lower(btrim(identificacao)));

-- Ficha mensal: marcação diária dos itens e fechamento do mês assinado pelo operador e pelo TST.
-- dias: {"05": {"statuses": ["ok","nc","na",...], "operador": "...", "colaborador_id": "...", "observacao": "...",
--              "fotos": ["caminho", ...], "assinatura": "caminho", "atualizado_em": "...", "por": "uuid"}}
-- fechamento: {"operador_nome", "operador_assinatura", "tst_nome", "tst_assinatura"}
create table public.seg_fichas_maquina (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.seg_maquinas (id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  dias jsonb not null default '{}'::jsonb,
  fechamento jsonb,
  fechada_em timestamptz,
  fechada_por uuid references public.usuarios (id),
  origem text not null default 'portal',
  origem_chave text unique,                                  -- chave do registro no ObraCheck (importação)
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id),
  atualizado_em timestamptz not null default now(),
  unique (maquina_id, competencia)
);

-- ---------------------------------------------------------------------------------------------- Alojamentos
create table public.seg_alojamentos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras (id),
  nome text not null check (length(btrim(nome)) > 0),
  endereco text,
  empresa_id uuid references public.empresas (id),          -- vazio = alojamento da Emais
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id)
);
create unique index seg_alojamentos_unico on public.seg_alojamentos (obra_id, lower(btrim(nome)));

-- Vistoria (alojamento e, depois, canteiro).
-- itens: [{"texto", "status": "sim"|"nao"|"na"|null, "recomendacao", "prazo": "aaaa-mm-dd", "fotos": ["caminho"]}]
-- funcionarios: [{"colaborador_id", "nome", "assinatura": "caminho"}]   envolvidos: [{"nome", "cargo", "assinatura"}]
create table public.seg_vistorias (
  id uuid primary key default gen_random_uuid(),
  modelo_codigo text not null references public.seg_modelos (codigo),
  obra_id uuid not null references public.obras (id),
  alojamento_id uuid references public.seg_alojamentos (id),
  data_vistoria date not null,
  horario text,
  qtd_funcionarios int,
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  funcionarios jsonb not null default '[]'::jsonb,
  envolvidos jsonb not null default '[]'::jsonb,
  pontuacao numeric,
  classificacao text,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'concluida')),
  concluida_em timestamptz,
  concluida_por uuid references public.usuarios (id),
  fotos_expiram_em timestamptz,
  fotos_excluidas_em timestamptz,
  origem text not null default 'portal',
  origem_chave text unique,                                  -- chave do registro no ObraCheck (importação)
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id),
  atualizado_em timestamptz not null default now()
);
create index seg_vistorias_alojamento on public.seg_vistorias (alojamento_id, data_vistoria desc);
create index seg_vistorias_obra on public.seg_vistorias (obra_id, data_vistoria desc);

-- Termo de uso do alojamento assinado pelo colaborador.
create table public.seg_termos_alojamento (
  id uuid primary key default gen_random_uuid(),
  alojamento_id uuid not null references public.seg_alojamentos (id),
  colaborador_id uuid references public.colaboradores (id),
  nome text not null,
  data date not null default current_date,
  assinatura text,
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id)
);

-- Não conformidade notificada ao fornecedor responsável. Ele responde pelo portal; o TST aprova ou reabre.
create table public.seg_nao_conformidades (
  id uuid primary key default gen_random_uuid(),
  vistoria_id uuid not null references public.seg_vistorias (id) on delete cascade,
  item int not null,
  empresa_id uuid not null references public.empresas (id),
  descricao text not null,
  recomendacao text,
  prazo date not null,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'respondida', 'regularizada', 'reaberta')),
  resposta text,
  resposta_fotos jsonb not null default '[]'::jsonb,
  respondida_em timestamptz,
  respondida_por uuid references public.usuarios (id),
  avaliada_em timestamptz,
  avaliada_por uuid references public.usuarios (id),
  motivo_reabertura text,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id),
  unique (vistoria_id, item)
);
create index seg_nc_empresa on public.seg_nao_conformidades (empresa_id, situacao);

-- Fila de e-mails da rotina (o n8n busca e envia, como os avisos de liberação e os convites).
--   vistoria_pdf: ao TST, para baixar o PDF da vistoria com as fotos antes da exclusão em 30 dias.
--   nao_conformidade: ao fornecedor, com os itens a regularizar e o prazo.
--   nc_reaberta: ao fornecedor, quando o TST não aceita a regularização.
create table public.seg_avisos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('vistoria_pdf', 'nao_conformidade', 'nc_reaberta')),
  vistoria_id uuid not null references public.seg_vistorias (id) on delete cascade,
  empresa_id uuid references public.empresas (id),
  usuario_id uuid references public.usuarios (id),
  situacao_envio text not null default 'aguardando' check (situacao_envio in ('aguardando', 'enviando', 'enviado', 'erro', 'cancelado')),
  envio_iniciado_em timestamptz,
  enviado_em timestamptz,
  para text,
  erro text,
  criado_em timestamptz not null default now()
);
create index seg_avisos_fila on public.seg_avisos (situacao_envio, criado_em);

-- ---------------------------------------------------------------------------------------------- Regras de acesso
alter table public.seg_modelos enable row level security;
alter table public.seg_maquinas enable row level security;
alter table public.seg_fichas_maquina enable row level security;
alter table public.seg_alojamentos enable row level security;
alter table public.seg_vistorias enable row level security;
alter table public.seg_termos_alojamento enable row level security;
alter table public.seg_nao_conformidades enable row level security;
alter table public.seg_avisos enable row level security;

create policy leitura on public.seg_modelos for select to authenticated using (true);
create policy admin on public.seg_modelos for all to authenticated using (app.eh_admin()) with check (app.eh_admin());

create policy leitura on public.seg_maquinas for select to authenticated using (app.ve_obra_seguranca(obra_id));
create policy inserir on public.seg_maquinas for insert to authenticated with check (app.tst_da_obra(obra_id));
create policy alterar on public.seg_maquinas for update to authenticated using (app.tst_da_obra(obra_id)) with check (app.tst_da_obra(obra_id));
create policy excluir on public.seg_maquinas for delete to authenticated using (app.eh_admin());

create policy leitura on public.seg_fichas_maquina for select to authenticated
  using (exists (select 1 from public.seg_maquinas m where m.id = maquina_id and app.ve_obra_seguranca(m.obra_id)));
create policy inserir on public.seg_fichas_maquina for insert to authenticated
  with check (fechada_em is null and exists (select 1 from public.seg_maquinas m where m.id = maquina_id and app.tst_da_obra(m.obra_id)));
create policy alterar on public.seg_fichas_maquina for update to authenticated
  using ((fechada_em is null or app.eh_admin()) and exists (select 1 from public.seg_maquinas m where m.id = maquina_id and app.tst_da_obra(m.obra_id)))
  with check (fechada_em is null or app.eh_admin());
create policy excluir on public.seg_fichas_maquina for delete to authenticated using (app.eh_admin());

create policy leitura on public.seg_alojamentos for select to authenticated
  using (app.ve_obra_seguranca(obra_id) or empresa_id in (select app.minhas_empresas()));
create policy inserir on public.seg_alojamentos for insert to authenticated with check (app.tst_da_obra(obra_id));
create policy alterar on public.seg_alojamentos for update to authenticated using (app.tst_da_obra(obra_id)) with check (app.tst_da_obra(obra_id));
create policy excluir on public.seg_alojamentos for delete to authenticated using (app.eh_admin());

-- Fornecedor vê só a vistoria concluída dos alojamentos da empresa dele.
create policy leitura on public.seg_vistorias for select to authenticated
  using (app.ve_obra_seguranca(obra_id)
         or (situacao = 'concluida' and alojamento_id in (select a.id from public.seg_alojamentos a where a.empresa_id in (select app.minhas_empresas()))));
create policy inserir on public.seg_vistorias for insert to authenticated
  with check (situacao = 'rascunho' and app.tst_da_obra(obra_id));
create policy alterar on public.seg_vistorias for update to authenticated
  using (situacao = 'rascunho' and app.tst_da_obra(obra_id)) with check (situacao = 'rascunho' and app.tst_da_obra(obra_id));
create policy excluir on public.seg_vistorias for delete to authenticated using (situacao = 'rascunho' and app.tst_da_obra(obra_id));

create policy leitura on public.seg_termos_alojamento for select to authenticated
  using (exists (select 1 from public.seg_alojamentos a where a.id = alojamento_id and app.ve_obra_seguranca(a.obra_id)));
create policy inserir on public.seg_termos_alojamento for insert to authenticated
  with check (exists (select 1 from public.seg_alojamentos a where a.id = alojamento_id and app.tst_da_obra(a.obra_id)));

-- Não conformidades: só leitura direta; abrir, responder e avaliar é pelas funções abaixo.
create policy leitura on public.seg_nao_conformidades for select to authenticated
  using (empresa_id in (select app.minhas_empresas())
         or exists (select 1 from public.seg_vistorias v where v.id = vistoria_id and app.ve_obra_seguranca(v.obra_id)));

create policy admin on public.seg_avisos for select to authenticated using (app.eh_admin());

-- ---------------------------------------------------------------------------------------------- Regras de negócio
-- Obra e alojamento precisam bater; o modelo precisa ser do grupo certo; só o TST/admin grava quem fez.
create or replace function app.seg_antes_gravar_vistoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_grupo text;
  v_obra uuid;
begin
  select grupo into v_grupo from public.seg_modelos where codigo = new.modelo_codigo;
  if v_grupo = 'alojamento' then
    if new.alojamento_id is null then raise exception 'Escolha o alojamento'; end if;
    select obra_id into v_obra from public.seg_alojamentos where id = new.alojamento_id;
    if v_obra is distinct from new.obra_id then raise exception 'O alojamento não é desta obra'; end if;
  elsif v_grupo = 'canteiro' then
    new.alojamento_id := null;
  else
    raise exception 'Modelo de checklist inválido para vistoria';
  end if;
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, auth.uid());
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger seg_vistorias_antes before insert or update on public.seg_vistorias
  for each row execute function app.seg_antes_gravar_vistoria();

create or replace function app.seg_antes_gravar_ficha() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_grupo text;
begin
  select mo.grupo into v_grupo from public.seg_maquinas m join public.seg_modelos mo on mo.codigo = m.modelo_codigo where m.id = new.maquina_id;
  if v_grupo is distinct from 'maquina' then raise exception 'Máquina inválida'; end if;
  if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid()); end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger seg_fichas_antes before insert or update on public.seg_fichas_maquina
  for each row execute function app.seg_antes_gravar_ficha();

-- Nota do alojamento (regra da planilha NR-18): SIM / (SIM + NÃO); N/A fica fora. Faixas: até 30% Péssimo,
-- até 50% Ruim, até 70% Regular, abaixo de 100% Bom, 100% Ótimo.
create or replace function app.seg_nota(p_itens jsonb, out pontuacao numeric, out classificacao text)
language sql immutable as $$
  with c as (
    select count(*) filter (where i->>'status' = 'sim') sim,
           count(*) filter (where i->>'status' in ('sim', 'nao')) aplicaveis
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
  )
  select case when aplicaveis = 0 then null else round(sim::numeric / aplicaveis, 4) end,
         case when aplicaveis = 0 then null
              when sim::numeric / aplicaveis <= 0.3 then 'Péssimo'
              when sim::numeric / aplicaveis <= 0.5 then 'Ruim'
              when sim::numeric / aplicaveis <= 0.7 then 'Regular'
              when sim < aplicaveis then 'Bom'
              else 'Ótimo' end
  from c;
$$;

-- Conclui a vistoria: calcula a nota, trava a edição, marca a exclusão das fotos em 30 dias e avisa o TST
-- para baixar o PDF com as fotos.
create or replace function public.concluir_vistoria_seg(p_vistoria uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.seg_vistorias;
  n record;
  v_dias int := coalesce(app.param_int('seg_dias_fotos'), 30);
begin
  select * into v from public.seg_vistorias where id = p_vistoria for update;
  if v.id is null then raise exception 'Vistoria não encontrada'; end if;
  if not app.tst_da_obra(v.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo conclui a vistoria'; end if;
  if v.situacao = 'concluida' then raise exception 'A vistoria já foi concluída'; end if;
  if exists (select 1 from jsonb_array_elements(v.itens) i where i->>'status' is null) then
    raise exception 'Responda todos os itens antes de concluir (sim, não ou não se aplica)';
  end if;
  select * into n from app.seg_nota(v.itens);
  update public.seg_vistorias
     set situacao = 'concluida', concluida_em = now(), concluida_por = auth.uid(),
         pontuacao = n.pontuacao, classificacao = n.classificacao,
         fotos_expiram_em = now() + make_interval(days => v_dias)
   where id = p_vistoria;
  insert into public.seg_avisos (tipo, vistoria_id, usuario_id) values ('vistoria_pdf', p_vistoria, auth.uid());
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'concluida',
    jsonb_build_object('pontuacao', n.pontuacao, 'classificacao', n.classificacao));
  return jsonb_build_object('pontuacao', n.pontuacao, 'classificacao', n.classificacao, 'fotos_expiram_em', now() + make_interval(days => v_dias));
end $$;

-- Notifica o fornecedor responsável pelo alojamento sobre os itens marcados "não".
-- p_itens: posições (0, 1, ...) dos itens a notificar; vazio = todos os "não". O prazo é o do item (ou 7 dias).
create or replace function public.notificar_nao_conformidades(p_vistoria uuid, p_itens int[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v public.seg_vistorias;
  v_empresa uuid;
  v_qtd int := 0;
  r record;
begin
  select * into v from public.seg_vistorias where id = p_vistoria;
  if v.id is null then raise exception 'Vistoria não encontrada'; end if;
  if not app.tst_da_obra(v.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo notifica o fornecedor'; end if;
  if v.situacao <> 'concluida' then raise exception 'Conclua a vistoria antes de notificar'; end if;
  select empresa_id into v_empresa from public.seg_alojamentos where id = v.alojamento_id;
  if v_empresa is null then raise exception 'Este alojamento não tem fornecedor responsável'; end if;

  for r in
    select (ord - 1)::int pos, i from jsonb_array_elements(v.itens) with ordinality t(i, ord)
    where i->>'status' = 'nao' and (p_itens is null or (ord - 1)::int = any (p_itens))
  loop
    insert into public.seg_nao_conformidades (vistoria_id, item, empresa_id, descricao, recomendacao, prazo, criado_por)
    values (p_vistoria, r.pos, v_empresa, r.i->>'texto', nullif(btrim(coalesce(r.i->>'recomendacao', '')), ''),
            coalesce(nullif(r.i->>'prazo', '')::date, current_date + 7), auth.uid())
    on conflict (vistoria_id, item) do nothing;
    if found then v_qtd := v_qtd + 1; end if;
  end loop;
  if v_qtd = 0 then raise exception 'Nenhum item "não" novo para notificar'; end if;
  insert into public.seg_avisos (tipo, vistoria_id, empresa_id, usuario_id) values ('nao_conformidade', p_vistoria, v_empresa, auth.uid());
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'fornecedor_notificado', jsonb_build_object('itens', v_qtd, 'empresa', v_empresa));
  return v_qtd;
end $$;

-- Fornecedor responde a não conformidade (texto e fotos na pasta nc/<id>/).
create or replace function public.responder_nao_conformidade(p_nc uuid, p_resposta text, p_fotos jsonb default '[]'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  n public.seg_nao_conformidades;
  f text;
begin
  select * into n from public.seg_nao_conformidades where id = p_nc for update;
  if n.id is null then raise exception 'Não conformidade não encontrada'; end if;
  if not (n.empresa_id in (select app.minhas_empresas()) or app.eh_admin()) then raise exception 'Esta não conformidade não é da sua empresa'; end if;
  if n.situacao not in ('aberta', 'reaberta') then raise exception 'Esta não conformidade já foi respondida'; end if;
  if length(btrim(coalesce(p_resposta, ''))) < 5 then raise exception 'Descreva o que foi feito para regularizar'; end if;
  if jsonb_typeof(coalesce(p_fotos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 5 then
    raise exception 'Envie até 5 fotos';
  end if;
  for f in select jsonb_array_elements_text(coalesce(p_fotos, '[]'::jsonb)) loop
    if left(f, length('nc/' || p_nc || '/')) <> 'nc/' || p_nc || '/' then raise exception 'Foto fora da pasta da não conformidade'; end if;
  end loop;
  update public.seg_nao_conformidades
     set situacao = 'respondida', resposta = btrim(p_resposta), resposta_fotos = coalesce(p_fotos, '[]'::jsonb),
         respondida_em = now(), respondida_por = auth.uid()
   where id = p_nc;
  perform app.registrar_evento('seg_nao_conformidades', p_nc, 'respondida', jsonb_build_object('fotos', jsonb_array_length(coalesce(p_fotos, '[]'::jsonb))));
end $$;

-- TST aprova (regularizada) ou reabre com o motivo (o fornecedor é avisado de novo).
create or replace function public.avaliar_nao_conformidade(p_nc uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  n public.seg_nao_conformidades;
  v_obra uuid;
begin
  select * into n from public.seg_nao_conformidades where id = p_nc for update;
  if n.id is null then raise exception 'Não conformidade não encontrada'; end if;
  select obra_id into v_obra from public.seg_vistorias where id = n.vistoria_id;
  if not app.tst_da_obra(v_obra) then raise exception 'Apenas o TST da obra ou o administrativo avalia'; end if;
  if n.situacao <> 'respondida' then raise exception 'Aguardando a resposta do fornecedor'; end if;
  if p_aprovar then
    update public.seg_nao_conformidades set situacao = 'regularizada', avaliada_em = now(), avaliada_por = auth.uid(), motivo_reabertura = null where id = p_nc;
  else
    if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Explique o que ainda falta regularizar'; end if;
    update public.seg_nao_conformidades set situacao = 'reaberta', avaliada_em = now(), avaliada_por = auth.uid(), motivo_reabertura = btrim(p_motivo) where id = p_nc;
    insert into public.seg_avisos (tipo, vistoria_id, empresa_id, usuario_id) values ('nc_reaberta', n.vistoria_id, n.empresa_id, auth.uid());
  end if;
  perform app.registrar_evento('seg_nao_conformidades', p_nc, case when p_aprovar then 'regularizada' else 'reaberta' end,
    jsonb_build_object('motivo', nullif(btrim(coalesce(p_motivo, '')), '')));
end $$;

-- Fecha a ficha mensal da máquina (assinaturas do operador e do TST). Depois só o admin altera.
create or replace function public.fechar_ficha_maquina(p_ficha uuid, p_fechamento jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.seg_fichas_maquina;
  v_obra uuid;
begin
  select * into f from public.seg_fichas_maquina where id = p_ficha for update;
  if f.id is null then raise exception 'Ficha não encontrada'; end if;
  select obra_id into v_obra from public.seg_maquinas where id = f.maquina_id;
  if not app.tst_da_obra(v_obra) then raise exception 'Apenas o TST da obra ou o administrativo fecha a ficha'; end if;
  if f.fechada_em is not null then raise exception 'A ficha já foi fechada'; end if;
  if length(btrim(coalesce(p_fechamento->>'operador_nome', ''))) < 3 or length(btrim(coalesce(p_fechamento->>'tst_nome', ''))) < 3 then
    raise exception 'Informe o operador e o TST';
  end if;
  update public.seg_fichas_maquina set fechamento = p_fechamento, fechada_em = now(), fechada_por = auth.uid() where id = p_ficha;
  perform app.registrar_evento('seg_fichas_maquina', p_ficha, 'fechada', '{}'::jsonb);
end $$;

-- Colaboradores ativos de um fornecedor, para o TST escolher (moradores do alojamento, termo, operador).
-- Só de empresas que atuam nas obras do TST.
create or replace function public.colaboradores_ativos_empresa(p_empresa uuid) returns table (id uuid, nome text, funcao text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (app.eh_admin() or exists (
    select 1 from public.empresas_obras eo where eo.empresa_id = p_empresa and eo.ativo and eo.obra_id in (select app.minhas_obras_tst()))) then
    raise exception 'Empresa fora das suas obras';
  end if;
  return query
    select c.id, c.nome, coalesce(f.nome, c.funcao_texto)
    from public.colaboradores c left join public.funcoes f on f.id = c.funcao_id
    where c.empresa_id = p_empresa and c.situacao = 'ativo'
    order by c.nome;
end $$;

revoke execute on function public.concluir_vistoria_seg(uuid) from anon, public;
revoke execute on function public.notificar_nao_conformidades(uuid, int[]) from anon, public;
revoke execute on function public.responder_nao_conformidade(uuid, text, jsonb) from anon, public;
revoke execute on function public.avaliar_nao_conformidade(uuid, boolean, text) from anon, public;
revoke execute on function public.fechar_ficha_maquina(uuid, jsonb) from anon, public;
revoke execute on function public.colaboradores_ativos_empresa(uuid) from anon, public;
grant execute on function public.concluir_vistoria_seg(uuid) to authenticated;
grant execute on function public.notificar_nao_conformidades(uuid, int[]) to authenticated;
grant execute on function public.responder_nao_conformidade(uuid, text, jsonb) to authenticated;
grant execute on function public.avaliar_nao_conformidade(uuid, boolean, text) to authenticated;
grant execute on function public.fechar_ficha_maquina(uuid, jsonb) to authenticated;
grant execute on function public.colaboradores_ativos_empresa(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------- Fotos e assinaturas
-- Pasta privada "seguranca". Caminhos:
--   vistoria/<vistoria_id>/...   fotos e assinaturas da vistoria (TST/admin grava; fornecedor vê se concluída e for dele)
--   nc/<nc_id>/...               fotos da resposta do fornecedor
--   ficha/<ficha_id>/...         fotos e assinaturas da ficha de máquina
--   termo/<termo_id>/...         assinatura do termo de alojamento
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seguranca', 'seguranca', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function app.seg_arquivo(p_caminho text, p_gravar boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  partes text[] := string_to_array(p_caminho, '/');
  v_id uuid;
  v_obra uuid;
  v_empresa uuid;
  v_situacao text;
begin
  if array_length(partes, 1) < 3 then return false; end if;
  begin
    v_id := partes[2]::uuid;
  exception when others then
    return false;
  end;
  if partes[1] = 'vistoria' then
    select v.obra_id, a.empresa_id, v.situacao into v_obra, v_empresa, v_situacao
    from public.seg_vistorias v left join public.seg_alojamentos a on a.id = v.alojamento_id where v.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return v_situacao = 'rascunho' and app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra) or (v_situacao = 'concluida' and v_empresa in (select app.minhas_empresas()));
  elsif partes[1] = 'nc' then
    select v.obra_id, n.empresa_id, n.situacao into v_obra, v_empresa, v_situacao
    from public.seg_nao_conformidades n join public.seg_vistorias v on v.id = n.vistoria_id where n.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return v_situacao in ('aberta', 'reaberta') and (v_empresa in (select app.minhas_empresas()) or app.eh_admin()); end if;
    return app.ve_obra_seguranca(v_obra) or v_empresa in (select app.minhas_empresas());
  elsif partes[1] = 'ficha' then
    select m.obra_id into v_obra
    from public.seg_fichas_maquina f join public.seg_maquinas m on m.id = f.maquina_id where f.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  elsif partes[1] = 'termo' then
    select a.obra_id into v_obra from public.seg_termos_alojamento t join public.seg_alojamentos a on a.id = t.alojamento_id where t.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  end if;
  return false;
end $$;

create policy "seguranca: ler" on storage.objects for select to authenticated
  using (bucket_id = 'seguranca' and app.seg_arquivo(name, false));
create policy "seguranca: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'seguranca' and app.seg_arquivo(name, true));
create policy "seguranca: apagar (admin)" on storage.objects for delete to authenticated
  using (bucket_id = 'seguranca' and app.eh_admin());

-- ---------------------------------------------------------------------------------------------- Parâmetros e e-mails
insert into public.parametros (chave, valor, descricao, rotulo, grupo, tipo, minimo, maximo, unidade, ordem) values
  ('seg_dias_fotos', '30', 'Depois de concluída a vistoria, as fotos ficam no portal por este tempo e são excluídas. O TST recebe o aviso para baixar o PDF.',
   'Fotos das vistorias ficam por', 'Segurança da obra', 'inteiro', 7, 365, 'dias', 10),
  ('seg_prazo_padrao', '7', 'Prazo para regularizar a não conformidade quando o TST não informa um prazo no item.',
   'Prazo padrão para regularizar', 'Segurança da obra', 'inteiro', 1, 90, 'dias', 20)
on conflict (chave) do nothing;

insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('seg_vistoria_pdf', 'Segurança: baixar o PDF da vistoria',
 'Quando o TST conclui a vistoria. As fotos ficam no portal pelo prazo de Regras > Segurança da obra.',
 'TST que concluiu a vistoria', 200,
 array['{primeiro_nome}', '{local}', '{obra}', '{data_vistoria}', '{classificacao}', '{data_exclusao}', '{link}', '{assinatura}'],
 'Texto inicial',
 'Vistoria de {local} concluída: baixe o PDF até {data_exclusao}',
 E'Olá, {primeiro_nome}!\n\nA vistoria de {local} (obra {obra}) de {data_vistoria} foi concluída, com classificação {classificacao}.\n\nBaixe o PDF da vistoria com as fotos pelo portal:\n{link}\n\nAs fotos ficam no portal até {data_exclusao}. Depois dessa data elas são excluídas da base e só ficam no PDF que você baixou.\n\n{assinatura}'),
('seg_nao_conformidade', 'Segurança: não conformidade no alojamento',
 'Quando o TST notifica o fornecedor responsável pelo alojamento.',
 'Fornecedor responsável pelo alojamento', 210,
 array['{empresa}', '{local}', '{obra}', '{data_vistoria}', '{itens}', '{link}', '{assinatura}'],
 'Texto inicial',
 'Alojamento {local}: itens a regularizar',
 E'Olá, {empresa}!\n\nNa vistoria de {data_vistoria} do alojamento {local} (obra {obra}), encontramos itens que precisam ser regularizados:\n\n{itens}\n\nResponda cada item pelo portal, com foto do que foi feito, até o prazo indicado:\n{link}\n\n{assinatura}'),
('seg_nc_reaberta', 'Segurança: regularização não aceita',
 'Quando o TST não aceita a regularização enviada pelo fornecedor.',
 'Fornecedor responsável pelo alojamento', 220,
 array['{empresa}', '{local}', '{obra}', '{itens}', '{link}', '{assinatura}'],
 'Texto inicial',
 'Alojamento {local}: regularização não aceita',
 E'Olá, {empresa}!\n\nA regularização enviada para o alojamento {local} (obra {obra}) não foi aceita:\n\n{itens}\n\nCorrija e responda de novo pelo portal:\n{link}\n\n{assinatura}')
on conflict (tipo) do nothing;

-- ---------------------------------------------------------------------------------------------- Modelos (do ObraCheck)
insert into public.seg_modelos (codigo, grupo, nome, itens, ordem) values
  ('maquina:manipulador-telescopico', 'maquina', $t$Manipulador Telescópico$t$, $t$["Sistema luminoso e instrumentos funcionando perfeitamente (faróis, ré, pisca alerta, etc.)", "Nível do tanque de combustível, óleo do motor, óleo da transmissão, óleo hidráulico e radiador", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão, porcas bem presas)", "Condições da pá carregadeira e/ou garfos", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Limitador de inclinação", "Funcionamento da lança", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 10),
  ('maquina:mini-carregadeira', 'maquina', $t$Mini Carregadeira$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 20),
  ('maquina:caminhao-munck', 'maquina', $t$Caminhão Munck$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Circuito elétrico em boas condições", "Buzina e alarme sonoro de ré estão funcionando", "Condições dos pneus / estepe (desgaste e pressão)", "Não apresenta vazamentos no sistema hidráulico, mangueiras, conexões e pistões", "Caminhão / equipamento em perfeito estado de conservação", "Sistema operacional (lança principal, lança auxiliar manual, elevação de cargas, giro, alavancas de comando) em perfeitas condições de uso", "Sistema de patolamento em perfeito estado de funcionamento (existência de calços de madeira)", "Existe trava de segurança do gancho e estão em perfeitas condições de uso", "Pinos de trava da lança em aço e com trava do tipo contra pino/cupilha", "Freios de roda e de estacionamento", "Extintor de incêndio (carga e validade)", "Os acessórios de içamento de carga (cintas, cabos de aço, manilhas, cabo guia) estão em bom estado de conservação", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 30),
  ('maquina:caminhao-pipa', 'maquina', $t$Caminhão Pipa$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Possíveis vazamentos do hidráulico e da própria máquina", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Bomba d'água está funcionando em perfeitas condições", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 40),
  ('maquina:caminhao-basculante', 'maquina', $t$Caminhão Basculante$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus (desgaste e pressão)", "Condições da caçamba de transporte", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 50),
  ('maquina:caminhao-carroceria', 'maquina', $t$Caminhão Carroceria$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus (desgaste e pressão)", "Condições da carroceria de transporte", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 60),
  ('maquina:escavadeira-hidraulica', 'maquina', $t$Escavadeira Hidráulica$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 70),
  ('maquina:mini-escavadeira', 'maquina', $t$Mini Escavadeira$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 80),
  ('maquina:mini-guincho', 'maquina', $t$Mini Guincho EM01$t$, $t$["O equipamento está em perfeitas condições", "Obedecendo a carga máxima de operação (80kg)", "Cabo de aço em perfeitas condições", "Clipagem do cabo de aço está conforme", "Gancho possui trava de segurança", "O local para operação está nivelado", "Coluna, barra de carga e contrapeso conforme", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 90),
  ('maquina:motoniveladora', 'maquina', $t$Motoniveladora$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 100),
  ('maquina:pa-carregadeira', 'maquina', $t$Pá Carregadeira$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 110),
  ('maquina:perfuratriz', 'maquina', $t$Perfuratriz$t$, $t$["O caminhão está em perfeitas condições", "Freios de roda e estacionamento estão funcionando", "O trado está em perfeitas condições", "O cabo de aço está em perfeitas condições", "Condições do enrolamento dos cabos de aço no tambor", "Verificar o posicionamento da estaca", "Verificar as condições da torre", "Verificar guincho de movimentação e carregamento", "Os pneus ou esteiras estão em perfeitas condições", "A buzina e sinais sonoros de ré estão funcionando", "Extintor de incêndio (validade e carga)", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 120),
  ('maquina:retroescavadeira', 'maquina', $t$Retroescavadeira$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 130),
  ('maquina:rolo-compactador', 'maquina', $t$Rolo Compactador$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus (desgaste e pressão)", "Condições do rolo", "Condições da proteção do rolo", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 140),
  ('maquina:trator-retroescavadeira', 'maquina', $t$Trator Retroescavadeira$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Condições da pá carregadeira", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador capacitado", "Operador utilizando os EPI's necessários"]$t$::jsonb, 150),
  ('maquina:trator', 'maquina', $t$Trator$t$, $t$["Sistema luminoso (faróis, ré, pisca alerta, etc.)", "Buzina e alarme sonoro de ré", "Condições dos pneus ou esteira (desgaste e pressão)", "Operador capacitado", "Condições do para-brisa", "Conservação da máquina", "Extintor de incêndio (carga e validade)", "Freios de roda e de estacionamento", "Circuito elétrico em boas condições", "Possíveis vazamentos do hidráulico e da própria máquina", "Operador utilizando os EPI's necessários"]$t$::jsonb, 160),
  ('alojamento', 'alojamento', 'Alojamento (NR-18)', $t$["Possui armários individuais duplos com separação para guarda de roupas dos trabalhadores?", "Possui área mínima de 3,00 m² por módulo cama/armário, incluindo a área de circulação?", "Alojamento está devidamente limpo e organizado?", "As instalações elétricas estão devidamente protegidas?", "Possui bebedouro com filtro para fornecimento de água potável e fresca?", "Possui chuveiro na proporção de 1 (um) para cada grupo de 10 (dez) trabalhadores ou fração?", "Os chuveiros estão aterrados adequadamente?", "Os chuveiros dispõem de água quente?", "Dispõem de saboneteira?", "Possui beliche?", "Possui cama simples?", "A cama superior do beliche tem proteção lateral e escada?", "As dimensões mínimas das camas são de 0,80m por 1,90 m de distância entre o ripamento do estrado de 0,05m, colchão com densidade 26 e espessura mínima de 0,10m?", "Possui roupa de cama fornecida pela empresa?", "Possui mesa e cadeira para realização das refeições?", "Possui cesto de lixo com tampa?", "O forro e/ou laje do alojamento está em boas condições de conservação e segurança?", "A pintura externa do alojamento está em boas condições de conservação?", "A pintura interna do alojamento está em boas condições de conservação?", "As porta e janelas possuem trincos e/ou fechaduras que garantem a segurança dos trabalhadores?", "As portas e janelas estão em boas condições de conservação?", "As instalações sanitárias possuem revestimento adequado que permite a higienização?", "O piso do alojamento está em boas condições de conservação?"]$t$::jsonb, 500)
on conflict (codigo) do nothing;

