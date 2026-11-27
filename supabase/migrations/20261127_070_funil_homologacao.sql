-- Funil da homologação (Suprimentos): por fornecedor, as datas de cada etapa e as devoluções.
-- A tela calcula a etapa atual, o tempo em cada etapa (dias úteis), os parados e os motivos de devolução.
create or replace function public.funil_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'situacao', e.homologacao, 'tipos', to_jsonb(e.tipos),
    'situacao_fornecedor', e.situacao_fornecedor,
    'convidada_em', h.convidada_em, 'atualizado_em', h.atualizado_em, 'enviada_em', h.enviada_em, 'decidida_em', h.decidida_em,
    'homologada_em', e.homologada_em, 'liberado_em', e.portal_liberado_em,
    'primeiro_documento_em', (select min(d.enviado_em) from public.homologacao_documentos d where d.empresa_id = e.id),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('acao', ev.acao, 'em', ev.criado_em, 'texto', coalesce(ev.detalhe ->> 'observacao', ev.detalhe ->> 'motivo')) order by ev.criado_em)
      from public.eventos ev
      where ev.tabela = 'empresas' and ev.registro_id = e.id
        and ev.acao in ('homologacao_enviada', 'homologacao_devolvida', 'homologada', 'homologacao_reprovada', 'portal_liberado')), '[]'::jsonb),
    'documentos_devolvidos', coalesce((
      select jsonb_agg(jsonb_build_object('documento', t.nome, 'motivo', d.motivo_devolucao, 'em', coalesce(d.analisado_em, d.enviado_em)) order by d.enviado_em)
      from public.homologacao_documentos d join public.homologacao_tipos t on t.codigo = d.tipo_codigo
      where d.empresa_id = e.id and d.motivo_devolucao is not null), '[]'::jsonb)
  ) order by h.convidada_em), '[]'::jsonb)
  from public.empresas e join public.homologacoes h on h.empresa_id = e.id
  where app.eh_gestao_fornecedor() and e.homologacao <> 'anterior';
$$;
revoke all on function public.funil_homologacao() from public, anon;
grant execute on function public.funil_homologacao() to authenticated;
