-- Segurança da obra: a quem pertence cada máquina e alojamento.
-- Máquina: de um terceiro da obra (empresa_id), de uma locadora de equipamentos (locadora_id) ou da Emais (os dois vazios).
-- Alojamento: de um terceiro da obra (empresa_id) ou da Emais.
-- Na importação do ObraCheck, a empresa que não bateu com o portal fica em empresa_a_vincular até o TST ou o
-- administrativo escolher o vínculo na tela.

create table public.seg_locadoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 1),
  cnpj text,
  telefone text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios (id) default auth.uid()
);
create unique index seg_locadoras_nome on public.seg_locadoras (lower(btrim(nome)));
alter table public.seg_locadoras enable row level security;

-- Locadora não é dado de fornecedor: a equipe da obra (admin, TST e engenharia) consulta; admin e TST cadastram.
create policy leitura on public.seg_locadoras for select to authenticated
  using (app.eh_admin() or exists (select 1 from app.minhas_obras_painel()));
create policy inserir on public.seg_locadoras for insert to authenticated
  with check (app.eh_admin() or exists (select 1 from app.minhas_obras_tst()));
create policy alterar on public.seg_locadoras for update to authenticated
  using (app.eh_admin() or exists (select 1 from app.minhas_obras_tst()))
  with check (app.eh_admin() or exists (select 1 from app.minhas_obras_tst()));
create policy excluir on public.seg_locadoras for delete to authenticated using (app.eh_admin());

alter table public.seg_maquinas
  add column locadora_id uuid references public.seg_locadoras (id),
  add column empresa_a_vincular text;
alter table public.seg_alojamentos
  add column empresa_a_vincular text;

-- O fornecedor escolhido precisa trabalhar na obra (senão ele passaria a ver vistorias de outra obra).
-- Escolhido o vínculo, a pendência da importação some.
create or replace function app.seg_antes_gravar_vinculo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is not null
     and (tg_op = 'INSERT' or new.empresa_id is distinct from old.empresa_id)
     and auth.uid() is not null and not app.eh_admin()
     and not exists (select 1 from public.empresas_obras eo where eo.empresa_id = new.empresa_id and eo.obra_id = new.obra_id and eo.ativo) then
    raise exception 'Este fornecedor não está ativo na obra';
  end if;
  if tg_op = 'UPDATE' and (new.empresa_id is not null
     or (tg_table_name = 'seg_maquinas' and (to_jsonb(new)->>'locadora_id') is not null)) then
    new.empresa_a_vincular := null;
  end if;
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, auth.uid());
  end if;
  return new;
end $$;
create trigger seg_maquinas_vinculo before insert or update on public.seg_maquinas
  for each row execute function app.seg_antes_gravar_vinculo();
create trigger seg_alojamentos_vinculo before insert or update on public.seg_alojamentos
  for each row execute function app.seg_antes_gravar_vinculo();
