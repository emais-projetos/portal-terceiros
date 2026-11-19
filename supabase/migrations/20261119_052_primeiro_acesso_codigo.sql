-- Primeiro acesso e troca de senha por código no e-mail (igual ao Portal de Treinamentos).
--
-- A pessoa clica em "Primeiro acesso ou esqueci a senha" na entrada do portal e digita o e-mail de acesso.
-- A função enviar-codigo (Supabase) gera o código e chama na hora o fluxo "Portal de Terceiros - Código de acesso"
-- do n8n, que manda o e-mail. A pessoa digita o código e cria a senha. No go-live basta um e-mail geral com as
-- orientações: ninguém precisa receber convite individual.
--
-- codigos_acesso_envios: controle de frequência (um código por minuto e até 5 por hora para cada e-mail).
-- Só a função do servidor lê e grava. O código em si não fica guardado aqui nem no registro de envios.

create table if not exists public.codigos_acesso_envios (
  email          text primary key,
  ultimo_em      timestamptz not null default now(),
  janela_inicio  timestamptz not null default now(),
  qtd_na_janela  integer not null default 1
);
alter table public.codigos_acesso_envios enable row level security;
revoke all on public.codigos_acesso_envios from public, anon, authenticated;

-- Texto do e-mail (Acessos > E-mails, com revisões). O código sempre vai, mesmo se sair do texto.
insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('codigo_acesso', 'Código de acesso', 'Quando a pessoa clica em Primeiro acesso ou esqueci a senha na entrada do portal. Sai na hora, pelo n8n, mesmo com o envio automático pausado', 'Quem pediu o código (o e-mail de acesso)', 105,
 array['{primeiro_nome}', '{codigo}', '{email}', '{endereco_portal}', '{assinatura}'],
 'Texto inicial',
 'Seu código de acesso ao Portal de Terceiros da Emais',
 E'Olá, {primeiro_nome},\n\nSeu código de acesso ao Portal de Terceiros do Grupo Emais é:\n\n{codigo}\n\nDigite o código na tela do portal para criar a sua senha. Ele vale por pouco tempo e só pode ser usado uma vez. Se vencer, peça outro na mesma tela.\n\nSe você não pediu este código, ignore este e-mail. Sua senha continua a mesma.\n\nDepois, entre sempre por {endereco_portal} com o e-mail {email}.\n\nAtenciosamente,\n{assinatura}')
on conflict (tipo) do nothing;
