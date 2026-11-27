-- A aprovação e a devolução de cada documento da homologação passam a ficar no histórico do fornecedor
-- (antes só ficava a última análise, no próprio documento). Altera por substituição de texto, sem recopiar a função.
do $$
declare
  v_def text := pg_get_functiondef('public.analisar_documento_homologacao(uuid, boolean, text)'::regprocedure);
  v_ancora text := E'analisado_por = auth.uid(), analisado_em = now()\n   where id = p_documento;';
begin
  if strpos(v_def, 'documento_homologacao_aprovado') > 0 then return; end if;
  if strpos(v_def, v_ancora) = 0 then raise exception 'analisar_documento_homologacao: trecho esperado não encontrado'; end if;
  execute replace(v_def, v_ancora, v_ancora || E'\n  perform app.registrar_evento(''homologacao_documentos'', p_documento,\n    case when p_aprovar then ''documento_homologacao_aprovado'' else ''documento_homologacao_devolvido'' end,\n    jsonb_build_object(''tipo'', d.tipo_codigo, ''motivo'', case when p_aprovar then null else btrim(p_motivo) end));');
end $$;
