-- Cadastro de alojamentos pelo administrativo (Segurança da obra > Cadastro).
--
-- 1. Só o administrativo cadastra alojamento e altera nome, endereço, obra e fornecedor. Assim a lista fica
--    padronizada e o TST, em "Realizar inspeção", só escolhe um alojamento que já existe.
--    O TST continua podendo vincular o responsável de um alojamento que veio do ObraCheck "a vincular" e
--    desativar um alojamento.
-- 2. juntar_alojamentos: para corrigir cadastro duplicado, o administrativo passa as vistorias de um alojamento
--    para outro da mesma obra e o cadastro repetido é apagado. Fica registrado em eventos.

drop policy inserir on public.seg_alojamentos;
create policy inserir on public.seg_alojamentos for insert to authenticated with check ((select app.eh_admin()));

create or replace function app.seg_antes_alterar_alojamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not app.eh_admin() then
    if new.nome is distinct from old.nome or new.endereco is distinct from old.endereco or new.obra_id is distinct from old.obra_id then
      raise exception 'Só o administrativo altera o nome e o endereço do alojamento';
    end if;
    if new.empresa_id is distinct from old.empresa_id and old.empresa_a_vincular is null then
      raise exception 'Só o administrativo troca o fornecedor do alojamento';
    end if;
  end if;
  if new.obra_id is distinct from old.obra_id and exists (select 1 from public.seg_vistorias v where v.alojamento_id = old.id) then
    raise exception 'Alojamento com vistoria não muda de obra';
  end if;
  return new;
end $$;
create trigger seg_alojamentos_cadastro before update on public.seg_alojamentos
  for each row execute function app.seg_antes_alterar_alojamento();

create or replace function public.juntar_alojamentos(p_origem uuid, p_destino uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o public.seg_alojamentos;
  d public.seg_alojamentos;
  n integer;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo junta alojamentos'; end if;
  select * into o from public.seg_alojamentos where id = p_origem for update;
  select * into d from public.seg_alojamentos where id = p_destino for update;
  if o.id is null or d.id is null then raise exception 'Alojamento não encontrado'; end if;
  if o.id = d.id then raise exception 'Escolha outro alojamento'; end if;
  if o.obra_id <> d.obra_id then raise exception 'Os dois alojamentos precisam ser da mesma obra'; end if;
  if exists (select 1 from public.seg_termos_alojamento t where t.alojamento_id = o.id) then
    raise exception '% tem termos de uso assinados. Desative o cadastro em vez de juntar.', o.nome;
  end if;
  update public.seg_vistorias set alojamento_id = d.id where alojamento_id = o.id;
  get diagnostics n = row_count;
  delete from public.seg_alojamentos where id = o.id;
  perform app.registrar_evento('seg_alojamentos', d.id, 'alojamento_juntado',
    jsonb_build_object('origem', o.id, 'nome', o.nome, 'endereco', o.endereco, 'empresa_id', o.empresa_id, 'vistorias', n));
  return n;
end $$;
revoke all on function public.juntar_alojamentos(uuid, uuid) from public, anon;
grant execute on function public.juntar_alojamentos(uuid, uuid) to authenticated;
