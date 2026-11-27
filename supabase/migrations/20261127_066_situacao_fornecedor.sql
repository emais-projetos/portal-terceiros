-- Situação do fornecedor: ativo, inativo ou bloqueado, sempre com motivo e histórico.
-- Inativo: não trabalha mais com a Emais (sai das listas e das cobranças). É o mesmo que empresas.ativa = falso.
-- Bloqueado: problema grave (fraude, reprovação, inadimplência). Não recebe convite da homologação, não é homologado,
-- não ganha portal, contrato nem obra nova. A engenharia e o TST veem o aviso no painel da obra; o fornecedor não vê o motivo.
-- O Suprimentos e o administrativo mudam a situação.

alter table public.empresas
  add column if not exists situacao_fornecedor text not null default 'ativo',
  add column if not exists situacao_motivo text,
  add column if not exists situacao_em timestamptz,
  add column if not exists situacao_por uuid references public.usuarios (id) on delete set null;
alter table public.empresas drop constraint if exists empresas_situacao_fornecedor_ck;
alter table public.empresas add constraint empresas_situacao_fornecedor_ck check (situacao_fornecedor in ('ativo', 'inativo', 'bloqueado'));
update public.empresas set situacao_fornecedor = 'inativo' where not ativa and situacao_fornecedor = 'ativo';

-- ativa e situacao_fornecedor andam juntas, e o fornecedor bloqueado não avança.
create or replace function app.antes_salvar_situacao_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.ativa and new.situacao_fornecedor = 'ativo' then new.situacao_fornecedor := 'inativo';
    else new.ativa := new.situacao_fornecedor <> 'inativo'; end if;
    return new;
  end if;
  if new.situacao_fornecedor is distinct from old.situacao_fornecedor then
    new.ativa := new.situacao_fornecedor <> 'inativo';
  elsif new.ativa is distinct from old.ativa then
    new.situacao_fornecedor := case when new.ativa then 'ativo' else 'inativo' end;
    new.situacao_motivo := null;
    new.situacao_em := now();
    new.situacao_por := auth.uid();
  end if;
  if new.situacao_fornecedor = 'bloqueado' then
    if old.portal_liberado_em is null and new.portal_liberado_em is not null then
      raise exception 'Fornecedor bloqueado: o portal não pode ser liberado';
    end if;
    if new.homologacao = 'homologada' and old.homologacao is distinct from 'homologada' then
      raise exception 'Fornecedor bloqueado: não pode ser homologado';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists empresas_situacao on public.empresas;
create trigger empresas_situacao before insert or update on public.empresas
  for each row execute function app.antes_salvar_situacao_empresa();

create or replace function app.fornecedor_bloqueado(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.empresas where id = p_empresa and situacao_fornecedor = 'bloqueado');
$$;
revoke all on function app.fornecedor_bloqueado(uuid) from public, anon, authenticated;

-- Obra nova, contrato novo e convite da homologação: recusados para fornecedor bloqueado.
create or replace function app.recusar_fornecedor_bloqueado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'empresas_obras' then
    if not new.ativo or (tg_op = 'UPDATE' and old.ativo) then return new; end if;
    if app.fornecedor_bloqueado(new.empresa_id) then raise exception 'Fornecedor bloqueado: não pode ser liberado em obra'; end if;
  elsif tg_table_name = 'contratos_fornecedor' then
    if app.fornecedor_bloqueado(new.empresa_id) then raise exception 'Fornecedor bloqueado: não pode receber contrato'; end if;
  elsif tg_table_name = 'envios_fila' then
    if new.tipo = 'convite_homologacao' and app.fornecedor_bloqueado(new.empresa_id) then
      raise exception 'Fornecedor bloqueado: o convite não é enviado';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists empresas_obras_bloqueio on public.empresas_obras;
create trigger empresas_obras_bloqueio before insert or update of ativo on public.empresas_obras
  for each row execute function app.recusar_fornecedor_bloqueado();
drop trigger if exists contratos_fornecedor_bloqueio on public.contratos_fornecedor;
create trigger contratos_fornecedor_bloqueio before insert on public.contratos_fornecedor
  for each row execute function app.recusar_fornecedor_bloqueado();
