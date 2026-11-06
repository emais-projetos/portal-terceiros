-- Ajustes pedidos em 06/11/2026 no cadastro de colaboradores e documentos.
--
-- 1. Tipos de documento: "PGR" sem "Inventário de risco"; NRs dispensáveis com justificativa (a função
--    pede, mas o serviço pode não exigir); contrato entre as partes obrigatório para subcontratada;
--    "Outro documento" que o fornecedor inclui no colaborador; documentos rescisórios.
-- 2. Colaborador: idade mínima de 18 anos; correção de nome, CPF, empresa e função pelo fornecedor só
--    até o cadastro ser enviado para análise; demissão com data e rescisórios pendentes; bloqueio pelo
--    administrativo ou pelo TST, com motivo e histórico.
-- 3. Subcontratada cadastrada pelo próprio fornecedor, no mesmo login.
-- 4. TST vê o anexo das NRs dos colaboradores das suas obras.

-- ------------------------------------------------------------------ 1. Tipos de documento

alter table public.tipos_documento add column if not exists so_rescisao boolean not null default false;
comment on column public.tipos_documento.so_rescisao is 'Documento rescisório: só é exigido do colaborador demitido.';

update public.tipos_documento set nome = 'PGR' where codigo = 'pgr';
update public.tipos_documento set pode_dispensar = true where depende_da_funcao;

select set_config('app.motivo', 'Contrato entre as partes obrigatório para liberar colaborador de subcontratada (ajuste de 06/11/2026)', true);
update public.tipos_documento set impeditivo = true where codigo = 'contrato_subcontratacao';

insert into public.tipos_documento
  (codigo, nome, grupo, area, regra, validade_dias, impeditivo, depende_da_funcao, so_subcontratada, pode_dispensar, enviado_pelo_fornecedor, ativo, ordem, so_rescisao, observacao)
values
  ('outro_documento', 'Outro documento', 'colaborador', 'SST', 'sem_vencimento', null, true, true, false, false, true, true, 290, false,
   'Incluído no colaborador pelo fornecedor ou pela Emais (ex.: treinamento específico de máquina). A descrição fica no ajuste do colaborador.'),
  ('trct', 'TRCT assinado', 'colaborador', 'ADM', 'sem_vencimento', null, true, false, false, false, true, true, 400, true, null),
  ('fgts_rescisorio', 'Guia e comprovante do FGTS rescisório', 'colaborador', 'ADM', 'sem_vencimento', null, true, false, false, false, true, true, 410, true, null),
  ('aso_demissional', 'ASO demissional', 'colaborador', 'SST', 'sem_vencimento', null, true, false, false, false, true, true, 420, true, null),
  ('pagamento_rescisao', 'Comprovante de pagamento das verbas rescisórias', 'colaborador', 'ADM', 'sem_vencimento', null, true, false, false, false, true, true, 430, true, null)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------------ 2. Colaborador

alter table public.colaboradores add column if not exists data_desligamento date;
alter table public.colaboradores add column if not exists rescisao_exigida boolean not null default false;
alter table public.colaboradores add column if not exists bloqueado boolean not null default false;
alter table public.colaboradores add column if not exists bloqueio_motivo text;
alter table public.colaboradores add column if not exists bloqueado_em timestamptz;
comment on column public.colaboradores.rescisao_exigida is 'Demitido pelo portal: os documentos rescisórios ficam pendentes no cadastro.';

-- Idade mínima: 18 anos.
create or replace function app.colaboradores_conferir_datas() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.data_nascimento is not null and new.data_nascimento > current_date - interval '18 years' then
    raise exception 'Colaborador menor de 18 anos não pode ser cadastrado';
  end if;
  if new.data_admissao is not null and new.data_admissao > current_date + 90 then
    raise exception 'Data de admissão muito à frente: confira a data';
  end if;
  return new;
end $$;

-- O cadastro pode ser corrigido pelo fornecedor só enquanto nenhuma obra foi enviada para análise.
create or replace function app.cadastro_editavel_pelo_fornecedor(p_colaborador uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.alocacoes a
    where a.colaborador_id = p_colaborador and a.status in ('em_analise', 'aprovado_admin', 'liberado')
  );
$$;

