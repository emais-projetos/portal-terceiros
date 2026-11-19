-- Análise de documentos: histórico e conclusão por fornecedor, com um e-mail só.
--
-- 1. Cada documento aprovado ou devolvido pelo administrativo fica "aguardando conclusão" (resultado_analise guarda o
--    que foi decidido, mesmo que o fornecedor reenvie depois e o registro vire "substituído").
-- 2. "Concluir análise" (por empresa): junta o que foi analisado e ainda não comunicado e coloca um e-mail só na fila
--    (Precisa corrigir + Aprovados; sem devolução, a versão curta de aprovados). O e-mail vai para o e-mail do
--    fornecedor cadastrado no portal (contato, ou o de acesso), sem edição. Sai na próxima passada do n8n, pela
--    mesma fila do Aviso de liberação, respeitando pausa e modo teste.
-- 3. O fornecedor vê no portal a última análise concluída da empresa dele.

alter table public.documentos
  add column resultado_analise text check (resultado_analise in ('aprovado', 'devolvido')),
  add column aguardando_conclusao boolean not null default false,
  add column conclusao_id uuid;

create table public.analises_conclusoes (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id),
  concluida_por      uuid default auth.uid(),
  concluida_em       timestamptz not null default now(),
  aprovados          integer not null,
  devolvidos         integer not null,
  colaboradores      integer not null,
  para               text not null,
  assunto            text not null,
  corpo              text not null,
  situacao_envio     text not null default 'aguardando' check (situacao_envio in ('aguardando', 'enviando', 'enviado', 'erro', 'sem_email')),
  envio_iniciado_em  timestamptz,
  enviado_em         timestamptz,
  envio_erro         text,
  envio_teste        boolean,
  envio_para         text
);
alter table public.documentos add constraint documentos_conclusao_fkey foreign key (conclusao_id) references public.analises_conclusoes (id);
create index documentos_aguardando_conclusao on public.documentos (empresa_id) where aguardando_conclusao;
create index analises_conclusoes_empresa on public.analises_conclusoes (empresa_id, concluida_em desc);

alter table public.analises_conclusoes enable row level security;
create policy leitura on public.analises_conclusoes for select to authenticated
  using ((select app.eh_admin()) or empresa_id in (select app.minhas_empresas()));
grant select on public.analises_conclusoes to authenticated;

-- Histórico: o que já estava analisado fica como comunicado; as análises desde 17/11 entram para concluir.
update public.documentos
   set resultado_analise = case when status = 'aprovado' then 'aprovado'
                                when status = 'devolvido' or motivo_devolucao is not null then 'devolvido'
                                else 'aprovado' end,
       aguardando_conclusao = analisado_em >= '2026-11-17'
 where analisado_em is not null and status <> 'em_analise';

create or replace function app.marcar_resultado_analise() returns trigger
language plpgsql as $$
begin
  if old.status = 'em_analise' and new.status in ('aprovado', 'devolvido') then
    new.resultado_analise := new.status::text;
    new.aguardando_conclusao := true;
    new.conclusao_id := null;
  end if;
  return new;
end $$;
create trigger documentos_resultado_analise before update of status on public.documentos
  for each row execute function app.marcar_resultado_analise();

insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('analise_documentos', 'Análise de documentos: correções',
 'Quando o administrativo clica em Concluir análise e há documento devolvido', 'Fornecedor', 85,
 array['{empresa}', '{corrigir}', '{bloco_aprovados}', '{link_pendencias}', '{assinatura}'],
 'Texto inicial',
 'Análise dos documentos: correções necessárias, {empresa}',
 E'Olá, equipe da {empresa},\n\nConcluímos a análise dos documentos enviados no portal. Os itens abaixo precisam de correção antes de o colaborador seguir para a integração de segurança.\n\nPrecisa corrigir:\n{corrigir}\n\n{bloco_aprovados}\n\nComo corrigir:\n1. Acesse {link_pendencias}\n2. Abra o colaborador, veja o motivo e envie o documento corrigido.\n3. Com tudo enviado, clique em Enviar para análise.\n\nImportante: documentos e correções são recebidos somente pelo portal.\n\n{assinatura}'),
('analise_aprovada', 'Análise de documentos: tudo aprovado',
 'Quando o administrativo clica em Concluir análise e nenhum documento foi devolvido', 'Fornecedor', 86,
 array['{empresa}', '{aprovados}', '{link_pendencias}', '{assinatura}'],
 'Texto inicial',
 'Análise dos documentos: aprovados, {empresa}',
 E'Olá, equipe da {empresa},\n\nConcluímos a análise dos documentos enviados no portal e está tudo certo com:\n\n{aprovados}\n\nAgora o TST da obra valida a liberação e agenda a integração de segurança. Acompanhe pelo portal: {link_pendencias}\n\n{assinatura}')
