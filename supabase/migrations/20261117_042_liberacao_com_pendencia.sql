-- Liberação com pendência (pedido da engenharia).
--
-- O administrativo pode aprovar um colaborador com documento obrigatório pendente, com anotação (quem pediu e
-- por quê). O prazo para regularizar é de 7 dias a partir da aprovação. O TST precisa confirmar que está ciente
-- para liberar. Regularizados os documentos, a pendência some. Vencido o prazo sem regularizar, o colaborador
-- volta para "pendente do fornecedor" e sai dos liberados da obra (rotina da fila automática, várias vezes ao dia).
--
-- O prazo fica na alocação (o fornecedor vê). A anotação fica em liberacoes_pendencia, que só o administrativo
-- e o TST da obra leem.

alter table public.alocacoes add column pendencia_prazo date;
comment on column public.alocacoes.pendencia_prazo is 'Liberação com pendência: prazo para regularizar os documentos obrigatórios.';

create table public.liberacoes_pendencia (
  id            uuid primary key default gen_random_uuid(),
  alocacao_id   uuid not null references public.alocacoes (id) on delete cascade,
  prazo         date not null,
  anotacao      text not null,
  documentos    text[] not null default '{}',
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  ciente_tst_por uuid,
  ciente_tst_em timestamptz,
  encerrada_em  timestamptz,
  resultado     text check (resultado in ('regularizada', 'vencida', 'devolvida'))
);
create index liberacoes_pendencia_alocacao on public.liberacoes_pendencia (alocacao_id, criado_em desc);
alter table public.liberacoes_pendencia enable row level security;
create policy leitura on public.liberacoes_pendencia for select to authenticated
  using ((select app.eh_admin()) or alocacao_id in (select a.id from public.alocacoes a where a.obra_id in (select app.minhas_obras_tst())));
grant select on public.liberacoes_pendencia to authenticated;

-- O resumo das alocações passa a trazer o prazo.
create or replace view public.v_alocacoes_resumo with (security_invoker = true) as
SELECT a.id AS alocacao_id,
    a.status,
    a.obra_id,
    o.nome AS obra,
    c.id AS colaborador_id,
    c.nome AS colaborador,
    COALESCE(f.nome, c.funcao_texto) AS funcao,
    c.empresa_id,
    emp.razao_social AS empresa,
    a.inicio_conferencia,
    a.aprovado_admin_em,
    a.validado_tst_em,
    a.data_integracao,
    a.data_integracao + (( SELECT tipos_documento.validade_dias
           FROM tipos_documento
          WHERE tipos_documento.codigo = 'integracao'::text)) AS vencimento_integracao,
    count(p.*) FILTER (WHERE p.impeditivo AND (p.situacao = ANY (ARRAY['nao_enviado'::text, 'em_analise'::text, 'devolvido'::text, 'vencido'::text]))) AS impeditivos_pendentes,
    count(p.*) FILTER (WHERE p.impeditivo AND p.area = 'ADM'::text AND (p.situacao = ANY (ARRAY['nao_enviado'::text, 'em_analise'::text, 'devolvido'::text, 'vencido'::text]))) AS pendentes_adm,
    count(p.*) FILTER (WHERE p.impeditivo AND p.area = 'SST'::text AND (p.situacao = ANY (ARRAY['nao_enviado'::text, 'em_analise'::text, 'devolvido'::text, 'vencido'::text]))) AS pendentes_sst,
    count(p.*) FILTER (WHERE p.situacao = 'devolvido'::text) AS devolvidos,
    count(p.*) FILTER (WHERE p.situacao = 'em_analise'::text) AS em_analise,
    count(p.*) FILTER (WHERE p.situacao = 'a_vencer'::text) AS a_vencer,
    EXTRACT(day FROM COALESCE(a.aprovado_admin_em, now()) - a.inicio_conferencia)::integer AS dias_em_analise,
    c.bloqueado,
    c.bloqueio_motivo,
    a.pendencia_prazo
   FROM alocacoes a
     JOIN colaboradores c ON c.id = a.colaborador_id
     JOIN empresas emp ON emp.id = c.empresa_id
     JOIN obras o ON o.id = a.obra_id
     LEFT JOIN funcoes f ON f.id = c.funcao_id
     LEFT JOIN v_pendencias p ON p.alocacao_id = a.id
  GROUP BY a.id, o.nome, c.id, f.nome, emp.razao_social;

