-- Teste por perfil: entra como cada tipo de usuário e tenta ler, alterar e chamar funções fora do seu acesso.
-- Roda num banco de TESTE com dados fictícios (nunca em produção). Para no primeiro bloco com erro e lista as falhas no fim.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\o /dev/null

-- ============================================================================================
-- Ferramentas do teste
-- ============================================================================================
create schema teste;
create table teste.falhas (n serial, teste text, detalhe text);
create table teste.contagem (n int);
insert into teste.contagem values (0);
grant usage on schema teste to anon, authenticated;
grant select, insert, update on teste.falhas, teste.contagem to anon, authenticated;
grant usage on sequence teste.falhas_n_seq to anon, authenticated;

-- Entra como a pessoa (null = sem login).
create function teste.entrar(p_usuario uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    case when p_usuario is null then json_build_object('role', 'anon') else json_build_object('sub', p_usuario, 'role', 'authenticated') end::text, false);
  execute case when p_usuario is null then 'set role anon' else 'set role authenticated' end;
end $$;

create function teste.sair() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

create function teste.falha(p_teste text, p_detalhe text) returns void language sql as $$
  insert into teste.falhas (teste, detalhe) values (p_teste, p_detalhe);
$$;

create function teste.contar() returns void language sql as $$ update teste.contagem set n = n + 1 $$;

-- Roda o comando e desfaz tudo. Devolve true se o comando passou (sem erro).
create function teste.passou(p_sql text) returns boolean language plpgsql as $$
declare ok boolean := false;
begin
  begin
    execute p_sql;
    ok := true;
    raise exception using errcode = 'P0999';
  exception when others then null;
  end;
  return ok;
end $$;

-- O comando precisa ser barrado (erro).
create function teste.bloqueado(p_teste text, p_sql text) returns void language plpgsql as $$
begin
  perform teste.contar();
  if teste.passou(p_sql) then perform teste.falha(p_teste, 'deveria ter sido barrado: ' || p_sql); end if;
end $$;

-- O comando precisa funcionar (controle: garante que o teste não passa "no vazio").
create function teste.permitido(p_teste text, p_sql text) returns void language plpgsql as $$
begin
  perform teste.contar();
  if not teste.passou(p_sql) then perform teste.falha(p_teste, 'deveria ter funcionado: ' || p_sql); end if;
end $$;

-- Quantas linhas um update/delete atinge (desfeito em seguida). Erro conta como 0 (barrado).
create function teste.linhas(p_sql text) returns int language plpgsql as $$
declare n int := 0;
begin
  begin
    execute 'with x as (' || p_sql || ' returning 1) select count(*) from x' into n;
    raise exception using errcode = 'P0999';
  exception when others then null;
  end;
  return n;
end $$;

