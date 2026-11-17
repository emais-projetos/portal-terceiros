-- Integração: participante que não sabe assinar (não alfabetizado).
--
-- Em vez da assinatura desenhada, o TST marca "Não sabe assinar" e o portal gera um registro eletrônico:
-- data e hora, código de verificação, quem registrou e o IP. Toda assinatura (desenhada ou registro) ganha
-- um código de verificação, que sai na lista de presença em PDF junto com a folha de evidências.

alter table public.integracoes_participantes
  add column nao_assina boolean not null default false,
  add column codigo_assinatura text,
  add column assinatura_por uuid,
  add column assinatura_ip text;

create or replace function app.codigo_assinatura() returns text
language sql volatile as $$
  select upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 4) || '-' || substr(md5(gen_random_uuid()::text), 1, 4));
$$;

create or replace function app.ip_da_requisicao() returns text
language sql stable as $$
  select nullif(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1), '');
$$;

-- Assinatura desenhada na tela (ou apagar, com caminho nulo).
create or replace function public.assinar_integracao(p_integracao uuid, p_alocacao uuid, p_caminho text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.integracoes;
begin
  select * into i from public.integracoes where id = p_integracao;
  if i.id is null or not app.pode_integrar(i.obra_id) then raise exception 'Integração não encontrada'; end if;
  if i.concluida_em is not null then raise exception 'Esta integração já foi concluída'; end if;
  if i.cancelada_em is not null then raise exception 'Esta integração foi cancelada'; end if;
  if i.data > current_date then raise exception 'A assinatura abre no dia da integração (%).', to_char(i.data, 'DD/MM/YYYY'); end if;
  if p_caminho is not null and (p_caminho not like p_integracao::text || '/' || p_alocacao::text || '-%.png'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'integracoes' and o.name = p_caminho)) then
    raise exception 'Assinatura não encontrada. Tente assinar de novo.';
  end if;
  update public.integracoes_participantes
  set assinatura = p_caminho,
      nao_assina = false,
      assinado_em = case when p_caminho is null then null else now() end,
      codigo_assinatura = case when p_caminho is null then null else app.codigo_assinatura() end,
      assinatura_por = case when p_caminho is null then null else auth.uid() end,
      assinatura_ip = case when p_caminho is null then null else app.ip_da_requisicao() end
  where integracao_id = p_integracao and alocacao_id = p_alocacao;
  if not found then raise exception 'Este colaborador não está na turma'; end if;
end $$;

-- Não sabe assinar: registro eletrônico no lugar da assinatura (ou desfazer, com p_registrar = false).
create or replace function public.registrar_sem_assinatura(p_integracao uuid, p_alocacao uuid, p_registrar boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  i public.integracoes;
  codigo text := case when p_registrar then app.codigo_assinatura() end;
begin
  select * into i from public.integracoes where id = p_integracao;
  if i.id is null or not app.pode_integrar(i.obra_id) then raise exception 'Integração não encontrada'; end if;
  if i.concluida_em is not null then raise exception 'Esta integração já foi concluída'; end if;
  if i.cancelada_em is not null then raise exception 'Esta integração foi cancelada'; end if;
  if i.data > current_date then raise exception 'O registro abre no dia da integração (%).', to_char(i.data, 'DD/MM/YYYY'); end if;
  update public.integracoes_participantes
  set nao_assina = coalesce(p_registrar, false),
      assinatura = null,
      assinado_em = case when p_registrar then now() end,
      codigo_assinatura = codigo,
      assinatura_por = case when p_registrar then auth.uid() end,
      assinatura_ip = case when p_registrar then app.ip_da_requisicao() end
  where integracao_id = p_integracao and alocacao_id = p_alocacao;
  if not found then raise exception 'Este colaborador não está na turma'; end if;
  perform app.registrar_evento('integracoes', p_integracao, case when p_registrar then 'sem_assinatura' else 'sem_assinatura_desfeito' end,
    jsonb_build_object('alocacao', p_alocacao, 'codigo', codigo));
  return codigo;
end $$;

revoke all on function public.registrar_sem_assinatura(uuid, uuid, boolean) from public, anon;
grant execute on function public.registrar_sem_assinatura(uuid, uuid, boolean) to authenticated;
revoke all on function public.assinar_integracao(uuid, uuid, text) from public, anon;
grant execute on function public.assinar_integracao(uuid, uuid, text) to authenticated;
revoke all on function app.codigo_assinatura() from public;
