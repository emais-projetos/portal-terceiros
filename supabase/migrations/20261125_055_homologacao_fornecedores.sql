-- Homologação de fornecedores pelo Suprimentos, antes do fluxo de documentos do administrativo.
--
-- 1. O Suprimentos faz o pré-cadastro (razão social, CNPJ, e-mail, obras previstas) e o fornecedor recebe o convite.
-- 2. O fornecedor entra e só vê a aba Homologação: preenche o F.31 (dados da empresa, fiscais, bancários e
--    referências) e envia os documentos exigidos.
-- 3. O Suprimentos aprova ou devolve cada documento, preenche a qualificação e homologa (ou reprova).
-- 4. O Suprimentos registra o contrato (número, BP do SAP, vigência, arquivo e obras).
-- 5. O administrativo libera o portal: o fornecedor recebe o e-mail e as abas atuais se abrem.
--
-- Fornecedores que já existiam ficam com a homologação "anterior" e o portal liberado: nada muda para eles.
-- Eles aparecem para o Suprimentos em "A regularizar" até ter BP e contrato registrado em todas as obras.
-- Os documentos da homologação que o portal já pede em Documentos da empresa (cartão CNPJ, PGR e PCMSO) entram
-- aprovados ao homologar, e o fornecedor não envia de novo.
-- Certidão ou contrato vencido não trava nada: aparece para o Suprimentos acompanhar.

-- ------------------------------------------------------------------------------------------------ Perfil
create or replace function app.eh_suprimentos() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.perfil = 'suprimentos' and u.ativo);
$$;
create or replace function app.eh_gestao_fornecedor() returns boolean
language sql stable security definer set search_path = public as $$
  select app.eh_admin() or app.eh_suprimentos();
$$;
grant execute on function app.eh_suprimentos(), app.eh_gestao_fornecedor() to authenticated;

-- ------------------------------------------------------------------------------------------------ Empresa
alter table public.empresas
  add column if not exists homologacao text not null default 'anterior',
  add column if not exists portal_liberado_em timestamptz default now(),
  add column if not exists portal_liberado_por uuid references public.usuarios (id),
  add column if not exists codigo_bp text,
  add column if not exists homologada_em timestamptz,
  add column if not exists homologada_por uuid references public.usuarios (id);
alter table public.empresas drop constraint if exists empresas_homologacao_ck;
alter table public.empresas add constraint empresas_homologacao_ck
  check (homologacao in ('anterior', 'convidada', 'enviada', 'devolvida', 'homologada', 'reprovada'));

-- Fornecedor só enxerga a empresa (e tudo dela) depois que o administrativo libera o portal.
create or replace function app.minhas_empresas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select ue.empresa_id
  from public.usuarios_empresas ue
  join public.usuarios u on u.id = ue.usuario_id
  join public.empresas e on e.id = ue.empresa_id
  where ue.usuario_id = auth.uid() and u.perfil = 'fornecedor' and u.ativo and e.portal_liberado_em is not null;
$$;

-- Todas as empresas do fornecedor, liberadas ou não (usado só na homologação).
create or replace function app.minhas_empresas_cadastro() returns setof uuid
language sql stable security definer set search_path = public as $$
  select ue.empresa_id
  from public.usuarios_empresas ue
  join public.usuarios u on u.id = ue.usuario_id
  where ue.usuario_id = auth.uid() and u.perfil = 'fornecedor' and u.ativo;
$$;
grant execute on function app.minhas_empresas_cadastro() to authenticated;

-- O Suprimentos lê as empresas, as obras de cada uma e os acessos.
drop policy if exists leitura on public.empresas;
create policy leitura on public.empresas for select to authenticated
  using ((select app.eh_admin()) or (select app.eh_suprimentos()) or id in (select app.minhas_empresas()) or id in (select app.empresas_do_tst()));
drop policy if exists leitura on public.empresas_obras;
create policy leitura on public.empresas_obras for select to authenticated
  using ((select app.eh_admin()) or (select app.eh_suprimentos()) or empresa_id in (select app.minhas_empresas()) or obra_id in (select app.minhas_obras_tst()));

-- Modelos de e-mail: o Suprimentos também revisa e edita.
drop policy if exists leitura on public.modelos_email;
create policy leitura on public.modelos_email for select to authenticated using ((select app.eh_gestao_fornecedor()));
drop policy if exists edicao on public.modelos_email;
create policy edicao on public.modelos_email for update to authenticated
  using ((select app.eh_gestao_fornecedor())) with check ((select app.eh_gestao_fornecedor()));

drop policy if exists admin on public.modelos_email_revisoes;
create policy admin on public.modelos_email_revisoes for select to authenticated using ((select app.eh_gestao_fornecedor()));

-- Pedidos de obra: o Suprimentos lê e responde.
drop policy if exists leitura on public.pedidos_obra;
create policy leitura on public.pedidos_obra for select to authenticated
  using ((select app.eh_gestao_fornecedor()) or empresa_id in (select app.minhas_empresas()));

-- ------------------------------------------------------------------------------------------------ Tabelas
create table if not exists public.homologacao_tipos (
  codigo        text primary key,
  nome          text not null,
  ordem         integer not null,
  obrigatorio   boolean not null default true,
  validade_dias integer,                                     -- null: sem vencimento
  tipo_portal   text references public.tipos_documento (codigo), -- documento igual em Documentos da empresa
  observacao    text
);
alter table public.homologacao_tipos enable row level security;
drop policy if exists leitura on public.homologacao_tipos;
create policy leitura on public.homologacao_tipos for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists edicao on public.homologacao_tipos;
create policy edicao on public.homologacao_tipos for update to authenticated
  using ((select app.eh_gestao_fornecedor())) with check ((select app.eh_gestao_fornecedor()));
grant select, update on public.homologacao_tipos to authenticated;

insert into public.homologacao_tipos (codigo, nome, ordem, obrigatorio, validade_dias, tipo_portal, observacao) values
  ('contrato_social',     'Contrato social com as alterações',                                   1, true,  null, null, null),
  ('cartao_cnpj',         'Cartão CNPJ',                                                         2, true,  180,  'cartao_cnpj', null),
  ('certidao_junta',      'Certidão simplificada da Junta Comercial',                            3, true,  30,   null, null),
  ('cnd_federal',         'CND da Receita Federal (tributos federais e dívida ativa da União)',  4, true,  180,  null, null),
  ('crf_fgts',            'CRF: certidão de regularidade do FGTS',                               5, true,  30,   null, null),
  ('inscricao_estadual',  'Comprovante de inscrição estadual',                                   6, true,  null, null, 'Isento: envie a declaração ou o cartão CNPJ.'),
  ('cnd_estadual',        'CND da Receita Estadual',                                             7, true,  90,   null, null),
  ('certidao_jf',         'Certidão da Justiça Federal',                                         8, true,  30,   null, null),
  ('inscricao_municipal', 'Comprovante de inscrição municipal',                                  9, false, null, null, 'Se houver.'),
  ('alvara',              'Alvará de funcionamento',                                            10, true,  365,  null, null),
  ('conta_bancaria',      'Comprovante da conta bancária',                                      11, true,  null, null, 'Folha de cheque em branco, cabeçalho de extrato ou cartão.'),
  ('orgao_regulador',     'Comprovante do órgão regulador (ABCP, PBQP-H/SiAC)',                12, false, 365,  null, 'Se houver.'),
  ('pgr',                 'SST: PGR (inventário de riscos)',                                    13, true,  365,  'pgr', null),
  ('pcmso',               'SST: PCMSO',                                                         14, true,  365,  'pcmso', null)
