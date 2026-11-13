-- 1) Número do contrato de cada empresa em cada obra (o fornecedor informa).
-- 2) Pedido do fornecedor para atuar em outra obra; a Emais aprova ou recusa.
-- 3) Ajuda: chat entre quem usa o portal (fornecedor, TST, engenharia) e a Emais, com aviso por e-mail pelo n8n.

-- ---------------------------------------------------------------- 1) Contrato
alter table public.empresas_obras add column if not exists numero_contrato text;

create or replace function public.informar_contrato(p_empresa uuid, p_obra uuid, p_numero text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_antes text;
begin
  if not (app.eh_admin() or p_empresa in (select app.minhas_empresas())) then
    raise exception 'Sem permissão para esta empresa';
  end if;
  select numero_contrato into v_antes from public.empresas_obras where empresa_id = p_empresa and obra_id = p_obra and ativo;
  if not found then raise exception 'A empresa não atua nesta obra'; end if;
  update public.empresas_obras set numero_contrato = nullif(btrim(p_numero), '')
   where empresa_id = p_empresa and obra_id = p_obra;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('empresas_obras', p_empresa, 'contrato_informado',
          jsonb_build_object('obra_id', p_obra, 'de', v_antes, 'para', nullif(btrim(p_numero), '')), auth.uid());
end $$;
revoke execute on function public.informar_contrato(uuid, uuid, text) from anon, public;
grant execute on function public.informar_contrato(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- 3) Chat (antes do pedido, que escreve no chat)
-- Uma conversa por pessoa (como um chat de atendimento). Quem responde pela Emais é qualquer administrativo.
create table if not exists public.conversas (
  id                 uuid primary key default gen_random_uuid(),
  usuario_id         uuid not null unique references public.usuarios (id) on delete cascade,
  situacao           text not null default 'aberta' check (situacao in ('aberta', 'resolvida')),
  ultima_mensagem_em timestamptz,
  lida_emais_em      timestamptz,
  lida_usuario_em    timestamptz,
  criado_em          timestamptz not null default now()
);

create table if not exists public.mensagens (
  id               uuid primary key default gen_random_uuid(),
  conversa_id      uuid not null references public.conversas (id) on delete cascade,
  autor_id         uuid references public.usuarios (id),
  da_emais         boolean not null,
  automatica       boolean not null default false,
  texto            text not null check (length(btrim(texto)) between 1 and 4000),
  criado_em        timestamptz not null default now(),
  aviso_enviado_em timestamptz
);
create index if not exists mensagens_conversa on public.mensagens (conversa_id, criado_em);
create index if not exists mensagens_sem_aviso on public.mensagens (criado_em) where aviso_enviado_em is null;

alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;
drop policy if exists leitura on public.conversas;
create policy leitura on public.conversas for select to authenticated
  using ((select app.eh_admin()) or usuario_id = (select auth.uid()));
drop policy if exists leitura on public.mensagens;
create policy leitura on public.mensagens for select to authenticated
  using ((select app.eh_admin()) or conversa_id in (select c.id from public.conversas c where c.usuario_id = (select auth.uid())));
grant select on public.conversas, public.mensagens to authenticated;

-- Mensagem nova aparece na hora para quem está com o portal aberto.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'mensagens') then
    alter publication supabase_realtime add table public.mensagens;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversas') then
    alter publication supabase_realtime add table public.conversas;
  end if;
end $$;