-- Fornecedor: não troca de empresa nem corrige o cadastro por fora da função de correção, e nunca mexe
-- no bloqueio. As funções abaixo marcam app.rpc para passar por aqui.
create or replace function app.antes_alterar_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pela_funcao boolean := coalesce(current_setting('app.rpc', true), '') = 'sim';
begin
  if auth.uid() is not null and not app.eh_admin() and not pela_funcao then
    if new.empresa_id is distinct from old.empresa_id then
      raise exception 'Não é possível trocar o colaborador de empresa';
    end if;
    if (new.nome, new.cpf, new.funcao_id, new.funcao_texto) is distinct from (old.nome, old.cpf, old.funcao_id, old.funcao_texto) then
      raise exception 'Use "Corrigir cadastro" para alterar nome, CPF ou função';
    end if;
    if (new.bloqueado, new.bloqueio_motivo, new.bloqueado_em) is distinct from (old.bloqueado, old.bloqueio_motivo, old.bloqueado_em)
       or (new.rescisao_exigida is distinct from old.rescisao_exigida) then
      raise exception 'Alteração não permitida';
    end if;
  end if;
  if new.situacao <> 'ativo' and old.situacao = 'ativo' then
    update public.alocacoes set status = 'encerrado' where colaborador_id = new.id and status <> 'encerrado';
  end if;
  return new;
end $$;