on conflict (codigo) do nothing;

create table if not exists public.homologacoes (
  empresa_id            uuid primary key references public.empresas (id) on delete cascade,
  dados                 jsonb not null default '{}'::jsonb,
  obras_previstas       uuid[] not null default '{}',
  qualificacao          jsonb not null default '{}'::jsonb,
  comentarios           text,
  responsavel_aprovacao text,
  motivo                text,
  convidada_por         uuid references public.usuarios (id),
  convidada_em          timestamptz not null default now(),
  enviada_em            timestamptz,
  decidida_por          uuid references public.usuarios (id),
  decidida_em           timestamptz,
  atualizado_em         timestamptz not null default now()
);
alter table public.homologacoes enable row level security;
drop policy if exists leitura on public.homologacoes;
create policy leitura on public.homologacoes for select to authenticated
  using ((select app.eh_gestao_fornecedor()) or empresa_id in (select app.minhas_empresas_cadastro()));
grant select on public.homologacoes to authenticated;

create table if not exists public.homologacao_documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  tipo_codigo      text not null references public.homologacao_tipos (codigo),
  data_emissao     date,
  vencimento       date,
  status           text not null default 'em_analise' check (status in ('em_analise', 'aprovado', 'devolvido', 'substituido')),
  motivo_devolucao text,
  arquivos         jsonb not null default '[]'::jsonb,       -- [{caminho, nome, tamanho, tipo}]
  enviado_por      uuid references public.usuarios (id),
  enviado_em       timestamptz not null default now(),
  analisado_por    uuid references public.usuarios (id),
  analisado_em     timestamptz,
  aviso_vencido_em timestamptz,
  documento_portal uuid references public.documentos (id)
);
create index if not exists homologacao_documentos_empresa on public.homologacao_documentos (empresa_id, tipo_codigo, enviado_em desc);
alter table public.homologacao_documentos enable row level security;
drop policy if exists leitura on public.homologacao_documentos;
create policy leitura on public.homologacao_documentos for select to authenticated
  using ((select app.eh_gestao_fornecedor()) or empresa_id in (select app.minhas_empresas_cadastro()));
grant select on public.homologacao_documentos to authenticated;

create table if not exists public.contratos_fornecedor (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  numero        text not null,
  codigo_bp     text not null,
  inicio        date not null,
  termino       date not null,
  arquivo       text not null,   -- caminho no bucket documentos: {empresa}/contratos/{contrato}/{arquivo}
  arquivo_nome  text not null,
  situacao      text not null default 'ativo' check (situacao in ('ativo', 'encerrado')),
  encerrado_em  timestamptz,
  encerrado_por uuid references public.usuarios (id),
  motivo_encerramento text,
  criado_por    uuid references public.usuarios (id) default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (termino >= inicio)
);
create table if not exists public.contratos_obras (
  contrato_id uuid not null references public.contratos_fornecedor (id) on delete cascade,
  obra_id     uuid not null references public.obras (id),
  primary key (contrato_id, obra_id)
);
alter table public.contratos_fornecedor enable row level security;
alter table public.contratos_obras enable row level security;
drop policy if exists leitura on public.contratos_fornecedor;
create policy leitura on public.contratos_fornecedor for select to authenticated
  using ((select app.eh_gestao_fornecedor()) or empresa_id in (select app.minhas_empresas()));
drop policy if exists leitura on public.contratos_obras;
create policy leitura on public.contratos_obras for select to authenticated
  using (contrato_id in (select id from public.contratos_fornecedor));
grant select on public.contratos_fornecedor, public.contratos_obras to authenticated;

-- E-mails avulsos (homologação e liberação do portal): o banco monta o texto e o n8n envia pela fila.
create table if not exists public.envios_fila (
  id                uuid primary key default gen_random_uuid(),
  chave             text unique,
  tipo              text not null,
  empresa_id        uuid references public.empresas (id) on delete cascade,
  titulo            text,
  para              text,
  assunto           text not null,
  corpo             text not null,
  situacao_envio    text not null default 'aguardando' check (situacao_envio in ('aguardando', 'enviando', 'enviado', 'erro', 'sem_email')),
  envio_iniciado_em timestamptz,
  enviado_em        timestamptz,
  envio_erro        text,
  envio_teste       boolean,
  envio_para        text,
  criado_por        uuid references public.usuarios (id) default auth.uid(),
  criado_em         timestamptz not null default now()
);
create index if not exists envios_fila_pendentes on public.envios_fila (situacao_envio, criado_em);
alter table public.envios_fila enable row level security;
drop policy if exists leitura on public.envios_fila;
create policy leitura on public.envios_fila for select to authenticated using ((select app.eh_gestao_fornecedor()));
grant select on public.envios_fila to authenticated;

-- ------------------------------------------------------------------------------------------------ Arquivos
-- Homologação: {empresa}/h/{id}/{arquivo}. Contrato: {empresa}/contratos/{id}/{arquivo}. Mesmo bucket dos documentos,
-- para o cartão CNPJ, o PGR e o PCMSO da homologação valerem também em Documentos da empresa.
drop policy if exists "homologacao: fornecedor envia" on storage.objects;
create policy "homologacao: fornecedor envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[2] = 'h'
              and (storage.foldername(name))[1] in (select e::text from app.minhas_empresas_cadastro() e));
drop policy if exists "contratos: suprimentos envia" on storage.objects;
create policy "contratos: suprimentos envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[2] = 'contratos' and (select app.eh_gestao_fornecedor()));
drop policy if exists "homologacao: suprimentos le" on storage.objects;
create policy "homologacao: suprimentos le" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[2] in ('h', 'contratos') and (select app.eh_suprimentos()));

-- ------------------------------------------------------------------------------------------------ Modelos de e-mail
insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('convite_homologacao', 'Homologação: convite ao fornecedor', 'Quando o Suprimentos cadastra um fornecedor novo', 'Fornecedor (e-mail do cadastro)', 200,
 array['{empresa}', '{email}', '{endereco_portal}', '{assinatura}'], 'Texto inicial',
 'Cadastro de fornecedor da Emais: envie a sua homologação',
 E'Olá, equipe da {empresa},\n\nA Emais iniciou o seu cadastro como fornecedor de serviços. O primeiro passo é a homologação, feita pelo Portal de Terceiros.\n\nComo fazer:\n1. Acesse {endereco_portal}\n2. Clique em Primeiro acesso ou esqueci a senha e digite o e-mail {email}.\n3. Digite o código que chegar por e-mail e crie a sua senha.\n4. Na aba Homologação, preencha os dados da empresa e envie os documentos pedidos.\n5. Clique em Enviar para homologação.\n\nDepois da análise do Suprimentos e da assinatura do contrato, o portal libera o cadastro dos colaboradores para a obra.\n\n{assinatura}'),