-- Quantidade de linhas de uma consulta.
create function teste.qtd(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') x' into n;
  return n;
end $$;

create function teste.igual(p_teste text, p_sql text, p_esperado bigint) returns void language plpgsql as $$
declare n bigint;
begin
  perform teste.contar();
  n := teste.qtd(p_sql);
  if n <> p_esperado then perform teste.falha(p_teste, format('esperado %s, veio %s: %s', p_esperado, n, p_sql)); end if;
end $$;

-- Isolamento: com o login atual, nenhuma tabela ou view pode mostrar, alterar ou apagar linhas dos "alvos".
-- p_alvos: {"coluna": [ids]} vale para qualquer tabela com essa coluna; {"tabela.coluna": [ids]} só naquela tabela.
create function teste.isolamento(p_teste text, p_alvos jsonb) returns void language plpgsql as $$
declare
  r record;
  ids uuid[];
  n bigint;
begin
  for r in
    select c.table_name tabela, c.column_name coluna, t.table_type tipo,
           coalesce(p_alvos -> (c.table_name || '.' || c.column_name), p_alvos -> c.column_name) valores
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and (p_alvos ? (c.table_name || '.' || c.column_name) or p_alvos ? c.column_name)
    order by 1, 2
  loop
    ids := array(select jsonb_array_elements_text(r.valores)::uuid);
    perform teste.contar();
    execute format('select count(*) from public.%I where %I = any($1)', r.tabela, r.coluna) using ids into n;
    if n > 0 then
      perform teste.falha(p_teste, format('vê %s linha(s) de %s (%s)', n, r.tabela, r.coluna));
    end if;
    if r.tipo = 'BASE TABLE' then
      perform teste.contar();
      n := teste.linhas(format('update public.%I set %I = %I where %I = any(%L::uuid[])', r.tabela, r.coluna, r.coluna, r.coluna, ids));
      if n > 0 then perform teste.falha(p_teste, format('altera %s linha(s) de %s (%s)', n, r.tabela, r.coluna)); end if;
      perform teste.contar();
      n := teste.linhas(format('delete from public.%I where %I = any(%L::uuid[])', r.tabela, r.coluna, ids));
      if n > 0 then perform teste.falha(p_teste, format('apaga %s linha(s) de %s (%s)', n, r.tabela, r.coluna)); end if;
    end if;
  end loop;
end $$;

-- Tabelas só do administrativo: qualquer outro perfil vê 0 linhas e não altera nada.
create function teste.so_admin(p_teste text) returns void language plpgsql as $$
declare
  t text;
begin
  foreach t in array array['avisos_liberacao', 'cobrancas', 'cobrancas_envios', 'convites_acesso', 'eventos', 'modelos_email',
                           'modelos_email_revisoes', 'parametros_historico', 'tipos_documento_historico'] loop
    perform teste.igual(p_teste, format('select 1 from public.%I', t), 0);
  end loop;
  foreach t in array array['funcoes', 'funcoes_documentos', 'modelos_documento', 'obras', 'parametros', 'tipos_documento',
                           'tipos_medicao', 'modelos_email', 'usuarios', 'tst_obras', 'usuarios_empresas', 'empresas_obras'] loop
    perform teste.contar();
    if teste.linhas(format('delete from public.%I', t)) > 0 then perform teste.falha(p_teste, 'apaga linhas de ' || t); end if;
  end loop;
end $$;

-- ============================================================================================
-- Dados fictícios
--   Obras O1, O2 e O3. Empresa E1 (fornecedor F1) na O1; empresa E2 (fornecedor F2) na O2.
--   TST T1 na O1, TST T2 na O2, engenharia G1 na O1. Admin A e um admin desativado X.
-- ============================================================================================
\set A  '''a0000000-0000-0000-0000-000000000001'''
\set X  '''a0000000-0000-0000-0000-000000000002'''
\set T1 '''b0000000-0000-0000-0000-000000000001'''
\set T2 '''b0000000-0000-0000-0000-000000000002'''
\set G1 '''b0000000-0000-0000-0000-000000000003'''
\set F1 '''c0000000-0000-0000-0000-000000000001'''
\set F2 '''c0000000-0000-0000-0000-000000000002'''
\set O1 '''10000000-0000-0000-0000-000000000001'''
\set O2 '''10000000-0000-0000-0000-000000000002'''
\set O3 '''10000000-0000-0000-0000-000000000003'''
\set E1 '''20000000-0000-0000-0000-000000000001'''
\set E2 '''20000000-0000-0000-0000-000000000002'''
\set C1 '''40000000-0000-0000-0000-000000000001'''
\set C2 '''40000000-0000-0000-0000-000000000002'''
\set AL1 '''50000000-0000-0000-0000-000000000001'''
\set AL2 '''50000000-0000-0000-0000-000000000002'''
\set D1 '''60000000-0000-0000-0000-000000000001'''
\set D2 '''60000000-0000-0000-0000-000000000002'''
\set AR1 '''70000000-0000-0000-0000-000000000001'''
\set AR2 '''70000000-0000-0000-0000-000000000002'''

insert into auth.users (id, email, last_sign_in_at) values
  (:A, 'admin@teste', now()), (:X, 'inativo@teste', now()), (:T1, 'tst1@teste', now()), (:T2, 'tst2@teste', now()),
  (:G1, 'eng1@teste', now()), (:F1, 'forn1@teste', now()), (:F2, 'forn2@teste', now());
insert into usuarios (id, nome, email, perfil, ativo) values
  (:A, 'Admin Teste', 'admin@teste', 'admin', true), (:X, 'Admin Desativado', 'inativo@teste', 'admin', false),
  (:T1, 'Tst Um', 'tst1@teste', 'tst', true), (:T2, 'Tst Dois', 'tst2@teste', 'tst', true),
  (:G1, 'Eng Um', 'eng1@teste', 'engenharia', true),
  (:F1, 'Fornecedor Um', 'forn1@teste', 'fornecedor', true), (:F2, 'Fornecedor Dois', 'forn2@teste', 'fornecedor', true);
insert into obras (id, nome) values (:O1, 'OBRA UM'), (:O2, 'OBRA DOIS'), (:O3, 'OBRA TRES');
insert into empresas (id, razao_social, cnpj) values (:E1, 'EMPRESA UM', '11111111000111'), (:E2, 'EMPRESA DOIS', '22222222000122');
insert into usuarios_empresas values (:F1, :E1), (:F2, :E2);
insert into tst_obras values (:T1, :O1), (:T2, :O2), (:G1, :O1);
insert into empresas_obras (empresa_id, obra_id, numero_contrato) values (:E1, :O1, 'CT-1'), (:E2, :O2, 'CT-2');
insert into colaboradores (id, empresa_id, nome, cpf) values (:C1, :E1, 'COLAB UM', '11111111111'), (:C2, :E2, 'COLAB DOIS', '22222222222');
insert into alocacoes (id, colaborador_id, obra_id) values (:AL1, :C1, :O1), (:AL2, :C2, :O2);
update alocacoes set status = 'liberado' where id in (:AL1, :AL2);
insert into documentos (id, tipo_codigo, empresa_id, colaborador_id, data_emissao, aceite_lgpd_em) values
  (:D1, 'aso', :E1, :C1, current_date - 10, now()), (:D2, 'aso', :E2, :C2, current_date - 10, now());
update documentos set status = 'aprovado', analisado_em = now() where id in (:D1, :D2);
-- D3: documento da E1 ainda em análise (o fornecedor tenta aprovar sozinho).
insert into documentos (id, tipo_codigo, empresa_id, colaborador_id, data_emissao, aceite_lgpd_em) values
  ('60000000-0000-0000-0000-000000000003', 'nr35', :E1, :C1, current_date - 5, now());
insert into arquivos (id, documento_id, caminho, nome_original) values
  (:AR1, :D1, '20000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001/aso.pdf', 'aso.pdf'),
  (:AR2, :D2, '20000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000002/aso.pdf', 'aso.pdf');
insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values
  ('documentos', '20000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001/aso.pdf'),
  ('documentos', '20000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000002/aso.pdf');
insert into colaboradores_documentos_extras (colaborador_id, tipo_codigo, motivo) values (:C1, 'nr35', 'teste'), (:C2, 'nr35', 'teste');
insert into colaboradores_bloqueios (colaborador_id, acao, motivo) values (:C1, 'bloqueio', 'teste'), (:C2, 'bloqueio', 'teste');
insert into integracoes (id, obra_id, data, responsavel) values ('80000000-0000-0000-0000-000000000001', :O1, current_date, 'Tst Um'),
  ('80000000-0000-0000-0000-000000000002', :O2, current_date, 'Tst Dois');
insert into integracoes_participantes (integracao_id, alocacao_id) values ('80000000-0000-0000-0000-000000000001', :AL1), ('80000000-0000-0000-0000-000000000002', :AL2);
insert into cobrancas (tipo, referencia, empresa_id, obra_id) values ('vencimento_documento', 'teste-1', :E1, :O1), ('vencimento_documento', 'teste-2', :E2, :O2);
insert into cobrancas_envios (chave, tipo, empresa_ids, obra_id, situacao) values
  ('teste-1', 'vencimento_documento', array[:E1]::uuid[], :O1, 'enviada');
insert into avisos_liberacao (obra_id, alocacoes, assunto, corpo) values (:O1, array[:AL1]::uuid[], 'teste', 'teste');
insert into convites_acesso (usuario_id, tipo, para) values (:F1, 'primeiro_acesso', 'forn1@teste'), (:F2, 'primeiro_acesso', 'forn2@teste');

-- Dados criados pelas próprias funções, com o login de cada fornecedor.
select teste.entrar(:F1);
select abrir_medicao(:E1, :O1, current_date);
select enviar_mensagem('Olá, preciso de ajuda', null);
select pedir_obra(:E1, :O3, 'CT-9', 'teste');
select teste.entrar(:F2);
select abrir_medicao(:E2, :O2, current_date);
select enviar_mensagem('Olá, sou o fornecedor dois', null);
select pedir_obra(:E2, :O3, null, null);
select teste.sair();

-- Ids gerados, para usar nos testes.
create table teste.ids as
select 'M1' nome, id from medicoes where empresa_id = :E1
union all select 'M2', id from medicoes where empresa_id = :E2
union all select 'CV1', id from conversas where usuario_id = :F1
union all select 'CV2', id from conversas where usuario_id = :F2
union all select 'P1', id from pedidos_obra where empresa_id = :E1
union all select 'P2', id from pedidos_obra where empresa_id = :E2
union all select 'AV1', id from avisos_liberacao where obra_id = :O1;
grant select on teste.ids to anon, authenticated;
create function teste.id(p text) returns uuid language sql stable as $$ select id from teste.ids where nome = p $$;

-- Conferência dos dados: cada lado precisa ter linhas em todas as tabelas, senão o teste passaria no vazio.
do $$
declare t text;
begin
  foreach t in array array['medicoes', 'medicoes_itens', 'medicoes_colaboradores', 'conversas', 'mensagens', 'pedidos_obra'] loop
    if teste.qtd(format('select 1 from public.%I', t)) < 2 then raise exception 'Dados de teste incompletos em %', t; end if;
  end loop;
end $$;

-- Alvos de cada lado (o que o outro lado NÃO pode ver).
create function teste.alvos(p_lado int, p_com_obra boolean) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'empresa_id', jsonb_build_array(e),
    'colaborador_id', jsonb_build_array(c),
    'documento_id', jsonb_build_array(d),
    'alocacao_id', jsonb_build_array(al),
    'conversa_id', jsonb_build_array(teste.id('CV' || p_lado)),
    'medicao_id', jsonb_build_array(teste.id('M' || p_lado)),
    'integracao_id', jsonb_build_array(i),
    'item_id', (select jsonb_agg(id) from public.medicoes_itens where medicao_id = teste.id('M' || p_lado)),
    'obra_id', case when p_com_obra then jsonb_build_array(o) end,
    'usuario_id', jsonb_build_array(f),
    'empresas.id', jsonb_build_array(e),
    'colaboradores.id', jsonb_build_array(c),
    'alocacoes.id', jsonb_build_array(al),
    'documentos.id', jsonb_build_array(d),
    'arquivos.id', jsonb_build_array(ar),
    'medicoes.id', jsonb_build_array(teste.id('M' || p_lado)),
    'conversas.id', jsonb_build_array(teste.id('CV' || p_lado)),
    'pedidos_obra.id', jsonb_build_array(teste.id('P' || p_lado)),
    'integracoes.id', jsonb_build_array(i),
    'usuarios.id', jsonb_build_array(f),
    'v_alocacoes_resumo.alocacao_id', jsonb_build_array(al)
  ))
  from (values
    (1, '20000000-0000-0000-0000-000000000001'::uuid, '40000000-0000-0000-0000-000000000001'::uuid, '60000000-0000-0000-0000-000000000001'::uuid,
        '50000000-0000-0000-0000-000000000001'::uuid, '80000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
        'c0000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000001'::uuid),
    (2, '20000000-0000-0000-0000-000000000002'::uuid, '40000000-0000-0000-0000-000000000002'::uuid, '60000000-0000-0000-0000-000000000002'::uuid,
        '50000000-0000-0000-0000-000000000002'::uuid, '80000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000002'::uuid,
        'c0000000-0000-0000-0000-000000000002'::uuid, '70000000-0000-0000-0000-000000000002'::uuid)
  ) v(lado, e, c, d, al, i, o, f, ar)
  where lado = p_lado
