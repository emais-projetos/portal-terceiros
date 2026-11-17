-- Integração na obra: assinatura no tablet/celular, lista assinada guardada e ausente volta para a pendência.
--
-- 1. Cada participante assina na tela no dia da integração. A assinatura (PNG) fica no bucket "integracoes"
--    em <integracao>/<alocacao>-<hora>.png e o caminho em integracoes_participantes.assinatura.
-- 2. Ao confirmar a presença, o navegador gera a lista de presença com as assinaturas e guarda o PDF em
--    <integracao>/lista-de-presenca-<hora>.pdf (integracoes.lista_pdf): é o arquivo digital da integração.
-- 3. Data de integração provisória: a carga inicial (17/11/2026) usou a data da última conferência da
--    planilha. Se a pessoa falta numa integração do portal, essa data provisória sai e ela volta para
--    "sem integração". Uma data real (integração com presença) nunca é apagada por uma falta.

alter table public.alocacoes add column integracao_provisoria boolean not null default false;
comment on column public.alocacoes.integracao_provisoria is
  'Data de integração vinda da carga inicial (última conferência da planilha), não de uma integração com presença.';

update public.alocacoes a set integracao_provisoria = true
where a.data_integracao is not null
  and exists (
    select 1 from public.eventos e
    where e.tabela = 'alocacoes' and e.registro_id = a.id and e.acao = 'integracao'
      and e.detalhe->>'origem' like 'carga inicial%' and (e.detalhe->>'data')::date = a.data_integracao);

-- Quem faltou numa turma concluída depois da carga inicial volta para a pendência (caso do teste de 17/11).
with ausentes as (
  select distinct a.id
  from public.alocacoes a
  join public.integracoes_participantes p on p.alocacao_id = a.id and p.presente is false
  join public.integracoes i on i.id = p.integracao_id and i.concluida_em >= '2026-11-17'
  where a.integracao_provisoria
), u as (
  update public.alocacoes a set data_integracao = null, integracao_provisoria = false
  from ausentes x where a.id = x.id returning a.id
)
insert into public.eventos (tabela, registro_id, acao, detalhe)
select 'alocacoes', u.id, 'integracao_ausente', jsonb_build_object('motivo', 'faltou na integração; data provisória da planilha retirada')
from u;

alter table public.integracoes_participantes
  add column assinatura text,
  add column assinado_em timestamptz;
alter table public.integracoes add column lista_pdf text;

-- Arquivos: <integracao>/<arquivo>. Leitura e envio para o administrativo e o TST da obra da turma.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('integracoes', 'integracoes', false, 10485760, array['image/png', 'application/pdf'])
on conflict (id) do nothing;