('homologacao_correcoes', 'Homologação: correções', 'Quando o Suprimentos devolve a homologação para correção', 'Fornecedor', 201,
 array['{empresa}', '{corrigir}', '{observacao}', '{endereco_portal}', '{assinatura}'], 'Texto inicial',
 'Homologação na Emais: correções necessárias',
 E'Olá, equipe da {empresa},\n\nConferimos a sua homologação e alguns itens precisam de correção:\n\n{corrigir}\n\n{observacao}\n\nAcesse {endereco_portal}, abra a aba Homologação, corrija os itens e clique em Enviar para homologação.\n\n{assinatura}'),
('homologacao_aprovada', 'Homologação: aprovada', 'Quando o Suprimentos homologa o fornecedor', 'Fornecedor', 202,
 array['{empresa}', '{assinatura}'], 'Texto inicial',
 'Homologação na Emais: aprovada',
 E'Olá, equipe da {empresa},\n\nA sua homologação como fornecedor da Emais foi aprovada.\n\nO próximo passo é a assinatura do contrato. Assim que ele for registrado, o portal libera o cadastro dos colaboradores e o envio dos documentos para a obra. Você vai receber um e-mail avisando.\n\n{assinatura}'),
('homologacao_reprovada', 'Homologação: reprovada', 'Quando o Suprimentos reprova a homologação', 'Fornecedor', 203,
 array['{empresa}', '{motivo}', '{assinatura}'], 'Texto inicial',
 'Homologação na Emais',
 E'Olá, equipe da {empresa},\n\nAgradecemos o interesse em fornecer para a Emais. Depois da análise, a homologação não foi aprovada neste momento.\n\nMotivo: {motivo}\n\n{assinatura}'),
('portal_liberado', 'Portal liberado para o fornecedor', 'Quando o administrativo libera o portal para o fornecedor homologado', 'Fornecedor', 204,
 array['{empresa}', '{obras}', '{endereco_portal}', '{assinatura}'], 'Texto inicial',
 'Portal de Terceiros da Emais liberado',
 E'Olá, equipe da {empresa},\n\nO seu cadastro está completo e o Portal de Terceiros está liberado para:\n{obras}\n\nAgora você já pode:\n1. Enviar os documentos da empresa (PGR, PCMSO, seguro de vida e os demais pedidos).\n2. Cadastrar os colaboradores que vão trabalhar na obra e enviar os documentos de cada um.\n\nAcesse {endereco_portal}. Quando os documentos obrigatórios estiverem enviados, a Emais confere e libera cada colaborador para a obra.\n\n{assinatura}'),
('certidao_vencida', 'Homologação: certidão vencida', 'No dia em que uma certidão da homologação vence', 'Fornecedor', 205,
 array['{empresa}', '{documentos}', '{endereco_portal}', '{assinatura}'], 'Texto inicial',
 'Certidão vencida no cadastro da Emais',
 E'Olá, equipe da {empresa},\n\nOs documentos abaixo do seu cadastro de fornecedor venceram:\n\n{documentos}\n\nAcesse {endereco_portal}, abra a aba Homologação e envie a versão atualizada.\n\n{assinatura}')
on conflict (tipo) do nothing;

-- Monta o e-mail a partir do modelo e coloca na fila do envio automático.
create or replace function app.enfileirar_email(p_tipo text, p_empresa uuid, p_valores jsonb, p_chave text default null, p_para text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.modelos_email;
  e public.empresas;
  v_assunto text;
  v_corpo text;
  v_para text;
  v_quem text;
  v_id uuid;
  k text;
begin
  select * into m from public.modelos_email where tipo = p_tipo;
  if m.tipo is null or not m.ativo then return null; end if;
  select * into e from public.empresas where id = p_empresa;
  select nome into v_quem from public.usuarios where id = auth.uid();
  v_assunto := m.assunto;
  v_corpo := m.corpo;
  for k in select jsonb_object_keys(coalesce(p_valores, '{}'::jsonb)) loop
    v_assunto := replace(v_assunto, '{' || k || '}', coalesce(p_valores ->> k, ''));
    v_corpo := replace(v_corpo, '{' || k || '}', coalesce(p_valores ->> k, ''));
  end loop;
  v_assunto := replace(v_assunto, '{empresa}', coalesce(e.razao_social, ''));
  v_corpo := replace(v_corpo, '{empresa}', coalesce(e.razao_social, ''));
  v_corpo := replace(v_corpo, '{endereco_portal}', 'https://emais-projetos.github.io/portal-terceiros/');
  v_corpo := replace(v_corpo, '{assinatura}', concat_ws(E'\n', nullif(btrim(coalesce(v_quem, '')), ''),
    case when p_tipo = 'portal_liberado' then coalesce(nullif((select valor from public.parametros where chave = 'cobranca_setor'), ''), 'Gente e Gestão') else 'Suprimentos' end || ' | Grupo Emais'));
  v_corpo := regexp_replace(v_corpo, E'\n{3,}', E'\n\n', 'g');
  v_para := coalesce(nullif(btrim(p_para), ''), app.emails_notificacao(e.email_acesso, e.email_contato),
                     (select nullif(btrim(h.dados ->> 'email'), '') from public.homologacoes h where h.empresa_id = p_empresa));
  insert into public.envios_fila (chave, tipo, empresa_id, titulo, para, assunto, corpo, situacao_envio)
  values (p_chave, p_tipo, p_empresa, e.razao_social, v_para, btrim(v_assunto), btrim(v_corpo), case when v_para is null then 'sem_email' else 'aguardando' end)
  on conflict (chave) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function app.enfileirar_email(text, uuid, jsonb, text, text) from public;

-- ------------------------------------------------------------------------------------------------ Suprimentos: cadastro
create or replace function public.cadastrar_fornecedor_homologacao(p_razao text, p_cnpj text, p_email text, p_contato text, p_obras uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos cadastra fornecedores'; end if;
  if length(btrim(coalesce(p_razao, ''))) < 3 then raise exception 'Informe a razão social'; end if;
  if length(v_cnpj) <> 14 then raise exception 'Informe o CNPJ com 14 números'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido'; end if;
  if exists (select 1 from public.empresas where regexp_replace(cnpj, '\D', '', 'g') = v_cnpj) then
    raise exception 'Já existe uma empresa com este CNPJ no portal';
  end if;
  insert into public.empresas (razao_social, cnpj, email_contato, homologacao, portal_liberado_em, origem)
  values (upper(btrim(p_razao)), v_cnpj, null, 'convidada', null, 'portal')
  returning id into v_id;
  insert into public.homologacoes (empresa_id, dados, obras_previstas, convidada_por)
  values (v_id, jsonb_build_object('email', v_email, 'contato', nullif(btrim(coalesce(p_contato, '')), '')),
          coalesce((select array_agg(o.id) from public.obras o where o.id = any (coalesce(p_obras, '{}')) and o.ativa), '{}'), auth.uid());
  perform app.registrar_evento('empresas', v_id, 'homologacao_cadastrada', jsonb_build_object('cnpj', v_cnpj, 'email', v_email));
  return v_id;
end $$;

-- Depois de criado o acesso (gerenciar-acesso), o convite vai para a fila.
create or replace function public.enviar_convite_homologacao(p_empresa uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  h public.homologacoes;
  e public.empresas;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  select * into e from public.empresas where id = p_empresa;
  select * into h from public.homologacoes where empresa_id = p_empresa;
  if h.empresa_id is null then raise exception 'Fornecedor não está em homologação'; end if;
  if e.homologacao not in ('convidada', 'devolvida') then raise exception 'A homologação já foi enviada pelo fornecedor'; end if;
  perform app.registrar_evento('empresas', p_empresa, 'convite_homologacao', jsonb_build_object('para', coalesce(e.email_acesso, h.dados ->> 'email')));
  return app.enfileirar_email('convite_homologacao', p_empresa,
    jsonb_build_object('email', coalesce(e.email_acesso, h.dados ->> 'email')), null, coalesce(e.email_acesso, h.dados ->> 'email'));
end $$;

-- ------------------------------------------------------------------------------------------------ Fornecedor: preenchimento
create or replace function public.minha_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.homologacao,
    'liberado', e.portal_liberado_em is not null, 'dados', h.dados, 'motivo', h.motivo, 'enviada_em', h.enviada_em,
    'documentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo_codigo, 'data_emissao', d.data_emissao, 'vencimento', d.vencimento,
        'status', d.status, 'motivo', d.motivo_devolucao, 'arquivos', d.arquivos, 'enviado_em', d.enviado_em) order by d.enviado_em desc)
      from public.homologacao_documentos d where d.empresa_id = e.id and d.status <> 'substituido'), '[]'::jsonb)
  ) order by e.razao_social), '[]'::jsonb)
  from public.empresas e
  join public.homologacoes h on h.empresa_id = e.id
  where e.id in (select app.minhas_empresas_cadastro()) and e.homologacao <> 'anterior';
