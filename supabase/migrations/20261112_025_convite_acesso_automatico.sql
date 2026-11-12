-- Convite de acesso pelo envio automático: o administrativo clica em "Enviar acesso" e o n8n manda o e-mail.
--
-- O e-mail leva um link do próprio portal (/acesso?c=...), que vale pelos dias definidos em Acessos > Regras.
-- Só quando a pessoa abre esse link e clica em "Criar minha senha" o portal gera o link do Supabase
-- (que vence em pouco tempo) e a leva direto para a tela de criar a senha. Assim o convite não vence
-- antes de ser aberto e o antivírus do e-mail, que costuma "abrir" os links, não gasta o convite.
--
-- O pedido entra na fila (situacao_envio = aguardando); o n8n busca junto com os avisos de liberação,
-- a cada 10 minutos, envia e registra. O modo de teste e a pausa do envio automático valem também aqui.
-- O código do convite não fica guardado: só o resumo (hash), gerado na hora em que o n8n busca o e-mail.

create table if not exists public.convites_acesso (
  id                 uuid primary key default gen_random_uuid(),
  usuario_id         uuid not null references public.usuarios (id) on delete cascade,
  tipo               text not null check (tipo in ('primeiro_acesso', 'nova_senha')),
  para               text not null,
  pedido_por         uuid references public.usuarios (id),
  pedido_em          timestamptz not null default now(),
  situacao_envio     text not null default 'aguardando' check (situacao_envio in ('aguardando', 'enviando', 'enviado', 'erro', 'cancelado')),
  envio_iniciado_em  timestamptz,
  enviado_em         timestamptz,
  envio_erro         text,
  envio_teste        boolean not null default false,
  envio_para         text,
  token_hash         text unique,
  expira_em          timestamptz,
  usado_em           timestamptz,
  substituido_em     timestamptz
);
create index if not exists convites_acesso_fila on public.convites_acesso (pedido_em) where situacao_envio in ('aguardando', 'enviando');
create index if not exists convites_acesso_usuario on public.convites_acesso (usuario_id, pedido_em desc);

alter table public.convites_acesso enable row level security;
drop policy if exists admin on public.convites_acesso;
create policy admin on public.convites_acesso for select to authenticated using ((select app.eh_admin()));
grant select on public.convites_acesso to authenticated;

-- Último login de cada acesso, para a lista mostrar quem nunca entrou.
create or replace function public.acessos_ultimo_login()
returns table (usuario_id uuid, ultimo_login timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo'; end if;
  return query select u.id, a.last_sign_in_at from public.usuarios u join auth.users a on a.id = u.id;
end $$;
revoke execute on function public.acessos_ultimo_login() from anon, public;
grant execute on function public.acessos_ultimo_login() to authenticated;

-- Validade do convite (Acessos > Regras).
insert into public.parametros (chave, valor, descricao, rotulo, grupo, tipo, minimo, maximo, unidade, ordem) values
  ('convite_validade_dias', '7',
   'Por quantos dias o link do e-mail de acesso (primeiro acesso ou nova senha) funciona. Depois disso, é preciso enviar outro pelo botão Enviar acesso.',
   'Validade do link de acesso', 'Acesso ao portal', 'inteiro', 1, 30, 'dias', 10)
on conflict (chave) do nothing;

-- Textos (Acessos > E-mails, com revisões).
insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('convite_acesso', 'Convite de primeiro acesso', 'Quando o administrativo cria o acesso ou clica em Enviar acesso para quem ainda não entrou no portal', 'Quem recebe o acesso', 100,
 array['{nome}', '{primeiro_nome}', '{motivo}', '{link}', '{validade}', '{email}', '{endereco_portal}', '{assinatura}'],
 'Texto inicial (o mesmo do convite pelo Outlook)',
 'Seu acesso ao Portal de Terceiros da Emais',
 E'Olá, {primeiro_nome},\n\nSeu acesso ao Portal de Terceiros do Grupo Emais foi criado. {motivo}\n\nPara criar sua senha, abra o link abaixo e clique em Criar minha senha. O link vale por {validade} e só pode ser usado uma vez. Se ele não funcionar, responda este e-mail que mandamos outro.\n\n{link}\n\nDepois, entre sempre por {endereco_portal} com o e-mail {email}.\n\nAtenciosamente,\n{assinatura}'),
('nova_senha_acesso', 'Link de nova senha', 'Quando o administrativo clica em Enviar acesso para quem já entrou no portal alguma vez', 'Quem recebe o acesso', 110,
 array['{nome}', '{primeiro_nome}', '{link}', '{validade}', '{email}', '{endereco_portal}', '{assinatura}'],
 'Texto inicial (o mesmo do link pelo Outlook)',
 'Nova senha do Portal de Terceiros da Emais',
 E'Olá, {primeiro_nome},\n\nSegue o link para criar uma nova senha no Portal de Terceiros do Grupo Emais. Abra o link e clique em Criar nova senha. Ele vale por {validade} e só pode ser usado uma vez.\n\n{link}\n\nDepois, entre por {endereco_portal} com o e-mail {email}.\n\nAtenciosamente,\n{assinatura}')
on conflict (tipo) do nothing;
