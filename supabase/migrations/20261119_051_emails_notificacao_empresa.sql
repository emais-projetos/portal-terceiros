-- E-mails das notificações do fornecedor: o de acesso (login) e os "a mais" da empresa.
--
-- O login no portal continua sendo só o e-mail do acesso (empresas.email_acesso, mantido pelo gerenciar-acesso).
-- Os e-mails automáticos (medição, vencimentos, segunda-feira, conclusão da análise) vão para o e-mail do acesso E
-- para os e-mails a mais (empresas.email_contato, um ou vários separados por ponto e vírgula), sem repetir.
-- Antes ia só o "a mais" quando existia, e quem fazia login ficava sem o aviso.
-- salvar_emails_empresa: o administrativo edita os e-mails a mais depois do cadastro (Acessos > Editar acesso).

create or replace function app.emails_notificacao(p_acesso text, p_contato text) returns text
language plpgsql immutable as $$
declare
  item text;
  lista text[] := '{}';
begin
  foreach item in array regexp_split_to_array(lower(coalesce(p_acesso, '') || ' ' || coalesce(p_contato, '')), '[,;[:space:]]+') loop
    if item ~ '^[^@]+@[^@]+\.[^@]+$' and not item = any (lista) then lista := lista || item; end if;
  end loop;
  return nullif(array_to_string(lista, ', '), '');
end $$;
grant execute on function app.emails_notificacao(text, text) to authenticated;

-- Medição: e-mail de cobrança com os dois.
do $$
declare v text := pg_get_viewdef('public.v_medicoes'::regclass);
begin
  if strpos(v, 'COALESCE(e.email_contato, e.email_acesso)') = 0 then raise exception 'v_medicoes mudou: revise a troca do e-mail'; end if;
  execute 'create or replace view public.v_medicoes with (security_invoker = true) as '
    || replace(v, 'COALESCE(e.email_contato, e.email_acesso)', 'app.emails_notificacao(e.email_acesso, e.email_contato)');
end $$;

-- Conclusão da análise de documentos: Para com os dois (troca só a expressão do e-mail nas duas funções).
do $$
declare
  f text;
  antiga text := $x$nullif(btrim(coalesce(nullif(btrim(e.email_contato), ''), e.email_acesso, '')), '')$x$;
  nova text := 'app.emails_notificacao(e.email_acesso, e.email_contato)';
  nome text;
begin
  foreach nome in array array['app.montar_conclusao_analise(uuid,uuid[])', 'public.analises_para_concluir()'] loop
    f := pg_get_functiondef(nome::regprocedure);
    if strpos(f, antiga) = 0 then raise exception '% mudou: revise a troca do e-mail', nome; end if;
    execute replace(f, antiga, nova);
  end loop;
end $$;

create or replace function public.salvar_emails_empresa(p_empresa uuid, p_emails text) returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  item text;
  lista text[] := '{}';
  v_novo text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo altera os e-mails da empresa'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Empresa não encontrada'; end if;
  foreach item in array regexp_split_to_array(lower(btrim(coalesce(p_emails, ''))), '[,;[:space:]]+') loop
    if item = '' then continue; end if;
    if item !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'E-mail inválido: %', item using errcode = '22023'; end if;
    if not item = any (lista) then lista := lista || item; end if;
  end loop;
  if cardinality(lista) > 10 then raise exception 'Informe até 10 e-mails'; end if;
  v_novo := nullif(array_to_string(lista, '; '), '');
  update public.empresas set email_contato = v_novo where id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'emails_alterados', jsonb_build_object('de', e.email_contato, 'para', v_novo));
  return v_novo;
end $$;
revoke all on function public.salvar_emails_empresa(uuid, text) from public, anon;
grant execute on function public.salvar_emails_empresa(uuid, text) to authenticated;