create or replace function app.integracao_arquivo(p_caminho text, p_gravar boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  partes text[] := string_to_array(p_caminho, '/');
  i public.integracoes;
begin
  if array_length(partes, 1) <> 2 then return false; end if;
  begin
    select * into i from public.integracoes where id = partes[1]::uuid;
  exception when others then
    return false;
  end;
  if i.id is null or not app.pode_integrar(i.obra_id) then return false; end if;
  if p_gravar then return i.cancelada_em is null and i.data <= current_date; end if;
  return true;
end $$;

create policy "integracoes: ler" on storage.objects for select to authenticated
  using (bucket_id = 'integracoes' and app.integracao_arquivo(name, false));
create policy "integracoes: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'integracoes' and app.integracao_arquivo(name, true));

-- Grava (ou apaga, com caminho nulo) a assinatura de um participante. Só no dia da integração ou depois,
-- com a turma aberta.
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
  set assinatura = p_caminho, assinado_em = case when p_caminho is null then null else now() end
  where integracao_id = p_integracao and alocacao_id = p_alocacao;
  if not found then raise exception 'Este colaborador não está na turma'; end if;
end $$;

-- Confirma a presença. Presentes recebem a data da integração (data real). Ausentes voltam para a pendência:
-- se tinham só a data provisória da planilha, ela sai.
create or replace function public.concluir_integracao(p_integracao uuid, p_presentes uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  i public.integracoes;
  qtd integer;
  r record;
begin
  select * into i from public.integracoes where id = p_integracao;
  if i.id is null or not app.pode_integrar(i.obra_id) then raise exception 'Integração não encontrada'; end if;
  if i.concluida_em is not null then raise exception 'Esta integração já foi concluída'; end if;
  if i.cancelada_em is not null then raise exception 'Esta integração foi cancelada'; end if;
  if i.data > current_date then raise exception 'A integração está marcada para %. Confirme a presença no dia ou depois.', to_char(i.data, 'DD/MM/YYYY'); end if;

  update public.integracoes_participantes
  set presente = (alocacao_id = any (coalesce(p_presentes, '{}')))
  where integracao_id = p_integracao;

  update public.alocacoes a set data_integracao = i.data, integracao_provisoria = false
  from public.integracoes_participantes p
  where p.integracao_id = p_integracao and p.presente and a.id = p.alocacao_id and a.status = 'liberado';
  get diagnostics qtd = row_count;

  for r in
    select a.id, a.integracao_provisoria from public.integracoes_participantes p join public.alocacoes a on a.id = p.alocacao_id
    where p.integracao_id = p_integracao and not p.presente
  loop
    if r.integracao_provisoria then
      update public.alocacoes set data_integracao = null, integracao_provisoria = false where id = r.id;
    end if;
    perform app.registrar_evento('alocacoes', r.id, 'integracao_ausente',
      jsonb_build_object('integracao', p_integracao, 'data', i.data, 'retirou_data_provisoria', r.integracao_provisoria));
  end loop;

  update public.integracoes set concluida_em = now(), concluida_por = auth.uid() where id = p_integracao;
  perform app.registrar_evento('integracoes', p_integracao, 'concluida', jsonb_build_object('presentes', qtd));
  return qtd;
end $$;

-- Guarda o caminho da lista de presença assinada (PDF gerado no navegador ao concluir).
create or replace function public.salvar_lista_integracao(p_integracao uuid, p_caminho text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.integracoes;
begin
  select * into i from public.integracoes where id = p_integracao;
  if i.id is null or not app.pode_integrar(i.obra_id) then raise exception 'Integração não encontrada'; end if;
  if i.concluida_em is null then raise exception 'Conclua a integração antes de guardar a lista'; end if;
  if p_caminho not like p_integracao::text || '/lista-de-presenca-%.pdf'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'integracoes' and o.name = p_caminho) then
    raise exception 'Arquivo da lista não encontrado';
  end if;
  update public.integracoes set lista_pdf = p_caminho where id = p_integracao;
  perform app.registrar_evento('integracoes', p_integracao, 'lista_assinada', jsonb_build_object('arquivo', p_caminho));
end $$;

-- Registro avulso de integração (data real).
create or replace function public.registrar_integracao(p_alocacao uuid, p_data date) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alocacoes;
begin
  select * into a from public.alocacoes where id = p_alocacao;
  if a.id is null or not app.pode_integrar(a.obra_id) then raise exception 'Apenas o administrativo ou o TST da obra registra a integração'; end if;
  if p_data > current_date then raise exception 'A data da integração não pode ser futura'; end if;
  if a.status <> 'liberado' then raise exception 'A alocação precisa estar liberada'; end if;
  update public.alocacoes set data_integracao = p_data, integracao_provisoria = false where id = p_alocacao;
  perform app.registrar_evento('alocacoes', p_alocacao, 'integracao', jsonb_build_object('data', p_data));
end $$;

revoke all on function public.assinar_integracao(uuid, uuid, text) from public, anon;
revoke all on function public.salvar_lista_integracao(uuid, text) from public, anon;
revoke all on function public.concluir_integracao(uuid, uuid[]) from public, anon;
revoke all on function public.registrar_integracao(uuid, date) from public, anon;
grant execute on function public.assinar_integracao(uuid, uuid, text) to authenticated;
grant execute on function public.salvar_lista_integracao(uuid, text) to authenticated;
grant execute on function public.concluir_integracao(uuid, uuid[]) to authenticated;
grant execute on function public.registrar_integracao(uuid, date) to authenticated;