drop trigger if exists envios_fila_bloqueio on public.envios_fila;
create trigger envios_fila_bloqueio before insert on public.envios_fila
  for each row execute function app.recusar_fornecedor_bloqueado();

-- Mudança de situação pelo Suprimentos ou pelo administrativo.
create or replace function public.mudar_situacao_fornecedor(p_empresa uuid, p_situacao text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_motivo text := nullif(regexp_replace(btrim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), '');
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos e o administrativo mudam a situação do fornecedor'; end if;
  if coalesce(p_situacao, '') not in ('ativo', 'inativo', 'bloqueado') then raise exception 'Situação inválida'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Fornecedor não encontrado'; end if;
  if e.situacao_fornecedor = p_situacao then
    raise exception 'O fornecedor já está %', case p_situacao when 'ativo' then 'ativo' when 'inativo' then 'inativo' else 'bloqueado' end;
  end if;
  if p_situacao <> 'ativo' and length(coalesce(v_motivo, '')) < 5 then raise exception 'Escreva o motivo (pelo menos 5 letras)'; end if;
  if length(coalesce(v_motivo, '')) > 500 then raise exception 'O motivo pode ter até 500 letras'; end if;
  update public.empresas
     set situacao_fornecedor = p_situacao, situacao_motivo = v_motivo, situacao_em = now(), situacao_por = auth.uid()
   where id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'situacao_fornecedor_alterada',
    jsonb_build_object('de', e.situacao_fornecedor, 'para', p_situacao, 'motivo', v_motivo));
end $$;
revoke all on function public.mudar_situacao_fornecedor(uuid, text, text) from public, anon;
grant execute on function public.mudar_situacao_fornecedor(uuid, text, text) to authenticated;

