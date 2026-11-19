-- Alojamento na obra (Emais) com vistoria por quarto e pendências da Emais.
--
-- 1. Alojamento ganha tipo: 'padrao' (fornecedor ou Emais, checklist NR-18 de sempre) ou 'obra' (alojamento da Emais
--    dentro da obra, dividido em quartos, ex.: Casas Mais Parque Barretos). O de obra é sempre da Emais.
-- 2. Vistoria do alojamento na obra: o TST inclui os quartos que vistoriou no dia (quartos: nome e tipo de cama) e, em
--    cada um, quem está usando (colaboradores liberados na obra, de qualquer empresa, ou nome à mão). Cada quarto recebe
--    o checklist de quartos; as áreas comuns (banheiros, chuveiros, refeição) entram uma vez por vistoria. Os itens
--    continuam numa lista só (itens), cada um com o quarto (nulo = áreas comuns), então nota e painéis seguem iguais.
-- 3. Quem corrige: no alojamento na obra, "limpo e organizado" vai para todas as empresas com morador no quarto; o resto
--    é da Emais. Item da Emais vira pendência sem fornecedor (empresa nula): a engenharia da obra responde com foto do
--    que foi feito e o TST aceita ou devolve. Vale também para os alojamentos cadastrados como da Emais.
-- 4. Moradores: o TST escolhe entre os colaboradores liberados na obra (do fornecedor responsável, ou de todos no
--    alojamento da Emais). Morador ausente fica marcado; quem não sabe assinar ganha registro eletrônico com código na
--    conclusão.

-- ---------------------------------------------------------------------------------------------- Cadastro
alter table public.seg_alojamentos add column tipo text not null default 'padrao' check (tipo in ('padrao', 'obra'));
alter table public.seg_alojamentos add constraint seg_alojamento_obra_emais check (tipo <> 'obra' or empresa_id is null);
comment on column public.seg_alojamentos.tipo is 'padrao: checklist NR-18 do alojamento inteiro. obra: alojamento da Emais na obra, vistoria por quarto.';

alter table public.seg_vistorias add column quartos jsonb not null default '[]'::jsonb check (jsonb_typeof(quartos) = 'array');
comment on column public.seg_vistorias.quartos is 'Alojamento na obra: quartos vistoriados [{nome, cama: beliche|simples|ambas}]. Itens e moradores apontam o quarto pelo nome.';

-- ---------------------------------------------------------------------------------------------- Formulários
insert into public.seg_modelos (codigo, grupo, nome, itens, ativo, ordem, versao) values
  ('alojamento:obra-quarto', 'alojamento', 'Alojamento na obra: quarto', $t$[
    "Possui armários individuais duplos com separação para guarda de roupas dos trabalhadores?",
    "Possui área mínima de 3,00 m² por módulo cama/armário, incluindo a área de circulação?",
    "Alojamento está devidamente limpo e organizado?",
    "As instalações elétricas estão devidamente protegidas?",
    "Possui bebedouro com filtro para fornecimento de água potável e fresca?",
    "A cama superior do beliche tem proteção lateral e escada?",
    "As dimensões mínimas das camas são de 0,80m por 1,90 m de distância entre o ripamento do estrado de 0,05m, colchão com densidade 26 e espessura mínima de 0,10m?",
    "Possui roupa de cama fornecida pela empresa?",
    "O forro e/ou laje do alojamento está em boas condições de conservação e segurança?",
    "A pintura interna e externa do alojamento está em boas condições de conservação?",
    "As porta e janelas possuem trincos e/ou fechaduras que garantem a segurança dos trabalhadores?",
    "As portas e janelas estão em boas condições de conservação?",
    "O piso do alojamento está em boas condições de conservação?"
  ]$t$::jsonb, true, 20, 1),
  ('alojamento:obra-areas-comuns', 'alojamento', 'Alojamento na obra: áreas comuns', $t$[
    "Possui chuveiro na proporção de 1 (um) para cada grupo de 10 (dez) trabalhadores ou fração?",
    "Os chuveiros estão aterrados adequadamente?",
    "Os chuveiros dispõem de água quente?",
    "Dispõem de saboneteira?",
    "As instalações sanitárias possuem revestimento adequado que permite a higienização?",
    "Possui mesa e cadeira para realização das refeições?",
    "Possui cesto de lixo com tampa?"
  ]$t$::jsonb, true, 30, 1);