create or replace function public.corrigir_colaborador(
  p_colaborador uuid, p_empresa uuid, p_nome text, p_cpf text, p_funcao_id uuid, p_funcao_texto text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.colaboradores;
  falta_obra text;
begin
  select * into c from public.colaboradores where id = p_colaborador;
  if c.id is null or not (app.eh_admin() or c.empresa_id in (select app.minhas_empresas())) then
    raise exception 'Colaborador não encontrado';
  end if;
  if not app.eh_admin() then
    if p_empresa not in (select app.minhas_empresas()) then raise exception 'Empresa fora do seu acesso'; end if;
    if not app.cadastro_editavel_pelo_fornecedor(p_colaborador) then
      raise exception 'O cadastro já foi enviado para análise. Peça a correção à Emais.';
    end if;
  end if;
  if c.situacao <> 'ativo' then raise exception 'Colaborador desligado não pode ser corrigido'; end if;
  if array_length(regexp_split_to_array(btrim(coalesce(p_nome, '')), '\s+'), 1) < 2 then raise exception 'Informe o nome completo'; end if;
  if coalesce(p_cpf, '') !~ '^\d{11}$' then raise exception 'CPF inválido'; end if;
  if p_funcao_id is null and length(btrim(coalesce(p_funcao_texto, ''))) < 3 then raise exception 'Informe a função'; end if;
  if exists (select 1 from public.colaboradores x where x.empresa_id = p_empresa and x.cpf = p_cpf and x.id <> p_colaborador) then
    raise exception 'Este CPF já está cadastrado nesta empresa';
  end if;

  if p_empresa is distinct from c.empresa_id then
    select string_agg(o.nome, ', ') into falta_obra
    from public.alocacoes a join public.obras o on o.id = a.obra_id
    where a.colaborador_id = p_colaborador and a.status <> 'encerrado'
      and not exists (select 1 from public.empresas_obras eo where eo.empresa_id = p_empresa and eo.obra_id = a.obra_id and eo.ativo);
    if falta_obra is not null then raise exception 'A nova empresa não está cadastrada na obra %', falta_obra; end if;
    -- Os documentos já enviados acompanham o colaborador.
    update public.documentos set empresa_id = p_empresa where colaborador_id = p_colaborador;
  end if;

  perform set_config('app.rpc', 'sim', true);
  update public.colaboradores set
    empresa_id = p_empresa,
    nome = upper(regexp_replace(btrim(p_nome), '\s+', ' ', 'g')),
    cpf = p_cpf,
    funcao_id = p_funcao_id,
    funcao_texto = upper(btrim(coalesce(p_funcao_texto, (select nome from public.funcoes where id = p_funcao_id))))
  where id = p_colaborador;
  perform set_config('app.rpc', '', true);

  perform app.registrar_evento('colaboradores', p_colaborador, 'cadastro_corrigido', jsonb_build_object(
    'de', jsonb_build_object('empresa_id', c.empresa_id, 'nome', c.nome, 'cpf', c.cpf, 'funcao_id', c.funcao_id, 'funcao_texto', c.funcao_texto),
    'para', jsonb_build_object('empresa_id', p_empresa, 'nome', p_nome, 'cpf', p_cpf, 'funcao_id', p_funcao_id, 'funcao_texto', p_funcao_texto)));
end $$;

-- Outro documento ou NR a mais, incluído pelo fornecedor (ou pela Emais) no colaborador.
create or replace function public.incluir_documento_colaborador(p_colaborador uuid, p_tipo text, p_descricao text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_documento;
  c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_colaborador;
  if c.id is null or not (app.eh_admin() or c.empresa_id in (select app.minhas_empresas())) then
    raise exception 'Colaborador não encontrado';
  end if;
  select * into t from public.tipos_documento where codigo = p_tipo and ativo;
  if t.codigo is null or not t.depende_da_funcao then raise exception 'Escolha uma NR ou "Outro documento"'; end if;
  if p_tipo = 'outro_documento' and length(btrim(coalesce(p_descricao, ''))) < 3 then
    raise exception 'Descreva qual é o documento';
  end if;
  insert into public.colaboradores_documentos_extras (colaborador_id, tipo_codigo, exige, motivo)
  values (p_colaborador, p_tipo, true, coalesce(nullif(btrim(p_descricao), ''), 'Incluído pelo fornecedor'))
  on conflict (colaborador_id, tipo_codigo) do update set exige = true, motivo = excluded.motivo;
end $$;

-- Demissão: encerra as obras e deixa os rescisórios pendentes. Desistência (não chegou a trabalhar) não pede rescisórios.
create or replace function public.desligar_colaborador(p_colaborador uuid, p_data date, p_desistente boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_colaborador;
  if c.id is null or not (app.eh_admin() or c.empresa_id in (select app.minhas_empresas())) then
    raise exception 'Colaborador não encontrado';
  end if;
  if c.situacao <> 'ativo' then raise exception 'Este colaborador já está desligado'; end if;
  if p_data is null then raise exception 'Informe a data do desligamento'; end if;
  if p_data > current_date + 30 then raise exception 'Data do desligamento muito à frente'; end if;
  if c.data_admissao is not null and p_data < c.data_admissao then raise exception 'O desligamento não pode ser antes da admissão'; end if;

  perform set_config('app.rpc', 'sim', true);
  update public.colaboradores set
    situacao = case when p_desistente then 'desistente'::public.situacao_colaborador else 'demitido'::public.situacao_colaborador end,
    data_desligamento = p_data,
    rescisao_exigida = not coalesce(p_desistente, false)
  where id = p_colaborador;
  perform set_config('app.rpc', '', true);
  perform app.registrar_evento('colaboradores', p_colaborador, 'desligado',
    jsonb_build_object('data', p_data, 'desistente', coalesce(p_desistente, false)));
end $$;

-- Bloqueio: administrativo ou TST da obra, sempre com motivo; o histórico fica em colaboradores_bloqueios.
create table if not exists public.colaboradores_bloqueios (
  id              bigint generated always as identity primary key,
  colaborador_id  uuid not null references public.colaboradores (id) on delete cascade,
  acao            text not null check (acao in ('bloqueio', 'desbloqueio')),
  motivo          text not null,
  feito_por       uuid default auth.uid(),
  feito_por_nome  text,
  feito_em        timestamptz not null default now()
);
create index if not exists colaboradores_bloqueios_colab on public.colaboradores_bloqueios (colaborador_id, feito_em desc);
alter table public.colaboradores_bloqueios enable row level security;
drop policy if exists leitura on public.colaboradores_bloqueios;
create policy leitura on public.colaboradores_bloqueios for select to authenticated
  using ((select app.eh_admin())
         or colaborador_id in (select c.id from public.colaboradores c where c.empresa_id in (select app.minhas_empresas()))
         or app.tst_ve_colaborador(colaborador_id));
grant select on public.colaboradores_bloqueios to authenticated;

create or replace function public.bloquear_colaborador(p_colaborador uuid, p_bloquear boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.colaboradores;
  quem text;
begin
  select * into c from public.colaboradores where id = p_colaborador;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  if not (app.eh_admin() or app.tst_ve_colaborador(p_colaborador)) then
    raise exception 'Apenas o administrativo ou o TST da obra bloqueiam colaboradores';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Descreva o motivo'; end if;
  if c.bloqueado = p_bloquear then
    raise exception '%', case when p_bloquear then 'O colaborador já está bloqueado' else 'O colaborador não está bloqueado' end;
  end if;
  select nome into quem from public.usuarios where id = auth.uid();

  perform set_config('app.rpc', 'sim', true);
  update public.colaboradores set
    bloqueado = p_bloquear,
    bloqueio_motivo = case when p_bloquear then btrim(p_motivo) else null end,
    bloqueado_em = case when p_bloquear then now() else null end
  where id = p_colaborador;
  perform set_config('app.rpc', '', true);

  insert into public.colaboradores_bloqueios (colaborador_id, acao, motivo, feito_por_nome)
  values (p_colaborador, case when p_bloquear then 'bloqueio' else 'desbloqueio' end, btrim(p_motivo), quem);
  perform app.registrar_evento('colaboradores', p_colaborador, case when p_bloquear then 'bloqueado' else 'desbloqueado' end,
    jsonb_build_object('motivo', btrim(p_motivo)));
end $$;

-- Colaborador bloqueado não é aprovado nem liberado.
create or replace function app.alocacao_conferir_bloqueio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('aprovado_admin', 'liberado') and new.status is distinct from old.status
     and exists (select 1 from public.colaboradores c where c.id = new.colaborador_id and c.bloqueado) then
    raise exception 'Colaborador bloqueado: desbloqueie antes de aprovar ou liberar';
  end if;
  return new;
end $$;
drop trigger if exists alocacoes_conferir_bloqueio on public.alocacoes;
create trigger alocacoes_conferir_bloqueio before update of status on public.alocacoes
  for each row execute function app.alocacao_conferir_bloqueio();

-- Exigências: os rescisórios ficam fora das obras (são do desligamento, não da alocação).
create or replace view public.v_exigencias with (security_invoker = true) as
select a.id as alocacao_id, a.obra_id, c.id as colaborador_id, c.empresa_id, t.codigo as tipo_codigo
from public.alocacoes a
join public.colaboradores c on c.id = a.colaborador_id
join public.tipos_documento t on t.ativo and t.enviado_pelo_fornecedor and not t.so_rescisao
left join public.empresas_obras eo on eo.empresa_id = c.empresa_id and eo.obra_id = a.obra_id
left join public.colaboradores_documentos_extras x on x.colaborador_id = c.id and x.tipo_codigo = t.codigo
where a.status <> 'encerrado'
  and c.situacao = 'ativo'
  and (
    (t.grupo = 'colaborador' and (
        not t.depende_da_funcao
        or coalesce(x.exige,
             exists (select 1 from public.funcoes_documentos fd where fd.funcao_id = c.funcao_id and fd.tipo_codigo = t.codigo))))
    or
    (t.grupo = 'empresa' and (not t.so_subcontratada or coalesce(eo.subcontratada, false)))
  );

-- Rescisórios de cada colaborador demitido pelo portal, com a situação de cada documento.
create or replace view public.v_rescisao with (security_invoker = true) as
select
  c.id as colaborador_id, c.empresa_id, c.nome as colaborador, c.data_desligamento,
  t.codigo as tipo_codigo, t.nome as documento, t.grupo, t.area, t.impeditivo,
  null::date as vencimento, null::integer as dias_para_vencer,
  ab.status as status_envio_aberto, ab.motivo_devolucao,
  case
    when atual.id is not null then atual.situacao
    when ab.status = 'devolvido' then 'devolvido'
    when ab.status = 'em_analise' then 'em_analise'
    else 'nao_enviado'
  end as situacao
from public.colaboradores c
join public.tipos_documento t on t.so_rescisao and t.ativo
left join public.v_documentos_atuais atual on atual.empresa_id = c.empresa_id and atual.tipo_codigo = t.codigo and atual.chave_colaborador = c.id
left join public.v_documentos_em_aberto ab on ab.empresa_id = c.empresa_id and ab.tipo_codigo = t.codigo and ab.chave_colaborador = c.id
where c.rescisao_exigida;
grant select on public.v_rescisao to authenticated;

-- Resumo das alocações e painel da obra passam a trazer o bloqueio.
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
    c.bloqueio_motivo
   FROM alocacoes a
     JOIN colaboradores c ON c.id = a.colaborador_id
     JOIN empresas emp ON emp.id = c.empresa_id
     JOIN obras o ON o.id = a.obra_id
     LEFT JOIN funcoes f ON f.id = c.funcao_id
     LEFT JOIN v_pendencias p ON p.alocacao_id = a.id
  GROUP BY a.id, o.nome, c.id, f.nome, emp.razao_social;

-- Painel da obra: igual ao da migração 019, com o bloqueio de cada colaborador.
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

-- ------------------------------------------------------------------ 3. Subcontratada

create or replace function public.cadastrar_subcontratada(
  p_principal uuid, p_cnpj text, p_razao_social text, p_email text, p_obras uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nova uuid;
  fora text;
begin
  if p_principal not in (select app.minhas_empresas()) then raise exception 'Empresa fora do seu acesso'; end if;
  if coalesce(p_cnpj, '') !~ '^\d{14}$' then raise exception 'CNPJ inválido'; end if;
  if length(btrim(coalesce(p_razao_social, ''))) < 3 then raise exception 'Informe a razão social'; end if;
  if coalesce(p_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Informe um e-mail válido'; end if;
  if coalesce(cardinality(p_obras), 0) = 0 then raise exception 'Escolha pelo menos uma obra'; end if;
  if exists (select 1 from public.empresas where cnpj = p_cnpj) then
    raise exception 'Este CNPJ já está cadastrado no portal. Fale com a Emais para vincular a subcontratada.';
  end if;
  select string_agg(o.nome, ', ') into fora
  from unnest(p_obras) as x(obra_id) join public.obras o on o.id = x.obra_id
  where not exists (select 1 from public.empresas_obras eo where eo.empresa_id = p_principal and eo.obra_id = x.obra_id and eo.ativo);
  if fora is not null then raise exception 'Sua empresa não está cadastrada na obra %', fora; end if;

  insert into public.empresas (razao_social, cnpj, email_acesso, email_contato)
  values (upper(regexp_replace(btrim(p_razao_social), '\s+', ' ', 'g')), p_cnpj, lower(btrim(p_email)), lower(btrim(p_email)))
  returning id into nova;
  insert into public.usuarios_empresas (usuario_id, empresa_id) values (auth.uid(), nova);
  insert into public.empresas_obras (empresa_id, obra_id, subcontratada, empresa_principal_id)
  select nova, x.obra_id, true, p_principal from unnest(p_obras) as x(obra_id);
  perform app.registrar_evento('empresas', nova, 'subcontratada_cadastrada', jsonb_build_object('principal', p_principal, 'obras', p_obras));
  return nova;
end $$;

-- ------------------------------------------------------------------ 4. TST vê o anexo das NRs

create or replace function app.tst_ve_arquivo_nr(p_caminho text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.arquivos a
    join public.documentos d on d.id = a.documento_id
    join public.tipos_documento t on t.codigo = d.tipo_codigo
    where a.caminho = p_caminho and t.depende_da_funcao and d.colaborador_id is not null
      and app.tst_ve_colaborador(d.colaborador_id)
  );
$$;

drop policy if exists tst_nr on public.arquivos;
create policy tst_nr on public.arquivos for select to authenticated
  using (app.tst_ve_arquivo_nr(caminho));

drop policy if exists "tst le anexos de nr" on storage.objects;
create policy "tst le anexos de nr" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and app.tst_ve_arquivo_nr(name));

-- ------------------------------------------------------------------ Permissões

revoke all on function public.corrigir_colaborador(uuid, uuid, text, text, uuid, text),
  public.incluir_documento_colaborador(uuid, text, text),
  public.desligar_colaborador(uuid, date, boolean),
  public.bloquear_colaborador(uuid, boolean, text),
  public.cadastrar_subcontratada(uuid, text, text, text, uuid[]) from public, anon;
grant execute on function public.corrigir_colaborador(uuid, uuid, text, text, uuid, text),
  public.incluir_documento_colaborador(uuid, text, text),
  public.desligar_colaborador(uuid, date, boolean),
  public.bloquear_colaborador(uuid, boolean, text),
  public.cadastrar_subcontratada(uuid, text, text, text, uuid[]) to authenticated;
grant execute on function app.cadastro_editavel_pelo_fornecedor(uuid), app.tst_ve_arquivo_nr(text) to authenticated;
