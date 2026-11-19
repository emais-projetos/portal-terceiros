-- Liberação com pendência também quando a alocação está "pendente do fornecedor" (documento devolvido).
--
-- Antes só valia em "em análise": depois que o administrativo devolvia um documento, a opção sumia até o fornecedor
-- reenviar. Muitas vezes o fornecedor nem reenvia logo, porque sabe que a engenharia pediu a liberação. Agora o
-- administrativo pode liberar com pendência nos dois casos. "Em cadastro" (fornecedor ainda não terminou o envio)
-- continua de fora. O resto não muda: anotação obrigatória, prazo de 7 dias, ciente do TST e volta automática ao
-- fornecedor se o prazo vencer.

create or replace function public.aprovar_alocacao(p_alocacao uuid, p_pendencia text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.v_alocacoes_resumo;
  docs text[];
  prazo date := current_date + 7;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador aprova'; end if;
  select * into r from public.v_alocacoes_resumo where alocacao_id = p_alocacao;
  if r.alocacao_id is null then raise exception 'Alocação não encontrada'; end if;
  if r.status not in ('em_analise', 'pendente_fornecedor') then raise exception 'A alocação precisa estar em análise ou pendente do fornecedor'; end if;
  if r.impeditivos_pendentes = 0 then
    if r.status = 'pendente_fornecedor' then
      raise exception 'Não há documento impeditivo pendente. Aprove quando o fornecedor reenviar e a alocação voltar para análise.';
    end if;
    perform app.encerrar_pendencia_liberacao(p_alocacao, 'regularizada');
    update public.alocacoes set status = 'aprovado_admin', aprovado_admin_por = auth.uid(), aprovado_admin_em = now() where id = p_alocacao;
    return;
  end if;
  if coalesce(trim(p_pendencia), '') = '' then
    raise exception 'Ainda há % documento(s) impeditivo(s) pendente(s). Para liberar assim, marque "Liberar com pendência" e escreva a anotação.', r.impeditivos_pendentes;
  end if;
  select coalesce(array_agg(p.documento order by p.documento), '{}') into docs
  from public.v_pendencias p
  where p.alocacao_id = p_alocacao and p.impeditivo and p.situacao in ('nao_enviado', 'em_analise', 'devolvido', 'vencido');
  update public.liberacoes_pendencia set encerrada_em = now(), resultado = 'devolvida' where alocacao_id = p_alocacao and encerrada_em is null;
  insert into public.liberacoes_pendencia (alocacao_id, prazo, anotacao, documentos) values (p_alocacao, prazo, trim(p_pendencia), docs);
  update public.alocacoes
  set status = 'aprovado_admin', aprovado_admin_por = auth.uid(), aprovado_admin_em = now(), pendencia_prazo = prazo
  where id = p_alocacao;
  perform app.registrar_evento('alocacoes', p_alocacao, 'aprovada_com_pendencia',
    jsonb_build_object('prazo', prazo, 'anotacao', trim(p_pendencia), 'documentos', to_jsonb(docs), 'de', r.status));
end $$;
revoke all on function public.aprovar_alocacao(uuid, text) from public, anon;
grant execute on function public.aprovar_alocacao(uuid, text) to authenticated;