insert into public.seg_modelos_revisoes (codigo, versao, nome, itens, ativo, motivo)
select codigo, 1, nome, itens, true, 'Versão inicial (checklist de quartos do alojamento da obra de Barretos)'
from public.seg_modelos where codigo in ('alojamento:obra-quarto', 'alojamento:obra-areas-comuns');

-- ---------------------------------------------------------------------------------------------- Regras
-- Item que vai para as empresas dos moradores do quarto (o resto do alojamento na obra é estrutura da Emais).
create or replace function app.seg_item_ocupantes(p_texto text) returns boolean
language sql immutable as $$
  select coalesce(p_texto, '') ~* '(limp|organiz)';
$$;

create or replace function app.engenharia_da_obra(p_obra uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tst_obras t join public.usuarios u on u.id = t.usuario_id
    where t.usuario_id = auth.uid() and t.obra_id = p_obra and u.perfil = 'engenharia' and u.ativo);
$$;

create or replace function app.seg_obra_da_vistoria(p_vistoria uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select obra_id from public.seg_vistorias where id = p_vistoria;
$$;

create or replace function app.seg_antes_gravar_vistoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_grupo text;
  v_obra uuid;
  v_tipo text;
begin
  select grupo into v_grupo from public.seg_modelos where codigo = new.modelo_codigo;
  if v_grupo = 'alojamento' then
    if new.alojamento_id is null then raise exception 'Escolha o alojamento'; end if;
    select obra_id, tipo into v_obra, v_tipo from public.seg_alojamentos where id = new.alojamento_id;
    if v_obra is distinct from new.obra_id then raise exception 'O alojamento não é desta obra'; end if;
    if new.modelo_codigo = 'alojamento:obra-areas-comuns' or (v_tipo = 'obra') <> (new.modelo_codigo = 'alojamento:obra-quarto') then
      raise exception 'Este formulário não é do tipo deste alojamento';
    end if;
  elsif v_grupo = 'canteiro' then
    new.alojamento_id := null;
  else
    raise exception 'Modelo de checklist inválido para vistoria';
  end if;
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, auth.uid());
    new.modelo_versao := coalesce(new.modelo_versao, (select versao from public.seg_modelos where codigo = new.modelo_codigo));
  elsif jsonb_array_length(new.itens) <> jsonb_array_length(old.itens)
        and exists (select 1 from public.seg_nao_conformidades n where n.vistoria_id = new.id) then
    raise exception 'Esta vistoria já tem itens enviados para correção: não dá para incluir ou tirar quartos. Faça uma vistoria nova.';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

