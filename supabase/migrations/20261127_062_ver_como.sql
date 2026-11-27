-- "Ver como": o administrativo master abre o portal como outro usuário para conferir o que ele vê.
-- A sessão aberta para isso fica registrada em visualizacoes e é sempre somente leitura:
-- toda gravação no banco (tabelas e arquivos) feita por ela é recusada, mesmo depois de encerrada.
-- A função ver-como (edge function) abre e encerra essas sessões; o site só mostra a faixa e o botão de voltar.

alter table public.usuarios add column if not exists master boolean not null default false;
alter table public.usuarios drop constraint if exists usuarios_master_admin;
alter table public.usuarios add constraint usuarios_master_admin check (not master or perfil = 'admin');

-- Só se vira master direto no banco (SQL ou função com chave de serviço), nunca pela tela de acessos.
create or replace function app.proteger_master() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.master is distinct from (case when tg_op = 'INSERT' then false else old.master end) then
    raise exception 'O acesso master só é alterado pela equipe do portal';
  end if;
  return new;
end $$;
drop trigger if exists usuarios_proteger_master on public.usuarios;
create trigger usuarios_proteger_master before insert or update on public.usuarios
  for each row execute function app.proteger_master();

create table if not exists public.visualizacoes (
  id            uuid primary key default gen_random_uuid(),
  sessao_id     uuid not null unique,
  master_id     uuid not null references public.usuarios (id),
  alvo_id       uuid not null references public.usuarios (id),
  iniciada_em   timestamptz not null default now(),
  encerrada_em  timestamptz
);
alter table public.visualizacoes enable row level security;
drop policy if exists "master le as suas" on public.visualizacoes;
create policy "master le as suas" on public.visualizacoes for select to authenticated using (master_id = (select auth.uid()));
grant select on public.visualizacoes to authenticated;

-- A sessão atual foi aberta pelo "Ver como"? (o Supabase põe o id da sessão no token)
create or replace function app.em_visualizacao() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
begin
  if s is null or s !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return exists (select 1 from public.visualizacoes v where v.sessao_id = s::uuid);
end $$;
grant execute on function app.em_visualizacao() to authenticated;

create or replace function app.bloquear_visualizacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.em_visualizacao() then
    raise exception 'Modo visualização: nada é gravado' using errcode = '42501';
  end if;
  return null;
end $$;

-- Uma trava por comando em todas as tabelas (o teste de estrutura confere que nenhuma tabela nova fica sem).
create or replace function app.travar_visualizacao_em_tudo() returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'visualizacoes'
      and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'zz_bloquear_visualizacao')
  loop
    execute format('create trigger zz_bloquear_visualizacao before insert or update or delete on public.%I for each statement execute function app.bloquear_visualizacao()', t.relname);
  end loop;
end $$;
revoke all on function app.travar_visualizacao_em_tudo() from public, anon, authenticated;
select app.travar_visualizacao_em_tudo();

-- Arquivos: a sessão do "Ver como" não envia, troca nem apaga.
drop policy if exists "visualizacao nao envia arquivos" on storage.objects;
drop policy if exists "visualizacao nao altera arquivos" on storage.objects;
drop policy if exists "visualizacao nao apaga arquivos" on storage.objects;
create policy "visualizacao nao envia arquivos" on storage.objects as restrictive for insert to authenticated with check (not app.em_visualizacao());
create policy "visualizacao nao altera arquivos" on storage.objects as restrictive for update to authenticated using (not app.em_visualizacao());
create policy "visualizacao nao apaga arquivos" on storage.objects as restrictive for delete to authenticated using (not app.em_visualizacao());
