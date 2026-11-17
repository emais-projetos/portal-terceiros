-- Segurança da obra: fornecedor e engenharia veem só o resumo (painel visual).
-- Conformidade, itens que mais aparecem como não conformes e ações de correção abertas. Vistoria completa,
-- fotos, assinaturas, moradores, fichas de máquina, termos e cadastros ficam só com o TST e o administrativo.
-- O resumo sai pronto das funções seg_resumo_obra (engenharia, TST, admin) e seg_resumo_fornecedor.

-- Leitura completa: só TST da obra e administrativo (antes incluía a engenharia).
create or replace function app.ve_obra_seguranca(p_obra uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.eh_admin() or p_obra in (select app.minhas_obras_tst());
$$;

drop policy leitura on public.seg_locadoras;
create policy leitura on public.seg_locadoras for select to authenticated
  using (app.eh_admin() or exists (select 1 from app.minhas_obras_tst()));
drop policy leitura on public.seg_modelos_revisoes;
create policy leitura on public.seg_modelos_revisoes for select to authenticated
  using (app.eh_admin() or exists (select 1 from app.minhas_obras_tst()));

-- Fornecedor deixa de ler a vistoria (e as fotos dela); continua lendo o próprio alojamento e os itens a regularizar.
drop policy leitura on public.seg_vistorias;
create policy leitura on public.seg_vistorias for select to authenticated using (app.ve_obra_seguranca(obra_id));

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
    return app.ve_obra_seguranca(v_obra);
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
    select a.obra_id into v_obra from public.seg_alojamentos a where a.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  end if;
  return false;
end $$;

-- Itens "Sim" e aplicáveis ("Sim" + "Não") de uma vistoria.
create or replace function app.seg_conta(p_itens jsonb, out sim int, out aplic int)
language sql immutable as $$
  select count(*) filter (where i->>'status' = 'sim')::int, count(*) filter (where i->>'status' in ('sim', 'nao'))::int
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i;
$$;

-- Resumo de um conjunto de vistorias concluídas (ids): conformidade, por mês e perguntas com mais "Não".
-- Roda dentro das funções de resumo (que já conferiram o acesso); sozinha não é chamável pela API.
create or replace function app.seg_bloco_vistorias(p_ids uuid[]) returns jsonb
language sql stable set search_path = public as $$
  with v as (
    select v.id, v.data_vistoria, v.itens, c.sim, c.aplic
    from public.seg_vistorias v cross join lateral app.seg_conta(v.itens) c where v.id = any (p_ids)
  )
  select jsonb_build_object(
    'conformidade', (select round(100.0 * sum(sim) / nullif(sum(aplic), 0), 1) from v),
    'vistorias', (select count(*) from v),
    'ultima', (select max(data_vistoria) from v),
    'meses', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'pct', pct, 'qtd', qtd) order by mes) from (
        select to_char(data_vistoria, 'YYYY-MM') mes, round(100.0 * sum(sim) / nullif(sum(aplic), 0), 1) pct, count(*) qtd from v group by 1) m), '[]'::jsonb),
    'mais_nao', coalesce((select jsonb_agg(jsonb_build_object('texto', texto, 'qtd', qtd) order by qtd desc, texto) from (
        select i->>'texto' texto, count(*) qtd from v cross join lateral jsonb_array_elements(v.itens) i
        where i->>'status' = 'nao' group by 1 order by 2 desc, 1 limit 6) t), '[]'::jsonb)
  );
$$;

-- Engenharia, TST e administrativo: painel da obra (sem acesso às vistorias).
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
        'alojamento', a.nome, 'fornecedor', e.razao_social, 'descricao', n.descricao, 'recomendacao', n.recomendacao,
        'prazo', n.prazo, 'situacao', n.situacao) order by n.prazo, a.nome)
      from public.seg_nao_conformidades n
      join public.seg_vistorias v on v.id = n.vistoria_id
      join public.seg_alojamentos a on a.id = v.alojamento_id
      join public.empresas e on e.id = n.empresa_id
      where v.obra_id = p_obra and n.situacao in ('aberta', 'reaberta', 'respondida')), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- Fornecedor: os alojamentos da empresa dele (só números) e os itens a regularizar.
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
        'id', n.id, 'alojamento', a.nome, 'obra', o.nome, 'descricao', n.descricao, 'recomendacao', n.recomendacao,
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

revoke execute on function app.seg_bloco_vistorias(uuid[]) from public;
revoke execute on function app.seg_conta(jsonb) from public;
revoke execute on function public.seg_resumo_obra(uuid, date) from anon, public;
revoke execute on function public.seg_resumo_fornecedor(date) from anon, public;
grant execute on function public.seg_resumo_obra(uuid, date) to authenticated;
grant execute on function public.seg_resumo_fornecedor(date) to authenticated;