-- Encerra a pendência aberta da alocação (resultado: regularizada, vencida ou devolvida).
create or replace function app.encerrar_pendencia_liberacao(p_alocacao uuid, p_resultado text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.alocacoes set pendencia_prazo = null where id = p_alocacao and pendencia_prazo is not null;
  update public.liberacoes_pendencia set encerrada_em = now(), resultado = p_resultado
  where alocacao_id = p_alocacao and encerrada_em is null;
  if found then perform app.registrar_evento('alocacoes', p_alocacao, 'pendencia_' || p_resultado, '{}'::jsonb); end if;
end $$;
revoke all on function app.encerrar_pendencia_liberacao(uuid, text) from public;

-- Administrativo: aprova. Com documento obrigatório pendente, só com anotação (liberação com pendência).
drop function public.aprovar_alocacao(uuid);
create function public.aprovar_alocacao(p_alocacao uuid, p_pendencia text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.v_alocacoes_resumo;
  docs text[];
  prazo date := current_date + 7;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador aprova'; end if;
  select * into r from public.v_alocacoes_resumo where alocacao_id = p_alocacao;
  if r.alocacao_id is null then raise exception 'Alocação não encontrada'; end if;
  if r.status <> 'em_analise' then raise exception 'A alocação precisa estar em análise'; end if;
  if r.impeditivos_pendentes = 0 then
    perform app.encerrar_pendencia_liberacao(p_alocacao, 'regularizada');
    update public.alocacoes set status = 'aprovado_admin', aprovado_admin_por = auth.uid(), aprovado_admin_em = now() where id = p_alocacao;
    return;
  end if;
  if coalesce(trim(p_pendencia), '') = '' then
    raise exception 'Ainda há % documento(s) impeditivo(s) pendente(s). Para liberar assim, marque "Liberar com pendência" e escreva a anotação.', r.impeditivos_pendentes;
  end if;
  select coalesce(array_agg(p.documento order by p.documento), '{}') into docs
  from public.v_pendencias p
  where p.alocacao_id = p_alocacao and p.impeditivo and p.situacao in ('nao_enviado', 'em_analise', 'devolvido', 'vencido');
  update public.liberacoes_pendencia set encerrada_em = now(), resultado = 'devolvida' where alocacao_id = p_alocacao and encerrada_em is null;
  insert into public.liberacoes_pendencia (alocacao_id, prazo, anotacao, documentos) values (p_alocacao, prazo, trim(p_pendencia), docs);
  update public.alocacoes
  set status = 'aprovado_admin', aprovado_admin_por = auth.uid(), aprovado_admin_em = now(), pendencia_prazo = prazo
  where id = p_alocacao;
  perform app.registrar_evento('alocacoes', p_alocacao, 'aprovada_com_pendencia',
    jsonb_build_object('prazo', prazo, 'anotacao', trim(p_pendencia), 'documentos', to_jsonb(docs)));
end $$;
revoke all on function public.aprovar_alocacao(uuid, text) from public, anon;
grant execute on function public.aprovar_alocacao(uuid, text) to authenticated;

-- TST: validação final. Liberação com pendência só com "ciente".
drop function public.validar_alocacao_tst(uuid);
create function public.validar_alocacao_tst(p_alocacao uuid, p_ciente_pendencia boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.alocacoes;
  faltam integer;
begin
  select * into a from public.alocacoes where id = p_alocacao;
  if a.id is null or a.obra_id not in (select app.minhas_obras_tst()) then raise exception 'Alocação fora das suas obras'; end if;
  if a.status <> 'aprovado_admin' then raise exception 'A alocação ainda não foi aprovada pelo administrador'; end if;
  if a.pendencia_prazo is not null then
    select impeditivos_pendentes into faltam from public.v_alocacoes_resumo where alocacao_id = p_alocacao;
    if faltam = 0 then
      perform app.encerrar_pendencia_liberacao(p_alocacao, 'regularizada');
    elsif not coalesce(p_ciente_pendencia, false) then
      raise exception 'Esta liberação tem documento pendente. Marque que está ciente para liberar com pendência.';
    else
      update public.liberacoes_pendencia set ciente_tst_por = auth.uid(), ciente_tst_em = now()
      where alocacao_id = p_alocacao and encerrada_em is null;
    end if;
  end if;
  update public.alocacoes set status = 'liberado', validado_tst_por = auth.uid(), validado_tst_em = now() where id = p_alocacao;
end $$;
revoke all on function public.validar_alocacao_tst(uuid, boolean) from public, anon;
grant execute on function public.validar_alocacao_tst(uuid, boolean) to authenticated;

-- TST devolve ao administrativo: a liberação com pendência deixa de valer.
create or replace function public.devolver_alocacao_tst(p_alocacao uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alocacoes;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  select * into a from public.alocacoes where id = p_alocacao;
  if a.id is null or a.obra_id not in (select app.minhas_obras_tst()) then raise exception 'Alocação fora das suas obras'; end if;
  if a.status <> 'aprovado_admin' then raise exception 'Só é possível devolver uma alocação aprovada pelo administrador'; end if;
  perform app.encerrar_pendencia_liberacao(p_alocacao, 'devolvida');
  update public.alocacoes set status = 'em_analise', observacao = p_motivo, aprovado_admin_por = null, aprovado_admin_em = null where id = p_alocacao;
  perform app.registrar_evento('alocacoes', p_alocacao, 'devolvida_tst', jsonb_build_object('motivo', p_motivo));
end $$;

-- Rotina (fila automática): encerra as pendências regularizadas e devolve ao fornecedor quem passou do prazo.
create or replace function public.processar_pendencias_liberacao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  regularizadas integer := 0;
  vencidas integer := 0;
begin
  for r in
    select v.alocacao_id, v.status, v.impeditivos_pendentes, v.pendencia_prazo
    from public.v_alocacoes_resumo v where v.pendencia_prazo is not null
  loop
    if r.status not in ('aprovado_admin', 'liberado') then
      perform app.encerrar_pendencia_liberacao(r.alocacao_id, 'devolvida');
    elsif r.impeditivos_pendentes = 0 then
      perform app.encerrar_pendencia_liberacao(r.alocacao_id, 'regularizada');
      regularizadas := regularizadas + 1;
    elsif r.pendencia_prazo < current_date then
      perform app.encerrar_pendencia_liberacao(r.alocacao_id, 'vencida');
      update public.alocacoes
      set status = 'pendente_fornecedor',
          observacao = 'Prazo da liberação com pendência venceu em ' || to_char(r.pendencia_prazo, 'DD/MM/YYYY') || ' sem regularizar os documentos.',
          aprovado_admin_por = null, aprovado_admin_em = null, validado_tst_por = null, validado_tst_em = null
      where id = r.alocacao_id;
      vencidas := vencidas + 1;
    end if;
  end loop;
  return jsonb_build_object('regularizadas', regularizadas, 'vencidas', vencidas);
end $$;
revoke all on function public.processar_pendencias_liberacao() from public, anon, authenticated;
grant execute on function public.processar_pendencias_liberacao() to service_role;
