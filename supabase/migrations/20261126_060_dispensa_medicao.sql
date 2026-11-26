-- Dispensa da medição: o administrativo libera a empresa de apresentar a medição de um mês numa obra
-- (ex.: não teve atuação na obra), com o motivo. A medição fica como aprovada, então não entra em cobrança,
-- retenção nem no farol do fornecedor; o portal mostra "Dispensada" com o motivo.
-- Desfazer volta a medição para como estava. Se ela foi criada pela dispensa (sem documento), é apagada.

alter table public.medicoes
  add column if not exists dispensada_em timestamptz,
  add column if not exists dispensada_por uuid references public.usuarios (id),
  add column if not exists motivo_dispensa text,
  add column if not exists status_antes_dispensa public.status_medicao,
  add column if not exists criada_pela_dispensa boolean not null default false;

-- A view ganha os campos da dispensa (e o nome de quem dispensou) no fim.
do $$
declare
  v text := pg_get_viewdef('public.v_medicoes'::regclass, true);
  novo text;
begin
  if strpos(v, 'dispensada_em') > 0 then return; end if;
  novo := regexp_replace(v, 'AS em_atraso\s+FROM medicoes m',
    'AS em_atraso, m.dispensada_em, m.motivo_dispensa, ( SELECT u.nome FROM usuarios u WHERE u.id = m.dispensada_por) AS dispensada_por FROM medicoes m');
  if novo = v then raise exception 'v_medicoes mudou: revise a inclusão dos campos da dispensa'; end if;
  execute 'create or replace view public.v_medicoes with (security_invoker = true) as ' || novo;
end $$;

-- Painel da obra (engenharia, TST, Suprimentos): a medição traz se foi dispensada e o motivo.
do $$
declare
  f text := pg_get_functiondef('public.painel_obra(uuid)'::regprocedure);
  antiga text := $x$'prazo_combinado', m.prazo_combinado, 'primeiro_envio_em'$x$;
begin
  if strpos(f, 'motivo_dispensa') > 0 then return; end if;
  if strpos(f, antiga) = 0 then raise exception 'painel_obra mudou: revise a inclusão da dispensa'; end if;
  execute replace(f, antiga, $x$'prazo_combinado', m.prazo_combinado, 'dispensada', m.dispensada_em is not null, 'motivo_dispensa', m.motivo_dispensa, 'primeiro_envio_em'$x$);
end $$;

-- Medição dispensada não muda por documento: desfaça a dispensa antes.
create or replace function app.medicao_editavel_pelo_fornecedor(p_medicao uuid) returns public.medicoes
language plpgsql stable security definer set search_path = public as $$
declare m public.medicoes;
begin
  select * into m from public.medicoes where id = p_medicao;
  if m.id is null or not app.pode_medicao(m.empresa_id) then raise exception 'Medição não encontrada'; end if;
  if m.dispensada_em is not null then raise exception 'Medição dispensada pela Emais neste mês. Não há documentos a enviar.'; end if;
  if not app.eh_admin() and m.status not in ('aberta', 'pendente_fornecedor') then
    raise exception 'A medição está em conferência na Emais. Aguarde a análise.';
  end if;
  return m;
end $$;

create or replace function public.dispensar_medicao(p_empresa uuid, p_obra uuid, p_competencia date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.medicoes;
  comp date := date_trunc('month', p_competencia)::date;
  dia integer := coalesce(app.param_int('prazo_medicao_dia'), 25);
  v_motivo text := regexp_replace(btrim(coalesce(p_motivo, '')), '\s+', ' ', 'g');
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo dispensa a medição'; end if;
  if length(v_motivo) < 5 then raise exception 'Escreva o motivo da dispensa'; end if;
  if length(v_motivo) > 500 then raise exception 'Motivo muito longo (até 500 letras)'; end if;
  if comp is null or comp > date_trunc('month', current_date)::date then raise exception 'Escolha um mês que já começou'; end if;
  if p_obra is null or not exists (select 1 from public.empresas_obras where empresa_id = p_empresa and obra_id = p_obra) then
    raise exception 'A empresa não está cadastrada nesta obra';
  end if;

  select * into m from public.medicoes where empresa_id = p_empresa and obra_id = p_obra and competencia = comp for update;
  if m.id is not null then
    if m.dispensada_em is not null then raise exception 'A medição deste mês já está dispensada'; end if;
    if m.status = 'aprovada' then raise exception 'A medição deste mês já foi aprovada'; end if;
    update public.medicoes
       set status_antes_dispensa = status, status = 'aprovada', dispensada_em = now(), dispensada_por = auth.uid(), motivo_dispensa = v_motivo
     where id = m.id;
  else
    insert into public.medicoes (empresa_id, obra_id, competencia, prazo, status, dispensada_em, dispensada_por, motivo_dispensa, criada_pela_dispensa)
    values (p_empresa, p_obra, comp, (comp + interval '1 month')::date + (dia - 1), 'aprovada', now(), auth.uid(), v_motivo, true)
    returning * into m;
  end if;
  perform app.registrar_evento('medicoes', m.id, 'medicao_dispensada',
    jsonb_build_object('competencia', comp, 'empresa_id', p_empresa, 'obra_id', p_obra, 'motivo', v_motivo));
  return m.id;
end $$;

create or replace function public.desfazer_dispensa_medicao(p_medicao uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m public.medicoes;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo desfaz a dispensa'; end if;
  select * into m from public.medicoes where id = p_medicao for update;
  if m.id is null or m.dispensada_em is null then raise exception 'Esta medição não está dispensada'; end if;
  perform app.registrar_evento('medicoes', m.id, 'dispensa_medicao_desfeita',
    jsonb_build_object('competencia', m.competencia, 'empresa_id', m.empresa_id, 'obra_id', m.obra_id, 'motivo_dispensa', m.motivo_dispensa));
  if m.criada_pela_dispensa
     and not exists (select 1 from public.medicoes_itens i where i.medicao_id = m.id)
     and not exists (select 1 from public.medicoes_colaboradores c where c.medicao_id = m.id) then
    delete from public.medicoes where id = m.id;
    return 'apagada';
  end if;
  update public.medicoes
     set status = coalesce(status_antes_dispensa, 'aberta'), status_antes_dispensa = null,
         dispensada_em = null, dispensada_por = null, motivo_dispensa = null, criada_pela_dispensa = false
   where id = m.id;
  return 'reaberta';
end $$;

revoke all on function public.dispensar_medicao(uuid, uuid, date, text) from public, anon;
revoke all on function public.desfazer_dispensa_medicao(uuid) from public, anon;
grant execute on function public.dispensar_medicao(uuid, uuid, date, text), public.desfazer_dispensa_medicao(uuid) to authenticated;
