-- Regras de segurança da estrutura do banco. Só lê: pode rodar no banco de teste e no Supabase de produção.
-- Cada linha devolvida é um problema. Nenhuma linha = tudo certo.
with
-- Tabelas de consulta que qualquer pessoa logada pode ler inteiras (não têm dado de fornecedor nem de colaborador).
tabelas_de_consulta(nome) as (values
  ('funcoes'), ('funcoes_documentos'), ('modelos_documento'), ('obras'), ('parametros'), ('tipos_documento'), ('tipos_medicao')
),
-- Funções que o site chama e que já estão cobertas pelo teste por perfil (03_testar_perfis.sql).
-- Função nova no schema public precisa ser revisada e entrar aqui e no teste.
funcoes_revisadas(nome) as (values
  ('abrir_medicao'), ('acessos_ultimo_login'), ('alterar_tipo_documento'), ('aprovar_alocacao'), ('aprovar_documento'),
  ('avaliar_item_medicao'), ('bloquear_colaborador'), ('cadastrar_subcontratada'), ('cancelar_integracao'),
  ('combinar_prazo_medicao'), ('concluir_conferencia_medicao'), ('concluir_integracao'), ('conferir_colaborador_medicao'),
  ('corrigir_colaborador'), ('criar_integracao'), ('definir_colaborador_medicao'), ('desligar_colaborador'),
  ('devolver_alocacao_tst'), ('devolver_documento'), ('enviar_aviso_liberacao'), ('enviar_documento'),
  ('enviar_item_medicao'), ('enviar_medicao'), ('enviar_mensagem'), ('enviar_para_analise'), ('gerar_aviso_liberacao'),
  ('incluir_documento_colaborador'), ('informar_contrato'), ('marcar_conversa_lida'), ('painel_obra'), ('painel_obras'),
  ('pedir_obra'), ('reenviar_aviso_liberacao'), ('registrar_cobranca_medicao'), ('registrar_download'),
  ('registrar_download_medicao'), ('registrar_integracao'), ('remover_colaborador_medicao'), ('resolver_conversa'),
  ('responder_pedido_obra'), ('validar_alocacao_tst')
),
problemas(regra, objeto) as (
  -- 1. Toda tabela precisa de regra de acesso (RLS) ligada.
  select 'Tabela sem regra de acesso (RLS)', c.relname::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity

  -- 2. Toda view precisa respeitar a regra de acesso de quem consulta (foi o erro de 13/11).
  union all
  select 'View que ignora a regra de acesso (falta security_invoker)', c.relname::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)

  -- 3. Nenhuma função que roda com poder total pode ser chamada sem login.
  union all
  select 'Função com poder total que roda sem login', p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')

  -- 4. Função com poder total precisa de search_path fixo (evita que alguém troque uma tabela por outra).
  union all
  select 'Função com poder total sem search_path fixo', n.nspname || '.' || p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')

  -- 5. Nenhuma regra de acesso pode valer para quem não fez login.
  union all
  select 'Regra de acesso liberada sem login', schemaname || '.' || tablename || ' / ' || policyname
  from pg_policies
  where schemaname in ('public', 'storage') and roles && array['anon', 'public']::name[]
    and not (schemaname = 'storage' and tablename <> 'objects')

  -- 6. Regra que libera a tabela inteira ("true") só nas tabelas de consulta, e só para leitura.
  union all
  select 'Regra de acesso que libera a tabela inteira', schemaname || '.' || tablename || ' / ' || policyname || ' (' || cmd || ')'
  from pg_policies
  where schemaname in ('public', 'storage')
    and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')
    and not (schemaname = 'public' and cmd = 'SELECT' and tablename in (select nome from tabelas_de_consulta))

  -- 7. Pasta de arquivos pública deixa qualquer pessoa baixar com o link.
  union all
  select 'Pasta de arquivos pública', id from storage.buckets where public

  -- 8. Função nova precisa entrar no teste por perfil.
  union all
  select 'Função nova sem teste por perfil (revisar e incluir no 03_testar_perfis.sql)', p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and p.proname not in (select nome from funcoes_revisadas)
)
select regra || ': ' || objeto from problemas order by 1;