on conflict (tipo) do nothing;

-- Monta o e-mail da conclusão (prévia e conclusão usam o mesmo texto).
create or replace function app.montar_conclusao_analise(p_empresa uuid, p_documentos uuid[])
returns table (para text, assunto text, corpo text, documentos uuid[], aprovados integer, devolvidos integer, colaboradores integer, modelo_ativo boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.empresas;
  m public.modelos_email;
  v_docs uuid[];
  v_corrigir text;
  v_aprovados text;
  v_qtd_aprov integer;
  v_qtd_dev integer;
  v_colabs integer;
  v_assinatura text;
  v_quem text;
  v_assunto text;
  v_corpo text;
begin
  select * into e from public.empresas where id = p_empresa;
  if e.id is null then raise exception 'Empresa não encontrada'; end if;

  select coalesce(array_agg(d.id), '{}') into v_docs
  from public.documentos d
  where d.empresa_id = p_empresa and d.aguardando_conclusao and (p_documentos is null or d.id = any (p_documentos));
  if cardinality(v_docs) = 0 then raise exception 'Nada para concluir nesta empresa: nenhum documento analisado esperando comunicação'; end if;

  -- Precisa corrigir: devoluções que o fornecedor ainda não reenviou (as já reenviadas viraram "substituído").
  with dev as (
    select coalesce(c.nome, 'Documentos da empresa') quem, c.nome is null eh_empresa,
           string_agg(format('%s (devolvido: %s)', t.nome, lower(coalesce(nullif(btrim(d.motivo_devolucao), ''), 'ver o motivo no portal'))), '; ' order by t.nome) docs
    from public.documentos d
    join public.tipos_documento t on t.codigo = d.tipo_codigo
    left join public.colaboradores c on c.id = d.colaborador_id
    where d.id = any (v_docs) and d.resultado_analise = 'devolvido' and d.status = 'devolvido'
    group by 1, 2
  )
  select string_agg(format('- %s: %s', quem, docs), E'\n' order by eh_empresa desc, quem), count(*) into v_corrigir, v_qtd_dev from dev;

  -- Aprovados: colaborador com documento aprovado nesta análise e nenhuma devolução em aberto nela.
  with ap as (
    select c.id, c.nome
    from public.documentos d join public.colaboradores c on c.id = d.colaborador_id
    where d.id = any (v_docs) and d.resultado_analise = 'aprovado'
    group by c.id, c.nome
    having not exists (
      select 1 from public.documentos d2
      where d2.id = any (v_docs) and d2.colaborador_id = c.id and d2.resultado_analise = 'devolvido' and d2.status = 'devolvido')
  )
  select string_agg(format('- %s%s', ap.nome, coalesce((
           select case
             when bool_or(a.status = 'liberado') then ': liberado na obra'
             when bool_or(a.status = 'aprovado_admin') then ': segue para a validação do TST da obra'
             else ': documentos aprovados'
           end
           from public.alocacoes a where a.colaborador_id = ap.id and a.status <> 'encerrado'), ': documentos aprovados')), E'\n' order by ap.nome),
         count(*)
    into v_aprovados, v_qtd_aprov
  from ap;

  select count(distinct d.colaborador_id) into v_colabs from public.documentos d where d.id = any (v_docs) and d.colaborador_id is not null;

  select * into m from public.modelos_email where tipo = case when coalesce(v_qtd_dev, 0) > 0 then 'analise_documentos' else 'analise_aprovada' end;
  select nome into v_quem from public.usuarios where id = auth.uid();
  select concat_ws(E'\n',
           nullif(btrim(coalesce(v_quem, '')), ''),
           coalesce(nullif((select valor from public.parametros where chave = 'cobranca_setor'), ''), 'Gente e Gestão') || ' | Grupo Emais',
           nullif(btrim(coalesce((select valor from public.parametros where chave = 'cobranca_contato'), '')), ''))
    into v_assinatura;

  v_assunto := replace(coalesce(m.assunto, 'Análise dos documentos, {empresa}'), '{empresa}', e.razao_social);
  v_corpo := coalesce(m.corpo, '');
  v_corpo := replace(v_corpo, '{empresa}', e.razao_social);
  v_corpo := replace(v_corpo, '{corrigir}', coalesce(v_corrigir, ''));
  v_corpo := replace(v_corpo, '{bloco_aprovados}', case when v_aprovados is null then '' else E'Documentos aprovados:\n' || v_aprovados end);
  v_corpo := replace(v_corpo, '{aprovados}', coalesce(v_aprovados, '- Documentos da empresa aprovados'));
  v_corpo := replace(v_corpo, '{link_pendencias}', 'https://emais-projetos.github.io/portal-terceiros/pendencias');
  v_corpo := replace(v_corpo, '{assinatura}', v_assinatura);
  v_corpo := btrim(regexp_replace(v_corpo, E'\n{3,}', E'\n\n', 'g'));

  return query select nullif(btrim(coalesce(nullif(btrim(e.email_contato), ''), e.email_acesso, '')), ''), btrim(v_assunto), v_corpo, v_docs,
    coalesce(v_qtd_aprov, 0), coalesce(v_qtd_dev, 0), coalesce(v_colabs, 0), coalesce(m.ativo, false);
end $$;
revoke all on function app.montar_conclusao_analise(uuid, uuid[]) from public;

create or replace function public.previa_conclusao_analise(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo conclui a análise'; end if;
  select * into r from app.montar_conclusao_analise(p_empresa, null);
  return jsonb_build_object('para', r.para, 'assunto', r.assunto, 'corpo', r.corpo, 'documentos', to_jsonb(r.documentos),
    'aprovados', r.aprovados, 'devolvidos', r.devolvidos, 'colaboradores', r.colaboradores, 'modelo_ativo', r.modelo_ativo,
    'na_fila', (select count(*) from public.documentos d where d.empresa_id = p_empresa and d.status = 'em_analise'));
end $$;

create or replace function public.concluir_analise(p_empresa uuid, p_documentos uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id uuid;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo conclui a análise'; end if;
  if coalesce(cardinality(p_documentos), 0) = 0 then raise exception 'Nada para concluir'; end if;
  perform 1 from public.documentos where id = any (p_documentos) for update;
  select * into r from app.montar_conclusao_analise(p_empresa, p_documentos);
  if r.para is null then raise exception 'O fornecedor não tem e-mail cadastrado no portal. Cadastre o e-mail da empresa antes de concluir.'; end if;
  insert into public.analises_conclusoes (empresa_id, aprovados, devolvidos, colaboradores, para, assunto, corpo, situacao_envio)
  values (p_empresa, r.aprovados, r.devolvidos, r.colaboradores, r.para, r.assunto, r.corpo, case when r.modelo_ativo then 'aguardando' else 'sem_email' end)
  returning id into v_id;
  update public.documentos set aguardando_conclusao = false, conclusao_id = v_id where id = any (r.documentos);
  perform app.registrar_evento('analises_conclusoes', v_id, 'analise_concluida',
    jsonb_build_object('empresa', p_empresa, 'documentos', cardinality(r.documentos), 'aprovados', r.aprovados, 'devolvidos', r.devolvidos));
  return v_id;
end $$;

-- Empresas com análise feita e ainda não comunicada (aviso no topo da Análise de documentos).
create or replace function public.analises_para_concluir() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'empresa_id', x.empresa_id, 'empresa', e.razao_social, 'cnpj', e.cnpj,
      'aprovados', x.aprovados, 'devolvidos', x.devolvidos, 'colaboradores', x.colaboradores, 'desde', x.desde,
      'na_fila', (select count(*) from public.documentos d where d.empresa_id = x.empresa_id and d.status = 'em_analise'),
      'tem_email', nullif(btrim(coalesce(nullif(btrim(e.email_contato), ''), e.email_acesso, '')), '') is not null) order by x.desde)
    from (
      select d.empresa_id,
             count(*) filter (where d.resultado_analise = 'aprovado') aprovados,
             count(*) filter (where d.resultado_analise = 'devolvido') devolvidos,
             count(distinct d.colaborador_id) colaboradores,
             min(d.analisado_em) desde
      from public.documentos d where d.aguardando_conclusao group by d.empresa_id) x
    join public.empresas e on e.id = x.empresa_id), '[]'::jsonb);
end $$;

revoke all on function public.previa_conclusao_analise(uuid) from public, anon;
revoke all on function public.concluir_analise(uuid, uuid[]) from public, anon;
revoke all on function public.analises_para_concluir() from public, anon;
grant execute on function public.previa_conclusao_analise(uuid) to authenticated;
grant execute on function public.concluir_analise(uuid, uuid[]) to authenticated;
grant execute on function public.analises_para_concluir() to authenticated;
