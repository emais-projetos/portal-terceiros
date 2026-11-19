-- Administrativo corrige e dispensa documentos sem devolver ao fornecedor.
--
-- 1. corrigir_documento: muda a data de emissão (ou a vigência) de um documento enviado, com motivo. Em análise ou
--    devolvido, já aprova junto ("Corrigir e aprovar"). Fica no histórico (eventos) com a data antiga e a nova.
-- 2. dispensar_documento: o administrativo dispensa qualquer documento (do colaborador ou da empresa), com motivo.
--    A pendência sai e o documento aparece como dispensado pela Emais. desfazer_dispensa volta a exigir.
--    O "pode dispensar" de Regras continua valendo para o pedido de dispensa do fornecedor.
-- 3. Se, depois da correção ou da dispensa, a alocação "pendente do fornecedor" não tiver mais documento impeditivo
--    pendente, ela volta para "em análise" (como se o fornecedor tivesse reenviado).

-- Dispensa pela Emais: o documento entra já aprovado e dispensado, sem o fluxo do fornecedor.
create or replace function app.antes_inserir_documento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_documento;
  emp_colab uuid;
  v_emais boolean := coalesce(current_setting('app.dispensa_emais', true), '') = 'sim' and app.eh_admin();
begin
  select * into t from public.tipos_documento where codigo = new.tipo_codigo;
  if not t.ativo then raise exception 'Tipo de documento % está inativo', new.tipo_codigo; end if;
  if not t.enviado_pelo_fornecedor then raise exception '% não é enviado pelo fornecedor', t.nome; end if;

  -- documento de empresa x de colaborador
  if t.grupo = 'empresa' and new.colaborador_id is not null then
    raise exception '% é documento da empresa: não informe colaborador', t.nome;
  end if;
  if t.grupo = 'colaborador' then
    if new.colaborador_id is null then raise exception '% exige o colaborador', t.nome; end if;
    select empresa_id into emp_colab from public.colaboradores where id = new.colaborador_id;
    if emp_colab is distinct from new.empresa_id then raise exception 'Colaborador não pertence à empresa informada'; end if;
  end if;

  if v_emais then
    if not new.dispensado then raise exception 'Uso interno: só a dispensa pela Emais entra direto'; end if;
    new.origem := 'portal';
    new.enviado_por := auth.uid();
    new.enviado_em := now();
    new.status := 'aprovado';
    new.motivo_devolucao := null;
    new.analisado_por := auth.uid();
    new.analisado_em := now();
    new.aceite_lgpd_em := coalesce(new.aceite_lgpd_em, now());
    return new;
  end if;

  -- datas
  if new.dispensado and not t.pode_dispensar then raise exception '% não pode ser dispensado', t.nome; end if;
  if not new.dispensado then
    if t.regra = 'emissao_mais_prazo' and new.data_emissao is null then
      raise exception 'Informe a data de emissão de %', t.nome;
    end if;
    if t.regra = 'vigencia_informada' and new.data_vencimento_informada is null then
      raise exception 'Informe a vigência final de %', t.nome;
    end if;
  end if;
  if new.data_emissao > current_date then
    raise exception 'A data de emissão de % não pode ser futura', t.nome;
  end if;

  -- campos do sistema: quem chega pela API (fornecedor ou admin) não escolhe status
  if auth.uid() is not null then
    new.origem := 'portal';
    new.enviado_por := auth.uid();
    new.enviado_em := now();
    new.status := 'em_analise';
    new.motivo_devolucao := null;
    new.analisado_por := null;
    new.analisado_em := null;
    if new.aceite_lgpd_em is null then raise exception 'É preciso aceitar o termo de LGPD para enviar'; end if;
  end if;
  return new;
end $$;