$$;
grant execute on function teste.alvos(int, boolean) to anon, authenticated;

-- ============================================================================================
-- 1. Sem login: nada em nenhuma tabela, view ou arquivo
-- ============================================================================================
select teste.entrar(null);
do $$
declare r record;
begin
  for r in select table_name from information_schema.tables where table_schema = 'public' order by 1 loop
    perform teste.igual('Sem login', format('select 1 from public.%I', r.table_name), 0);
  end loop;
  perform teste.igual('Sem login', 'select 1 from storage.objects', 0);
  perform teste.bloqueado('Sem login', $q$insert into storage.objects (bucket_id, name) values ('documentos', '20000000-0000-0000-0000-000000000001/x/invasao.pdf')$q$);
  perform teste.bloqueado('Sem login', $q$select enviar_mensagem('oi', null)$q$);
  perform teste.bloqueado('Sem login', $q$select aprovar_documento('60000000-0000-0000-0000-000000000003', null)$q$);
  perform teste.bloqueado('Sem login', $q$select painel_obras()$q$);
end $$;
select teste.sair();

-- ============================================================================================
-- 2. Fornecedor: vê só a própria empresa
-- ============================================================================================
-- Controle: o F1 enxerga o que é dele.
select teste.entrar(:F1);
select teste.igual('Fornecedor (controle)', 'select 1 from colaboradores', 1);
select teste.igual('Fornecedor (controle)', 'select 1 from documentos', 2);
select teste.igual('Fornecedor (controle)', 'select 1 from v_documentos_atuais where colaborador_id = ''40000000-0000-0000-0000-000000000001''', 1);
select teste.igual('Fornecedor (controle)', 'select 1 from conversas', 1);
select teste.igual('Fornecedor (controle)', 'select 1 from medicoes', 1);

