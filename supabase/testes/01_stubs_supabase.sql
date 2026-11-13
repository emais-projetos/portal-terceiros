-- Imitação mínima do Supabase para rodar as migrações num Postgres comum.
-- Perfis anon (sem login), authenticated (com login) e service_role (servidor), auth.uid(), armazenamento e realtime.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;
grant anon, authenticated, service_role to current_user;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz, created_at timestamptz default now());

-- Igual ao Supabase: o id de quem está logado vem do token (claim "sub").
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create publication supabase_realtime;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Privilégios que o Supabase concede por padrão em tudo o que é criado no schema public.
-- É o motivo de cada tabela precisar de RLS e de cada função de admin precisar checar o perfil.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
