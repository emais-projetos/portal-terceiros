-- Segurança da obra: nomes dos fornecedores da obra, para escolher o responsável pela máquina ou pelo alojamento.
-- A engenharia não lê a tabela de empresas, e o TST só vê as empresas com colaborador na obra dele; aqui vêm os
-- fornecedores ativos na obra e os que já respondem por máquina ou alojamento dela.
create or replace function public.seg_fornecedores_obra(p_obra uuid) returns table (id uuid, nome text, ativo_na_obra boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.ve_obra_seguranca(p_obra) then raise exception 'Obra fora do seu acesso'; end if;
  return query
    select e.id, e.razao_social,
           exists (select 1 from public.empresas_obras eo where eo.empresa_id = e.id and eo.obra_id = p_obra and eo.ativo)
    from public.empresas e
    where e.id in (
      select eo.empresa_id from public.empresas_obras eo where eo.obra_id = p_obra and eo.ativo
      union select a.empresa_id from public.seg_alojamentos a where a.obra_id = p_obra
      union select m.empresa_id from public.seg_maquinas m where m.obra_id = p_obra)
    order by e.razao_social;
end $$;
revoke execute on function public.seg_fornecedores_obra(uuid) from anon, public;
grant execute on function public.seg_fornecedores_obra(uuid) to authenticated;