-- Moradores: colaboradores liberados na obra (de uma empresa ou de todas).
create or replace function public.seg_moradores_obra(p_obra uuid, p_empresa uuid default null)
returns table (id uuid, nome text, funcao text, empresa_id uuid, empresa text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.tst_da_obra(p_obra) then raise exception 'Obra fora do seu acesso'; end if;
  return query
    select distinct c.id, c.nome, coalesce(f.nome, c.funcao_texto), c.empresa_id, e.razao_social
    from public.alocacoes al
    join public.colaboradores c on c.id = al.colaborador_id
    join public.empresas e on e.id = c.empresa_id
    left join public.funcoes f on f.id = c.funcao_id
    where al.obra_id = p_obra and al.status = 'liberado' and c.situacao = 'ativo'
      and (p_empresa is null or c.empresa_id = p_empresa)
    order by e.razao_social, c.nome;
end $$;
revoke execute on function public.seg_moradores_obra(uuid, uuid) from anon, public;
grant execute on function public.seg_moradores_obra(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------- Conclusão
create or replace function public.concluir_vistoria_seg(p_vistoria uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.seg_vistorias;
  n record;
  v_tipo text;
  v_quarto text;
  v_dias int := coalesce(app.param_int('seg_dias_fotos'), 30);
begin
  select * into v from public.seg_vistorias where id = p_vistoria for update;
  if v.id is null then raise exception 'Vistoria não encontrada'; end if;
  if not app.tst_da_obra(v.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo conclui a vistoria'; end if;
  if v.situacao = 'concluida' then raise exception 'A vistoria já foi concluída'; end if;
  if exists (select 1 from jsonb_array_elements(v.itens) i where i->>'status' is null) then
    raise exception 'Responda todos os itens antes de concluir (sim, não ou não se aplica)';
  end if;
  if exists (select 1 from jsonb_array_elements(v.funcionarios) p where btrim(coalesce(p->>'nome', '')) = '') then
    raise exception 'Há morador sem nome. Preencha ou tire da lista.';
  end if;
  select tipo into v_tipo from public.seg_alojamentos where id = v.alojamento_id;
  if v_tipo = 'obra' then
    select q->>'nome' into v_quarto from jsonb_array_elements(v.quartos) q where coalesce(q->>'cama', '') not in ('beliche', 'simples', 'ambas') limit 1;
    if found then raise exception 'Informe o tipo de cama do %', coalesce(nullif(v_quarto, ''), 'quarto'); end if;
  end if;

  select * into n from app.seg_nota(v.itens);
  update public.seg_vistorias
     set situacao = 'concluida', concluida_em = now(), concluida_por = auth.uid(),
         pontuacao = n.pontuacao, classificacao = n.classificacao,
         fotos_expiram_em = now() + make_interval(days => v_dias),
         qtd_funcionarios = case when v_tipo = 'obra' then jsonb_array_length(v.funcionarios) else v.qtd_funcionarios end,
         -- Quem não sabe assinar: registro eletrônico com código, data e hora e quem registrou (o TST que concluiu).
         funcionarios = coalesce((
           select jsonb_agg(case when coalesce((p->>'nao_assina')::boolean, false) and coalesce(p->>'codigo', '') = ''
                                 then p || jsonb_build_object('codigo', app.codigo_assinatura(), 'registrado_em', now(), 'registrado_por', auth.uid())
                                 else p end order by o)
           from jsonb_array_elements(v.funcionarios) with ordinality t(p, o)), '[]'::jsonb)
   where id = p_vistoria;
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'concluida',
    jsonb_build_object('pontuacao', n.pontuacao, 'classificacao', n.classificacao));
  return jsonb_build_object('pontuacao', n.pontuacao, 'classificacao', n.classificacao, 'fotos_expiram_em', now() + make_interval(days => v_dias));
end $$;

-- ---------------------------------------------------------------------------------------------- Itens a corrigir
-- empresa nula = pendência da Emais (engenharia da obra responde). Um item de limpeza pode ir para várias empresas.
alter table public.seg_nao_conformidades alter column empresa_id drop not null;
alter table public.seg_nao_conformidades add column quarto text;
alter table public.seg_nao_conformidades drop constraint seg_nao_conformidades_vistoria_id_item_key;
create unique index seg_nc_item_destino on public.seg_nao_conformidades
  (vistoria_id, item, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)));

drop policy leitura on public.seg_nao_conformidades;
create policy leitura on public.seg_nao_conformidades for select to authenticated
  using (empresa_id in (select app.minhas_empresas())
         or app.ve_obra_seguranca(app.seg_obra_da_vistoria(vistoria_id))
         or (empresa_id is null and app.engenharia_da_obra(app.seg_obra_da_vistoria(vistoria_id))));

create or replace function public.notificar_nao_conformidades(p_vistoria uuid, p_itens int[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v public.seg_vistorias;
  a public.seg_alojamentos;
  v_qtd int := 0;
  v_quarto text;
  v_destinos uuid[];
  d uuid;
  r record;
begin
  select * into v from public.seg_vistorias where id = p_vistoria;
  if v.id is null then raise exception 'Vistoria não encontrada'; end if;
  if not app.tst_da_obra(v.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo envia os itens a corrigir'; end if;
  if v.situacao <> 'concluida' then raise exception 'Conclua a vistoria antes de enviar os itens'; end if;
  select * into a from public.seg_alojamentos where id = v.alojamento_id;
  if a.empresa_a_vincular is not null then raise exception 'Vincule o responsável pelo alojamento antes de enviar os itens'; end if;

  for r in
    select (ord - 1)::int pos, i from jsonb_array_elements(v.itens) with ordinality t(i, ord)
    where i->>'status' = 'nao' and (p_itens is null or (ord - 1)::int = any (p_itens))
  loop
    v_quarto := nullif(btrim(coalesce(r.i->>'quarto', '')), '');
    if a.tipo = 'obra' and v_quarto is not null and app.seg_item_ocupantes(r.i->>'texto') then
      select array_agg(distinct (p->>'empresa_id')::uuid) into v_destinos
      from jsonb_array_elements(v.funcionarios) p
      where p->>'quarto' = v_quarto and nullif(p->>'empresa_id', '') is not null;
      if v_destinos is null then v_destinos := array[null::uuid]; end if;
    else
      v_destinos := array[a.empresa_id];
    end if;
    foreach d in array v_destinos loop
      insert into public.seg_nao_conformidades (vistoria_id, item, empresa_id, quarto, descricao, recomendacao, prazo, criado_por)
      values (p_vistoria, r.pos, d, v_quarto, r.i->>'texto', nullif(btrim(coalesce(r.i->>'recomendacao', '')), ''),
              coalesce(nullif(r.i->>'prazo', '')::date, current_date + coalesce(app.param_int('seg_prazo_padrao'), 7)), auth.uid())
      on conflict (vistoria_id, item, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid))) do nothing;
      if found then v_qtd := v_qtd + 1; end if;
    end loop;
  end loop;
  if v_qtd = 0 then raise exception 'Nenhum item "não" novo para enviar'; end if;
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'fornecedor_notificado', jsonb_build_object('itens', v_qtd));
  return v_qtd;
end $$;

create or replace function public.responder_nao_conformidade(p_nc uuid, p_resposta text, p_fotos jsonb default '[]'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  n public.seg_nao_conformidades;
  v_obra uuid;
  f text;
begin
  select * into n from public.seg_nao_conformidades where id = p_nc for update;
  if n.id is null then raise exception 'Item não encontrado'; end if;
  v_obra := app.seg_obra_da_vistoria(n.vistoria_id);
  if n.empresa_id is null then
    if not (app.engenharia_da_obra(v_obra) or app.tst_da_obra(v_obra)) then raise exception 'Esta pendência é da engenharia da obra'; end if;
  elsif not (n.empresa_id in (select app.minhas_empresas()) or app.eh_admin()) then
    raise exception 'Este item não é da sua empresa';
  end if;
  if n.situacao not in ('aberta', 'reaberta') then raise exception 'Este item já foi respondido'; end if;
  if length(btrim(coalesce(p_resposta, ''))) < 5 then raise exception 'Descreva o que foi feito para regularizar'; end if;
  if jsonb_typeof(coalesce(p_fotos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 5 then
    raise exception 'Envie até 5 fotos';
  end if;
  for f in select jsonb_array_elements_text(coalesce(p_fotos, '[]'::jsonb)) loop
    if left(f, length('nc/' || p_nc || '/')) <> 'nc/' || p_nc || '/' then raise exception 'Foto fora da pasta do item'; end if;
  end loop;
  update public.seg_nao_conformidades
     set situacao = 'respondida', resposta = btrim(p_resposta), resposta_fotos = coalesce(p_fotos, '[]'::jsonb),
         respondida_em = now(), respondida_por = auth.uid()
   where id = p_nc;
  perform app.registrar_evento('seg_nao_conformidades', p_nc, 'respondida', jsonb_build_object('fotos', jsonb_array_length(coalesce(p_fotos, '[]'::jsonb))));
end $$;

-- Fotos: a engenharia vê as fotos do problema das pendências da Emais e grava as fotos da correção.
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
    select v.obra_id, v.situacao into v_obra, v_situacao from public.seg_vistorias v where v.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return v_situacao = 'rascunho' and app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra)
      or (app.engenharia_da_obra(v_obra) and exists (
            select 1 from public.seg_nao_conformidades n join public.seg_vistorias v on v.id = n.vistoria_id
            where n.vistoria_id = v_id and n.empresa_id is null and coalesce(v.itens->n.item->'fotos', '[]'::jsonb) ? p_caminho));
  elsif partes[1] = 'nc' then
    select v.obra_id, n.empresa_id, n.situacao into v_obra, v_empresa, v_situacao
    from public.seg_nao_conformidades n join public.seg_vistorias v on v.id = n.vistoria_id where n.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then
      return v_situacao in ('aberta', 'reaberta')
        and (v_empresa in (select app.minhas_empresas()) or app.eh_admin()
             or (v_empresa is null and (app.engenharia_da_obra(v_obra) or app.tst_da_obra(v_obra))));
    end if;
    return app.ve_obra_seguranca(v_obra) or v_empresa in (select app.minhas_empresas())
      or (v_empresa is null and app.engenharia_da_obra(v_obra));
  elsif partes[1] = 'ficha' then
    select m.obra_id into v_obra
    from public.seg_fichas_maquina f join public.seg_maquinas m on m.id = f.maquina_id where f.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  elsif partes[1] = 'termo' then
    select a.obra_id into v_obra from public.seg_alojamentos a where a.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  end if;
  return false;
end $$;

-- Pendências da Emais de uma obra (engenharia, TST e administrativo), com as fotos do problema.
create or replace function public.seg_pendencias_emais(p_obra uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (app.engenharia_da_obra(p_obra) or app.tst_da_obra(p_obra)) then raise exception 'Obra fora do seu acesso'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'alojamento', coalesce(a.nome, 'Canteiro de obras'), 'obra', o.nome, 'quarto', n.quarto,
      'descricao', n.descricao, 'recomendacao', n.recomendacao, 'prazo', n.prazo, 'situacao', n.situacao,
      'resposta', n.resposta, 'resposta_fotos', n.resposta_fotos, 'respondida_em', n.respondida_em,
      'motivo_reabertura', n.motivo_reabertura, 'avaliada_em', n.avaliada_em, 'vistoria_id', v.id, 'data_vistoria', v.data_vistoria,
      'fotos_problema', case when v.fotos_excluidas_em is null then coalesce(v.itens->n.item->'fotos', '[]'::jsonb) else '[]'::jsonb end)
      order by n.prazo, a.nome, n.quarto)
    from public.seg_nao_conformidades n
    join public.seg_vistorias v on v.id = n.vistoria_id
    join public.obras o on o.id = v.obra_id
    left join public.seg_alojamentos a on a.id = v.alojamento_id
    where v.obra_id = p_obra and n.empresa_id is null
      and (n.situacao <> 'regularizada' or n.avaliada_em >= now() - interval '60 days')), '[]'::jsonb);
