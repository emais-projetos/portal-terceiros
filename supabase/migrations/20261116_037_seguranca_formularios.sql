-- Segurança da obra:
-- 1. Avisos só pelo portal (sem e-mail): sai a fila seg_avisos e os modelos de e-mail da segurança.
-- 2. Formulários revisáveis: cada alteração das perguntas gera uma revisão (histórico), e cada inspeção guarda a
--    versão que usou. As perguntas já respondidas ficam gravadas na própria inspeção, então não mudam.
-- 3. Fichas de máquina também perdem as fotos depois do prazo (marca fotos_excluidas_em).

-- ---------------------------------------------------------------- 1. Sem e-mail

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
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'concluida',
    jsonb_build_object('pontuacao', n.pontuacao, 'classificacao', n.classificacao));
  return jsonb_build_object('pontuacao', n.pontuacao, 'classificacao', n.classificacao, 'fotos_expiram_em', now() + make_interval(days => v_dias));
end $$;

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
            coalesce(nullif(r.i->>'prazo', '')::date, current_date + coalesce(app.param_int('seg_prazo_padrao'), 7)), auth.uid())
    on conflict (vistoria_id, item) do nothing;
    if found then v_qtd := v_qtd + 1; end if;
  end loop;
  if v_qtd = 0 then raise exception 'Nenhum item "não" novo para notificar'; end if;
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'fornecedor_notificado', jsonb_build_object('itens', v_qtd, 'empresa', v_empresa));
  return v_qtd;
end $$;

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
  end if;
  perform app.registrar_evento('seg_nao_conformidades', p_nc, case when p_aprovar then 'regularizada' else 'reaberta' end,
    jsonb_build_object('motivo', nullif(btrim(coalesce(p_motivo, '')), '')));
end $$;

create or replace function public.reabrir_vistoria_seg(p_vistoria uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v public.seg_vistorias;
begin
  select * into v from public.seg_vistorias where id = p_vistoria for update;
  if v.id is null then raise exception 'Vistoria não encontrada'; end if;
  if not app.tst_da_obra(v.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo reabre a vistoria'; end if;
  if v.situacao <> 'concluida' then raise exception 'A vistoria já está em edição'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Diga o que vai ser corrigido'; end if;
  update public.seg_vistorias set situacao = 'rascunho', concluida_em = null, concluida_por = null where id = p_vistoria;
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'reaberta', jsonb_build_object('motivo', btrim(p_motivo)));
end $$;

drop table public.seg_avisos;
delete from public.modelos_email where tipo in ('seg_vistoria_pdf', 'seg_nao_conformidade', 'seg_nc_reaberta');

-- ---------------------------------------------------------------- 2. Formulários com revisões

alter table public.seg_modelos
  add column versao int not null default 1,
  add column atualizado_por uuid references public.usuarios (id);

create table public.seg_modelos_revisoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null references public.seg_modelos (codigo),
  versao int not null,
  nome text not null,
  itens jsonb not null,
  ativo boolean not null,
  motivo text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id),
  unique (codigo, versao)
);
alter table public.seg_modelos_revisoes enable row level security;
create policy leitura on public.seg_modelos_revisoes for select to authenticated
  using (app.eh_admin() or exists (select 1 from app.minhas_obras_painel()));

insert into public.seg_modelos_revisoes (codigo, versao, nome, itens, ativo, motivo, criado_em)
select codigo, 1, nome, itens, ativo, 'Versão inicial (ObraCheck)', atualizado_em from public.seg_modelos;

-- Alteração só pela função (que grava a revisão); leitura continua para todos os logados.
drop policy admin on public.seg_modelos;

alter table public.seg_vistorias add column modelo_versao int;
alter table public.seg_fichas_maquina add column modelo_versao int, add column fotos_excluidas_em timestamptz;
update public.seg_vistorias set modelo_versao = 1;
update public.seg_fichas_maquina set modelo_versao = 1;

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
    new.modelo_versao := coalesce(new.modelo_versao, (select versao from public.seg_modelos where codigo = new.modelo_codigo));
  end if;
  new.atualizado_em := now();
  return new;
end $$;

