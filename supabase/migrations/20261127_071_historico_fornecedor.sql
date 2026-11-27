-- Histórico da ficha do fornecedor (Suprimentos e administrativo): tudo o que foi registrado sobre a empresa,
-- os contratos, os documentos da homologação e os pedidos de obra dela, com quem fez. Só leitura.
create or replace function public.historico_fornecedor(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('em', x.criado_em, 'acao', x.acao, 'tabela', x.tabela, 'detalhe', x.detalhe, 'quem', x.quem) order by x.criado_em desc), '[]'::jsonb)
  from (
    select ev.criado_em, ev.acao, ev.tabela, ev.detalhe, u.nome as quem
    from public.eventos ev left join public.usuarios u on u.id = ev.usuario_id
    where app.eh_gestao_fornecedor() and (
         (ev.tabela = 'empresas' and ev.registro_id = p_empresa)
      or (ev.tabela = 'contratos_fornecedor' and ev.registro_id in (select c.id from public.contratos_fornecedor c where c.empresa_id = p_empresa))
      or (ev.tabela = 'homologacao_documentos' and ev.registro_id in (select d.id from public.homologacao_documentos d where d.empresa_id = p_empresa))
      or (ev.tabela = 'pedidos_obra' and ev.registro_id in (select p.id from public.pedidos_obra p where p.empresa_id = p_empresa)))
    order by ev.criado_em desc
    limit 200
  ) x;
$$;
revoke all on function public.historico_fornecedor(uuid) from public, anon;
grant execute on function public.historico_fornecedor(uuid) to authenticated;
