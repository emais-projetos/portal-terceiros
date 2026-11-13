-- Encerramento de obra.
-- Situação da obra: ativa -> em_encerramento -> encerrada (e pode ser reaberta).
--   Em encerramento: a obra continua aparecendo, mas não recebe ninguém novo (colaborador, empresa, pedido de acesso
--   ou integração). A Emais confere as movimentações dos colaboradores que ainda estão nela.
--   Encerrada: a Emais confirma o fechamento. As alocações abertas são encerradas, as empresas saem da obra, pedidos
--   pendentes são recusados e integrações agendadas são canceladas. A obra some da gestão de terceiros
--   (painel, fornecedor, TST, engenharia, pedidos e cobranças) e fica no histórico.

alter table public.obras
  add column if not exists situacao text not null default 'ativa',
  add column if not exists encerramento_iniciado_em timestamptz,
  add column if not exists encerrada_em date,
  add column if not exists encerrada_por uuid references public.usuarios (id),
  add column if not exists encerramento_obs text;

update public.obras set situacao = case when ativa then 'ativa' else 'encerrada' end;

alter table public.obras drop constraint if exists obras_situacao_check;
alter table public.obras add constraint obras_situacao_check
  check (situacao in ('ativa', 'em_encerramento', 'encerrada') and ativa = (situacao <> 'encerrada'));

-- Obra que não está ativa não recebe ninguém novo.
create or replace function app.obra_recebe_entrada() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_situacao text;
  v_nome text;
begin
  if tg_table_name = 'empresas_obras' then
    if not new.ativo then return new; end if;
    if tg_op = 'UPDATE' then
      if old.ativo and old.obra_id = new.obra_id then return new; end if;
    end if;
  elsif tg_table_name = 'alocacoes' and tg_op = 'UPDATE' then
    if old.obra_id = new.obra_id then return new; end if;
  end if;
  select situacao, nome into v_situacao, v_nome from public.obras where id = new.obra_id;
  if v_situacao = 'em_encerramento' then
    raise exception 'A obra % está em encerramento e não recebe novos colaboradores, empresas ou integrações.', v_nome using errcode = '22023';
  elsif v_situacao = 'encerrada' then
    raise exception 'A obra % está encerrada.', v_nome using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists obra_recebe_entrada on public.alocacoes;
create trigger obra_recebe_entrada before insert or update of obra_id on public.alocacoes
  for each row execute function app.obra_recebe_entrada();
drop trigger if exists obra_recebe_entrada on public.empresas_obras;
create trigger obra_recebe_entrada before insert or update of ativo, obra_id on public.empresas_obras
  for each row execute function app.obra_recebe_entrada();
drop trigger if exists obra_recebe_entrada on public.pedidos_obra;
create trigger obra_recebe_entrada before insert on public.pedidos_obra
  for each row execute function app.obra_recebe_entrada();
drop trigger if exists obra_recebe_entrada on public.integracoes;
create trigger obra_recebe_entrada before insert on public.integracoes
  for each row execute function app.obra_recebe_entrada();

-- Painel: devolve também a situação da obra (para o selo "Em encerramento").
drop function if exists public.painel_obras();
create function public.painel_obras() returns table (id uuid, nome text, situacao text)
language sql stable security definer set search_path = public as $$
  select o.id, o.nome, o.situacao from public.obras o
  where o.ativa and (app.eh_admin() or o.id in (select app.minhas_obras_painel()) or o.id in (select app.obras_do_fornecedor()))
  order by o.nome;
$$;
revoke execute on function public.painel_obras() from anon, public;
grant execute on function public.painel_obras() to authenticated;

-- O que ainda está aberto na obra: base da conferência antes de encerrar.
create or replace function public.conferir_encerramento_obra(p_obra uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.obras;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo encerra obras'; end if;
  select * into o from public.obras where id = p_obra;
  if o.id is null then raise exception 'Obra não encontrada'; end if;
  return jsonb_build_object(
    'obra', jsonb_build_object('id', o.id, 'nome', o.nome, 'situacao', o.situacao,
      'encerramento_iniciado_em', o.encerramento_iniciado_em, 'encerrada_em', o.encerrada_em, 'encerramento_obs', o.encerramento_obs),
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object('alocacao_id', a.id, 'colaborador', c.nome, 'empresa', e.razao_social,
               'status', a.status, 'situacao_colaborador', c.situacao) order by e.razao_social, c.nome)
      from public.alocacoes a
      join public.colaboradores c on c.id = a.colaborador_id
      join public.empresas e on e.id = c.empresa_id
      where a.obra_id = p_obra and a.status <> 'encerrado'), '[]'::jsonb),
    'empresas', (select count(*) from public.empresas_obras where obra_id = p_obra and ativo),
    'documentos_em_analise', (
      select count(*) from public.documentos d
      where d.status = 'em_analise' and d.colaborador_id in (
        select a.colaborador_id from public.alocacoes a where a.obra_id = p_obra and a.status <> 'encerrado')),
    'medicoes', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', e.razao_social, 'competencia', m.competencia, 'status', m.status)
               order by m.competencia, e.razao_social)
      from public.medicoes m join public.empresas e on e.id = m.empresa_id
      where m.obra_id = p_obra and m.status <> 'aprovada'), '[]'::jsonb),
    'integracoes', (select count(*) from public.integracoes where obra_id = p_obra and concluida_em is null and cancelada_em is null),
    'pedidos', (select count(*) from public.pedidos_obra where obra_id = p_obra and situacao = 'pendente')
  );