$$;

create or replace function public.salvar_homologacao(p_empresa uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e public.empresas;
begin
  if p_empresa not in (select app.minhas_empresas_cadastro()) then raise exception 'Sem permissão para esta empresa'; end if;
  select * into e from public.empresas where id = p_empresa;
  if e.homologacao not in ('convidada', 'devolvida') then raise exception 'A homologação já foi enviada. Aguarde a análise do Suprimentos'; end if;
  if jsonb_typeof(coalesce(p_dados, '{}'::jsonb)) <> 'object' or length(p_dados::text) > 20000 then raise exception 'Dados inválidos'; end if;
  -- O e-mail do convite fica guardado; o resto vem do formulário.
  update public.homologacoes set dados = p_dados || jsonb_build_object('email', dados ->> 'email'), atualizado_em = now() where empresa_id = p_empresa;
end $$;

create or replace function public.enviar_documento_homologacao(p_empresa uuid, p_tipo text, p_data_emissao date, p_arquivos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  t public.homologacao_tipos;
  v_id uuid;
  a jsonb;
begin
  if p_empresa not in (select app.minhas_empresas_cadastro()) then raise exception 'Sem permissão para esta empresa'; end if;
  select * into e from public.empresas where id = p_empresa;
  if e.homologacao not in ('convidada', 'devolvida', 'homologada') then raise exception 'A homologação está em análise. Aguarde o Suprimentos'; end if;
  select * into t from public.homologacao_tipos where codigo = p_tipo;
  if t.codigo is null then raise exception 'Documento não encontrado'; end if;
  if p_data_emissao is null then raise exception 'Informe a data de emissão'; end if;
  if p_data_emissao > current_date then raise exception 'A data de emissão não pode ser futura'; end if;
  if jsonb_typeof(p_arquivos) <> 'array' or jsonb_array_length(p_arquivos) = 0 then raise exception 'Anexe o arquivo'; end if;
  for a in select * from jsonb_array_elements(p_arquivos) loop
    if coalesce(a ->> 'caminho', '') not like p_empresa::text || '/h/%' then raise exception 'Arquivo inválido'; end if;
  end loop;
  -- Envio novo substitui o anterior que ainda não foi aprovado; o aprovado vale até o novo ser aprovado.
  update public.homologacao_documentos set status = 'substituido'
   where empresa_id = p_empresa and tipo_codigo = p_tipo and status in ('em_analise', 'devolvido');
  insert into public.homologacao_documentos (empresa_id, tipo_codigo, data_emissao, vencimento, arquivos, enviado_por)
  values (p_empresa, p_tipo, p_data_emissao, case when t.validade_dias is null then null else p_data_emissao + t.validade_dias end, p_arquivos, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.enviar_homologacao(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  h public.homologacoes;
  faltam text;
  campo text;
begin
  if p_empresa not in (select app.minhas_empresas_cadastro()) then raise exception 'Sem permissão para esta empresa'; end if;
  select * into e from public.empresas where id = p_empresa;
  select * into h from public.homologacoes where empresa_id = p_empresa;
  if e.homologacao not in ('convidada', 'devolvida') then raise exception 'A homologação já foi enviada'; end if;
  foreach campo in array array['razao_social', 'ramo', 'endereco', 'numero', 'bairro', 'cep', 'cidade', 'estado', 'telefone', 'contato', 'email_empresa', 'banco', 'agencia', 'conta'] loop
    if length(btrim(coalesce(h.dados ->> campo, ''))) = 0 then raise exception 'Preencha todos os campos obrigatórios dos dados da empresa'; end if;
  end loop;
  if jsonb_array_length(coalesce(h.dados -> 'referencias', '[]'::jsonb)) < 1
     or length(btrim(coalesce(h.dados -> 'referencias' -> 0 ->> 'empresa', ''))) = 0 then
    raise exception 'Informe pelo menos uma referência de fornecimento';
  end if;
  select string_agg(t.nome, ', ' order by t.ordem) into faltam
  from public.homologacao_tipos t
  where t.obrigatorio and not exists (
    select 1 from public.homologacao_documentos d where d.empresa_id = p_empresa and d.tipo_codigo = t.codigo and d.status in ('em_analise', 'aprovado'));
  if faltam is not null then raise exception 'Envie os documentos: %', faltam; end if;
  update public.empresas set homologacao = 'enviada' where id = p_empresa;
  update public.homologacoes set enviada_em = now(), motivo = null, atualizado_em = now() where empresa_id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'homologacao_enviada', '{}'::jsonb);
end $$;

-- ------------------------------------------------------------------------------------------------ Suprimentos: análise
create or replace function public.analisar_documento_homologacao(p_documento uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.homologacao_documentos;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  select * into d from public.homologacao_documentos where id = p_documento for update;
  if d.id is null or d.status not in ('em_analise', 'aprovado', 'devolvido') then raise exception 'Documento não encontrado ou substituído'; end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o que precisa ser corrigido'; end if;
  if p_aprovar then
    -- Aprovado novo substitui o aprovado anterior do mesmo documento.
    update public.homologacao_documentos set status = 'substituido'
     where empresa_id = d.empresa_id and tipo_codigo = d.tipo_codigo and status = 'aprovado' and id <> d.id;
  end if;
  update public.homologacao_documentos
     set status = case when p_aprovar then 'aprovado' else 'devolvido' end,
         motivo_devolucao = case when p_aprovar then null else btrim(p_motivo) end,
         analisado_por = auth.uid(), analisado_em = now()
   where id = p_documento;
  -- Renovação depois de homologado: certidão aprovada que também existe em Documentos da empresa entra lá.
  if p_aprovar and (select homologacao from public.empresas where id = d.empresa_id) = 'homologada' then
    perform app.levar_documento_ao_portal(p_documento);
  end if;
end $$;

-- Copia o documento aprovado da homologação para Documentos da empresa (cartão CNPJ, PGR, PCMSO), já aprovado.
create or replace function app.levar_documento_ao_portal(p_documento uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d public.homologacao_documentos;
  t public.homologacao_tipos;
  v_doc uuid;
  a jsonb;
begin
  select * into d from public.homologacao_documentos where id = p_documento;
  select * into t from public.homologacao_tipos where codigo = d.tipo_codigo;
  if t.tipo_portal is null or d.status <> 'aprovado' or d.documento_portal is not null then return d.documento_portal; end if;
  -- Já existe um envio mais novo do fornecedor em Documentos da empresa: não sobrescreve.
  if exists (select 1 from public.documentos x where x.empresa_id = d.empresa_id and x.colaborador_id is null and x.tipo_codigo = t.tipo_portal
             and x.status in ('em_analise', 'aprovado') and x.data_emissao >= d.data_emissao) then
    return null;
  end if;
  perform set_config('app.homologacao_emais', 'sim', true);
  insert into public.documentos (tipo_codigo, empresa_id, colaborador_id, data_emissao, dispensado, dados, aceite_lgpd_em)
  values (t.tipo_portal, d.empresa_id, null, d.data_emissao, false, jsonb_build_object('origem', 'homologacao', 'homologacao_documento', d.id), now())
  returning id into v_doc;
  perform set_config('app.homologacao_emais', '', true);
  for a in select * from jsonb_array_elements(d.arquivos) loop
    insert into public.arquivos (documento_id, caminho, nome_original, tamanho_bytes, tipo_mime)
    values (v_doc, a ->> 'caminho', coalesce(a ->> 'nome', 'arquivo'), coalesce((a ->> 'tamanho')::bigint, 0), coalesce(a ->> 'tipo', 'application/pdf'));
  end loop;
  update public.homologacao_documentos set documento_portal = v_doc where id = d.id;
  return v_doc;
end $$;
revoke all on function app.levar_documento_ao_portal(uuid) from public;

-- Documento vindo da homologação entra já aprovado, sem passar pela análise do administrativo.
create or replace function app.antes_inserir_documento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_documento;
  emp_colab uuid;
  v_emais boolean := coalesce(current_setting('app.dispensa_emais', true), '') = 'sim' and app.eh_admin();
  v_homologacao boolean := coalesce(current_setting('app.homologacao_emais', true), '') = 'sim' and app.eh_gestao_fornecedor();
begin
  select * into t from public.tipos_documento where codigo = new.tipo_codigo;
  if not t.ativo then raise exception 'Tipo de documento % está inativo', new.tipo_codigo; end if;
  if not t.enviado_pelo_fornecedor then raise exception '% não é enviado pelo fornecedor', t.nome; end if;

  -- documento de empresa x de colaborador
  if t.grupo = 'empresa' and new.colaborador_id is not null then
    raise exception '% é documento da empresa: não informe colaborador', t.nome;
  end if;
  if t.grupo = 'colaborador' then
    if new.colaborador_id is null then raise exception '% exige o colaborador', t.nome; end if;
    select empresa_id into emp_colab from public.colaboradores where id = new.colaborador_id;
    if emp_colab is distinct from new.empresa_id then raise exception 'Colaborador não pertence à empresa informada'; end if;
  end if;

  if v_emais or v_homologacao then
    if v_emais and not new.dispensado then raise exception 'Uso interno: só a dispensa pela Emais entra direto'; end if;
    if v_homologacao and (new.dispensado or t.grupo <> 'empresa') then raise exception 'Uso interno: só documento da empresa vem da homologação'; end if;
    new.origem := 'portal';
    new.enviado_por := auth.uid();
    new.enviado_em := now();
    new.status := 'aprovado';
    new.motivo_devolucao := null;
    new.analisado_por := auth.uid();
    new.analisado_em := now();
    new.aceite_lgpd_em := coalesce(new.aceite_lgpd_em, now());
    return new;
  end if;

  -- datas
  if new.dispensado and not t.pode_dispensar then raise exception '% não pode ser dispensado', t.nome; end if;
  if not new.dispensado then
    if t.regra = 'emissao_mais_prazo' and new.data_emissao is null then
      raise exception 'Informe a data de emissão de %', t.nome;
    end if;
    if t.regra = 'vigencia_informada' and new.data_vencimento_informada is null then
      raise exception 'Informe a vigência final de %', t.nome;
    end if;
  end if;
  if new.data_emissao > current_date then
    raise exception 'A data de emissão de % não pode ser futura', t.nome;
  end if;

  -- campos do sistema: quem chega pela API (fornecedor ou admin) não escolhe status
  if auth.uid() is not null then
    new.origem := 'portal';
    new.enviado_por := auth.uid();
    new.enviado_em := now();
    new.status := 'em_analise';
    new.motivo_devolucao := null;
    new.analisado_por := null;
    new.analisado_em := null;
    if new.aceite_lgpd_em is null then raise exception 'É preciso aceitar o termo de LGPD para enviar'; end if;
  end if;
  return new;
end $$;

create or replace function public.devolver_homologacao(p_empresa uuid, p_observacao text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_lista text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.homologacao <> 'enviada' then raise exception 'A homologação não está aguardando análise'; end if;
  select string_agg('- ' || t.nome || ': ' || d.motivo_devolucao, E'\n' order by t.ordem) into v_lista
  from public.homologacao_documentos d join public.homologacao_tipos t on t.codigo = d.tipo_codigo
  where d.empresa_id = p_empresa and d.status = 'devolvido';
  if v_lista is null and length(btrim(coalesce(p_observacao, ''))) < 3 then
    raise exception 'Devolva algum documento ou escreva o que precisa ser corrigido';
  end if;
  update public.empresas set homologacao = 'devolvida' where id = p_empresa;
  update public.homologacoes set motivo = nullif(btrim(coalesce(p_observacao, '')), ''), atualizado_em = now() where empresa_id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'homologacao_devolvida', jsonb_build_object('observacao', p_observacao));
  return app.enfileirar_email('homologacao_correcoes', p_empresa, jsonb_build_object(
    'corrigir', coalesce(v_lista, '- Dados da empresa (veja a observação abaixo)'),
    'observacao', case when nullif(btrim(coalesce(p_observacao, '')), '') is null then '' else 'Observação do Suprimentos: ' || btrim(p_observacao) end));
end $$;

create or replace function public.homologar_fornecedor(p_empresa uuid, p_qualificacao jsonb, p_comentarios text, p_responsavel text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  pend text;
  d record;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos homologa'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.homologacao <> 'enviada' then raise exception 'A homologação não está aguardando análise'; end if;
  if length(btrim(coalesce(p_responsavel, ''))) < 3 then raise exception 'Informe o responsável pela aprovação'; end if;
  select string_agg(t.nome, ', ' order by t.ordem) into pend
  from public.homologacao_tipos t
  where t.obrigatorio and not exists (
    select 1 from public.homologacao_documentos x where x.empresa_id = p_empresa and x.tipo_codigo = t.codigo and x.status = 'aprovado');
  if pend is not null then raise exception 'Aprove os documentos antes de homologar: %', pend; end if;
  if exists (select 1 from public.homologacao_documentos x where x.empresa_id = p_empresa and x.status = 'em_analise') then
    raise exception 'Ainda há documento em análise';
  end if;
  update public.empresas set homologacao = 'homologada', homologada_em = now(), homologada_por = auth.uid() where id = p_empresa;
  update public.homologacoes
     set qualificacao = coalesce(p_qualificacao, '{}'::jsonb), comentarios = nullif(btrim(coalesce(p_comentarios, '')), ''),
         responsavel_aprovacao = btrim(p_responsavel), decidida_por = auth.uid(), decidida_em = now(), motivo = null, atualizado_em = now()
   where empresa_id = p_empresa;
  -- Cartão CNPJ, PGR e PCMSO aprovados na homologação valem em Documentos da empresa.
  for d in select x.id from public.homologacao_documentos x join public.homologacao_tipos t on t.codigo = x.tipo_codigo
           where x.empresa_id = p_empresa and x.status = 'aprovado' and t.tipo_portal is not null loop
    perform app.levar_documento_ao_portal(d.id);
  end loop;
  perform app.registrar_evento('empresas', p_empresa, 'homologada', jsonb_build_object('responsavel', btrim(p_responsavel)));
  perform app.enfileirar_email('homologacao_aprovada', p_empresa, '{}'::jsonb, 'homologada|' || p_empresa);
end $$;

create or replace function public.reprovar_homologacao(p_empresa uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.empresas;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.homologacao not in ('enviada', 'devolvida', 'convidada') then raise exception 'Esta homologação não pode ser reprovada'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo da reprovação'; end if;
  update public.empresas set homologacao = 'reprovada' where id = p_empresa;
  update public.homologacoes set motivo = btrim(p_motivo), decidida_por = auth.uid(), decidida_em = now(), atualizado_em = now() where empresa_id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'homologacao_reprovada', jsonb_build_object('motivo', btrim(p_motivo)));
  perform app.enfileirar_email('homologacao_reprovada', p_empresa, jsonb_build_object('motivo', btrim(p_motivo)));
end $$;

-- ------------------------------------------------------------------------------------------------ Contrato
create or replace function public.registrar_contrato(
  p_empresa uuid, p_numero text, p_bp text, p_inicio date, p_termino date, p_arquivo text, p_arquivo_nome text,
  p_obras uuid[], p_contrato uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_id uuid := p_contrato;
  o uuid;
  p public.pedidos_obra;
  v_obra text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos registra contratos'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Fornecedor não encontrado'; end if;
  if e.homologacao not in ('anterior', 'homologada') then raise exception 'Homologue o fornecedor antes de registrar o contrato'; end if;
  if length(btrim(coalesce(p_numero, ''))) = 0 then raise exception 'Informe o número do contrato'; end if;
  if length(btrim(coalesce(p_bp, ''))) = 0 then raise exception 'Informe o código do BP no SAP'; end if;
  if p_inicio is null or p_termino is null then raise exception 'Informe o início e o término do contrato'; end if;
  if p_termino < p_inicio then raise exception 'O término não pode ser antes do início'; end if;
  if coalesce(p_arquivo, '') not like p_empresa::text || '/contratos/%' then raise exception 'Anexe o contrato assinado'; end if;
  if coalesce(array_length(p_obras, 1), 0) = 0 then raise exception 'Escolha pelo menos uma obra'; end if;

  if v_id is null then
    insert into public.contratos_fornecedor (empresa_id, numero, codigo_bp, inicio, termino, arquivo, arquivo_nome)
    values (p_empresa, btrim(p_numero), btrim(p_bp), p_inicio, p_termino, p_arquivo, coalesce(nullif(btrim(p_arquivo_nome), ''), 'contrato.pdf'))
    returning id into v_id;
  else
    update public.contratos_fornecedor
       set numero = btrim(p_numero), codigo_bp = btrim(p_bp), inicio = p_inicio, termino = p_termino, arquivo = p_arquivo,
           arquivo_nome = coalesce(nullif(btrim(p_arquivo_nome), ''), arquivo_nome), situacao = 'ativo',
           encerrado_em = null, encerrado_por = null, motivo_encerramento = null, atualizado_em = now()
     where id = v_id and empresa_id = p_empresa;
    if not found then raise exception 'Contrato não encontrado'; end if;
    delete from public.contratos_obras where contrato_id = v_id;
  end if;
  update public.empresas set codigo_bp = btrim(p_bp) where id = p_empresa;

  foreach o in array p_obras loop
    if not exists (select 1 from public.obras where id = o and ativa) then raise exception 'Obra não encontrada ou inativa'; end if;
    insert into public.contratos_obras (contrato_id, obra_id) values (v_id, o) on conflict do nothing;
    insert into public.empresas_obras (empresa_id, obra_id, ativo, numero_contrato)
    values (p_empresa, o, true, btrim(p_numero))
    on conflict (empresa_id, obra_id) do update set ativo = true, numero_contrato = excluded.numero_contrato;
    -- Pedido do fornecedor para esta obra fica aprovado.
    for p in select * from public.pedidos_obra where empresa_id = p_empresa and obra_id = o and situacao = 'pendente' loop
      update public.pedidos_obra set situacao = 'aprovado', analisado_por = auth.uid(), analisado_em = now(), numero_contrato = btrim(p_numero) where id = p.id;
      insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
      values ('pedidos_obra', p.id, 'pedido_obra_aprovado', jsonb_build_object('empresa_id', p_empresa, 'obra_id', o, 'contrato', btrim(p_numero)), auth.uid());
      if p.pedido_por is not null then
        select nome into v_obra from public.obras where id = o;
        perform app.gravar_mensagem(app.conversa_do_usuario(p.pedido_por), auth.uid(), true,
          format('Pedido aprovado: a %s já pode cadastrar colaboradores na obra %s.', e.razao_social, v_obra), true);
      end if;
    end loop;
  end loop;
  perform app.registrar_evento('contratos_fornecedor', v_id, case when p_contrato is null then 'contrato_registrado' else 'contrato_alterado' end,
    jsonb_build_object('empresa_id', p_empresa, 'numero', btrim(p_numero), 'obras', p_obras, 'termino', p_termino));
  return v_id;
end $$;

create or replace function public.encerrar_contrato(p_contrato uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo'; end if;
  update public.contratos_fornecedor set situacao = 'encerrado', encerrado_em = now(), encerrado_por = auth.uid(), motivo_encerramento = btrim(p_motivo), atualizado_em = now()
   where id = p_contrato and situacao = 'ativo';
  if not found then raise exception 'Contrato não encontrado ou já encerrado'; end if;
  perform app.registrar_evento('contratos_fornecedor', p_contrato, 'contrato_encerrado', jsonb_build_object('motivo', btrim(p_motivo)));
end $$;

-- Pedido de outra obra: recusa pelo Suprimentos (a aprovação acontece ao registrar o contrato).
create or replace function public.responder_pedido_obra(p_pedido uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.pedidos_obra;
  v_obra text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  if p_aprovar then raise exception 'Para aprovar, registre o contrato da obra'; end if;
  select * into p from public.pedidos_obra where id = p_pedido for update;
  if not found or p.situacao <> 'pendente' then raise exception 'Pedido já respondido'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da recusa'; end if;
  update public.pedidos_obra set situacao = 'recusado', analisado_por = auth.uid(), analisado_em = now(), motivo_recusa = btrim(p_motivo) where id = p_pedido;
  select nome into v_obra from public.obras where id = p.obra_id;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('pedidos_obra', p_pedido, 'pedido_obra_recusado', jsonb_build_object('empresa_id', p.empresa_id, 'obra_id', p.obra_id, 'motivo', p_motivo), auth.uid());
  if p.pedido_por is not null then
    perform app.gravar_mensagem(app.conversa_do_usuario(p.pedido_por), auth.uid(), true,
      format('Pedido de acesso à obra %s não aprovado. Motivo: %s', v_obra, btrim(p_motivo)), true);
  end if;
end $$;

-- O fornecedor não informa mais o número do contrato: quem registra é o Suprimentos.
create or replace function public.informar_contrato(p_empresa uuid, p_obra uuid, p_numero text) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'O contrato agora é registrado pelo Suprimentos da Emais';
end $$;

-- ------------------------------------------------------------------------------------------------ Administrativo: liberar
create or replace function public.fornecedores_para_liberar() returns table (
  empresa_id uuid, razao_social text, cnpj text, homologada_em timestamptz, obras text[], email text)
language sql stable security definer set search_path = public as $$
  select e.id, e.razao_social, e.cnpj, e.homologada_em,
         array(select distinct o.nome from public.contratos_fornecedor c join public.contratos_obras co on co.contrato_id = c.id
               join public.obras o on o.id = co.obra_id where c.empresa_id = e.id and c.situacao = 'ativo' order by o.nome),
         app.emails_notificacao(e.email_acesso, e.email_contato)
  from public.empresas e
  where app.eh_gestao_fornecedor() and e.homologacao = 'homologada' and e.portal_liberado_em is null and e.ativa
    and exists (select 1 from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo')
  order by e.homologada_em;
$$;

create or replace function public.liberar_portal_fornecedor(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_obras text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo libera o portal'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.homologacao <> 'homologada' then raise exception 'O fornecedor ainda não foi homologado pelo Suprimentos'; end if;
  if e.portal_liberado_em is not null then raise exception 'O portal já está liberado para este fornecedor'; end if;
  if not exists (select 1 from public.contratos_fornecedor c where c.empresa_id = p_empresa and c.situacao = 'ativo') then
    raise exception 'O Suprimentos ainda não registrou o contrato';
  end if;
  update public.empresas set portal_liberado_em = now(), portal_liberado_por = auth.uid() where id = p_empresa;
  select string_agg('- ' || o.nome, E'\n' order by o.nome) into v_obras
  from public.empresas_obras eo join public.obras o on o.id = eo.obra_id where eo.empresa_id = p_empresa and eo.ativo;
  perform app.registrar_evento('empresas', p_empresa, 'portal_liberado', '{}'::jsonb);
  perform app.enfileirar_email('portal_liberado', p_empresa, jsonb_build_object('obras', coalesce(v_obras, '')), 'portal_liberado|' || p_empresa);
end $$;

-- ------------------------------------------------------------------------------------------------ Suprimentos: listas
create or replace function public.lista_homologacoes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'ordem', x ->> 'razao_social'), '[]'::jsonb) from (
    select jsonb_build_object(
      'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.homologacao,
      'ordem', case e.homologacao when 'enviada' then '1' when 'devolvida' then '2' when 'convidada' then '3' when 'homologada' then '4' else '5' end,
      'email', coalesce(e.email_acesso, h.dados ->> 'email'), 'convidada_em', h.convidada_em, 'enviada_em', h.enviada_em,
      'decidida_em', h.decidida_em, 'liberado_em', e.portal_liberado_em, 'codigo_bp', e.codigo_bp,
      'tem_acesso', exists (select 1 from public.usuarios_empresas ue join public.usuarios u on u.id = ue.usuario_id where ue.empresa_id = e.id and u.ativo),
      'contratos', (select count(*) from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo'),
      'docs_em_analise', (select count(*) from public.homologacao_documentos d where d.empresa_id = e.id and d.status = 'em_analise'),
      'docs_devolvidos', (select count(*) from public.homologacao_documentos d where d.empresa_id = e.id and d.status = 'devolvido'),
      'obras_previstas', coalesce((select jsonb_agg(o.nome order by o.nome) from public.obras o where o.id = any (h.obras_previstas)), '[]'::jsonb)
    ) x
    from public.empresas e join public.homologacoes h on h.empresa_id = e.id
    where app.eh_gestao_fornecedor() and e.homologacao <> 'anterior'
  ) s;
$$;

create or replace function public.detalhe_homologacao(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.homologacao, 'codigo_bp', e.codigo_bp,
    'liberado_em', e.portal_liberado_em, 'email', coalesce(e.email_acesso, h.dados ->> 'email'),
    'dados', h.dados, 'qualificacao', h.qualificacao, 'comentarios', h.comentarios, 'responsavel', h.responsavel_aprovacao,
    'motivo', h.motivo, 'convidada_em', h.convidada_em, 'enviada_em', h.enviada_em, 'decidida_em', h.decidida_em,
    'decidida_por', (select nome from public.usuarios where id = h.decidida_por),
    'obras_previstas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome) order by o.nome) from public.obras o where o.id = any (h.obras_previstas)), '[]'::jsonb),
    'documentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo_codigo, 'data_emissao', d.data_emissao, 'vencimento', d.vencimento,
        'status', d.status, 'motivo', d.motivo_devolucao, 'arquivos', d.arquivos, 'enviado_em', d.enviado_em,
        'analisado_em', d.analisado_em, 'analisado_por', (select nome from public.usuarios where id = d.analisado_por)) order by d.enviado_em desc)
      from public.homologacao_documentos d where d.empresa_id = e.id and d.status <> 'substituido'), '[]'::jsonb),
    'contratos', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'codigo_bp', c.codigo_bp, 'inicio', c.inicio, 'termino', c.termino,
        'arquivo', c.arquivo, 'arquivo_nome', c.arquivo_nome, 'situacao', c.situacao,
        'obras', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome) order by o.nome) from public.contratos_obras co join public.obras o on o.id = co.obra_id where co.contrato_id = c.id), '[]'::jsonb))
        order by c.situacao, c.termino desc)
      from public.contratos_fornecedor c where c.empresa_id = e.id), '[]'::jsonb),
    'obras_ativas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'numero_contrato', eo.numero_contrato) order by o.nome)
      from public.empresas_obras eo join public.obras o on o.id = eo.obra_id where eo.empresa_id = e.id and eo.ativo), '[]'::jsonb)
  )
  from public.empresas e left join public.homologacoes h on h.empresa_id = e.id
  where e.id = p_empresa and app.eh_gestao_fornecedor();
