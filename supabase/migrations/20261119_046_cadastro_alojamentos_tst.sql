-- Cadastro de alojamentos aberto também para o TST da obra (ajuste da 045).
--
-- O TST gerencia os alojamentos das obras dele: cadastra e corrige nome, endereço e fornecedor pela aba
-- Segurança da obra > Cadastro. Em "Realizar inspeção" continua só a escolha de um alojamento já cadastrado.
-- Juntar cadastro repetido (apaga um cadastro) continua só com o administrativo.

drop policy inserir on public.seg_alojamentos;
create policy inserir on public.seg_alojamentos for insert to authenticated with check (app.tst_da_obra(obra_id));

create or replace function app.seg_antes_alterar_alojamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.obra_id is distinct from old.obra_id and exists (select 1 from public.seg_vistorias v where v.alojamento_id = old.id) then
    raise exception 'Alojamento com vistoria não muda de obra';
  end if;
  return new;
end $$;
