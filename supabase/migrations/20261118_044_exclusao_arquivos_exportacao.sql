-- Exclusão dos arquivos e exportação mensal.
--
-- 1. A fila automática (cobrancas-automaticas, ação liberacoes) apaga do armazenamento os arquivos de documentos e da
--    medição 30 dias depois do primeiro download (apagar_apos), marcando apagado_em. A cópia fica no SharePoint.
-- 2. Arquivo sem vínculo: arquivo no bucket "documentos" que não está ligado a nenhum documento nem item da medição
--    (envio que falhou no meio) é apagado depois de 24 horas, para todo arquivo guardado estar ligado a um
--    colaborador ou fornecedor.
-- 3. Exportação mensal: o administrativo baixa tudo (tabelas em CSV e arquivos guardados) num ZIP; cada exportação
--    fica registrada, e o portal lembra quando passa de 30 dias.

create or replace function public.arquivos_sem_vinculo(p_horas integer, p_limite integer) returns table (nome text)
language sql stable security definer set search_path = public as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'documentos'
    and o.created_at < now() - make_interval(hours => greatest(p_horas, 1))
    and not exists (select 1 from public.arquivos a where a.caminho = o.name)
    and not exists (select 1 from public.medicoes_arquivos m where m.caminho = o.name)
  order by o.created_at
  limit least(greatest(p_limite, 1), 500);
$$;
revoke all on function public.arquivos_sem_vinculo(integer, integer) from public, anon, authenticated;
grant execute on function public.arquivos_sem_vinculo(integer, integer) to service_role;

create table public.exportacoes (
  id          uuid primary key default gen_random_uuid(),
  feita_por   uuid default auth.uid(),
  feita_em    timestamptz not null default now(),
  tabelas     integer not null,
  linhas      integer not null,
  arquivos    integer not null,
  bytes       bigint not null
);
alter table public.exportacoes enable row level security;
create policy leitura on public.exportacoes for select to authenticated using ((select app.eh_admin()));
grant select on public.exportacoes to authenticated;

create or replace function public.registrar_exportacao(p_tabelas integer, p_linhas integer, p_arquivos integer, p_bytes bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo exporta'; end if;
  insert into public.exportacoes (tabelas, linhas, arquivos, bytes) values (p_tabelas, p_linhas, p_arquivos, p_bytes);
end $$;
revoke all on function public.registrar_exportacao(integer, integer, integer, bigint) from public, anon;
grant execute on function public.registrar_exportacao(integer, integer, integer, bigint) to authenticated;