$$;

-- Fornecedores ativos com dado faltando: BP, contrato em cada obra, contrato vencendo ou vencido.
create or replace function public.fornecedores_a_regularizar() returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (
    select e.id, e.razao_social, e.cnpj, e.homologacao, e.codigo_bp,
      array(select o.nome from public.empresas_obras eo join public.obras o on o.id = eo.obra_id
            where eo.empresa_id = e.id and eo.ativo and not eo.subcontratada and o.ativa and o.situacao <> 'encerrada'
              and not exists (select 1 from public.contratos_obras co join public.contratos_fornecedor c on c.id = co.contrato_id
                              where co.obra_id = eo.obra_id and c.empresa_id = e.id and c.situacao = 'ativo')
            order by o.nome) as obras_sem_contrato,
      (select jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'termino', c.termino) order by c.termino)
         from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo' and c.termino <= current_date + 30) as contratos_vencendo,
      (select jsonb_agg(jsonb_build_object('tipo', t.nome, 'vencimento', d.vencimento) order by d.vencimento)
         from public.homologacao_documentos d join public.homologacao_tipos t on t.codigo = d.tipo_codigo
        where d.empresa_id = e.id and d.status = 'aprovado' and d.vencimento is not null and d.vencimento <= current_date + 15
          and not exists (select 1 from public.homologacao_documentos n where n.empresa_id = d.empresa_id and n.tipo_codigo = d.tipo_codigo
                          and n.status in ('em_analise') and n.enviado_em > d.enviado_em)) as certidoes
    from public.empresas e
    where app.eh_gestao_fornecedor() and e.ativa and e.homologacao in ('anterior', 'homologada') and e.portal_liberado_em is not null
      -- Subcontratada tem contrato com o fornecedor principal, não com a Emais.
      and exists (select 1 from public.empresas_obras eo where eo.empresa_id = e.id and eo.ativo and not eo.subcontratada)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', id, 'razao_social', razao_social, 'cnpj', cnpj, 'homologacao', homologacao, 'sem_bp', codigo_bp is null,
    'obras_sem_contrato', to_jsonb(obras_sem_contrato), 'contratos_vencendo', coalesce(contratos_vencendo, '[]'::jsonb),
    'certidoes', coalesce(certidoes, '[]'::jsonb)) order by razao_social), '[]'::jsonb)
  from base
  where codigo_bp is null or cardinality(obras_sem_contrato) > 0 or contratos_vencendo is not null or certidoes is not null;
