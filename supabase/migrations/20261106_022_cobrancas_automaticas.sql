-- Cobranças e avisos enviados automaticamente pelo n8n.
--
-- As regras continuam as do portal (calendário da medição, vencimentos e integração). Uma função do
-- Supabase (cobrancas-automaticas) monta os e-mails do dia e o n8n só envia. Cada tentativa fica em
-- cobrancas_envios (enviada ou com erro), que alimenta a aba de notificações enviadas. Quando o envio
-- dá certo, a cobrança entra em cobrancas como "enviada" e não volta mais, como hoje acontece quando
-- alguém abre no Outlook.
--
-- Parâmetros (tabela parametros), para testar antes de ligar para todos:
--   cobranca_automatica_empresas : CNPJs liberados para envio automático, separados por vírgula, ou "todas".
--                                  Vazio = ninguém recebe.
--   cobranca_automatica_teste_para: se preenchido, todos os e-mails vão para este endereço, com o
--                                  destinatário real no assunto, e nada é marcado como cobrado.
--   cobranca_automatica_pausada   : "sim" suspende os envios sem mexer no n8n.

alter table public.cobrancas drop constraint if exists cobrancas_situacao_check;
alter table public.cobrancas add constraint cobrancas_situacao_check
  check (situacao in ('aberta_no_outlook', 'dispensada', 'enviada'));
alter table public.cobrancas add column if not exists corpo text;
alter table public.cobrancas add column if not exists canal text not null default 'portal';
comment on column public.cobrancas.canal is 'portal (aberta no Outlook ou dispensada por alguém), n8n (envio automático) ou carga (fila marcada como cobrada ao ligar a automação).';

create table if not exists public.cobrancas_envios (
  id            bigint generated always as identity primary key,
  chave         text not null,
  tipo          text not null,
  titulo        text,
  empresa_ids   uuid[] not null default '{}',
  obra_id       uuid references public.obras (id),
  para          text,
  para_original text,
  assunto       text,
  corpo         text,
  situacao      text not null check (situacao in ('enviada', 'erro')),
  erro          text,
  teste         boolean not null default false,
  enviado_em    timestamptz not null default now()
);
create index if not exists cobrancas_envios_data on public.cobrancas_envios (enviado_em desc);
create index if not exists cobrancas_envios_empresas on public.cobrancas_envios using gin (empresa_ids);
alter table public.cobrancas_envios enable row level security;
drop policy if exists admin on public.cobrancas_envios;
create policy admin on public.cobrancas_envios for select to authenticated using ((select app.eh_admin()));
grant select on public.cobrancas_envios to authenticated;

insert into public.parametros (chave, valor, descricao) values
  ('cobranca_automatica_empresas', '', 'CNPJs liberados para o envio automático das cobranças, separados por vírgula, ou "todas". Vazio: ninguém recebe.'),
  ('cobranca_automatica_teste_para', '', 'Se preenchido, todos os e-mails automáticos vão para este endereço (teste), com o destinatário real no assunto.'),
  ('cobranca_automatica_pausada', 'nao', 'sim: suspende o envio automático das cobranças.')
on conflict (chave) do nothing;