end $$;
revoke execute on function public.seg_pendencias_emais(uuid) from anon, public;
grant execute on function public.seg_pendencias_emais(uuid) to authenticated;

-- Painéis: itens da Emais aparecem como "Emais"; o quarto vai junto.
create or replace function public.seg_resumo_obra(p_obra uuid, p_desde date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_aloj uuid[];
  v_cant uuid[];
  r jsonb;
begin
  if not (app.ve_obra_seguranca(p_obra) or p_obra in (select app.minhas_obras_painel())) then
    raise exception 'Obra fora do seu acesso';
  end if;
  select coalesce(array_agg(id) filter (where alojamento_id is not null), '{}'), coalesce(array_agg(id) filter (where alojamento_id is null), '{}')
    into v_aloj, v_cant
  from public.seg_vistorias where obra_id = p_obra and situacao = 'concluida' and data_vistoria >= p_desde;

  select jsonb_build_object(
    'metas', jsonb_build_object('alojamento', coalesce(app.param_int('seg_meta_alojamento'), 90), 'canteiro', coalesce(app.param_int('seg_meta_canteiro'), 85)),
    'alojamento', app.seg_bloco_vistorias(v_aloj) || jsonb_build_object(
      'por_alojamento', coalesce((
        select jsonb_agg(jsonb_build_object('nome', nome, 'pct', pct, 'data', data_vistoria) order by pct, nome) from (
          select distinct on (v.alojamento_id) a.nome, v.data_vistoria, round(100.0 * c.sim / nullif(c.aplic, 0), 1) pct
          from public.seg_vistorias v join public.seg_alojamentos a on a.id = v.alojamento_id cross join lateral app.seg_conta(v.itens) c
          where v.id = any (v_aloj) order by v.alojamento_id, v.data_vistoria desc) u), '[]'::jsonb),
      'alojamentos_ativos', (select count(*) from public.seg_alojamentos where obra_id = p_obra and ativo)),
    'canteiro', app.seg_bloco_vistorias(v_cant),
    'maquinas', (
      select jsonb_build_object(
        'conformidade', round(100.0 * count(*) filter (where s = 'ok') / nullif(count(*) filter (where s in ('ok', 'nc')), 0), 1),
        'dias', count(distinct (f.id, d.k)),
        'nao_conformes', count(*) filter (where s = 'nc'),
        'mais_nc', coalesce((
          select jsonb_agg(jsonb_build_object('texto', texto, 'qtd', qtd) order by qtd desc, texto) from (
            select f2.itens->>(o2 - 1)::int texto, count(*) qtd
            from public.seg_fichas_maquina f2 join public.seg_maquinas m2 on m2.id = f2.maquina_id
            cross join lateral jsonb_each(f2.dias) d2(k, v)
            cross join lateral jsonb_array_elements_text(d2.v->'statuses') with ordinality x2(s, o2)
            where m2.obra_id = p_obra and (f2.competencia + (d2.k::int - 1)) >= p_desde and x2.s = 'nc'
            group by 1 order by 2 desc, 1 limit 5) t), '[]'::jsonb))
      from public.seg_fichas_maquina f join public.seg_maquinas m on m.id = f.maquina_id
      cross join lateral jsonb_each(f.dias) d(k, v)
      cross join lateral jsonb_array_elements_text(d.v->'statuses') x(s)
      where m.obra_id = p_obra and (f.competencia + (d.k::int - 1)) >= p_desde),
    'acoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alojamento', coalesce(a.nome, 'Canteiro de obras'), 'quarto', n.quarto, 'fornecedor', coalesce(e.razao_social, 'Emais'), 'emais', n.empresa_id is null,
        'descricao', n.descricao, 'recomendacao', n.recomendacao, 'prazo', n.prazo, 'situacao', n.situacao) order by n.prazo, a.nome, n.quarto)
      from public.seg_nao_conformidades n
      join public.seg_vistorias v on v.id = n.vistoria_id
      left join public.seg_alojamentos a on a.id = v.alojamento_id
      left join public.empresas e on e.id = n.empresa_id
      where v.obra_id = p_obra and n.situacao in ('aberta', 'reaberta', 'respondida')), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function public.seg_resumo_fornecedor(p_desde date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[];
  r jsonb;
begin
  if not exists (select 1 from app.minhas_empresas()) then raise exception 'Disponível só para fornecedores'; end if;
  select coalesce(array_agg(v.id), '{}') into v_ids
  from public.seg_vistorias v join public.seg_alojamentos a on a.id = v.alojamento_id
  where a.empresa_id in (select app.minhas_empresas()) and v.situacao = 'concluida' and v.data_vistoria >= p_desde;

  select jsonb_build_object(
    'meta', coalesce(app.param_int('seg_meta_alojamento'), 90),
    'periodo', app.seg_bloco_vistorias(v_ids),
    'alojamentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'obra', o.nome, 'data', u.data_vistoria, 'pct', u.pct) order by a.nome)
      from public.seg_alojamentos a join public.obras o on o.id = a.obra_id
      left join lateral (
        select v.data_vistoria, round(100.0 * c.sim / nullif(c.aplic, 0), 1) pct
        from public.seg_vistorias v cross join lateral app.seg_conta(v.itens) c
        where v.alojamento_id = a.id and v.situacao = 'concluida' order by v.data_vistoria desc limit 1) u on true
      where a.empresa_id in (select app.minhas_empresas()) and a.ativo), '[]'::jsonb),
    'acoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'alojamento', a.nome, 'quarto', n.quarto, 'obra', o.nome, 'descricao', n.descricao, 'recomendacao', n.recomendacao,
        'prazo', n.prazo, 'situacao', n.situacao, 'resposta', n.resposta, 'resposta_fotos', n.resposta_fotos,
        'respondida_em', n.respondida_em, 'motivo_reabertura', n.motivo_reabertura, 'avaliada_em', n.avaliada_em) order by n.prazo, a.nome)
      from public.seg_nao_conformidades n
      join public.seg_vistorias v on v.id = n.vistoria_id
      join public.seg_alojamentos a on a.id = v.alojamento_id
      join public.obras o on o.id = v.obra_id
      where n.empresa_id in (select app.minhas_empresas())
        and (n.situacao <> 'regularizada' or n.avaliada_em >= p_desde)), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function app.engenharia_da_obra(uuid) from public;
revoke execute on function app.seg_obra_da_vistoria(uuid) from public;
grant execute on function app.engenharia_da_obra(uuid) to authenticated;
grant execute on function app.seg_obra_da_vistoria(uuid) to authenticated;