-- Grava a mensagem (uso interno das funções abaixo).
create or replace function app.gravar_mensagem(p_conversa uuid, p_autor uuid, p_da_emais boolean, p_texto text, p_automatica boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.mensagens (conversa_id, autor_id, da_emais, automatica, texto)
  values (p_conversa, p_autor, p_da_emais, p_automatica, btrim(p_texto))
  returning id into v_id;
  update public.conversas
     set ultima_mensagem_em = now(),
         situacao = 'aberta',
         lida_emais_em = case when p_da_emais and not p_automatica then now() else lida_emais_em end,
         lida_usuario_em = case when not p_da_emais then now() else lida_usuario_em end
   where id = p_conversa;
  return v_id;
end $$;

create or replace function app.conversa_do_usuario(p_usuario uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from public.conversas where usuario_id = p_usuario;
  if v_id is null then
    insert into public.conversas (usuario_id) values (p_usuario)
    on conflict (usuario_id) do update set usuario_id = excluded.usuario_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Quem usa o portal escreve na própria conversa; o administrativo responde na conversa escolhida.
create or replace function public.enviar_mensagem(p_texto text, p_conversa uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_perfil text;
  v_conversa uuid;
begin
  select perfil::text into v_perfil from public.usuarios where id = auth.uid() and ativo;
  if v_perfil is null then raise exception 'Faça login para continuar'; end if;
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva a mensagem'; end if;
  if length(p_texto) > 4000 then raise exception 'Mensagem muito longa (até 4.000 caracteres)'; end if;
  if v_perfil = 'admin' then
    if p_conversa is null then raise exception 'Escolha a conversa'; end if;
    return app.gravar_mensagem(p_conversa, auth.uid(), true, p_texto);
  end if;
  v_conversa := app.conversa_do_usuario(auth.uid());
  return app.gravar_mensagem(v_conversa, auth.uid(), false, p_texto);
end $$;
revoke execute on function public.enviar_mensagem(text, uuid) from anon, public;
grant execute on function public.enviar_mensagem(text, uuid) to authenticated;

create or replace function public.marcar_conversa_lida(p_conversa uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app.eh_admin() and p_conversa is not null then
    update public.conversas set lida_emais_em = now() where id = p_conversa;
  else
    update public.conversas set lida_usuario_em = now() where usuario_id = auth.uid();
  end if;
end $$;
revoke execute on function public.marcar_conversa_lida(uuid) from anon, public;
grant execute on function public.marcar_conversa_lida(uuid) to authenticated;

create or replace function public.resolver_conversa(p_conversa uuid, p_resolvida boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo'; end if;
  update public.conversas set situacao = case when p_resolvida then 'resolvida' else 'aberta' end, lida_emais_em = now() where id = p_conversa;
end $$;
revoke execute on function public.resolver_conversa(uuid, boolean) from anon, public;
grant execute on function public.resolver_conversa(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 2) Pedido de outra obra
create table if not exists public.pedidos_obra (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas (id) on delete cascade,
  obra_id         uuid not null references public.obras (id),
  numero_contrato text,
  observacao      text,
  situacao        text not null default 'pendente' check (situacao in ('pendente', 'aprovado', 'recusado')),
  pedido_por      uuid references public.usuarios (id),
  pedido_em       timestamptz not null default now(),
  analisado_por   uuid references public.usuarios (id),
  analisado_em    timestamptz,
  motivo_recusa   text
);
create unique index if not exists pedidos_obra_pendente on public.pedidos_obra (empresa_id, obra_id) where situacao = 'pendente';

alter table public.pedidos_obra enable row level security;
drop policy if exists leitura on public.pedidos_obra;
create policy leitura on public.pedidos_obra for select to authenticated
  using ((select app.eh_admin()) or empresa_id in (select app.minhas_empresas()));
grant select on public.pedidos_obra to authenticated;

create or replace function public.pedir_obra(p_empresa uuid, p_obra uuid, p_contrato text, p_observacao text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_empresa text;
  v_obra text;
begin
  if p_empresa not in (select app.minhas_empresas()) then raise exception 'Sem permissão para esta empresa'; end if;
  select nome into v_obra from public.obras where id = p_obra and ativa;
  if v_obra is null then raise exception 'Obra não encontrada'; end if;
  if exists (select 1 from public.empresas_obras where empresa_id = p_empresa and obra_id = p_obra and ativo) then
    raise exception 'A empresa já atua nesta obra';
  end if;
  if exists (select 1 from public.pedidos_obra where empresa_id = p_empresa and obra_id = p_obra and situacao = 'pendente') then
    raise exception 'Já existe um pedido para esta obra aguardando a Emais';
  end if;
  insert into public.pedidos_obra (empresa_id, obra_id, numero_contrato, observacao, pedido_por)
  values (p_empresa, p_obra, nullif(btrim(p_contrato), ''), nullif(btrim(p_observacao), ''), auth.uid())
  returning id into v_id;
  select razao_social into v_empresa from public.empresas where id = p_empresa;
  -- O pedido aparece no chat da pessoa, e a Emais recebe o aviso como uma mensagem.
  perform app.gravar_mensagem(app.conversa_do_usuario(auth.uid()), auth.uid(), false,
    format('Pedido de acesso à obra %s para a %s.%s%s', v_obra, v_empresa,
           case when nullif(btrim(p_contrato), '') is not null then format(' Contrato: %s.', btrim(p_contrato)) else '' end,
           case when nullif(btrim(p_observacao), '') is not null then format(' Observação: %s', btrim(p_observacao)) else '' end),
    true);
  return v_id;
end $$;
revoke execute on function public.pedir_obra(uuid, uuid, text, text) from anon, public;
grant execute on function public.pedir_obra(uuid, uuid, text, text) to authenticated;

create or replace function public.responder_pedido_obra(p_pedido uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.pedidos_obra;
  v_obra text;
  v_empresa text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo'; end if;
  select * into p from public.pedidos_obra where id = p_pedido for update;
  if not found or p.situacao <> 'pendente' then raise exception 'Pedido já respondido'; end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da recusa'; end if;

  update public.pedidos_obra
     set situacao = case when p_aprovar then 'aprovado' else 'recusado' end,
         analisado_por = auth.uid(), analisado_em = now(), motivo_recusa = case when p_aprovar then null else btrim(p_motivo) end
   where id = p_pedido;

  if p_aprovar then
    insert into public.empresas_obras (empresa_id, obra_id, ativo, numero_contrato)
    values (p.empresa_id, p.obra_id, true, p.numero_contrato)
    on conflict (empresa_id, obra_id) do update set ativo = true, numero_contrato = coalesce(excluded.numero_contrato, public.empresas_obras.numero_contrato);
  end if;

  select nome into v_obra from public.obras where id = p.obra_id;
  select razao_social into v_empresa from public.empresas where id = p.empresa_id;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('pedidos_obra', p_pedido, case when p_aprovar then 'pedido_obra_aprovado' else 'pedido_obra_recusado' end,
          jsonb_build_object('empresa_id', p.empresa_id, 'obra_id', p.obra_id, 'motivo', p_motivo), auth.uid());

  if p.pedido_por is not null then
    perform app.gravar_mensagem(app.conversa_do_usuario(p.pedido_por), auth.uid(), true,
      case when p_aprovar
        then format('Pedido aprovado: a %s já pode cadastrar colaboradores na obra %s.', v_empresa, v_obra)
        else format('Pedido de acesso à obra %s não aprovado. Motivo: %s', v_obra, btrim(p_motivo)) end,
      true);
  end if;
end $$;
revoke execute on function public.responder_pedido_obra(uuid, boolean, text) from anon, public;
grant execute on function public.responder_pedido_obra(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------- Avisos por e-mail (n8n)
insert into public.parametros (chave, valor, descricao, rotulo, grupo, tipo, minimo, maximo, unidade, ordem) values
  ('ajuda_email_emais', 'gente10@emais.com',
   'Recebe o aviso quando alguém escreve na Ajuda e ninguém da Emais leu em alguns minutos.',
   'E-mail que recebe as mensagens da Ajuda', 'Ajuda', 'email', null, null, null, 10),
  ('ajuda_minutos_aviso', '10',
   'Tempo sem leitura para a mensagem virar e-mail (para a Emais ou para quem perguntou). O envio automático passa a cada 10 minutos, nos dias úteis.',
   'Aviso por e-mail depois de', 'Ajuda', 'inteiro', 5, 240, 'minutos', 20)
on conflict (chave) do nothing;

insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('ajuda_para_emais', 'Ajuda: mensagem para a Emais', 'Quando alguém escreve na Ajuda e ninguém da Emais lê no tempo definido em Regras', 'E-mail da Ajuda (Regras)', 120,
 array['{nome}', '{de_onde}', '{mensagens}', '{link}'],
 'Texto inicial',
 'Ajuda do portal: mensagem de {nome}',
 E'{nome} ({de_onde}) escreveu na Ajuda do Portal de Terceiros:\n\n{mensagens}\n\nPara responder, abra o portal em Atendimento:\n{link}'),
('ajuda_resposta', 'Ajuda: resposta para quem perguntou', 'Quando a Emais responde na Ajuda e a pessoa não lê no tempo definido em Regras', 'Quem perguntou', 130,
 array['{primeiro_nome}', '{mensagens}', '{link}', '{assinatura}'],
 'Texto inicial',
 'Resposta da Emais no Portal de Terceiros',
 E'Olá, {primeiro_nome},\n\nA Emais respondeu a sua mensagem no Portal de Terceiros:\n\n{mensagens}\n\nPara continuar a conversa, entre no portal e clique em Ajuda:\n{link}\n\nAtenciosamente,\n{assinatura}')
on conflict (tipo) do nothing;
