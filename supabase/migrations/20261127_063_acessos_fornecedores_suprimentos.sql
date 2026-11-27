-- Acessos dos fornecedores pelo Suprimentos: a mesma lista do administrativo (Acessos > Usuários), só com o perfil
-- fornecedor. Um acesso pode gerenciar várias empresas; cada empresa continua com um único acesso.
-- Criar, editar, enviar o convite e desativar passam pela função gerenciar-acesso, que confere o perfil.

create or replace function public.acessos_fornecedores() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos e o administrativo'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'nome', u.nome, 'email', u.email, 'perfil', u.perfil, 'ativo', u.ativo, 'criado_em', u.criado_em,
      'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'razao_social', e.razao_social) order by e.razao_social)
                            from public.usuarios_empresas ue join public.empresas e on e.id = ue.empresa_id where ue.usuario_id = u.id), '[]'::jsonb),
      'obras', '[]'::jsonb,
      'ultimo_login', (select a.last_sign_in_at from auth.users a where a.id = u.id),
      'convite', (select to_jsonb(c) from (
                    select c.id, c.usuario_id, c.tipo, c.para, c.pedido_em, c.situacao_envio, c.enviado_em, c.envio_erro, c.envio_teste, c.envio_para, c.expira_em, c.usado_em
                    from public.convites_acesso c where c.usuario_id = u.id and c.situacao_envio <> 'cancelado'
                    order by c.pedido_em desc limit 1) c)
    ) order by u.nome)
    from public.usuarios u where u.perfil = 'fornecedor'
  ), '[]'::jsonb);
end $$;
revoke all on function public.acessos_fornecedores() from public, anon;
grant execute on function public.acessos_fornecedores() to authenticated;