-- Alocação devolvida ao fornecedor volta para análise quando não sobra documento impeditivo pendente.
create or replace function app.reavaliar_pendente_fornecedor(p_empresa uuid, p_colaborador uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.alocacoes a set status = 'em_analise', inicio_conferencia = coalesce(a.inicio_conferencia, now())
  from public.colaboradores c
  where c.id = a.colaborador_id and a.status = 'pendente_fornecedor'
    and (a.colaborador_id = p_colaborador or (p_colaborador is null and c.empresa_id = p_empresa))
    and not exists (
      select 1 from public.v_pendencias p
      where p.alocacao_id = a.id and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido'));
end $$;
revoke all on function app.reavaliar_pendente_fornecedor(uuid, uuid) from public;

create or replace function public.corrigir_documento(p_documento uuid, p_data_emissao date, p_vigencia date, p_motivo text, p_aprovar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.documentos;
  t public.tipos_documento;
  v_aprovou boolean := false;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo corrige documentos'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo da correção'; end if;
  select * into d from public.documentos where id = p_documento for update;
  if d.id is null then raise exception 'Documento não encontrado'; end if;
  if d.status not in ('aprovado', 'em_analise', 'devolvido') then raise exception 'Este documento foi substituído por um envio mais novo'; end if;
  if d.dispensado then raise exception 'Documento dispensado não tem data para corrigir'; end if;
  select * into t from public.tipos_documento where codigo = d.tipo_codigo;
  if p_data_emissao > current_date then raise exception 'A data de emissão não pode ser futura'; end if;
  if t.regra = 'emissao_mais_prazo' and p_data_emissao is null then raise exception 'Informe a data de emissão'; end if;
  if t.regra = 'vigencia_informada' and p_vigencia is null then raise exception 'Informe a vigência final'; end if;
  if t.regra = 'emissao_mais_prazo' and p_vigencia is not null then raise exception 'Este documento vence pela data de emissão: a vigência não se informa'; end if;

  update public.documentos set data_emissao = p_data_emissao, data_vencimento_informada = p_vigencia where id = p_documento;
  if d.status in ('em_analise', 'devolvido') and coalesce(p_aprovar, true) then
    update public.documentos
       set status = 'aprovado', analisado_por = auth.uid(), analisado_em = now(), motivo_devolucao = null,
           resultado_analise = 'aprovado', aguardando_conclusao = true, conclusao_id = null
     where id = p_documento;
    v_aprovou := true;
  end if;
  perform app.registrar_evento('documentos', p_documento, 'corrigido', jsonb_build_object(
    'motivo', btrim(p_motivo), 'aprovado', v_aprovou, 'status_antes', d.status,
    'de', jsonb_build_object('emissao', d.data_emissao, 'vigencia', d.data_vencimento_informada),
    'para', jsonb_build_object('emissao', p_data_emissao, 'vigencia', p_vigencia)));
  if v_aprovou then perform app.reavaliar_pendente_fornecedor(d.empresa_id, d.colaborador_id); end if;
end $$;

create or replace function public.dispensar_documento(p_empresa uuid, p_colaborador uuid, p_tipo text, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_documento;
  v_id uuid;
  v_nome text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo dispensa documentos'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo da dispensa'; end if;
  select * into t from public.tipos_documento where codigo = p_tipo;
  if t.codigo is null then raise exception 'Documento não encontrado'; end if;
  if t.grupo = 'empresa' and p_colaborador is not null then raise exception '% é documento da empresa', t.nome; end if;
  if t.grupo = 'colaborador' and p_colaborador is null then raise exception '% é documento do colaborador', t.nome; end if;
  select nome into v_nome from public.usuarios where id = auth.uid();
  perform set_config('app.dispensa_emais', 'sim', true);
  insert into public.documentos (tipo_codigo, empresa_id, colaborador_id, data_emissao, dispensado, dados)
  values (p_tipo, p_empresa, p_colaborador, current_date, true,
          jsonb_build_object('motivo_dispensa', btrim(p_motivo), 'dispensa_emais', true, 'dispensado_por', v_nome))
  returning id into v_id;
  perform set_config('app.dispensa_emais', '', true);
  perform app.registrar_evento('documentos', v_id, 'dispensado_emais', jsonb_build_object('motivo', btrim(p_motivo), 'tipo', p_tipo));
  perform app.reavaliar_pendente_fornecedor(p_empresa, p_colaborador);
  return v_id;
end $$;

create or replace function public.desfazer_dispensa(p_documento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.documentos;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo desfaz a dispensa'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escreva o motivo'; end if;
  select * into d from public.documentos where id = p_documento for update;
  if d.id is null or not d.dispensado or d.status <> 'aprovado' then raise exception 'Este documento não está dispensado'; end if;
  update public.documentos set status = 'substituido' where id = p_documento;
  perform app.registrar_evento('documentos', p_documento, 'dispensa_desfeita', jsonb_build_object('motivo', btrim(p_motivo)));
end $$;

revoke all on function public.corrigir_documento(uuid, date, date, text, boolean) from public, anon;
revoke all on function public.dispensar_documento(uuid, uuid, text, text) from public, anon;
revoke all on function public.desfazer_dispensa(uuid, text) from public, anon;
grant execute on function public.corrigir_documento(uuid, date, date, text, boolean) to authenticated;
grant execute on function public.dispensar_documento(uuid, uuid, text, text) to authenticated;
grant execute on function public.desfazer_dispensa(uuid, text) to authenticated;
