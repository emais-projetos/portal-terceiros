-- A migração 026 recriou a view sem security_invoker: ela passou a ignorar as regras de acesso (RLS).
-- Corrigido no mesmo dia; os registros de acesso mostram que só o próprio fornecedor consultou os seus documentos nesse intervalo.
alter view public.v_documentos_atuais set (security_invoker = true);

-- Funções só do administrativo: ninguém sem login executa.
revoke execute on function public.aprovar_documento(uuid, date) from anon, public;
revoke execute on function public.enviar_aviso_liberacao(uuid, uuid[], text) from anon, public;
revoke execute on function public.reenviar_aviso_liberacao(uuid) from anon, public;
grant execute on function public.aprovar_documento(uuid, date) to authenticated;
grant execute on function public.enviar_aviso_liberacao(uuid, uuid[], text) to authenticated;
grant execute on function public.reenviar_aviso_liberacao(uuid) to authenticated;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname in ('validar_destinatarios', 'validar_parametro_ajuda') loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