-- Funções de antes, com a situação.
create or replace function public.fornecedores_cadastro(p_empresa uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.* from public.empresas e
    where app.eh_gestao_fornecedor() and (p_empresa is null or e.id = p_empresa)
  ),
  docs as (
    select distinct on (p.empresa_id, p.tipo_codigo) p.empresa_id, p.tipo_codigo, p.documento, p.impeditivo, p.situacao, p.vencimento
    from public.v_pendencias p
    where p.grupo = 'empresa' and p.empresa_id in (select id from emp)
    order by p.empresa_id, p.tipo_codigo,
      case p.situacao when 'vencido' then 1 when 'nao_enviado' then 2 when 'devolvido' then 3 when 'a_vencer' then 4 when 'em_analise' then 5 else 6 end
  ),
  colab as (
    select p.empresa_id,
      count(distinct p.colaborador_id) filter (where p.situacao = 'vencido') as com_vencido,
      count(distinct p.colaborador_id) filter (where p.situacao = 'a_vencer') as com_vencendo
    from public.v_pendencias p
    where p.grupo = 'colaborador' and p.empresa_id in (select id from emp)
    group by p.empresa_id
  ),
  aloc as (
    select c.empresa_id,
      count(distinct c.id) filter (where a.status <> 'encerrado') as em_obra,
      count(distinct c.id) filter (where a.status = 'liberado') as liberados
    from public.alocacoes a join public.colaboradores c on c.id = a.colaborador_id
    where c.empresa_id in (select id from emp) and c.situacao = 'ativo'
    group by c.empresa_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'ativa', e.ativa, 'homologacao', e.homologacao,
    'situacao', e.situacao_fornecedor, 'situacao_motivo', e.situacao_motivo, 'situacao_em', e.situacao_em,
    'situacao_por', (select u.nome from public.usuarios u where u.id = e.situacao_por),
    'historico_situacao', case when p_empresa is not null then coalesce((
      select jsonb_agg(jsonb_build_object('em', ev.criado_em, 'de', ev.detalhe ->> 'de', 'para', ev.detalhe ->> 'para', 'motivo', ev.detalhe ->> 'motivo',
                                          'quem', (select u.nome from public.usuarios u where u.id = ev.usuario_id)) order by ev.criado_em desc)
      from public.eventos ev where ev.tabela = 'empresas' and ev.registro_id = e.id and ev.acao = 'situacao_fornecedor_alterada'), '[]'::jsonb) end,
    'codigo_bp', e.codigo_bp, 'tipos', to_jsonb(e.tipos), 'exige_colaboradores', e.exige_colaboradores, 'exige_mensal', e.exige_mensal, 'liberado_em', e.portal_liberado_em, 'email_acesso', e.email_acesso, 'emails_contato', e.email_contato,
    'dados', coalesce(h.dados, '{}'::jsonb) - 'referencias' - 'email',
    'subcontratada', exists (select 1 from public.empresas_obras eo where eo.empresa_id = e.id and eo.ativo)
                     and not exists (select 1 from public.empresas_obras eo where eo.empresa_id = e.id and eo.ativo and not eo.subcontratada),
    'obras', coalesce((select jsonb_agg(o.nome order by o.nome) from public.empresas_obras eo join public.obras o on o.id = eo.obra_id
                       where eo.empresa_id = e.id and eo.ativo and o.ativa), '[]'::jsonb),
    'contratos_ativos', (select count(*) from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo'),
    'proximo_termino', (select min(c.termino) from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo'),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('nome', d.documento, 'situacao', d.situacao, 'vencimento', d.vencimento, 'impeditivo', d.impeditivo)
                            order by d.documento) from docs d where d.empresa_id = e.id), '[]'::jsonb),
    'certidoes', coalesce((
      select jsonb_agg(jsonb_build_object('nome', t.nome, 'vencimento', x.vencimento) order by x.vencimento)
      from public.homologacao_documentos x join public.homologacao_tipos t on t.codigo = x.tipo_codigo
      where x.empresa_id = e.id and x.status = 'aprovado' and x.vencimento is not null and x.vencimento <= current_date + 15
        and not exists (select 1 from public.homologacao_documentos n where n.empresa_id = x.empresa_id and n.tipo_codigo = x.tipo_codigo
                        and n.status = 'em_analise' and n.enviado_em > x.enviado_em)), '[]'::jsonb),
    'colaboradores', jsonb_build_object('em_obra', coalesce(al.em_obra, 0), 'liberados', coalesce(al.liberados, 0),
                                        'com_vencido', coalesce(cl.com_vencido, 0), 'com_vencendo', coalesce(cl.com_vencendo, 0))
  ) order by e.razao_social), '[]'::jsonb)
  from emp e
  left join public.homologacoes h on h.empresa_id = e.id
  left join colab cl on cl.empresa_id = e.id
  left join aloc al on al.empresa_id = e.id;
$$;

create or replace function public.fornecedores_para_liberar() returns table (
  empresa_id uuid, razao_social text, cnpj text, homologada_em timestamptz, obras text[], email text)