-- F1 contra os dados da E2, e F2 contra os dados da E1.
select teste.isolamento('Fornecedor 1 x empresa 2', teste.alvos(2, true));
select teste.so_admin('Fornecedor 1');
select teste.entrar(:F2);
select teste.isolamento('Fornecedor 2 x empresa 1', teste.alvos(1, true));
select teste.entrar(:F1);

do $$
declare
  t text := 'Fornecedor: escrita fora da empresa';
begin
  perform teste.bloqueado(t, $q$insert into colaboradores (empresa_id, nome, cpf) values ('20000000-0000-0000-0000-000000000002', 'INTRUSO', '99999999999')$q$);
  perform teste.bloqueado(t, $q$insert into documentos (tipo_codigo, empresa_id, colaborador_id, data_emissao, aceite_lgpd_em) values ('aso', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', current_date, now())$q$);
  perform teste.bloqueado(t, $q$insert into alocacoes (colaborador_id, obra_id) values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$insert into arquivos (documento_id, caminho, nome_original) values ('60000000-0000-0000-0000-000000000002', 'x', 'x')$q$);
  perform teste.bloqueado(t, $q$insert into storage.objects (bucket_id, name) values ('documentos', '20000000-0000-0000-0000-000000000002/x/invasao.pdf')$q$);
  perform teste.igual(t, $q$select 1 from storage.objects$q$, 0);

  t := 'Fornecedor: aumentar o próprio acesso';
  perform teste.bloqueado(t, $q$insert into usuarios_empresas values ('c0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$insert into empresas_obras (empresa_id, obra_id) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003')$q$);
  perform teste.bloqueado(t, $q$insert into tst_obras values ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$insert into usuarios (id, nome, email, perfil) values (gen_random_uuid(), 'Novo Admin', 'novo@x', 'admin')$q$);
  if teste.linhas($q$update usuarios set perfil = 'admin' where id = 'c0000000-0000-0000-0000-000000000001'$q$) > 0 then
    perform teste.falha(t, 'consegue virar admin');
  end if;
  if teste.linhas($q$update pedidos_obra set situacao = 'aprovado'$q$) > 0 then perform teste.falha(t, 'aprova o próprio pedido de obra'); end if;
  if teste.linhas($q$update documentos set status = 'aprovado'$q$) > 0 then perform teste.falha(t, 'aprova o próprio documento'); end if;
  if teste.linhas($q$update alocacoes set status = 'liberado'$q$) > 0 then perform teste.falha(t, 'libera o próprio colaborador'); end if;
  if teste.linhas($q$update conversas set situacao = 'resolvida'$q$) > 0 then perform teste.falha(t, 'altera a conversa direto'); end if;
  perform teste.bloqueado(t, $q$insert into mensagens (conversa_id, da_emais, texto) values ('$q$ || teste.id('CV1') || $q$', true, 'mensagem falsa da Emais')$q$);
  perform teste.bloqueado(t, $q$insert into pedidos_obra (empresa_id, obra_id, situacao) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'aprovado')$q$);

  t := 'Fornecedor: funções do administrativo';
  perform teste.bloqueado(t, $q$select aprovar_documento('60000000-0000-0000-0000-000000000003', null)$q$);
  perform teste.bloqueado(t, $q$select devolver_documento('60000000-0000-0000-0000-000000000003', 'x')$q$);
  perform teste.bloqueado(t, $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select validar_alocacao_tst('50000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select devolver_alocacao_tst('50000000-0000-0000-0000-000000000001', 'x')$q$);
  perform teste.bloqueado(t, $q$select bloquear_colaborador('40000000-0000-0000-0000-000000000001', true, 'x')$q$);
  perform teste.bloqueado(t, $q$select alterar_tipo_documento('aso', 999, false, 'x')$q$);
  perform teste.bloqueado(t, $q$select gerar_aviso_liberacao('10000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000001']::uuid[], 'a@b.com')$q$);
  perform teste.bloqueado(t, $q$select enviar_aviso_liberacao('10000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000001']::uuid[], 'a@b.com')$q$);
  perform teste.bloqueado(t, $q$select reenviar_aviso_liberacao('$q$ || teste.id('AV1') || $q$')$q$);
  perform teste.bloqueado(t, $q$select responder_pedido_obra('$q$ || teste.id('P1') || $q$', true, null)$q$);
  perform teste.bloqueado(t, $q$select resolver_conversa('$q$ || teste.id('CV1') || $q$', true)$q$);
  perform teste.bloqueado(t, $q$select acessos_ultimo_login()$q$);
  perform teste.bloqueado(t, $q$select criar_integracao('10000000-0000-0000-0000-000000000001', current_date, '8h', 'x', 'x', array['50000000-0000-0000-0000-000000000001']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select registrar_integracao('50000000-0000-0000-0000-000000000001', current_date)$q$);
  perform teste.bloqueado(t, $q$select cancelar_integracao('80000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select concluir_integracao('80000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000001']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select avaliar_item_medicao(id, true, null) from medicoes_itens limit 1$q$);
  perform teste.bloqueado(t, $q$select conferir_colaborador_medicao(id, '{}'::jsonb, situacao) from medicoes_colaboradores limit 1$q$);
  perform teste.bloqueado(t, $q$select concluir_conferencia_medicao('$q$ || teste.id('M1') || $q$')$q$);
  perform teste.bloqueado(t, $q$select combinar_prazo_medicao('$q$ || teste.id('M1') || $q$', current_date + 30, 'x')$q$);
  perform teste.bloqueado(t, $q$select registrar_cobranca_medicao(array['$q$ || teste.id('M1') || $q$']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select registrar_download(array['70000000-0000-0000-0000-000000000001']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select registrar_download_medicao(array[gen_random_uuid()])$q$);

  t := 'Fornecedor: funções com dados de outra empresa';
  perform teste.bloqueado(t, $q$select informar_contrato('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'x')$q$);
  perform teste.bloqueado(t, $q$select pedir_obra('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', null, null)$q$);
  perform teste.bloqueado(t, $q$select corrigir_colaborador('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'X', '22222222222', null, null)$q$);
  perform teste.bloqueado(t, $q$select desligar_colaborador('40000000-0000-0000-0000-000000000002', current_date, false)$q$);
  perform teste.bloqueado(t, $q$select incluir_documento_colaborador('40000000-0000-0000-0000-000000000002', 'nr35', 'x')$q$);
  perform teste.bloqueado(t, $q$select enviar_para_analise('50000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select cadastrar_subcontratada('20000000-0000-0000-0000-000000000002', '33333333000133', 'SUB', 'sub@x', array['10000000-0000-0000-0000-000000000002']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select abrir_medicao('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', current_date)$q$);
  perform teste.bloqueado(t, $q$select enviar_item_medicao('$q$ || teste.id('M2') || $q$', (select tipo_codigo from medicoes_itens limit 1), '[]', true, 'x', true)$q$);
  perform teste.bloqueado(t, $q$select enviar_medicao('$q$ || teste.id('M2') || $q$')$q$);
  perform teste.bloqueado(t, $q$select definir_colaborador_medicao('$q$ || teste.id('M2') || $q$', '40000000-0000-0000-0000-000000000002', 'trabalhou', null)$q$);
  perform teste.bloqueado(t, $q$select enviar_documento(gen_random_uuid(), 'aso', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', current_date, null, false, null, '[{"caminho":"20000000-0000-0000-0000-000000000002/x/a.pdf","nome":"a.pdf"}]', true)$q$);
  perform teste.bloqueado(t, $q$select painel_obra('10000000-0000-0000-0000-000000000002')$q$);

  -- Funções que o fornecedor pode usar, mas que só mexem no que é dele.
  t := 'Fornecedor: funções liberadas';
  perform teste.permitido(t, $q$select informar_contrato('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CT-1A')$q$);
  perform teste.permitido(t, $q$select painel_obra('10000000-0000-0000-0000-000000000001')$q$);
  -- Mesmo informando a conversa de outra pessoa, a mensagem cai na conversa do próprio fornecedor.
  perform enviar_mensagem('teste de conversa alheia', teste.id('CV2'));
end $$;

select teste.sair();
select teste.igual('Fornecedor: mensagem na conversa de outro', $q$select 1 from mensagens where texto = 'teste de conversa alheia' and conversa_id <> teste.id('CV1')$q$, 0);
create table teste.antes as select lida_usuario_em, lida_emais_em from conversas where id = teste.id('CV2');
select teste.entrar(:F1);
select marcar_conversa_lida(teste.id('CV2'));
select teste.sair();
select teste.igual('Fornecedor: marcar como lida a conversa de outro', $q$select 1 from conversas c, teste.antes a where c.id = teste.id('CV2') and (c.lida_usuario_em is distinct from a.lida_usuario_em or c.lida_emais_em is distinct from a.lida_emais_em)$q$, 0);

-- ============================================================================================
-- 3. TST e engenharia: só as obras deles
-- ============================================================================================
select teste.entrar(:T1);
select teste.igual('TST (controle)', 'select 1 from colaboradores', 1);
select teste.igual('TST (controle)', 'select 1 from alocacoes', 1);
select teste.isolamento('TST 1 x obra 2', teste.alvos(2, true) - 'usuario_id' - 'usuarios.id');
select teste.so_admin('TST 1');
select teste.entrar(:T2);
select teste.isolamento('TST 2 x obra 1', teste.alvos(1, true) - 'usuario_id' - 'usuarios.id');
select teste.entrar(:T1);
do $$
declare t text := 'TST: fora da obra ou função do administrativo';
begin
  perform teste.bloqueado(t, $q$select validar_alocacao_tst('50000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select devolver_alocacao_tst('50000000-0000-0000-0000-000000000002', 'x')$q$);
  perform teste.bloqueado(t, $q$select criar_integracao('10000000-0000-0000-0000-000000000002', current_date, '8h', 'x', 'x', array['50000000-0000-0000-0000-000000000002']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select registrar_integracao('50000000-0000-0000-0000-000000000002', current_date)$q$);
  perform teste.bloqueado(t, $q$select cancelar_integracao('80000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select bloquear_colaborador('40000000-0000-0000-0000-000000000002', true, 'x')$q$);
  perform teste.bloqueado(t, $q$select painel_obra('10000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select aprovar_documento('60000000-0000-0000-0000-000000000003', null)$q$);
  perform teste.bloqueado(t, $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select registrar_download(array['70000000-0000-0000-0000-000000000001']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select resolver_conversa('$q$ || teste.id('CV1') || $q$', true)$q$);
  perform teste.bloqueado(t, $q$select abrir_medicao('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_date)$q$);
  perform teste.bloqueado(t, $q$insert into colaboradores (empresa_id, nome) values ('20000000-0000-0000-0000-000000000001', 'INTRUSO')$q$);
  perform teste.bloqueado(t, $q$insert into storage.objects (bucket_id, name) values ('documentos', '20000000-0000-0000-0000-000000000001/x/invasao.pdf')$q$);
  perform teste.igual(t, $q$select 1 from conversas$q$, 0);
  perform teste.igual(t, $q$select 1 from mensagens$q$, 0);
  perform teste.permitido('TST: funções liberadas', $q$select painel_obra('10000000-0000-0000-0000-000000000001')$q$);
end $$;

select teste.entrar(:G1);
select teste.isolamento('Engenharia 1 x obra 2', teste.alvos(2, true) - 'usuario_id' - 'usuarios.id');
select teste.so_admin('Engenharia');
do $$
declare t text := 'Engenharia: só consulta';
begin
  perform teste.bloqueado(t, $q$select validar_alocacao_tst('50000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select criar_integracao('10000000-0000-0000-0000-000000000001', current_date, '8h', 'x', 'x', array['50000000-0000-0000-0000-000000000001']::uuid[])$q$);
  perform teste.bloqueado(t, $q$select aprovar_documento('60000000-0000-0000-0000-000000000003', null)$q$);
  perform teste.bloqueado(t, $q$select painel_obra('10000000-0000-0000-0000-000000000002')$q$);
  perform teste.permitido('Engenharia: funções liberadas', $q$select painel_obra('10000000-0000-0000-0000-000000000001')$q$);
end $$;

-- ============================================================================================
-- 4. Admin desativado perde tudo
-- ============================================================================================
select teste.entrar(:X);
select teste.so_admin('Admin desativado');
select teste.isolamento('Admin desativado', teste.alvos(1, true));
select teste.isolamento('Admin desativado', teste.alvos(2, true));
do $$
declare t text := 'Admin desativado';
begin
  perform teste.bloqueado(t, $q$select aprovar_documento('60000000-0000-0000-0000-000000000003', null)$q$);
  perform teste.bloqueado(t, $q$select acessos_ultimo_login()$q$);
  perform teste.bloqueado(t, $q$select enviar_mensagem('oi', null)$q$);
end $$;

-- ============================================================================================
-- 5. Admin (controle): vê tudo e usa as funções do administrativo
-- ============================================================================================
select teste.entrar(:A);
select teste.igual('Admin (controle)', 'select 1 from colaboradores', 2);
select teste.igual('Admin (controle)', 'select 1 from v_documentos_atuais where id in (''60000000-0000-0000-0000-000000000001'', ''60000000-0000-0000-0000-000000000002'')', 2);
select teste.igual('Admin (controle)', 'select 1 from storage.objects', 2);
select teste.permitido('Admin (controle)', $q$select acessos_ultimo_login()$q$);
select teste.permitido('Admin (controle)', $q$select resolver_conversa('$q$ || teste.id('CV1') || $q$', true)$q$);
select teste.sair();

-- ============================================================================================
-- Resultado
-- ============================================================================================
\o
\pset footer off
\echo
\echo '========== Resultado do teste por perfil =========='
select n as "verificações" from teste.contagem;
select teste as "teste", detalhe as "falha" from teste.falhas order by n;
do $$
declare n int := (select count(*) from teste.falhas);
begin
  if n > 0 then raise exception '% falha(s) de segurança. Veja a lista acima.', n; end if;

end $$;
\echo 'Nenhuma falha encontrada.'