create or replace function public.abrir_ficha_maquina(p_maquina uuid, p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.seg_maquinas;
  mo public.seg_modelos;
  v_id uuid;
  v_comp date := date_trunc('month', p_competencia)::date;
begin
  select * into m from public.seg_maquinas where id = p_maquina;
  if m.id is null then raise exception 'Máquina não encontrada'; end if;
  if not app.tst_da_obra(m.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo preenche a ficha'; end if;
  select id into v_id from public.seg_fichas_maquina where maquina_id = p_maquina and competencia = v_comp;
  if v_id is not null then return v_id; end if;
  if not m.ativo then raise exception 'Esta máquina saiu da obra'; end if;
  if v_comp > date_trunc('month', current_date)::date then raise exception 'Não dá para abrir a ficha de um mês que ainda não chegou'; end if;
  select * into mo from public.seg_modelos where codigo = m.modelo_codigo;
  insert into public.seg_fichas_maquina (maquina_id, competencia, itens, modelo_versao, criado_por)
  values (p_maquina, v_comp, mo.itens, mo.versao, auth.uid())
  on conflict (maquina_id, competencia) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.seg_fichas_maquina where maquina_id = p_maquina and competencia = v_comp;
  end if;
  return v_id;
end $$;

-- Cria ou revisa um formulário. Sem código = formulário novo (o código sai do grupo e do nome).
create or replace function public.salvar_modelo_seg(p_codigo text, p_grupo text, p_nome text, p_itens jsonb, p_ativo boolean, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.seg_modelos;
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_itens jsonb;
  v_versao int;
  v_rev uuid;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo altera os formulários'; end if;
  if length(btrim(coalesce(p_nome, ''))) < 3 then raise exception 'Dê um nome ao formulário'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Diga o motivo da revisão'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Perguntas inválidas'; end if;
  select coalesce(jsonb_agg(btrim(x) order by o), '[]'::jsonb) into v_itens
  from jsonb_array_elements_text(p_itens) with ordinality t(x, o) where btrim(x) <> '';
  if jsonb_array_length(v_itens) = 0 then raise exception 'O formulário precisa de pelo menos uma pergunta'; end if;
  if (select count(distinct lower(x)) from jsonb_array_elements_text(v_itens) x) <> jsonb_array_length(v_itens) then
    raise exception 'Há perguntas repetidas';
  end if;

  if v_codigo is not null then
    select * into m from public.seg_modelos where codigo = v_codigo for update;
  end if;
  if m.codigo is null then
    if p_grupo not in ('maquina', 'alojamento', 'canteiro') then raise exception 'Escolha o tipo do formulário'; end if;
    v_codigo := coalesce(v_codigo, case when p_grupo = 'maquina' then 'maquina:' else p_grupo || ':' end
      || trim(both '-' from regexp_replace(lower(translate(btrim(p_nome), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '-', 'g')));
    if exists (select 1 from public.seg_modelos where codigo = v_codigo) then raise exception 'Já existe um formulário com esse nome'; end if;
    insert into public.seg_modelos (codigo, grupo, nome, itens, ativo, ordem, versao, atualizado_por)
    values (v_codigo, p_grupo, btrim(p_nome), v_itens, coalesce(p_ativo, true),
            coalesce((select max(ordem) + 10 from public.seg_modelos where grupo = p_grupo), 1000), 1, auth.uid());
    v_versao := 1;
  else
    if m.nome = btrim(p_nome) and m.itens = v_itens and m.ativo = coalesce(p_ativo, m.ativo) then
      raise exception 'Nada mudou no formulário';
    end if;
    v_versao := m.versao + 1;
    update public.seg_modelos
       set nome = btrim(p_nome), itens = v_itens, ativo = coalesce(p_ativo, m.ativo), versao = v_versao,
           atualizado_em = now(), atualizado_por = auth.uid()
     where codigo = v_codigo;
  end if;
  insert into public.seg_modelos_revisoes (codigo, versao, nome, itens, ativo, motivo, criado_por)
  values (v_codigo, v_versao, btrim(p_nome), v_itens, coalesce(p_ativo, coalesce(m.ativo, true)), btrim(p_motivo), auth.uid())
  returning id into v_rev;
  perform app.registrar_evento('seg_modelos_revisoes', v_rev, 'revisado', jsonb_build_object('codigo', v_codigo, 'versao', v_versao));
  return jsonb_build_object('codigo', v_codigo, 'versao', v_versao);
end $$;
revoke execute on function public.salvar_modelo_seg(text, text, text, jsonb, boolean, text) from anon, public;
grant execute on function public.salvar_modelo_seg(text, text, text, jsonb, boolean, text) to authenticated;