end $$;
revoke execute on function public.conferir_encerramento_obra(uuid) from anon, public;
grant execute on function public.conferir_encerramento_obra(uuid) to authenticated;

-- Muda a situação da obra.
--   'iniciar'  : ativa -> em_encerramento
--   'cancelar' : em_encerramento -> ativa
--   'concluir' : ativa ou em_encerramento -> encerrada (p_data e p_observacao obrigatórias; com algo aberto, p_confirmo)
--   'reabrir'  : encerrada -> ativa (alocações e empresas não voltam sozinhas)
create or replace function public.mudar_situacao_obra(
  p_obra uuid, p_acao text, p_data date default null, p_observacao text default null, p_confirmo boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.obras;
  v_abertas int;
  v_medicoes int;
  v_alocacoes int := 0;
  v_empresas int := 0;
  v_pedidos int := 0;
  v_integracoes int := 0;
  v_texto text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo encerra obras'; end if;
  select * into o from public.obras where id = p_obra for update;
  if o.id is null then raise exception 'Obra não encontrada'; end if;

  if p_acao = 'iniciar' then
    if o.situacao <> 'ativa' then raise exception 'A obra não está ativa'; end if;
    update public.obras set situacao = 'em_encerramento', encerramento_iniciado_em = now(),
           encerramento_obs = nullif(btrim(p_observacao), '') where id = p_obra;

  elsif p_acao = 'cancelar' then
    if o.situacao <> 'em_encerramento' then raise exception 'A obra não está em encerramento'; end if;
    update public.obras set situacao = 'ativa', encerramento_iniciado_em = null, encerramento_obs = null where id = p_obra;

  elsif p_acao = 'concluir' then
    if o.situacao = 'encerrada' then raise exception 'A obra já está encerrada'; end if;
    if p_data is null then raise exception 'Informe a data de encerramento'; end if;
    if p_data > current_date then raise exception 'A data de encerramento não pode ser futura'; end if;
    if length(btrim(coalesce(p_observacao, ''))) < 5 then raise exception 'Descreva o encerramento (ex.: obra entregue, últimas medições conferidas)'; end if;
    select count(*) into v_abertas from public.alocacoes where obra_id = p_obra and status <> 'encerrado';
    select count(*) into v_medicoes from public.medicoes where obra_id = p_obra and status <> 'aprovada';
    if (v_abertas > 0 or v_medicoes > 0) and not coalesce(p_confirmo, false) then
      raise exception 'Ainda há % colaborador(es) na obra e % medição(ões) sem aprovação. Confira as movimentações e confirme o encerramento.', v_abertas, v_medicoes;
    end if;
    v_texto := format('Obra encerrada em %s', to_char(p_data, 'DD/MM/YYYY'));

    update public.alocacoes
       set status = 'encerrado', observacao = btrim(coalesce(observacao || ' · ', '') || v_texto)
     where obra_id = p_obra and status <> 'encerrado';
    get diagnostics v_alocacoes = row_count;
    update public.empresas_obras set ativo = false where obra_id = p_obra and ativo;
    get diagnostics v_empresas = row_count;
    update public.pedidos_obra set situacao = 'recusado', motivo_recusa = v_texto, analisado_por = auth.uid(), analisado_em = now()
     where obra_id = p_obra and situacao = 'pendente';
    get diagnostics v_pedidos = row_count;
    update public.integracoes set cancelada_em = now()
     where obra_id = p_obra and concluida_em is null and cancelada_em is null;
    get diagnostics v_integracoes = row_count;

    update public.obras set situacao = 'encerrada', ativa = false, encerrada_em = p_data, encerrada_por = auth.uid(),
           encerramento_obs = btrim(p_observacao), encerramento_iniciado_em = coalesce(encerramento_iniciado_em, now())
     where id = p_obra;

  elsif p_acao = 'reabrir' then
    if o.situacao <> 'encerrada' then raise exception 'A obra não está encerrada'; end if;
    update public.obras set situacao = 'ativa', ativa = true, encerrada_em = null, encerrada_por = null,
           encerramento_iniciado_em = null, encerramento_obs = null where id = p_obra;
  else
    raise exception 'Ação desconhecida';
  end if;

  perform app.registrar_evento('obras', p_obra, 'obra_' || p_acao, jsonb_build_object(
    'obra', o.nome, 'data', p_data, 'observacao', nullif(btrim(p_observacao), ''), 'alocacoes_encerradas', v_alocacoes,
    'empresas_desligadas', v_empresas, 'pedidos_recusados', v_pedidos, 'integracoes_canceladas', v_integracoes, 'usuario', auth.uid()));
  return jsonb_build_object('alocacoes', v_alocacoes, 'empresas', v_empresas, 'pedidos', v_pedidos, 'integracoes', v_integracoes);
end $$;
revoke execute on function public.mudar_situacao_obra(uuid, text, date, text, boolean) from anon, public;
grant execute on function public.mudar_situacao_obra(uuid, text, date, text, boolean) to authenticated;