language sql stable security definer set search_path = public as $$
  select e.id, e.razao_social, e.cnpj, e.homologada_em,
         array(select distinct o.nome from public.contratos_fornecedor c join public.contratos_obras co on co.contrato_id = c.id
               join public.obras o on o.id = co.obra_id where c.empresa_id = e.id and c.situacao = 'ativo' order by o.nome),
         app.emails_notificacao(e.email_acesso, e.email_contato)
  from public.empresas e
  where app.eh_gestao_fornecedor() and e.homologacao = 'homologada' and e.portal_liberado_em is null and e.situacao_fornecedor = 'ativo'
    and exists (select 1 from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo')
  order by e.homologada_em;
$$;

create or replace function public.painel_obra(p_obra uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  resultado jsonb;
  v_empresas uuid[];  -- nulo: todas as empresas da obra; fornecedor: só as dele
begin
  if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then
    v_empresas := array(select app.minhas_empresas());
    if cardinality(v_empresas) = 0 or p_obra not in (select app.obras_do_fornecedor()) then
      raise exception 'Obra fora do seu acesso';
    end if;
  end if;

  -- Pendências calculadas uma vez para a obra inteira (a visão é pesada; por colaborador ficaria lento).
  with pend as (
    select p.alocacao_id, p.documento, p.grupo, p.situacao, p.vencimento
    from public.v_pendencias p
    where p.obra_id = p_obra and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido', 'em_analise', 'a_vencer')
      and (v_empresas is null or p.empresa_id = any (v_empresas))
  ), por_alocacao as (
    select alocacao_id,
      jsonb_agg(jsonb_build_object('documento', documento, 'grupo', grupo, 'situacao', situacao, 'vencimento', vencimento) order by documento)
        filter (where situacao <> 'a_vencer') as pendencias,
      jsonb_agg(jsonb_build_object('documento', documento, 'grupo', grupo, 'vencimento', vencimento) order by vencimento)
        filter (where situacao = 'a_vencer') as a_vencer
    from pend group by alocacao_id
  )
  select jsonb_build_object(
    'obra', (select nome from public.obras where id = p_obra),
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alocacao_id', a.alocacao_id, 'colaborador', a.colaborador, 'funcao', a.funcao, 'empresa_id', a.empresa_id, 'empresa', a.empresa,
        'status', a.status, 'data_integracao', a.data_integracao, 'vencimento_integracao', a.vencimento_integracao,
        'liberado_em', a.validado_tst_em,
        'bloqueado', a.bloqueado, 'bloqueio_motivo', a.bloqueio_motivo,
        'mensal', coalesce((select x.exige_mensal from public.empresas x where x.id = a.empresa_id), true),
        -- Bloqueio do fornecedor: só para a Emais (o fornecedor não vê o motivo).
        'fornecedor_bloqueado', v_empresas is null and app.fornecedor_bloqueado(a.empresa_id),
        'fornecedor_bloqueio_motivo', case when v_empresas is null then (select x.situacao_motivo from public.empresas x where x.id = a.empresa_id and x.situacao_fornecedor = 'bloqueado') end,
        'pendencias', coalesce(pa.pendencias, '[]'::jsonb),
        'a_vencer', coalesce(pa.a_vencer, '[]'::jsonb)
      ) order by a.empresa, a.colaborador)
      from public.v_alocacoes_resumo a
      left join por_alocacao pa on pa.alocacao_id = a.alocacao_id
      where a.obra_id = p_obra and a.status <> 'encerrado'
        and (v_empresas is null or a.empresa_id = any (v_empresas))
    ), '[]'::jsonb),
    'medicoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'empresa_id', m.empresa_id, 'empresa', m.empresa, 'competencia', m.competencia, 'prazo', m.prazo,
        'tolerancia', m.tolerancia, 'status', m.status, 'retida', m.retida, 'em_atraso', m.em_atraso,
        'cnpj', m.cnpj, 'obra', m.obra, 'origem', m.origem,
        'prazo_combinado', m.prazo_combinado, 'primeiro_envio_em', m.primeiro_envio_em, 'ultima_analise_em', m.ultima_analise_em,
        'itens_pendentes', coalesce((
          select jsonb_agg(t.item || '. ' || t.nome order by t.ordem)
          from public.medicoes_itens i join public.tipos_medicao t on t.codigo = i.tipo_codigo
          where i.medicao_id = m.id and t.impeditivo and i.status in ('nao_enviado', 'devolvido')
        ), '[]'::jsonb)
      ) order by m.competencia desc, m.empresa)
      from public.v_medicoes m
      where (v_empresas is null or m.empresa_id = any (v_empresas))
        and (m.obra_id = p_obra
         or (m.obra_id is null and m.empresa_id in (
              select c.empresa_id from public.alocacoes a join public.colaboradores c on c.id = a.colaborador_id
              where a.obra_id = p_obra)))
    ), '[]'::jsonb),
    'integracoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'data', i.data, 'horario', i.horario, 'local', i.local, 'responsavel', i.responsavel,
        'concluida_em', i.concluida_em,
        'participantes', (select count(*) from public.integracoes_participantes x where x.integracao_id = i.id),
        'presentes', (select count(*) from public.integracoes_participantes x where x.integracao_id = i.id and x.presente)
      ) order by i.data desc)
      from public.integracoes i
      where i.obra_id = p_obra and i.cancelada_em is null and i.data >= current_date - 90
        and v_empresas is null
    ), '[]'::jsonb)
  ) into resultado;
  return resultado;
end $$;