$$;

-- Aviso ao fornecedor no dia em que uma certidão da homologação vence (chamado pelo envio automático).
create or replace function public.avisar_certidoes_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select d.empresa_id, string_agg('- ' || t.nome || ' (venceu em ' || to_char(d.vencimento, 'DD/MM/YYYY') || ')', E'\n' order by t.ordem) as lista,
           array_agg(d.id) as ids
    from public.homologacao_documentos d
    join public.homologacao_tipos t on t.codigo = d.tipo_codigo
    join public.empresas e on e.id = d.empresa_id
    where d.status = 'aprovado' and d.vencimento < current_date and d.aviso_vencido_em is null
      and e.ativa and e.homologacao = 'homologada'
      and not exists (select 1 from public.homologacao_documentos n where n.empresa_id = d.empresa_id and n.tipo_codigo = d.tipo_codigo
                      and n.status = 'em_analise' and n.enviado_em > d.enviado_em)
    group by d.empresa_id
  loop
    perform app.enfileirar_email('certidao_vencida', r.empresa_id, jsonb_build_object('documentos', r.lista), 'certidao|' || r.empresa_id || '|' || current_date);
    update public.homologacao_documentos set aviso_vencido_em = now() where id = any (r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Contadores do menu do Suprimentos.
create or replace function public.contadores_suprimentos() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'homologacao', (select count(*) from public.empresas where homologacao = 'enviada'),
    'pedidos', (select count(*) from public.pedidos_obra where situacao = 'pendente'),
    'contrato', (select count(*) from public.empresas e where e.homologacao = 'homologada'
                 and not exists (select 1 from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo')))
  where app.eh_gestao_fornecedor();
$$;

-- Painel da obra: o Suprimentos vê todas as obras (só leitura, como a engenharia).
do $$
declare
  f text := pg_get_functiondef('public.painel_obra(uuid)'::regprocedure);
  g text := pg_get_functiondef('public.painel_obras()'::regprocedure);
begin
  if strpos(g, 'where o.ativa and (app.eh_admin() or') = 0 then raise exception 'painel_obras mudou: revise a troca do acesso'; end if;
  execute replace(g, 'where o.ativa and (app.eh_admin() or', 'where o.ativa and (app.eh_admin() or app.eh_suprimentos() or');
  if strpos(f, 'if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then') = 0 then
    raise exception 'painel_obra mudou: revise a troca do acesso';
  end if;
  execute replace(f, 'if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then',
                     'if not (app.eh_admin() or app.eh_suprimentos() or p_obra in (select app.minhas_obras_painel())) then');
end $$;

-- ------------------------------------------------------------------------------------------------ Permissões
revoke all on function public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[]) from public, anon;
revoke all on function public.enviar_convite_homologacao(uuid) from public, anon;
revoke all on function public.minha_homologacao() from public, anon;
revoke all on function public.salvar_homologacao(uuid, jsonb) from public, anon;
revoke all on function public.enviar_documento_homologacao(uuid, text, date, jsonb) from public, anon;
revoke all on function public.enviar_homologacao(uuid) from public, anon;
revoke all on function public.analisar_documento_homologacao(uuid, boolean, text) from public, anon;
revoke all on function public.devolver_homologacao(uuid, text) from public, anon;
revoke all on function public.homologar_fornecedor(uuid, jsonb, text, text) from public, anon;
revoke all on function public.reprovar_homologacao(uuid, text) from public, anon;
revoke all on function public.registrar_contrato(uuid, text, text, date, date, text, text, uuid[], uuid) from public, anon;
revoke all on function public.encerrar_contrato(uuid, text) from public, anon;
revoke all on function public.responder_pedido_obra(uuid, boolean, text) from public, anon;
revoke all on function public.informar_contrato(uuid, uuid, text) from public, anon;
revoke all on function public.fornecedores_para_liberar() from public, anon;
revoke all on function public.liberar_portal_fornecedor(uuid) from public, anon;
revoke all on function public.lista_homologacoes() from public, anon;
revoke all on function public.detalhe_homologacao(uuid) from public, anon;
revoke all on function public.fornecedores_a_regularizar() from public, anon;
revoke all on function public.avisar_certidoes_vencidas() from public, anon, authenticated;
revoke all on function public.contadores_suprimentos() from public, anon;
revoke all on function public.painel_obras() from public, anon;
grant execute on function public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[]), public.enviar_convite_homologacao(uuid),
  public.minha_homologacao(), public.salvar_homologacao(uuid, jsonb), public.enviar_documento_homologacao(uuid, text, date, jsonb),
  public.enviar_homologacao(uuid), public.analisar_documento_homologacao(uuid, boolean, text), public.devolver_homologacao(uuid, text),
  public.homologar_fornecedor(uuid, jsonb, text, text), public.reprovar_homologacao(uuid, text),
  public.registrar_contrato(uuid, text, text, date, date, text, text, uuid[], uuid), public.encerrar_contrato(uuid, text),
  public.responder_pedido_obra(uuid, boolean, text), public.informar_contrato(uuid, uuid, text),
  public.fornecedores_para_liberar(), public.liberar_portal_fornecedor(uuid), public.lista_homologacoes(), public.detalhe_homologacao(uuid),
  public.fornecedores_a_regularizar(), public.contadores_suprimentos(), public.painel_obras() to authenticated;
grant execute on function public.avisar_certidoes_vencidas() to service_role;
