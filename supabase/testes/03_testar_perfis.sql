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
-- Segurança da obra: alojamento e máquina em cada obra; vistoria concluída com item "não" notificada ao fornecedor.
insert into seg_alojamentos (id, obra_id, nome, empresa_id) values
  ('a1000000-0000-0000-0000-000000000001', :O1, 'CASA UM', :E1), ('a1000000-0000-0000-0000-000000000002', :O2, 'CASA DOIS', :E2);
insert into seg_maquinas (id, obra_id, modelo_codigo, identificacao, empresa_id) values
  ('a2000000-0000-0000-0000-000000000001', :O1, 'maquina:trator', 'TR-01', :E1), ('a2000000-0000-0000-0000-000000000002', :O2, 'maquina:trator', 'TR-02', :E2);
insert into seg_fichas_maquina (id, maquina_id, competencia, itens) values
  ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', date_trunc('month', current_date), '["a","b"]'),
  ('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', date_trunc('month', current_date), '["a","b"]');
insert into seg_vistorias (id, modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values
  ('a3000000-0000-0000-0000-000000000001', 'alojamento', :O1, 'a1000000-0000-0000-0000-000000000001', current_date,
   '[{"texto":"Limpo?","status":"sim"},{"texto":"Chuveiro aterrado?","status":"nao","prazo":"2030-01-10","recomendacao":"Aterrar"},{"texto":"Beliche?","status":"na"}]'),
  ('a3000000-0000-0000-0000-000000000002', 'alojamento', :O2, 'a1000000-0000-0000-0000-000000000002', current_date,
   '[{"texto":"Limpo?","status":"nao"}]'),
  ('a3000000-0000-0000-0000-000000000003', 'alojamento', :O1, 'a1000000-0000-0000-0000-000000000001', current_date,
   '[{"texto":"Limpo?","status":null}]');
insert into seg_locadoras (id, nome) values ('a5000000-0000-0000-0000-000000000001', 'LOCADORA TESTE');
update seg_maquinas set empresa_id = null, empresa_a_vincular = 'Locadora do ObraCheck' where id = 'a2000000-0000-0000-0000-000000000001';
insert into storage.buckets (id, name, public) values ('seguranca', 'seguranca', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values
  ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000001/1/foto.jpg'),
  ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000002/0/foto.jpg'),
  ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000003/0/foto.jpg');
select teste.entrar(:T1);
select concluir_vistoria_seg('a3000000-0000-0000-0000-000000000001');
select notificar_nao_conformidades('a3000000-0000-0000-0000-000000000001', null);
select teste.entrar(:T2);
select concluir_vistoria_seg('a3000000-0000-0000-0000-000000000002');
select notificar_nao_conformidades('a3000000-0000-0000-0000-000000000002', null);
select teste.sair();

create table teste.ids as
select 'M1' nome, id from medicoes where empresa_id = :E1
union all select 'M2', id from medicoes where empresa_id = :E2
union all select 'CV1', id from conversas where usuario_id = :F1
union all select 'CV2', id from conversas where usuario_id = :F2
union all select 'P1', id from pedidos_obra where empresa_id = :E1
union all select 'P2', id from pedidos_obra where empresa_id = :E2
union all select 'AV1', id from avisos_liberacao where obra_id = :O1
union all select 'NC1', id from seg_nao_conformidades where empresa_id = :E1
union all select 'NC2', id from seg_nao_conformidades where empresa_id = :E2;
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
    'v_alocacoes_resumo.alocacao_id', jsonb_build_array(al),
    'alojamento_id', jsonb_build_array(('a1000000-0000-0000-0000-00000000000' || p_lado)::uuid),
    'seg_alojamentos.id', jsonb_build_array(('a1000000-0000-0000-0000-00000000000' || p_lado)::uuid),
    'maquina_id', jsonb_build_array(('a2000000-0000-0000-0000-00000000000' || p_lado)::uuid),
    'seg_maquinas.id', jsonb_build_array(('a2000000-0000-0000-0000-00000000000' || p_lado)::uuid),
    'seg_fichas_maquina.id', jsonb_build_array(('a4000000-0000-0000-0000-00000000000' || p_lado)::uuid),
    'vistoria_id', case when p_lado = 1 then jsonb_build_array('a3000000-0000-0000-0000-000000000001'::uuid, 'a3000000-0000-0000-0000-000000000003'::uuid)
                        else jsonb_build_array('a3000000-0000-0000-0000-000000000002'::uuid) end,
    'seg_vistorias.id', case when p_lado = 1 then jsonb_build_array('a3000000-0000-0000-0000-000000000001'::uuid, 'a3000000-0000-0000-0000-000000000003'::uuid)
                        else jsonb_build_array('a3000000-0000-0000-0000-000000000002'::uuid) end,
    'seg_nao_conformidades.id', jsonb_build_array(teste.id('NC' || p_lado))
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
  perform teste.igual(t, $q$select 1 from storage.objects where bucket_id = 'documentos'$q$, 0);

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
  perform teste.bloqueado(t, $q$select conferir_encerramento_obra('10000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select mudar_situacao_obra('10000000-0000-0000-0000-000000000001', 'iniciar')$q$);
  perform teste.bloqueado(t, $q$select mudar_situacao_obra('10000000-0000-0000-0000-000000000001', 'concluir', current_date, 'teste de encerramento', true)$q$);
  if teste.linhas($q$update obras set situacao = 'encerrada', ativa = false$q$) > 0 then perform teste.falha(t, 'encerra obra direto na tabela'); end if;

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
  perform teste.bloqueado(t, $q$select informar_contrato('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CT-1A')$q$);
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
  perform teste.bloqueado(t, $q$select mudar_situacao_obra('10000000-0000-0000-0000-000000000001', 'iniciar')$q$);
  perform teste.bloqueado(t, $q$select conferir_encerramento_obra('10000000-0000-0000-0000-000000000001')$q$);
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

-- --------------------------------------------------------------------------------------------
-- Integração: assinatura na tela, lista assinada e ausente volta para a pendência
-- --------------------------------------------------------------------------------------------
select teste.entrar(:F1);
select teste.bloqueado('Integração: fornecedor assina', $q$select assinar_integracao('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null)$q$);
select teste.bloqueado('Integração: fornecedor registra sem assinatura', $q$select registrar_sem_assinatura('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', true)$q$);
select teste.bloqueado('Integração: fornecedor guarda lista', $q$select salvar_lista_integracao('80000000-0000-0000-0000-000000000001', 'x')$q$);
select teste.bloqueado('Integração: fornecedor envia arquivo', $q$insert into storage.objects (bucket_id, name) values ('integracoes', '80000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001-1.png')$q$);
select teste.igual('Integração: fornecedor lê arquivo', $q$select 1 from storage.objects where bucket_id = 'integracoes'$q$, 0);
select teste.entrar(:G1);
select teste.bloqueado('Integração: engenharia assina', $q$select assinar_integracao('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null)$q$);
select teste.entrar(:T1);
select teste.bloqueado('Integração: TST assina em outra obra', $q$select assinar_integracao('80000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', null)$q$);
select teste.bloqueado('Integração: TST envia arquivo de outra obra', $q$insert into storage.objects (bucket_id, name) values ('integracoes', '80000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002-1.png')$q$);
select teste.bloqueado('Integração: assinatura com arquivo de outra turma', $q$select assinar_integracao('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002-1.png')$q$);
select teste.bloqueado('Integração: assinatura sem arquivo enviado', $q$select assinar_integracao('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001-9.png')$q$);
select teste.bloqueado('Integração: lista antes de concluir', $q$select salvar_lista_integracao('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001/lista-de-presenca-1.pdf')$q$);
select (criar_integracao('10000000-0000-0000-0000-000000000001', current_date, '8h', 'sala', 'Tst Um', array['50000000-0000-0000-0000-000000000001']::uuid[])).id as "TI" \gset
insert into storage.objects (bucket_id, name) values ('integracoes', :'TI' || '/50000000-0000-0000-0000-000000000001-1.png');
select assinar_integracao(:'TI', '50000000-0000-0000-0000-000000000001', :'TI' || '/50000000-0000-0000-0000-000000000001-1.png');
select teste.igual('Integração (controle): assinatura gravada', $q$select 1 from integracoes_participantes where assinatura is not null and assinado_em is not null$q$, 1);
select teste.igual('Integração (controle): TST lê a assinatura', $q$select 1 from storage.objects where bucket_id = 'integracoes'$q$, 1);
select teste.igual('Integração (controle): assinatura desenhada tem código', $q$select 1 from integracoes_participantes where assinatura is not null and codigo_assinatura ~ '^[0-9A-F]{4}-[0-9A-F]{4}$'$q$, 1);
select teste.bloqueado('Integração: sem assinatura em outra obra', $q$select registrar_sem_assinatura('80000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', true)$q$);
select registrar_sem_assinatura(:'TI', '50000000-0000-0000-0000-000000000001', true);
select teste.igual('Integração (controle): não sabe assinar gera registro eletrônico', $q$select 1 from integracoes_participantes where nao_assina and assinatura is null and codigo_assinatura is not null and assinado_em is not null and assinatura_por is not null$q$, 1);
select teste.sair();
update alocacoes set data_integracao = current_date - 100, integracao_provisoria = true where id = :AL1;
select teste.entrar(:T1);
select concluir_integracao(:'TI', '{}');
insert into storage.objects (bucket_id, name) values ('integracoes', :'TI' || '/lista-de-presenca-1.pdf');
select salvar_lista_integracao(:'TI', :'TI' || '/lista-de-presenca-1.pdf');
select teste.bloqueado('Integração: assinar depois de concluída', $q$select assinar_integracao('$q$ || :'TI' || $q$', '50000000-0000-0000-0000-000000000001', null)$q$);
select teste.sair();
select teste.igual('Integração: ausente com data provisória volta para a pendência', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000001' and data_integracao is null and not integracao_provisoria$q$, 1);
select teste.igual('Integração (controle): lista assinada guardada', $q$select 1 from integracoes where lista_pdf like '%lista-de-presenca-1.pdf'$q$, 1);
update alocacoes set data_integracao = current_date - 100, integracao_provisoria = false where id = :AL1;
select teste.entrar(:T1);
select (criar_integracao('10000000-0000-0000-0000-000000000001', current_date, '8h', 'sala', 'Tst Um', array['50000000-0000-0000-0000-000000000001']::uuid[])).id as "TI2" \gset
select concluir_integracao(:'TI2', '{}');
select teste.sair();
select teste.igual('Integração: falta não apaga integração real', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000001' and data_integracao = current_date - 100$q$, 1);
select teste.entrar(:T1);
select (criar_integracao('10000000-0000-0000-0000-000000000001', current_date, '8h', 'sala', 'Tst Um', array['50000000-0000-0000-0000-000000000001']::uuid[])).id as "TI3" \gset
select concluir_integracao(:'TI3', array['50000000-0000-0000-0000-000000000001']::uuid[]);
select teste.sair();
select teste.igual('Integração (controle): presente recebe a data real', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000001' and data_integracao = current_date and not integracao_provisoria$q$, 1);
update alocacoes set data_integracao = null where id = :AL1;

-- --------------------------------------------------------------------------------------------
-- Liberação com pendência: anotação do administrativo, ciente do TST e volta ao fornecedor no fim do prazo
-- --------------------------------------------------------------------------------------------
update alocacoes set status = 'em_analise' where id = :AL2;
select teste.entrar(:F2);
select teste.bloqueado('Pendência: fornecedor processa prazos', $q$select processar_pendencias_liberacao()$q$);
select teste.entrar(:T2);
select teste.bloqueado('Pendência: TST processa prazos', $q$select processar_pendencias_liberacao()$q$);
select teste.bloqueado('Pendência: TST aprova com pendência', $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000002', 'pedido da engenharia')$q$);
select teste.entrar(:A);
select teste.bloqueado('Pendência: aprovar com documento pendente sem anotação', $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000002')$q$);
select teste.bloqueado('Pendência: anotação em branco', $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000002', '   ')$q$);
select aprovar_alocacao(:AL2, 'Pedido do eng. Rodrigo para a concretagem');
select teste.igual('Pendência (controle): prazo de 7 dias', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000002' and status = 'aprovado_admin' and pendencia_prazo = current_date + 7$q$, 1);
select teste.igual('Pendência (controle): anotação guardada com os documentos', $q$select 1 from liberacoes_pendencia where anotacao like 'Pedido do eng.%' and cardinality(documentos) > 0 and encerrada_em is null$q$, 1);
select teste.entrar(:T2);
select teste.igual('Pendência (controle): TST lê a anotação', 'select 1 from liberacoes_pendencia', 1);
select teste.bloqueado('Pendência: TST libera sem ciente', $q$select validar_alocacao_tst('50000000-0000-0000-0000-000000000002')$q$);
select validar_alocacao_tst(:AL2, true);
select teste.igual('Pendência (controle): liberado com pendência', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000002' and status = 'liberado' and pendencia_prazo is not null$q$, 1);
select teste.entrar(:T1);
select teste.igual('Pendência: TST de outra obra lê a anotação', 'select 1 from liberacoes_pendencia', 0);
select teste.entrar(:F2);
select teste.igual('Pendência: fornecedor lê a anotação', 'select 1 from liberacoes_pendencia', 0);
select teste.igual('Pendência (controle): fornecedor vê o prazo', $q$select 1 from v_alocacoes_resumo where pendencia_prazo is not null$q$, 1);
select teste.entrar(:G1);
select teste.igual('Pendência: engenharia lê a anotação', 'select 1 from liberacoes_pendencia', 0);
select teste.sair();
select processar_pendencias_liberacao();
select teste.igual('Pendência (controle): dentro do prazo continua liberado', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000002' and status = 'liberado'$q$, 1);
update alocacoes set pendencia_prazo = current_date - 1 where id = :AL2;
select processar_pendencias_liberacao();
select teste.igual('Pendência: prazo vencido volta para o fornecedor', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-000000000002' and status = 'pendente_fornecedor' and pendencia_prazo is null and validado_tst_em is null$q$, 1);
select teste.igual('Pendência (controle): registro encerrado como vencido', $q$select 1 from liberacoes_pendencia where resultado = 'vencida' and encerrada_em is not null$q$, 1);
select teste.entrar(:A);
select teste.bloqueado('Pendência: pendente do fornecedor sem anotação', $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000002')$q$);
select teste.permitido('Pendência (controle): libera com pendência estando pendente do fornecedor', $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000002', 'Engenharia pediu de novo, fornecedor não reenviou')$q$);
select teste.sair();
update alocacoes set status = 'em_cadastro' where id = :AL2;
select teste.entrar(:A);
select teste.bloqueado('Pendência: em cadastro', $q$select aprovar_alocacao('50000000-0000-0000-0000-000000000002', 'pedido da engenharia')$q$);
select teste.sair();
update alocacoes set status = 'liberado', observacao = null where id = :AL2;

-- --------------------------------------------------------------------------------------------
-- Exportação mensal e arquivos sem vínculo
-- --------------------------------------------------------------------------------------------
select teste.entrar(:F1);
select teste.bloqueado('Exportação: fornecedor registra', $q$select registrar_exportacao(1, 1, 1, 1)$q$);
select teste.bloqueado('Arquivos sem vínculo: fornecedor lista', $q$select * from arquivos_sem_vinculo(24, 10)$q$);
select teste.entrar(:T1);
select teste.bloqueado('Exportação: TST registra', $q$select registrar_exportacao(1, 1, 1, 1)$q$);
select teste.bloqueado('Arquivos sem vínculo: TST lista', $q$select * from arquivos_sem_vinculo(24, 10)$q$);
select teste.entrar(:G1);
select teste.bloqueado('Exportação: engenharia registra', $q$select registrar_exportacao(1, 1, 1, 1)$q$);
select teste.entrar(:A);
select teste.bloqueado('Arquivos sem vínculo: administrativo lista (só a rotina)', $q$select * from arquivos_sem_vinculo(24, 10)$q$);
select registrar_exportacao(40, 1000, 12, 5000000);
select teste.igual('Exportação (controle): administrativo vê o registro', 'select 1 from exportacoes', 1);
select teste.entrar(:T1);
select teste.igual('Exportação: TST não vê o registro', 'select 1 from exportacoes', 0);
select teste.entrar(:F1);
select teste.igual('Exportação: fornecedor não vê o registro', 'select 1 from exportacoes', 0);
select teste.sair();

-- Cadastro de alojamentos: o TST cadastra e corrige os das obras dele; juntar duplicados só o administrativo.
select teste.entrar(:T1);
select teste.permitido('Alojamento (controle): TST cadastra na obra dele', $q$insert into seg_alojamentos (obra_id, nome, endereco) values ('10000000-0000-0000-0000-000000000001', 'CASA NOVA', 'Rua W, 4')$q$);
select teste.bloqueado('Alojamento: TST cadastra em outra obra', $q$insert into seg_alojamentos (obra_id, nome) values ('10000000-0000-0000-0000-000000000002', 'CASA NOVA')$q$);
do $$
begin
  if teste.linhas($q$update seg_alojamentos set nome = 'OUTRO NOME', endereco = 'Rua X, 1' where id = 'a1000000-0000-0000-0000-000000000001'$q$) = 0 then perform teste.falha('Alojamento (controle): TST corrige nome e endereço', 'não alterou'); end if;
  if teste.linhas($q$update seg_alojamentos set nome = 'OUTRO NOME' where id = 'a1000000-0000-0000-0000-000000000002'$q$) > 0 then perform teste.falha('Alojamento: TST altera outra obra', 'alterou'); end if;
  if teste.linhas($q$update seg_alojamentos set ativo = false where id = 'a1000000-0000-0000-0000-000000000001'$q$) = 0 then perform teste.falha('Alojamento (controle): TST desativa', 'não desativou'); end if;
  perform teste.bloqueado('Alojamento: TST junta', $q$select juntar_alojamentos('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$q$);
end $$;
select teste.entrar(:F1);
select teste.bloqueado('Alojamento: fornecedor', $q$select juntar_alojamentos('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$q$);
select teste.entrar(:A);
select teste.permitido('Alojamento (controle): administrativo cadastra', $q$insert into seg_alojamentos (obra_id, nome, endereco, empresa_id) values ('10000000-0000-0000-0000-000000000001', 'CASA TRES', 'Rua Y, 2', '20000000-0000-0000-0000-000000000001')$q$);
do $$ begin
  perform teste.contar();
  if teste.linhas($q$update seg_alojamentos set nome = 'CASA 1', endereco = 'Rua Z, 3', empresa_id = null where id = 'a1000000-0000-0000-0000-000000000001'$q$) = 0 then perform teste.falha('Alojamento (controle): administrativo renomeia', 'não alterou'); end if;
end $$;
insert into seg_alojamentos (id, obra_id, nome, empresa_id) values ('a1000000-0000-0000-0000-000000000009', :O1, 'CASA UM REPETIDA', :E1);
insert into seg_vistorias (id, modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values
  ('a3000000-0000-0000-0000-000000000009', 'alojamento', :O1, 'a1000000-0000-0000-0000-000000000009', current_date, '[]');
select teste.bloqueado('Alojamento: juntar com outra obra', $q$select juntar_alojamentos('a1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000002')$q$);
select teste.bloqueado('Alojamento: juntar com ele mesmo', $q$select juntar_alojamentos('a1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000009')$q$);
select teste.igual('Alojamento (controle): juntar passa a vistoria', $q$select 1 where juntar_alojamentos('a1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001') = 1$q$, 1);
select teste.igual('Alojamento (controle): vistoria no alojamento certo', $q$select 1 from seg_vistorias where id = 'a3000000-0000-0000-0000-000000000009' and alojamento_id = 'a1000000-0000-0000-0000-000000000001'$q$, 1);
select teste.igual('Alojamento (controle): cadastro repetido apagado', $q$select 1 from seg_alojamentos where id = 'a1000000-0000-0000-0000-000000000009'$q$, 0);
select teste.igual('Alojamento (controle): junção registrada', $q$select 1 from eventos where acao = 'alojamento_juntado'$q$, 1);
select teste.sair();
delete from seg_vistorias where id = 'a3000000-0000-0000-0000-000000000009';

-- Alojamento na obra (Emais) com quartos: limpeza vai para as empresas do quarto, o resto é pendência da Emais,
-- que a engenharia da obra responde. Moradores vêm dos colaboradores liberados na obra.
insert into colaboradores (id, empresa_id, nome, cpf) values ('40000000-0000-0000-0000-00000000000a', :E1, 'COLAB QUARTO', '33333333333');
insert into alocacoes (id, colaborador_id, obra_id, status) values ('50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', :O1, 'liberado');
insert into seg_alojamentos (id, obra_id, nome, endereco, tipo) values ('a1000000-0000-0000-0000-00000000000a', :O1, 'ALOJAMENTO DA OBRA', 'Dentro da obra', 'obra');
select teste.bloqueado('Alojamento na obra com fornecedor', $q$update seg_alojamentos set empresa_id = '20000000-0000-0000-0000-000000000001' where id = 'a1000000-0000-0000-0000-00000000000a'$q$);
select teste.entrar(:T1);
select teste.igual('Moradores (controle): TST vê os liberados da obra', $q$select 1 from seg_moradores_obra('10000000-0000-0000-0000-000000000001') where id = '40000000-0000-0000-0000-00000000000a'$q$, 1);
select teste.igual('Moradores (controle): filtro por empresa', $q$select 1 from seg_moradores_obra('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$q$, 0);
select teste.bloqueado('Alojamento na obra: checklist padrão', $q$insert into seg_vistorias (modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values ('alojamento', '10000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', current_date, '[]')$q$);
select teste.bloqueado('Alojamento padrão: checklist de quarto', $q$insert into seg_vistorias (modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values ('alojamento:obra-quarto', '10000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', current_date, '[]')$q$);
insert into seg_vistorias (id, modelo_codigo, obra_id, alojamento_id, data_vistoria, quartos, itens, funcionarios) values (
  'a3000000-0000-0000-0000-00000000000a', 'alojamento:obra-quarto', :O1, 'a1000000-0000-0000-0000-00000000000a', current_date,
  '[{"nome": "Quarto 1", "cama": ""}]',
  '[{"texto": "Alojamento está devidamente limpo e organizado?", "quarto": "Quarto 1", "status": "nao", "recomendacao": "Organizar", "prazo": null, "fotos": ["vistoria/a3000000-0000-0000-0000-00000000000a/0/limpeza.jpg"]},
    {"texto": "O forro e/ou laje do alojamento está em boas condições de conservação e segurança?", "quarto": "Quarto 1", "status": "nao", "recomendacao": "Trocar o forro", "prazo": null, "fotos": ["vistoria/a3000000-0000-0000-0000-00000000000a/1/forro.jpg"]},
    {"texto": "Possui armários individuais duplos com separação para guarda de roupas dos trabalhadores?", "quarto": "Quarto 1", "status": "sim", "recomendacao": "", "prazo": null, "fotos": []},
    {"texto": "Os chuveiros dispõem de água quente?", "quarto": null, "status": "nao", "recomendacao": "Consertar", "prazo": null, "fotos": []}]',
  '[{"colaborador_id": "40000000-0000-0000-0000-00000000000a", "nome": "COLAB QUARTO", "empresa_id": "20000000-0000-0000-0000-000000000001", "quarto": "Quarto 1", "nao_assina": true, "assinatura": null},
    {"colaborador_id": null, "nome": "OUTRA EMPRESA", "empresa_id": "20000000-0000-0000-0000-000000000002", "quarto": "Quarto 1", "assinatura": null},
    {"colaborador_id": null, "nome": "NOME A MAO", "quarto": "Quarto 1", "ausente": true, "assinatura": null}]');
select teste.bloqueado('Alojamento na obra: concluir sem tipo de cama', $q$select concluir_vistoria_seg('a3000000-0000-0000-0000-00000000000a')$q$);
update seg_vistorias set quartos = '[{"nome": "Quarto 1", "cama": "simples"}]' where id = 'a3000000-0000-0000-0000-00000000000a';
select concluir_vistoria_seg('a3000000-0000-0000-0000-00000000000a');
select teste.igual('Alojamento na obra (controle): código para quem não sabe assinar', $q$select 1 from seg_vistorias v, jsonb_array_elements(v.funcionarios) p where v.id = 'a3000000-0000-0000-0000-00000000000a' and p->>'codigo' ~ '^[0-9A-F]{4}-[0-9A-F]{4}$'$q$, 1);
select teste.igual('Alojamento na obra (controle): moradores contados', $q$select 1 from seg_vistorias where id = 'a3000000-0000-0000-0000-00000000000a' and qtd_funcionarios = 3$q$, 1);
select teste.igual('Alojamento na obra (controle): itens enviados', $q$select 1 where notificar_nao_conformidades('a3000000-0000-0000-0000-00000000000a', null) = 4$q$, 1);
select teste.sair();
select teste.igual('Alojamento na obra (controle): limpeza para as duas empresas', $q$select 1 from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a' and item = 0 and empresa_id is not null and quarto = 'Quarto 1'$q$, 2);
select teste.igual('Alojamento na obra (controle): estrutura e áreas comuns para a Emais', $q$select 1 from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a' and empresa_id is null$q$, 2);
select id as "NCEMAIS" from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a' and item = 1 \gset
select id as "NCE1" from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a' and empresa_id = :E1 \gset
select teste.entrar(:F1);
select teste.igual('Alojamento na obra: fornecedor vê só o item dele', $q$select 1 from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a'$q$, 1);
select teste.bloqueado('Pendência da Emais: fornecedor responde', format($q$select responder_nao_conformidade(%L, 'Arrumado pela empresa', '[]')$q$, :'NCEMAIS'));
select teste.bloqueado('Pendência da Emais: fornecedor lista', $q$select seg_pendencias_emais('10000000-0000-0000-0000-000000000001')$q$);
select teste.entrar(:T2);
select teste.igual('Alojamento na obra: TST de outra obra', $q$select 1 from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a'$q$, 0);
select teste.bloqueado('Pendência da Emais: TST de outra obra lista', $q$select seg_pendencias_emais('10000000-0000-0000-0000-000000000001')$q$);
select teste.bloqueado('Moradores: TST de outra obra', $q$select * from seg_moradores_obra('10000000-0000-0000-0000-000000000001')$q$);
select teste.entrar(:G1);
select teste.bloqueado('Moradores: engenharia', $q$select * from seg_moradores_obra('10000000-0000-0000-0000-000000000001')$q$);
select teste.igual('Pendência da Emais (controle): engenharia vê as da obra', $q$select 1 from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a'$q$, 2);
select teste.igual('Pendência da Emais (controle): lista da engenharia', $q$select jsonb_array_elements(seg_pendencias_emais('10000000-0000-0000-0000-000000000001'))$q$, 2);
select teste.igual('Pendência da Emais (controle): engenharia vê a foto do problema', $q$select 1 where app.seg_arquivo('vistoria/a3000000-0000-0000-0000-00000000000a/1/forro.jpg', false)$q$, 1);
select teste.igual('Pendência da Emais: engenharia vê foto de item de fornecedor', $q$select 1 where app.seg_arquivo('vistoria/a3000000-0000-0000-0000-00000000000a/0/limpeza.jpg', false)$q$, 0);
select teste.igual('Pendência da Emais (controle): engenharia grava a foto da correção', format($q$select 1 where app.seg_arquivo('nc/%s/x.jpg', true)$q$, :'NCEMAIS'), 1);
select teste.igual('Pendência da Emais: engenharia grava foto em item de fornecedor', format($q$select 1 where app.seg_arquivo('nc/%s/x.jpg', true)$q$, :'NCE1'), 0);
select teste.bloqueado('Pendência da Emais: engenharia responde item de fornecedor', format($q$select responder_nao_conformidade(%L, 'Arrumado pela engenharia', '[]')$q$, :'NCE1'));
select teste.permitido('Pendência da Emais (controle): engenharia responde', format($q$select responder_nao_conformidade(%L, 'Forro trocado pela equipe da obra', '[]')$q$, :'NCEMAIS'));
select teste.bloqueado('Pendência da Emais: engenharia avalia', format($q$select avaliar_nao_conformidade(%L, true, null)$q$, :'NCEMAIS'));
select teste.entrar(:T1);
select reabrir_vistoria_seg('a3000000-0000-0000-0000-00000000000a', 'Teste de correção');
select teste.bloqueado('Alojamento na obra: incluir quarto com itens já enviados', $q$update seg_vistorias set itens = itens || '[{"texto": "x", "quarto": "Quarto 2", "status": null}]' where id = 'a3000000-0000-0000-0000-00000000000a'$q$);
select teste.sair();
delete from seg_nao_conformidades where vistoria_id = 'a3000000-0000-0000-0000-00000000000a';
delete from seg_vistorias where id = 'a3000000-0000-0000-0000-00000000000a';
delete from seg_alojamentos where id = 'a1000000-0000-0000-0000-00000000000a';
delete from alocacoes where id = '50000000-0000-0000-0000-00000000000a';
delete from colaboradores where id = '40000000-0000-0000-0000-00000000000a';

-- Conclusão da análise de documentos: um e-mail só por fornecedor, com o que precisa corrigir e o que foi aprovado.
insert into documentos (id, tipo_codigo, empresa_id, colaborador_id, data_emissao, aceite_lgpd_em) values
  ('60000000-0000-0000-0000-000000000009', 'aso', :E1, :C1, current_date - 2, now());
select teste.entrar(:A);
select devolver_documento('60000000-0000-0000-0000-000000000009', 'Arquivo ilegível ou cortado');
select teste.sair();
select teste.igual('Conclusão (controle): devolução fica aguardando conclusão', $q$select 1 from documentos where id = '60000000-0000-0000-0000-000000000009' and aguardando_conclusao and resultado_analise = 'devolvido'$q$, 1);
select teste.entrar(:F1);
select teste.bloqueado('Conclusão: fornecedor vê a prévia', $q$select previa_conclusao_analise('20000000-0000-0000-0000-000000000001')$q$);
select teste.bloqueado('Conclusão: fornecedor conclui', $q$select concluir_analise('20000000-0000-0000-0000-000000000001', array['60000000-0000-0000-0000-000000000009']::uuid[])$q$);
select teste.bloqueado('Conclusão: fornecedor lista', $q$select analises_para_concluir()$q$);
select teste.entrar(:T1);
select teste.bloqueado('Conclusão: TST conclui', $q$select concluir_analise('20000000-0000-0000-0000-000000000001', array['60000000-0000-0000-0000-000000000009']::uuid[])$q$);
select teste.entrar(:A);
select teste.igual('Conclusão (controle): empresa na lista para concluir', $q$select 1 from jsonb_array_elements(analises_para_concluir()) x where x->>'empresa_id' = '20000000-0000-0000-0000-000000000001'$q$, 1);
select teste.bloqueado('Conclusão: fornecedor sem e-mail', $q$select concluir_analise('20000000-0000-0000-0000-000000000001', array['60000000-0000-0000-0000-000000000009']::uuid[])$q$);
select teste.sair();
update empresas set email_contato = 'contato@empresaum.test' where id = :E1;
select teste.entrar(:A);
select teste.igual('Conclusão (controle): prévia com o e-mail do fornecedor e a devolução', $q$select 1 where (previa_conclusao_analise('20000000-0000-0000-0000-000000000001')->>'para') = 'contato@empresaum.test' and (previa_conclusao_analise('20000000-0000-0000-0000-000000000001')->>'corpo') like '%COLAB UM: ASO (devolvido: arquivo ilegível ou cortado)%'$q$, 1);
select concluir_analise(:E1, array['60000000-0000-0000-0000-000000000009']::uuid[]) as "CONC" \gset
select teste.igual('Conclusão (controle): documento comunicado', $q$select 1 from documentos where id = '60000000-0000-0000-0000-000000000009' and not aguardando_conclusao and conclusao_id is not null$q$, 1);
select teste.igual('Conclusão (controle): e-mail na fila para o fornecedor', $q$select 1 from analises_conclusoes where para = 'contato@empresaum.test' and situacao_envio = 'aguardando' and devolvidos = 1$q$, 1);
select teste.bloqueado('Conclusão: concluir de novo o mesmo documento', $q$select concluir_analise('20000000-0000-0000-0000-000000000001', array['60000000-0000-0000-0000-000000000009']::uuid[])$q$);
select teste.entrar(:F1);
select teste.igual('Conclusão (controle): fornecedor vê a análise da empresa dele', 'select 1 from analises_conclusoes', 1);
select teste.entrar(:F2);
select teste.igual('Conclusão: outro fornecedor vê a análise', 'select 1 from analises_conclusoes', 0);
select teste.entrar(:T1);
select teste.igual('Conclusão: TST vê a análise', 'select 1 from analises_conclusoes', 0);
select teste.sair();
delete from documentos where id = '60000000-0000-0000-0000-000000000009';
delete from analises_conclusoes;
update empresas set email_contato = null where id = :E1;

-- Administrativo corrige a data de um documento (e aprova junto) e dispensa documento que não se aplica.
insert into documentos (id, tipo_codigo, empresa_id, colaborador_id, data_emissao, aceite_lgpd_em) values
  ('60000000-0000-0000-0000-00000000000a', 'aso', :E1, :C1, current_date - 400, now());
select teste.entrar(:F1);
select teste.bloqueado('Correção: fornecedor corrige', $q$select corrigir_documento('60000000-0000-0000-0000-00000000000a', current_date - 10, null, 'data digitada errada')$q$);
select teste.bloqueado('Dispensa: fornecedor dispensa pela Emais', $q$select dispensar_documento('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'epi', 'não se aplica')$q$);
select teste.bloqueado('Dispensa: fornecedor dispensa documento que não pode', $q$insert into documentos (tipo_codigo, empresa_id, colaborador_id, dispensado, aceite_lgpd_em) values ('epi', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', true, now())$q$);
select teste.entrar(:T1);
select teste.bloqueado('Correção: TST corrige', $q$select corrigir_documento('60000000-0000-0000-0000-00000000000a', current_date - 10, null, 'data digitada errada')$q$);
select teste.bloqueado('Dispensa: TST dispensa', $q$select dispensar_documento('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'epi', 'não se aplica')$q$);
select teste.entrar(:A);
select teste.bloqueado('Correção: sem motivo', $q$select corrigir_documento('60000000-0000-0000-0000-00000000000a', current_date - 10, null, ' ')$q$);
select teste.bloqueado('Correção: data futura', $q$select corrigir_documento('60000000-0000-0000-0000-00000000000a', current_date + 1, null, 'data digitada errada')$q$);
select teste.bloqueado('Correção: vigência em documento que vence pela emissão', $q$select corrigir_documento('60000000-0000-0000-0000-00000000000a', current_date - 10, current_date + 300, 'data digitada errada')$q$);
select teste.sair();
update alocacoes set status = 'pendente_fornecedor' where id = :AL1;
select teste.entrar(:A);
select corrigir_documento('60000000-0000-0000-0000-00000000000a', current_date - 10, null, 'Data de emissão digitada errada pelo fornecedor');
select teste.sair();
select teste.igual('Correção (controle): data corrigida e aprovado', $q$select 1 from documentos where id = '60000000-0000-0000-0000-00000000000a' and status = 'aprovado' and data_emissao = current_date - 10 and aguardando_conclusao$q$, 1);
select teste.igual('Correção (controle): histórico com a data antiga', $q$select 1 from eventos where registro_id = '60000000-0000-0000-0000-00000000000a' and acao = 'corrigido' and (detalhe->'de'->>'emissao')::date = current_date - 400$q$, 1);
select teste.igual('Correção (controle): alocação volta para análise só sem pendência impeditiva',
  $q$select 1 from alocacoes a where a.id = '50000000-0000-0000-0000-000000000001' and (a.status = 'em_analise') = not exists (select 1 from v_pendencias p where p.alocacao_id = a.id and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido'))$q$, 1);
select teste.entrar(:A);
select dispensar_documento(:E1, :C1, 'epi', 'Colaborador administrativo, não usa EPI') as "DISP" \gset
select teste.permitido('Dispensa (controle): documento da empresa', $q$select dispensar_documento('20000000-0000-0000-0000-000000000001', null, 'pgr', 'Empresa sem atividade de risco nesta obra')$q$);
select teste.bloqueado('Dispensa: documento da empresa com colaborador', $q$select dispensar_documento('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'pgr', 'motivo qualquer')$q$);
select teste.sair();
select teste.igual('Dispensa (controle): pendência sai como dispensado', $q$select 1 from v_pendencias where colaborador_id = '40000000-0000-0000-0000-000000000001' and tipo_codigo = 'epi' and situacao = 'dispensado'$q$, 1);
select teste.entrar(:A);
select desfazer_dispensa(:'DISP', 'Colaborador mudou de função');
select teste.sair();
select teste.igual('Dispensa (controle): desfeita volta a exigir', $q$select 1 from v_pendencias where colaborador_id = '40000000-0000-0000-0000-000000000001' and tipo_codigo = 'epi' and situacao = 'dispensado'$q$, 0);
update alocacoes set status = 'liberado' where id = :AL1;
delete from documentos where id in ('60000000-0000-0000-0000-00000000000a', :'DISP');

-- E-mails da empresa: o administrativo edita os "a mais"; as notificações vão para o do acesso e os a mais.
select teste.entrar(:F1);
select teste.bloqueado('E-mails da empresa: fornecedor altera', $q$select salvar_emails_empresa('20000000-0000-0000-0000-000000000001', 'outro@empresa.test')$q$);
select teste.entrar(:T1);
select teste.bloqueado('E-mails da empresa: TST altera', $q$select salvar_emails_empresa('20000000-0000-0000-0000-000000000001', 'outro@empresa.test')$q$);
select teste.entrar(:A);
select teste.bloqueado('E-mails da empresa: e-mail inválido', $q$select salvar_emails_empresa('20000000-0000-0000-0000-000000000001', 'financeiro@empresa.test; rh-sem-arroba')$q$);
select salvar_emails_empresa(:E1, 'Financeiro@Empresa.test; rh@empresa.test, financeiro@empresa.test');
select teste.sair();
select teste.igual('E-mails da empresa (controle): salvos sem repetir', $q$select 1 from empresas where id = '20000000-0000-0000-0000-000000000001' and email_contato = 'financeiro@empresa.test; rh@empresa.test'$q$, 1);
select teste.igual('E-mails da empresa (controle): notificação com o do acesso e os a mais',
  $q$select 1 where app.emails_notificacao('login@empresa.test', 'financeiro@empresa.test; rh@empresa.test; login@empresa.test') = 'login@empresa.test, financeiro@empresa.test, rh@empresa.test'$q$, 1);
update empresas set email_contato = null where id = :E1;

-- Análise automática: alocação em cadastro vai sozinha para análise quando não falta documento obrigatório.
insert into colaboradores (id, empresa_id, nome, cpf, funcao_id)
  select '40000000-0000-0000-0000-00000000000b', :E1, 'COLAB AUTOMATICO', '44444444444', funcao_id from colaboradores where id = :C1;
select teste.entrar(:F1);
insert into alocacoes (id, colaborador_id, obra_id) values ('50000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', :O1);
select teste.sair();
select teste.igual('Análise automática (controle): sem documento fica em cadastro', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-00000000000b' and status = 'em_cadastro'$q$, 1);
select teste.entrar(:A);
select count(dispensar_documento(:E1, case when grupo = 'colaborador' then '40000000-0000-0000-0000-00000000000b'::uuid end, tipo_codigo, 'teste da análise automática'))
  from v_pendencias where alocacao_id = '50000000-0000-0000-0000-00000000000b' and impeditivo and situacao in ('nao_enviado', 'devolvido', 'vencido') and grupo = 'colaborador'
  and tipo_codigo <> (select min(tipo_codigo) from v_pendencias where alocacao_id = '50000000-0000-0000-0000-00000000000b' and impeditivo and grupo = 'colaborador' and situacao = 'nao_enviado');
select teste.sair();
select teste.igual('Análise automática (controle): faltando um documento continua em cadastro', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-00000000000b' and status = 'em_cadastro'$q$, 1);
update colaboradores set bloqueado = true, bloqueio_motivo = 'teste', bloqueado_em = now() where id = '40000000-0000-0000-0000-00000000000b';
select teste.entrar(:A);
select count(dispensar_documento(:E1, case when grupo = 'colaborador' then '40000000-0000-0000-0000-00000000000b'::uuid end, tipo_codigo, 'teste da análise automática'))
  from v_pendencias where alocacao_id = '50000000-0000-0000-0000-00000000000b' and impeditivo and situacao in ('nao_enviado', 'devolvido', 'vencido');
select teste.sair();
select teste.igual('Análise automática (controle): nada pendente', $q$select 1 from v_pendencias where alocacao_id = '50000000-0000-0000-0000-00000000000b' and impeditivo and situacao in ('nao_enviado', 'devolvido', 'vencido')$q$, 0);
select teste.igual('Análise automática: colaborador bloqueado vai para análise', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-00000000000b' and status = 'em_cadastro'$q$, 1);
update colaboradores set bloqueado = false, bloqueio_motivo = null, bloqueado_em = null where id = '40000000-0000-0000-0000-00000000000b';
select teste.igual('Análise automática (controle): com tudo em dia vai para análise', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-00000000000b' and status = 'em_analise' and inicio_conferencia is not null$q$, 1);
select teste.igual('Análise automática (controle): fica no histórico', $q$select 1 from eventos where registro_id = '50000000-0000-0000-0000-00000000000b' and acao = 'enviada_analise_automatica'$q$, 1);
update alocacoes set status = 'pendente_fornecedor' where id = '50000000-0000-0000-0000-00000000000b';
update colaboradores set situacao = 'ativo' where id = '40000000-0000-0000-0000-00000000000b';
select teste.igual('Análise automática: pendente do fornecedor volta sozinho para análise', $q$select 1 from alocacoes where id = '50000000-0000-0000-0000-00000000000b' and status = 'pendente_fornecedor'$q$, 1);
delete from eventos where registro_id in ('50000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000c');
delete from documentos where colaborador_id = '40000000-0000-0000-0000-00000000000b' or (colaborador_id is null and dados->>'motivo_dispensa' = 'teste da análise automática');
delete from alocacoes where colaborador_id = '40000000-0000-0000-0000-00000000000b';
delete from colaboradores where id = '40000000-0000-0000-0000-00000000000b';

-- Homologação de fornecedor pelo Suprimentos, contrato e liberação do portal pelo administrativo.
\set S1 '''d0000000-0000-0000-0000-000000000001'''
\set FH '''c0000000-0000-0000-0000-000000000009'''
\set O9 '''10000000-0000-0000-0000-000000000009'''
insert into auth.users (id, email, last_sign_in_at) values (:S1, 'sup@teste', now());
insert into usuarios (id, nome, email, perfil, ativo) values (:S1, 'Suprimentos Um', 'sup@teste', 'suprimentos', true);
insert into obras (id, nome) values (:O9, 'OBRA NOVE');

select teste.entrar(:F1);
select teste.bloqueado('Homologação: fornecedor não cadastra fornecedor', $q$select cadastrar_fornecedor_homologacao('X LTDA', '99888777000166', 'x@x.com', null, null)$q$);
select teste.entrar(:T1);
select teste.bloqueado('Homologação: TST não cadastra fornecedor', $q$select cadastrar_fornecedor_homologacao('X LTDA', '99888777000166', 'x@x.com', null, null)$q$);
select teste.entrar(:S1);
select teste.bloqueado('Suprimentos: não aprova documento de colaborador', format($q$select aprovar_documento(%L)$q$, :D1));
select teste.bloqueado('Suprimentos: não libera colaborador', format($q$select aprovar_alocacao(%L)$q$, :AL1));
select teste.contar(), case when teste.linhas(format($q$update empresas set homologacao = 'homologada' where id = %L$q$, :E1)) > 0 then teste.falha('Suprimentos: não altera empresa direto', 'alterou a empresa') end;
select teste.bloqueado('Suprimentos: não cria colaborador', format($q$insert into colaboradores (empresa_id, nome, cpf) values (%L, 'X', '12345678909')$q$, :E1));
select teste.igual('Suprimentos: não lê documentos de colaborador', $q$select 1 from documentos$q$, 0);
select teste.igual('Suprimentos: lê as empresas', format($q$select 1 from empresas where id = %L$q$, :E1), 1);
-- Cadastro do fornecedor pelo Suprimentos
select teste.igual('Cadastro: Suprimentos vê o fornecedor com documentos e colaboradores', format($q$select 1 from jsonb_array_elements(fornecedores_cadastro()) x where x->>'empresa_id' = %L and jsonb_typeof(x->'documentos') = 'array' and x->'colaboradores' ? 'em_obra'$q$, :E1), 1);
select teste.igual('Cadastro: sem nome de colaborador na lista', $q$select 1 from jsonb_array_elements(fornecedores_cadastro()) x where x::text ilike '%cpf%'$q$, 0);
select teste.bloqueado('Cadastro: e-mail da empresa inválido', format($q$select salvar_cadastro_fornecedor(%L, 'EMPRESA UM', null, null, '{"email_empresa":"sem-arroba"}')$q$, :E1));
select teste.bloqueado('Cadastro: estado inválido', format($q$select salvar_cadastro_fornecedor(%L, 'EMPRESA UM', null, null, '{"estado":"Sao Paulo"}')$q$, :E1));
select teste.bloqueado('Cadastro: CNPJ inválido', format($q$select salvar_cadastro_fornecedor(%L, 'EMPRESA UM', '11.222.333/0001-80', null, '{}')$q$, :E1));
select teste.sair();
update empresas set cnpj = '11222333000181' where id = :E2;
select teste.entrar(:S1);
select teste.bloqueado('Cadastro: CNPJ de outra empresa', format($q$select salvar_cadastro_fornecedor(%L, 'EMPRESA UM', '11.222.333/0001-81', null, '{}')$q$, :E1));
select salvar_cadastro_fornecedor(:E1, 'Empresa Um Renomeada', '11.444.777/0001-61', null, '{}'::jsonb);
select teste.sair();
select teste.igual('Cadastro: CNPJ corrigido pelo Suprimentos e registrado', format($q$select 1 from empresas e join eventos ev on ev.registro_id = e.id where e.id = %L and e.cnpj = '11444777000161' and e.razao_social = 'EMPRESA UM RENOMEADA' and ev.acao = 'cadastro_alterado' and ev.detalhe->'cnpj'->>'de' = '11111111000111'$q$, :E1), 1);
update empresas set cnpj = '11111111000111', razao_social = 'EMPRESA UM' where id = :E1;
update homologacoes set dados = dados - 'razao_social' where empresa_id = :E1;
update empresas set cnpj = '22222222000122' where id = :E2;
select teste.entrar(:S1);
select salvar_cadastro_fornecedor(:E1, (select razao_social from empresas where id = :E1), null, 'avisos@empresa.com', '{"telefone":"11 4000-0000","cidade":"Campinas","estado":"SP","cnpj":"00000000000000"}'::jsonb);
select teste.sair();
select teste.igual('Cadastro: dados gravados sem convite e sem campo fora da lista', format($q$select 1 from homologacoes h join empresas e on e.id = h.empresa_id where h.empresa_id = %L and h.convidada_em is null and h.dados->>'telefone' = '11 4000-0000' and not h.dados ? 'cnpj' and e.email_contato = 'avisos@empresa.com' and e.homologacao = 'anterior'$q$, :E1), 1);
select teste.entrar(:F1);
select teste.bloqueado('Cadastro: fornecedor não edita pelo Suprimentos', format($q$select salvar_cadastro_fornecedor(%L, 'X LTDA', null, null, '{}')$q$, :E1));
select teste.igual('Cadastro: fornecedor não lista fornecedores', $q$select jsonb_array_elements(fornecedores_cadastro())$q$, 0);
select teste.sair();
select teste.entrar(:T1);
select teste.bloqueado('Cadastro: TST não altera e-mails da empresa', format($q$select salvar_emails_empresa(%L, 'x@x.com')$q$, :E1));
select teste.sair();
select teste.entrar(:S1);
select teste.bloqueado('Homologação: CNPJ repetido', $q$select cadastrar_fornecedor_homologacao('OUTRA', '11111111000111', 'x@x.com', null, null)$q$);
select teste.bloqueado('Homologação: e-mail que já é login de outro acesso', format($q$select cadastrar_fornecedor_homologacao('OUTRA', '12345678000195', %L, null, null)$q$, (select email from usuarios where id = :S1)));
select teste.igual('Homologação: recusa não deixa empresa sem acesso', $q$select 1 from empresas where cnpj = '12345678000195'$q$, 0);
select cadastrar_fornecedor_homologacao('Fornecedor Homologado Ltda', '99.888.777/0001-66', 'Novo@Fornecedor.com', 'Fulano', array[:O9]::uuid[]) as "EH" \gset
select teste.sair();
-- Como na função gerenciar-acesso: o login do fornecedor é criado depois da empresa.
insert into auth.users (id, email, last_sign_in_at) values (:FH, 'novo@fornecedor.com', now());
insert into usuarios (id, nome, email, perfil, ativo) values (:FH, 'Fornecedor Novo', 'novo@fornecedor.com', 'fornecedor', true);
insert into usuarios_empresas values (:FH, :'EH');
update empresas set email_acesso = 'novo@fornecedor.com' where id = :'EH';
select teste.entrar(:S1);
select enviar_convite_homologacao(:'EH');
select teste.sair();
select teste.igual('Homologação: convite na fila', format($q$select 1 from envios_fila where empresa_id = %L and tipo = 'convite_homologacao' and para = 'novo@fornecedor.com'$q$, :'EH'), 1);
select teste.entrar(:S1);
select enviar_convite_homologacao(:'EH');
select teste.sair();
select teste.igual('Convite: reenviar troca o que estava na fila', format($q$select 1 from envios_fila where empresa_id = %L and tipo = 'convite_homologacao' and situacao_envio = 'aguardando'$q$, :'EH'), 1);
select id as "CV" from envios_fila where empresa_id = :'EH' and tipo = 'convite_homologacao' \gset
select teste.entrar(:FH);
select teste.bloqueado('Convite: fornecedor não marca envio', format($q$select marcar_envio_manual(%L)$q$, :'CV'));
select teste.sair();
select teste.entrar(:S1);
select marcar_envio_manual(:'CV');
select teste.bloqueado('Convite: não marca duas vezes', format($q$select marcar_envio_manual(%L)$q$, :'CV'));
select teste.sair();
select teste.igual('Convite: mandado pelo Outlook sai da fila automática', format($q$select 1 from envios_fila where id = %L and situacao_envio = 'enviado' and envio_para like 'Outlook%%'$q$, :'CV'), 1);

-- Fornecedor em homologação só vê a homologação
select teste.entrar(:FH);
select teste.igual('Homologação: empresa ainda fechada no portal', format($q$select 1 from empresas where id = %L$q$, :'EH'), 0);
select teste.igual('Homologação: fornecedor vê a homologação', $q$select jsonb_array_elements(minha_homologacao())$q$, 1);
select teste.bloqueado('Homologação: sem portal não cadastra colaborador', format($q$insert into colaboradores (empresa_id, nome, cpf) values (%L, 'X', '12345678909')$q$, :'EH'));
select teste.bloqueado('Homologação: envio sem dados', format($q$select enviar_homologacao(%L)$q$, :'EH'));
-- Configuração do formulário: só o Suprimentos (e o administrativo) muda, com registro
select teste.bloqueado('Configuração: fornecedor não muda campo obrigatório', $q$select configurar_campo_homologacao('ramo', false)$q$);
select teste.bloqueado('Configuração: fornecedor não muda documento', $q$select configurar_documento_homologacao('alvara', false, null)$q$);
select teste.contar(), case when teste.linhas($q$update homologacao_tipos set obrigatorio = false where codigo = 'alvara'$q$) > 0 then teste.falha('Configuração: fornecedor não altera documento direto', 'alterou') end;
select teste.sair();
select teste.entrar(:S1);
select teste.bloqueado('Configuração: razão social é sempre obrigatória', $q$select configurar_campo_homologacao('razao_social', false)$q$);
select teste.bloqueado('Configuração: validade inválida', $q$select configurar_documento_homologacao('alvara', true, 0)$q$);
select teste.contar(), case when teste.linhas($q$update homologacao_tipos set obrigatorio = false where codigo = 'alvara'$q$) > 0 then teste.falha('Configuração: Suprimentos não altera documento direto', 'alterou') end;
select configurar_campo_homologacao('celular', true);
select configurar_campo_homologacao('celular', false);
select configurar_documento_homologacao('alvara', true, 180);
select teste.igual('Configuração: mudanças registradas', $q$select jsonb_array_elements(historico_configuracao_homologacao())$q$, 3);
select teste.sair();
select teste.igual('Configuração: validade nova gravada', $q$select 1 from homologacao_tipos where codigo = 'alvara' and validade_dias = 180$q$, 1);
-- Itens novos no formulário
select teste.entrar(:F1);
select teste.bloqueado('Itens: fornecedor não inclui pergunta', $q$select incluir_item_homologacao('Quantos funcionários?', 'numero', true)$q$);
select teste.sair();
select teste.entrar(:S1);
select teste.bloqueado('Itens: formato inválido', $q$select incluir_item_homologacao('Pergunta qualquer', 'imagem', true)$q$);
select teste.bloqueado('Itens: validade só em anexo', $q$select incluir_item_homologacao('Pergunta qualquer', 'texto', true, 30)$q$);
select teste.bloqueado('Itens: não remove campo do F.31', $q$select remover_item_homologacao('ramo')$q$);
select teste.bloqueado('Itens: não remove documento do F.31', $q$select remover_item_homologacao('alvara')$q$);
select incluir_item_homologacao('Data de abertura da filial', 'data', true) as "IP" \gset
select incluir_item_homologacao('Certificado ISO 9001', 'anexo', true, 365) as "IA" \gset
select teste.bloqueado('Itens: pergunta repetida', $q$select incluir_item_homologacao('data de abertura da filial', 'texto', false)$q$);
select teste.sair();
select teste.igual('Itens: pergunta e documento criados', format($q$select 1 from homologacao_campos where campo = %L and formato = 'data' and obrigatorio and personalizado union all select 1 from homologacao_tipos where codigo = %L and validade_dias = 365 and personalizado$q$, :'IP', :'IA'), 2);
-- E-mails: o Suprimentos só vê e edita os da homologação
select teste.entrar(:S1);
select teste.igual('E-mails: Suprimentos vê os da homologação', $q$select 1 from modelos_email$q$, 5);
select teste.igual('E-mails: Suprimentos não vê cobrança nem portal liberado', $q$select 1 from modelos_email where tipo in ('lembrete_medicao', 'portal_liberado')$q$, 0);
select teste.contar(), case when teste.linhas($q$update modelos_email set assunto = 'x' where tipo = 'lembrete_medicao'$q$) > 0 then teste.falha('E-mails: Suprimentos não edita cobrança', 'editou') end;
select teste.sair();
select teste.entrar(:A);
select teste.igual('E-mails: administrativo vê o portal liberado', $q$select 1 from modelos_email where tipo = 'portal_liberado'$q$, 1);
select teste.sair();
select teste.entrar(:FH);
select teste.bloqueado('Homologação: arquivo fora da pasta', format($q$select enviar_documento_homologacao(%L, 'cnd_federal', current_date, '[{"caminho":"outra/h/1/a.pdf"}]')$q$, :'EH'));
select teste.bloqueado('Homologação: data futura', format($q$select enviar_documento_homologacao(%L, 'cnd_federal', current_date + 1, '[{"caminho":"%s/h/1/a.pdf"}]')$q$, :'EH', :'EH'));
select salvar_homologacao(:'EH', '{"razao_social":"FORNECEDOR HOMOLOGADO LTDA","ramo":"Pintura","endereco":"Rua A","numero":"1","bairro":"Centro","cep":"15000-000","cidade":"Rio Preto","estado":"SP","telefone":"17 3333-3333","contato":"Fulano","email_empresa":"contato@x.com","banco":"001","agencia":"1234","conta":"5678-9","referencias":[{"empresa":"Cliente A","telefone":"17 1111-1111"}],"email":"hackeado@x.com"}'::jsonb);
select count(enviar_documento_homologacao(:'EH', t.codigo, current_date - 2, jsonb_build_array(jsonb_build_object('caminho', :'EH' || '/h/' || t.codigo || '/a.pdf', 'nome', t.codigo || '.pdf', 'tamanho', 100, 'tipo', 'application/pdf'))))
  from homologacao_tipos t where t.obrigatorio;
select teste.sair();
select teste.entrar(:S1);
select configurar_campo_homologacao('celular', true);
select teste.sair();
select teste.entrar(:FH);
select teste.bloqueado('Configuração: envio exige o campo que ficou obrigatório', format($q$select enviar_homologacao(%L)$q$, :'EH'));
select teste.sair();
select teste.entrar(:S1);
select configurar_campo_homologacao('celular', false);
select teste.sair();
select teste.entrar(:FH);
select teste.bloqueado('Itens: envio exige a pergunta e o documento novos', format($q$select enviar_homologacao(%L)$q$, :'EH'));
select teste.bloqueado('Itens: documento novo exige data', format($q$select enviar_documento_homologacao(%L, %L, null, '[{"caminho":"%s/h/iso/a.pdf"}]')$q$, :'EH', :'IA', :'EH'));
select enviar_documento_homologacao(:'EH', :'IA', current_date, jsonb_build_array(jsonb_build_object('caminho', :'EH' || '/h/iso/a.pdf')));
select salvar_homologacao(:'EH', (select dados || jsonb_build_object(:'IP', '31/12/2026') from homologacoes where empresa_id = :'EH'));
select teste.bloqueado('Itens: data em formato errado', format($q$select enviar_homologacao(%L)$q$, :'EH'));
select salvar_homologacao(:'EH', (select dados || jsonb_build_object(:'IP', '2026-01-15') from homologacoes where empresa_id = :'EH'));
select teste.sair();
select teste.entrar(:S1);
select remover_item_homologacao(:'IP');
select remover_item_homologacao(:'IA');
select teste.igual('Itens: histórico registra inclusão e remoção', $q$select 1 from jsonb_array_elements(historico_configuracao_homologacao()) x where x->>'acao' like 'item_%'$q$, 4);
select teste.sair();
select teste.entrar(:FH);
select teste.bloqueado('Itens: documento removido não recebe mais envio', format($q$select enviar_documento_homologacao(%L, %L, current_date, '[{"caminho":"%s/h/iso/b.pdf"}]')$q$, :'EH', :'IA', :'EH'));
select enviar_homologacao(:'EH');
select teste.bloqueado('Homologação: enviada não muda mais', format($q$select salvar_homologacao(%L, '{}'::jsonb)$q$, :'EH'));
select teste.sair();
select teste.igual('Homologação: e-mail do convite não muda pelo fornecedor', format($q$select 1 from homologacoes where empresa_id = %L and dados->>'email' = 'novo@fornecedor.com'$q$, :'EH'), 1);

select teste.entrar(:F1);
select teste.igual('Homologação: outro fornecedor não vê', format($q$select 1 from homologacao_documentos where empresa_id = %L union all select 1 from homologacoes where empresa_id = %L$q$, :'EH', :'EH'), 0);
select teste.bloqueado('Homologação: outro fornecedor não envia documento', format($q$select enviar_documento_homologacao(%L, 'cnd_federal', current_date, '[{"caminho":"%s/h/1/a.pdf"}]')$q$, :'EH', :'EH'));
select teste.igual('Suprimentos: fornecedor não lê os modelos de e-mail', $q$select 1 from modelos_email$q$, 0);
select teste.bloqueado('Contrato: fornecedor não informa mais o contrato', format($q$select informar_contrato(%L, %L, 'X')$q$, :E1, :O1));
select teste.sair();

-- Suprimentos analisa
select teste.entrar(:S1);
select teste.igual('Suprimentos: lê os modelos de e-mail', $q$select 1 from modelos_email where tipo = 'homologacao_aprovada'$q$, 1);
select teste.igual('Suprimentos: lista a homologação enviada', format($q$select 1 from jsonb_array_elements(lista_homologacoes()) x where x->>'empresa_id' = %L and x->>'situacao' = 'enviada'$q$, :'EH'), 1);
select teste.bloqueado('Homologação: homologar sem aprovar os documentos', format($q$select homologar_fornecedor(%L, '{}', null, 'Responsável')$q$, :'EH'));
select count(analisar_documento_homologacao(d.id, d.tipo_codigo <> 'crf_fgts', case when d.tipo_codigo = 'crf_fgts' then 'Certidão vencida' end))
  from homologacao_documentos d where d.empresa_id = :'EH' and d.status = 'em_analise';
select devolver_homologacao(:'EH', null);
select teste.sair();
select teste.igual('Homologação: devolvida com e-mail de correção', format($q$select 1 from empresas e join envios_fila f on f.empresa_id = e.id where e.id = %L and e.homologacao = 'devolvida' and f.tipo = 'homologacao_correcoes' and f.corpo like '%%Certidão vencida%%'$q$, :'EH'), 1);
select teste.entrar(:FH);
select enviar_documento_homologacao(:'EH', 'crf_fgts', current_date, jsonb_build_array(jsonb_build_object('caminho', :'EH' || '/h/crf2/a.pdf')));
select enviar_homologacao(:'EH');
select teste.sair();
select teste.entrar(:S1);
select count(analisar_documento_homologacao(d.id, true)) from homologacao_documentos d where d.empresa_id = :'EH' and d.status = 'em_analise';
select teste.bloqueado('Homologação: sem responsável', format($q$select homologar_fornecedor(%L, '{}', null, '')$q$, :'EH'));
select homologar_fornecedor(:'EH', '{"habilitacao":"sim"}', 'Ok', 'Responsável Suprimentos');
select teste.bloqueado('Liberação: Suprimentos não libera o portal', format($q$select liberar_portal_fornecedor(%L)$q$, :'EH'));
select teste.sair();
select teste.igual('Homologação: cartão CNPJ, PGR e PCMSO entram aprovados em Documentos da empresa', format($q$select 1 from documentos where empresa_id = %L and status = 'aprovado' and tipo_codigo in ('cartao_cnpj', 'pgr', 'pcmso') and dados->>'origem' = 'homologacao'$q$, :'EH'), 3);
select teste.igual('Homologação: os arquivos acompanham', format($q$select 1 from arquivos a join documentos d on d.id = a.documento_id where d.empresa_id = %L$q$, :'EH'), 3);
select teste.entrar(:A);
select teste.bloqueado('Liberação: sem contrato não libera', format($q$select liberar_portal_fornecedor(%L)$q$, :'EH'));
select teste.sair();

-- Contrato
select teste.entrar(:F1);
select teste.bloqueado('Contrato: fornecedor não registra', format($q$select registrar_contrato(%L, 'CT', 'BP', current_date, current_date + 30, '%s/contratos/1/c.pdf', 'c.pdf', array[%L]::uuid[])$q$, :E1, :E1, :O9));
select teste.sair();
select teste.entrar(:S1);
select teste.bloqueado('Contrato: sem arquivo', format($q$select registrar_contrato(%L, 'CT', 'BP', current_date, current_date + 30, null, 'c.pdf', array[%L]::uuid[])$q$, :'EH', :O9));
select registrar_contrato(:'EH', 'CT-900', 'BP-123', current_date, current_date + 365, :'EH' || '/contratos/1/c.pdf', 'contrato.pdf', array[:O9]::uuid[]) as "CT" \gset
select teste.sair();
select teste.igual('Contrato: obra e BP gravados', format($q$select 1 from empresas e join empresas_obras eo on eo.empresa_id = e.id where e.id = %L and e.codigo_bp = 'BP-123' and eo.obra_id = %L and eo.numero_contrato = 'CT-900'$q$, :'EH', :O9), 1);
select teste.entrar(:FH);
select teste.igual('Contrato: fornecedor ainda sem portal', format($q$select 1 from empresas_obras where empresa_id = %L$q$, :'EH'), 0);
select teste.sair();

-- Administrativo libera
select teste.entrar(:A);
select teste.igual('Liberação: aparece para o administrativo', format($q$select 1 from fornecedores_para_liberar() where empresa_id = %L$q$, :'EH'), 1);
select liberar_portal_fornecedor(:'EH');
select teste.sair();
select teste.igual('Liberação: e-mail do portal liberado', format($q$select 1 from envios_fila where empresa_id = %L and tipo = 'portal_liberado' and corpo like '%%OBRA NOVE%%'$q$, :'EH'), 1);
select teste.entrar(:FH);
select teste.igual('Liberação: fornecedor passa a ver a empresa e a obra', format($q$select 1 from empresas_obras where empresa_id = %L$q$, :'EH'), 1);
select teste.sair();

-- A regularizar (fornecedores que já existiam) e pedido de obra
select teste.entrar(:S1);
select teste.igual('Regularizar: fornecedor antigo sem BP aparece', format($q$select 1 from jsonb_array_elements(fornecedores_a_regularizar()) x where x->>'empresa_id' = %L and (x->>'sem_bp')::boolean$q$, :E1), 1);
select teste.igual('Regularizar: homologado com contrato não aparece', format($q$select 1 from jsonb_array_elements(fornecedores_a_regularizar()) x where x->>'empresa_id' = %L$q$, :'EH'), 0);
select teste.sair();
select teste.entrar(:F1);
select pedir_obra(:E1, :O9, null, 'Vamos pintar a obra nove') as "PED" \gset
select teste.sair();
select teste.entrar(:S1);
select teste.bloqueado('Pedido de obra: aprovação só com contrato', format($q$select responder_pedido_obra(%L, true)$q$, :'PED'));
select registrar_contrato(:E1, 'CT-77', 'BP-77', current_date, current_date + 10, :E1 || '/contratos/2/c.pdf', 'c.pdf', array[:O9]::uuid[]) as "CT2" \gset
select teste.sair();
select teste.igual('Pedido de obra: aprovado ao registrar o contrato', format($q$select 1 from pedidos_obra where id = %L and situacao = 'aprovado'$q$, :'PED'), 1);
select teste.entrar(:S1);
select teste.igual('Regularizar: contrato vencendo em 30 dias aparece', format($q$select 1 from jsonb_array_elements(fornecedores_a_regularizar()) x where x->>'empresa_id' = %L and jsonb_array_length(x->'contratos_vencendo') = 1$q$, :E1), 1);
select encerrar_contrato(:'CT2', 'Contrato de teste');
select teste.sair();

-- Certidão vencida: aviso ao fornecedor, sem travar nada
update homologacao_documentos set vencimento = current_date - 1 where empresa_id = :'EH' and tipo_codigo = 'crf_fgts' and status = 'aprovado';
select avisar_certidoes_vencidas();
select teste.igual('Certidão vencida: e-mail ao fornecedor uma vez', format($q$select 1 from envios_fila where empresa_id = %L and tipo = 'certidao_vencida'$q$, :'EH'), 1);
select avisar_certidoes_vencidas();
select teste.igual('Certidão vencida: não repete o aviso', format($q$select 1 from envios_fila where empresa_id = %L and tipo = 'certidao_vencida'$q$, :'EH'), 1);
select teste.entrar(:F1);
select teste.bloqueado('Certidão vencida: só o envio automático chama', $q$select avisar_certidoes_vencidas()$q$);
select teste.sair();

-- Reprovação
select teste.entrar(:S1);
select cadastrar_fornecedor_homologacao('Reprovado Ltda', '55444333000122', 'rep@x.com', null, null) as "ER" \gset
select reprovar_homologacao(:'ER', 'Sem capacidade técnica');
select teste.sair();
select teste.igual('Reprovação: situação e e-mail', format($q$select 1 from empresas e join envios_fila f on f.empresa_id = e.id where e.id = %L and e.homologacao = 'reprovada' and f.tipo = 'homologacao_reprovada' and f.para = 'rep@x.com'$q$, :'ER'), 1);

-- Limpeza
delete from pedidos_obra where obra_id = :O9;
delete from arquivos where documento_id in (select id from documentos where empresa_id = :'EH');
update homologacao_documentos set documento_portal = null where empresa_id = :'EH';
delete from documentos where empresa_id = :'EH';
delete from contratos_fornecedor where empresa_id in (:E1, :'EH');
delete from empresas_obras where obra_id = :O9;
delete from envios_fila where empresa_id in (:'EH', :'ER');
delete from usuarios_empresas where usuario_id = :FH;
delete from empresas where id in (:'EH', :'ER');
update empresas set codigo_bp = null where id = :E1;
delete from mensagens where autor_id in (:S1, :FH);
update homologacoes set convidada_por = null, decidida_por = null where convidada_por = :S1 or decidida_por = :S1;
delete from usuarios where id in (:S1, :FH);
delete from auth.users where id in (:S1, :FH);

-- ============================================================================================
-- Dispensa da medição pelo administrativo
select (date_trunc('month', current_date) - interval '1 month')::date as "MES_ANT" \gset
select teste.entrar(:F1);
select teste.bloqueado('Dispensa: fornecedor não dispensa a própria medição', format($q$select dispensar_medicao(%L, %L, %L, 'Sem atuação no mês')$q$, :E1, :O1, :'MES_ANT'));
select teste.sair();
select teste.entrar(:A);
select teste.bloqueado('Dispensa: exige motivo', format($q$select dispensar_medicao(%L, %L, %L, 'ok')$q$, :E1, :O1, :'MES_ANT'));
select teste.bloqueado('Dispensa: obra fora da empresa', format($q$select dispensar_medicao(%L, %L, %L, 'Sem atuação no mês')$q$, :E1, :O2, :'MES_ANT'));
select teste.bloqueado('Dispensa: mês futuro', format($q$select dispensar_medicao(%L, %L, %L, 'Sem atuação no mês')$q$, :E1, :O1, (current_date + interval '2 months')::date));
select dispensar_medicao(:E1, :O1, :'MES_ANT', 'Sem atuação na obra em outubro') as "MD" \gset
select teste.bloqueado('Dispensa: não dispensa duas vezes', format($q$select dispensar_medicao(%L, %L, %L, 'Sem atuação no mês')$q$, :E1, :O1, :'MES_ANT'));
select teste.sair();
select teste.igual('Dispensa: medição criada aprovada, sem documentos e sem retenção', format($q$select 1 from v_medicoes v join medicoes m on m.id = v.id where v.id = %L and v.status = 'aprovada' and not v.retida and v.motivo_dispensa like 'Sem atuação%%' and m.criada_pela_dispensa and not exists (select 1 from medicoes_itens i where i.medicao_id = v.id)$q$, :'MD'), 1);
select teste.entrar(:F1);
select teste.igual('Dispensa: fornecedor vê a dispensa e o motivo', format($q$select 1 from v_medicoes where id = %L and dispensada_em is not null and motivo_dispensa is not null$q$, :'MD'), 1);
select teste.bloqueado('Dispensa: fornecedor não mexe na medição dispensada', format($q$select definir_colaborador_medicao(%L, %L, 'trabalhou')$q$, :'MD', :C1));
select teste.igual('Dispensa: abrir o mês devolve a dispensada', format($q$select 1 from abrir_medicao(%L, %L, %L) x where x.id = %L$q$, :E1, :O1, :'MES_ANT', :'MD'), 1);
select teste.sair();
select teste.entrar(:A);
select desfazer_dispensa_medicao(:'MD') as "R1" \gset
select teste.igual('Dispensa: desfazer apaga a criada pela dispensa', format($q$select 1 where %L = 'apagada'$q$, :'R1'), 1);
select dispensar_medicao(:E1, :O1, current_date, 'Obra parada no mês, sem equipe');
select teste.sair();
select teste.igual('Dispensa: medição já aberta fica aprovada', format($q$select 1 from medicoes where id = %L and status = 'aprovada' and status_antes_dispensa = 'aberta'$q$, teste.id('M1')), 1);
select teste.entrar(:A);
select desfazer_dispensa_medicao(teste.id('M1')) as "R2" \gset
select teste.igual('Dispensa: desfazer reabre como estava', format($q$select 1 where %L = 'reaberta'$q$, :'R2'), 1);
select teste.bloqueado('Dispensa: desfazer só em dispensada', format($q$select desfazer_dispensa_medicao(%L)$q$, teste.id('M1')));
select teste.sair();
select teste.igual('Dispensa: medição volta aberta, sem resto da dispensa, com registro', format($q$select 1 from medicoes m where m.id = %L and m.status = 'aberta' and m.dispensada_em is null and m.motivo_dispensa is null and (select count(*) from eventos e where e.acao in ('medicao_dispensada', 'dispensa_medicao_desfeita')) = 4 and not exists (select 1 from medicoes where id = %L)$q$, teste.id('M1'), :'MD'), 1);

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
-- Segurança da obra: checklists do TST e alojamentos do fornecedor
-- ============================================================================================
select teste.entrar(:F1);
select teste.igual('Segurança (controle): fornecedor vê o alojamento dele', 'select 1 from seg_alojamentos', 1);
select teste.igual('Segurança: fornecedor não lê a vistoria (só o resumo)', 'select 1 from seg_vistorias', 0);
select teste.igual('Segurança (controle): resumo do fornecedor traz o alojamento dele', $q$select 1 from jsonb_array_elements(seg_resumo_fornecedor(current_date - 90)->'alojamentos') a where a->>'nome' = 'CASA UM' and (a->>'pct')::numeric = 50$q$, 1);
select teste.igual('Segurança: resumo do fornecedor sem alojamento de outro', $q$select 1 from jsonb_array_elements(seg_resumo_fornecedor(current_date - 90)->'alojamentos') a where a->>'nome' <> 'CASA UM'$q$, 0);
select teste.igual('Segurança (controle): resumo do fornecedor traz o item a regularizar', $q$select 1 from jsonb_array_elements(seg_resumo_fornecedor(current_date - 90)->'acoes') a where a->>'descricao' is not null$q$, 1);
select teste.igual('Segurança (controle): resumo do fornecedor traz o item com mais "Não"', $q$select 1 from jsonb_array_elements(seg_resumo_fornecedor(current_date - 90)->'periodo'->'mais_nao') a where a->>'texto' = 'Chuveiro aterrado?'$q$, 1);
select teste.igual('Segurança: resumo do fornecedor sem lista de moradores e fotos', $q$select 1 where seg_resumo_fornecedor(current_date - 90)::text ~ '(funcionarios|envolvidos|vistoria/)'$q$, 0);
select teste.bloqueado('Segurança: fornecedor', $q$select seg_resumo_obra('10000000-0000-0000-0000-000000000001', current_date - 90)$q$);
select teste.igual('Segurança (controle): fornecedor vê a não conformidade dele', 'select 1 from seg_nao_conformidades', 1);
select teste.igual('Segurança: fornecedor não vê máquinas', 'select 1 from seg_maquinas', 0);
select teste.igual('Segurança: fornecedor não vê locadoras', 'select 1 from seg_locadoras', 0);
select teste.bloqueado('Segurança: fornecedor', $q$insert into seg_locadoras (nome) values ('INTRUSA')$q$);
select teste.igual('Segurança: fornecedor não vê termos', 'select 1 from seg_termos_alojamento', 0);
select teste.igual('Segurança: fornecedor não vê revisões de formulário', 'select 1 from seg_modelos_revisoes', 0);
select teste.bloqueado('Segurança: fornecedor', $q$select salvar_modelo_seg('alojamento', 'alojamento', 'Alojamento', '["X?"]', true, 'teste de invasão')$q$);
select teste.bloqueado('Segurança: fornecedor', $q$insert into seg_termos_alojamento (alojamento_id, colaborador_id, nome, representante_nome, assinatura, representante_assinatura) values ('a1000000-0000-0000-0000-000000000001', null, 'Fulano de Tal', 'Responsavel', 'termo/a1000000-0000-0000-0000-000000000001/a.png', 'termo/a1000000-0000-0000-0000-000000000001/b.png')$q$);
select teste.bloqueado('Segurança: fornecedor', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'termo/a1000000-0000-0000-0000-000000000001/x.png')$q$);
select teste.igual('Segurança: fornecedor não vê a foto da vistoria', $q$select 1 from storage.objects where bucket_id = 'seguranca'$q$, 0);
do $$
declare t text := 'Segurança: fornecedor';
begin
  perform teste.bloqueado(t, $q$insert into seg_alojamentos (obra_id, nome, empresa_id) values ('10000000-0000-0000-0000-000000000001', 'INTRUSO', '20000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$insert into seg_vistorias (modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values ('alojamento', '10000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', current_date, '[]')$q$);
  if teste.linhas($q$update seg_vistorias set pontuacao = 1, classificacao = 'Ótimo'$q$) > 0 then perform teste.falha(t, 'altera a nota da vistoria'); end if;
  if teste.linhas($q$update seg_nao_conformidades set situacao = 'regularizada'$q$) > 0 then perform teste.falha(t, 'marca a não conformidade como regularizada'); end if;
  perform teste.bloqueado(t, $q$select concluir_vistoria_seg('a3000000-0000-0000-0000-000000000003')$q$);
  perform teste.bloqueado(t, $q$select notificar_nao_conformidades('a3000000-0000-0000-0000-000000000001', null)$q$);
  perform teste.bloqueado(t, $q$select avaliar_nao_conformidade('$q$ || teste.id('NC1') || $q$', true, null)$q$);
  perform teste.bloqueado(t, $q$select fechar_ficha_maquina('a4000000-0000-0000-0000-000000000001', '{"operador_nome":"Fulano","tst_nome":"Ciclano"}')$q$);
  perform teste.bloqueado(t, $q$select colaboradores_ativos_empresa('20000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select seg_fornecedores_obra('10000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select abrir_ficha_maquina('a2000000-0000-0000-0000-000000000001', current_date)$q$);
  perform teste.bloqueado(t, $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 1, '{"statuses":["ok","ok"],"operador":"Fulano"}')$q$);
  perform teste.bloqueado(t, $q$select reabrir_vistoria_seg('a3000000-0000-0000-0000-000000000001', 'corrigir item')$q$);
  perform teste.bloqueado(t, $q$select responder_nao_conformidade('$q$ || teste.id('NC2') || $q$', 'Regularizado conforme pedido', '[]')$q$);
  perform teste.bloqueado(t, $q$select responder_nao_conformidade('$q$ || teste.id('NC1') || $q$', 'Regularizado conforme pedido', '["vistoria/a3000000-0000-0000-0000-000000000002/0/foto.jpg"]')$q$);
  perform teste.bloqueado(t, $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000003/0/x.jpg')$q$);
  perform teste.bloqueado(t, $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'nc/$q$ || teste.id('NC2') || $q$/x.jpg')$q$);
  perform teste.permitido('Segurança: fornecedor (controle)', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'nc/$q$ || teste.id('NC1') || $q$/x.jpg')$q$);
end $$;
-- Resposta de verdade (sem desfazer), para o TST avaliar em seguida.
select responder_nao_conformidade(teste.id('NC1'), 'Chuveiro aterrado pelo eletricista', jsonb_build_array('nc/' || teste.id('NC1') || '/x.jpg'));
select teste.bloqueado('Segurança: responder de novo', $q$select responder_nao_conformidade('$q$ || teste.id('NC1') || $q$', 'Outra resposta qualquer', '[]')$q$);

select teste.entrar(:T1);
select teste.igual('Segurança (controle): TST vê a obra dele', 'select 1 from seg_vistorias', 2);
do $$
declare t text := 'Segurança: TST fora da obra';
begin
  perform teste.bloqueado(t, $q$insert into seg_alojamentos (obra_id, nome) values ('10000000-0000-0000-0000-000000000002', 'INTRUSO')$q$);
  perform teste.bloqueado(t, $q$insert into seg_maquinas (obra_id, modelo_codigo, identificacao) values ('10000000-0000-0000-0000-000000000002', 'maquina:trator', 'X')$q$);
  perform teste.bloqueado(t, $q$insert into seg_vistorias (modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values ('alojamento', '10000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', current_date, '[]')$q$);
  perform teste.bloqueado(t, $q$insert into seg_vistorias (modelo_codigo, obra_id, alojamento_id, data_vistoria, itens) values ('alojamento', '10000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', current_date, '[]')$q$);
  perform teste.bloqueado(t, $q$select avaliar_nao_conformidade('$q$ || teste.id('NC2') || $q$', true, null)$q$);
  perform teste.bloqueado(t, $q$select fechar_ficha_maquina('a4000000-0000-0000-0000-000000000002', '{"operador_nome":"Fulano","tst_nome":"Ciclano"}')$q$);
  perform teste.bloqueado(t, $q$select colaboradores_ativos_empresa('20000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select seg_fornecedores_obra('10000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select abrir_ficha_maquina('a2000000-0000-0000-0000-000000000002', current_date)$q$);
  perform teste.bloqueado(t, $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000002', 1, '{"statuses":["ok","ok"],"operador":"Fulano"}')$q$);
  perform teste.bloqueado(t, $q$select reabrir_vistoria_seg('a3000000-0000-0000-0000-000000000002', 'corrigir item')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$select abrir_ficha_maquina('a2000000-0000-0000-0000-000000000001', current_date)$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 1, '{"statuses":["ok","nc"],"operador":"Fulano","fotos":["ficha/a4000000-0000-0000-0000-000000000001/01/a.jpg"]}')$q$);
  perform teste.bloqueado('Segurança: dia da ficha sem todas as respostas', $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 1, '{"statuses":["ok",null],"operador":"Fulano"}')$q$);
  perform teste.bloqueado('Segurança: foto de outra ficha', $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 1, '{"statuses":["ok","ok"],"operador":"Fulano","fotos":["ficha/a4000000-0000-0000-0000-000000000002/01/a.jpg"]}')$q$);
  perform teste.bloqueado('Segurança: dia que ainda não chegou', $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', extract(day from current_date)::int + 1, '{"statuses":["ok","ok"],"operador":"Fulano"}')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$select reabrir_vistoria_seg('a3000000-0000-0000-0000-000000000001', 'corrigir a recomendação')$q$);
  perform teste.igual('Segurança (controle): TST vê os fornecedores da obra dele', $q$select 1 from seg_fornecedores_obra('10000000-0000-0000-0000-000000000001') where id = '20000000-0000-0000-0000-000000000001'$q$, 1);
  perform teste.igual('Segurança: fornecedor de outra obra fora da lista', $q$select 1 from seg_fornecedores_obra('10000000-0000-0000-0000-000000000001') where id = '20000000-0000-0000-0000-000000000002'$q$, 0);
  perform teste.bloqueado(t, $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000002/0/x.jpg')$q$);
  if teste.linhas($q$update seg_vistorias set itens = '[]' where id = 'a3000000-0000-0000-0000-000000000001'$q$) > 0 then perform teste.falha('Segurança: vistoria concluída travada', 'TST altera vistoria concluída'); end if;
  perform teste.bloqueado('Segurança: concluir com item sem resposta', $q$select concluir_vistoria_seg('a3000000-0000-0000-0000-000000000003')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$select avaliar_nao_conformidade('$q$ || teste.id('NC1') || $q$', false, 'Falta a foto do aterramento')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$select colaboradores_ativos_empresa('20000000-0000-0000-0000-000000000001')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$select fechar_ficha_maquina('a4000000-0000-0000-0000-000000000001', '{"operador_nome":"Fulano","tst_nome":"Ciclano"}')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000003/0/x.jpg')$q$);
  -- Vínculo de máquina e alojamento: só fornecedor ativo na obra.
  perform teste.bloqueado('Segurança: vincular fornecedor de outra obra', $q$update seg_maquinas set empresa_id = '20000000-0000-0000-0000-000000000002' where id = 'a2000000-0000-0000-0000-000000000001'$q$);
  perform teste.bloqueado('Segurança: vincular fornecedor de outra obra', $q$update seg_alojamentos set empresa_id = '20000000-0000-0000-0000-000000000002' where id = 'a1000000-0000-0000-0000-000000000001'$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$insert into seg_locadoras (nome) values ('LOCADORA NOVA')$q$);
  perform teste.bloqueado('Segurança: TST não revisa formulário', $q$select salvar_modelo_seg('alojamento', 'alojamento', 'Alojamento', '["X?"]', true, 'teste de invasão')$q$);
  if teste.linhas($q$update seg_modelos set itens = '["X"]'$q$) > 0 then perform teste.falha('Segurança: formulário só muda pela revisão', 'TST altera seg_modelos direto'); end if;
  if teste.qtd('select 1 from seg_modelos_revisoes') = 0 then perform teste.falha('Segurança (controle): TST vê o histórico dos formulários', 'nenhuma revisão visível'); end if;
  perform teste.permitido('Segurança: TST (controle)', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'termo/a1000000-0000-0000-0000-000000000001/x.png')$q$);
  perform teste.bloqueado('Segurança: termo de alojamento de outra obra', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'termo/a1000000-0000-0000-0000-000000000002/x.png')$q$);
  perform teste.permitido('Segurança: TST (controle)', $q$insert into seg_termos_alojamento (alojamento_id, colaborador_id, nome, representante_nome, assinatura, representante_assinatura) values ('a1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Fulano de Tal', 'Responsavel', 'termo/a1000000-0000-0000-0000-000000000001/a.png', 'termo/a1000000-0000-0000-0000-000000000001/b.png')$q$);
  perform teste.bloqueado('Segurança: termo com assinatura de outro alojamento', $q$insert into seg_termos_alojamento (alojamento_id, colaborador_id, nome, representante_nome, assinatura, representante_assinatura) values ('a1000000-0000-0000-0000-000000000001', null, 'Fulano de Tal', 'Responsavel', 'termo/a1000000-0000-0000-0000-000000000002/a.png', 'termo/a1000000-0000-0000-0000-000000000002/b.png')$q$);
  perform teste.bloqueado('Segurança: termo com colaborador de outro fornecedor', $q$insert into seg_termos_alojamento (alojamento_id, colaborador_id, nome, representante_nome, assinatura, representante_assinatura) values ('a1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'Fulano de Tal', 'Responsavel', 'termo/a1000000-0000-0000-0000-000000000001/a.png', 'termo/a1000000-0000-0000-0000-000000000001/b.png')$q$);
  perform teste.bloqueado('Segurança: termo sem assinatura', $q$insert into seg_termos_alojamento (alojamento_id, nome, representante_nome) values ('a1000000-0000-0000-0000-000000000001', 'Fulano de Tal', 'Responsavel')$q$);
  perform teste.igual('Segurança (controle): TST vê as locadoras', 'select 1 from seg_locadoras', 1);
  perform teste.igual('Segurança (controle): resumo da obra para o TST', $q$select 1 where seg_resumo_obra('10000000-0000-0000-0000-000000000001', current_date - 90) ? 'acoes'$q$, 1);
  perform teste.bloqueado('Segurança: TST resumo de outra obra', $q$select seg_resumo_obra('10000000-0000-0000-0000-000000000002', current_date - 90)$q$);
end $$;
-- Vínculo de verdade: escolher a locadora tira a pendência da importação.
select teste.entrar(:T1);
update seg_maquinas set locadora_id = 'a5000000-0000-0000-0000-000000000001' where id = 'a2000000-0000-0000-0000-000000000001';
select teste.igual('Segurança: vínculo tira a pendência', $q$select 1 from seg_maquinas where empresa_a_vincular is not null$q$, 0);
select teste.igual('Segurança (controle): locadora gravada', $q$select 1 from seg_maquinas where locadora_id is not null$q$, 1);

select teste.entrar(:G1);
do $$
declare t text := 'Segurança: engenharia só vê o resumo';
begin
  perform teste.igual('Segurança: engenharia não lê as vistorias', 'select 1 from seg_vistorias', 0);
  perform teste.igual('Segurança: engenharia não lê alojamentos', 'select 1 from seg_alojamentos', 0);
  perform teste.igual('Segurança: engenharia não lê máquinas', 'select 1 from seg_maquinas', 0);
  perform teste.igual('Segurança: engenharia não lê fichas', 'select 1 from seg_fichas_maquina', 0);
  perform teste.igual('Segurança: engenharia não lê não conformidades', 'select 1 from seg_nao_conformidades', 0);
  perform teste.igual('Segurança: engenharia não lê termos', 'select 1 from seg_termos_alojamento', 0);
  perform teste.igual('Segurança: engenharia não lê revisões de formulário', 'select 1 from seg_modelos_revisoes', 0);
  perform teste.igual('Segurança: engenharia não vê fotos', $q$select 1 from storage.objects where bucket_id = 'seguranca'$q$, 0);
  perform teste.igual('Segurança (controle): resumo da obra para a engenharia', $q$select 1 where (seg_resumo_obra('10000000-0000-0000-0000-000000000001', current_date - 90)->'alojamento'->>'conformidade')::numeric = 50$q$, 1);
  perform teste.igual('Segurança (controle): resumo da obra traz a ação aberta', $q$select 1 from jsonb_array_elements(seg_resumo_obra('10000000-0000-0000-0000-000000000001', current_date - 90)->'acoes')$q$, 1);
  perform teste.igual('Segurança: resumo da obra sem moradores e fotos', $q$select 1 where seg_resumo_obra('10000000-0000-0000-0000-000000000001', current_date - 90)::text ~ '(funcionarios|envolvidos|vistoria/|nc/)'$q$, 0);
  perform teste.bloqueado(t, $q$select seg_resumo_obra('10000000-0000-0000-0000-000000000002', current_date - 90)$q$);
  perform teste.bloqueado(t, $q$select seg_resumo_fornecedor(current_date - 90)$q$);
  perform teste.bloqueado(t, $q$insert into seg_alojamentos (obra_id, nome) values ('10000000-0000-0000-0000-000000000001', 'NOVO')$q$);
  perform teste.bloqueado(t, $q$insert into seg_locadoras (nome) values ('NOVA')$q$);
  perform teste.igual('Segurança: engenharia não lê locadoras', 'select 1 from seg_locadoras', 0);
  perform teste.bloqueado(t, $q$select seg_fornecedores_obra('10000000-0000-0000-0000-000000000001')$q$);
  perform teste.bloqueado(t, $q$select seg_fornecedores_obra('10000000-0000-0000-0000-000000000002')$q$);
  perform teste.bloqueado(t, $q$select abrir_ficha_maquina('a2000000-0000-0000-0000-000000000001', current_date)$q$);
  perform teste.bloqueado(t, $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 1, '{"statuses":["ok","ok"],"operador":"Fulano"}')$q$);
  perform teste.bloqueado(t, $q$select reabrir_vistoria_seg('a3000000-0000-0000-0000-000000000001', 'corrigir item')$q$);
  if teste.linhas($q$update seg_maquinas set locadora_id = null$q$) > 0 then perform teste.falha(t, 'altera máquina'); end if;
  perform teste.bloqueado(t, $q$select concluir_vistoria_seg('a3000000-0000-0000-0000-000000000003')$q$);
  if teste.linhas($q$update seg_vistorias set horario = '8h'$q$) > 0 then perform teste.falha(t, 'altera vistoria'); end if;
end $$;
select teste.sair();

-- ============================================================================================
-- 5. Admin (controle): vê tudo e usa as funções do administrativo
-- ============================================================================================
select teste.entrar(:A);
select teste.igual('Admin (controle)', 'select 1 from colaboradores', 2);
select teste.igual('Admin (controle)', 'select 1 from v_documentos_atuais where id in (''60000000-0000-0000-0000-000000000001'', ''60000000-0000-0000-0000-000000000002'')', 2);
select teste.igual('Admin (controle)', $q$select 1 from storage.objects where bucket_id = 'documentos'$q$, 2);
select teste.permitido('Admin (controle)', $q$select acessos_ultimo_login()$q$);
select teste.permitido('Admin (controle)', $q$select salvar_modelo_seg('alojamento', null, 'Alojamento (NR-18)', '["Pergunta nova?", "Outra pergunta?"]', true, 'Revisão de teste')$q$);
select teste.permitido('Admin (controle)', $q$select salvar_modelo_seg(null, 'canteiro', 'Canteiro de obras', '["Área sinalizada?"]', true, 'Formulário novo')$q$);
select teste.bloqueado('Segurança: revisão sem mudança', $q$select salvar_modelo_seg(codigo, grupo, nome, itens, ativo, 'Sem mudança nenhuma') from seg_modelos where codigo = 'alojamento'$q$);
select teste.bloqueado('Segurança: perguntas repetidas', $q$select salvar_modelo_seg('alojamento', null, 'Alojamento', '["A?", "a?"]', true, 'Revisão repetida')$q$);
select teste.bloqueado('Segurança: revisão sem motivo', $q$select salvar_modelo_seg('alojamento', null, 'Alojamento', '["A?"]', true, '')$q$);
select teste.permitido('Admin (controle)', $q$select resolver_conversa('$q$ || teste.id('CV1') || $q$', true)$q$);

-- Encerramento de obra (admin): em encerramento a obra não recebe ninguém novo; encerrada, sai da gestão.
select teste.permitido('Admin (controle)', $q$select conferir_encerramento_obra('10000000-0000-0000-0000-000000000001')$q$);
select mudar_situacao_obra('10000000-0000-0000-0000-000000000001', 'iniciar', null, 'teste');
select teste.bloqueado('Obra em encerramento', $q$insert into alocacoes (colaborador_id, obra_id) values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$q$);
select teste.bloqueado('Obra em encerramento', $q$insert into empresas_obras (empresa_id, obra_id) values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$q$);
select teste.bloqueado('Obra em encerramento', $q$select criar_integracao('10000000-0000-0000-0000-000000000001', current_date, '8h', 'x', 'x', array['50000000-0000-0000-0000-000000000001']::uuid[])$q$);
select teste.bloqueado('Obra encerrada sem confirmar pendências', $q$select mudar_situacao_obra('10000000-0000-0000-0000-000000000001', 'concluir', current_date, 'teste de encerramento', false)$q$);
select mudar_situacao_obra('10000000-0000-0000-0000-000000000001', 'concluir', current_date, 'teste de encerramento', true);
select teste.sair();
select teste.igual('Obra encerrada: alocações abertas', $q$select 1 from alocacoes where obra_id = '10000000-0000-0000-0000-000000000001' and status <> 'encerrado'$q$, 0);
select teste.igual('Obra encerrada: empresas ativas', $q$select 1 from empresas_obras where obra_id = '10000000-0000-0000-0000-000000000001' and ativo$q$, 0);
select teste.entrar(:F1);
select teste.igual('Obra encerrada some do fornecedor', $q$select 1 from painel_obras() where id = '10000000-0000-0000-0000-000000000001'$q$, 0);
select teste.bloqueado('Obra encerrada', $q$select pedir_obra('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null)$q$);
select teste.entrar(:T1);
select teste.igual('Obra encerrada some do TST', $q$select 1 from painel_obras()$q$, 0);
select teste.sair();

-- ============================================================================================
-- "Ver como": a sessão aberta pelo master é somente leitura, para qualquer perfil.
-- ============================================================================================
select teste.sair();
insert into visualizacoes (sessao_id, master_id, alvo_id) values
  ('99000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  ('99000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
-- Controle: fora do "Ver como" o TST grava normalmente.
select teste.entrar(:T1);
select teste.permitido('Ver como (controle): TST grava fora da visualização', $q$insert into seg_locadoras (nome) values ('LOCADORA VER COMO')$q$);
select teste.permitido('Ver como (controle): TST usa a função fora da visualização', $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 2, '{"statuses":["ok","ok"],"operador":"Fulano","fotos":[]}')$q$);
select set_config('request.jwt.claims', json_build_object('sub', 'b0000000-0000-0000-0000-000000000001', 'role', 'authenticated', 'session_id', '99000000-0000-0000-0000-000000000001')::text, false);
select teste.permitido('Ver como: TST consulta', $q$select painel_obra('10000000-0000-0000-0000-000000000001')$q$);
select teste.bloqueado('Ver como: TST não grava tabela', $q$insert into seg_locadoras (nome) values ('LOCADORA VER COMO')$q$);
select teste.bloqueado('Ver como: TST não grava arquivo', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'vistoria/a3000000-0000-0000-0000-000000000003/0/vc.jpg')$q$);
select teste.bloqueado('Ver como: TST não usa função que grava', $q$select salvar_dia_ficha('a4000000-0000-0000-0000-000000000001', 2, '{"statuses":["ok","ok"],"operador":"Fulano","fotos":[]}')$q$);
select teste.igual('Ver como: TST não vê as visualizações', $q$select 1 from visualizacoes$q$, 0);
select teste.entrar(:F1);
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000001', 'role', 'authenticated', 'session_id', '99000000-0000-0000-0000-000000000002')::text, false);
select teste.bloqueado('Ver como: fornecedor não envia arquivo', $q$insert into storage.objects (bucket_id, name) values ('seguranca', 'nc/$q$ || teste.id('NC1') || $q$/vc.jpg')$q$);
select teste.bloqueado('Ver como: fornecedor não altera colaborador', $q$update colaboradores set nome = nome where empresa_id = '20000000-0000-0000-0000-000000000001'$q$);
select teste.igual('Ver como: fornecedor continua vendo os seus', $q$select 1 from colaboradores where empresa_id = '20000000-0000-0000-0000-000000000001' limit 1$q$, 1);
-- Master: ninguém se promove pela tela, nem o admin.
select teste.entrar(:A);
select teste.bloqueado('Master só pelo banco', $q$update usuarios set master = true where id = 'a0000000-0000-0000-0000-000000000001'$q$);
select teste.igual('Master vê as visualizações que abriu', $q$select 1 from visualizacoes$q$, 2);
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
