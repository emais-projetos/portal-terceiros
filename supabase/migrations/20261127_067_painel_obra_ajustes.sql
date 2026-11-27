-- Correção: as migrações 065 e 066 reescreveram o painel_obra a partir da versão da 021 e perderam dois ajustes
-- feitos depois por troca de texto: o Suprimentos vendo todas as obras (055) e a medição dispensada (060).
-- Reaplica os dois. O teste por perfil passa a conferir os dois.
do $$
declare
  f text := pg_get_functiondef('public.painel_obra(uuid)'::regprocedure);
begin
  if strpos(f, 'app.eh_suprimentos()') > 0 then return; end if;
  if strpos(f, 'if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then') = 0 then
    raise exception 'painel_obra mudou: revise a troca do acesso';
  end if;
  execute replace(f, 'if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then',
                     'if not (app.eh_admin() or app.eh_suprimentos() or p_obra in (select app.minhas_obras_painel())) then');
end $$;

do $$
declare
  f text := pg_get_functiondef('public.painel_obra(uuid)'::regprocedure);
  antiga text := $x$'prazo_combinado', m.prazo_combinado, 'primeiro_envio_em'$x$;
begin
  if strpos(f, 'motivo_dispensa') > 0 then return; end if;
  if strpos(f, antiga) = 0 then raise exception 'painel_obra mudou: revise a inclusão da dispensa'; end if;
  execute replace(f, antiga, $x$'prazo_combinado', m.prazo_combinado, 'dispensada', m.dispensada_em is not null, 'motivo_dispensa', m.motivo_dispensa, 'primeiro_envio_em'$x$);
end $$;
