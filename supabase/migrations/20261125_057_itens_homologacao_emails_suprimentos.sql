-- 1. Itens novos no formulário da homologação: o Suprimentos inclui perguntas (texto, data ou número) ou pedidos
--    de documento (anexo). Itens incluídos podem ser removidos; os do F.31 original não.
--    Remover só esconde o item dos próximos envios: respostas e documentos já recebidos continuam guardados.
-- 2. E-mails: o Suprimentos vê e edita só os e-mails da homologação. O resto continua com o administrativo.

-- ------------------------------------------------------------------------------------------------ Itens
alter table public.homologacao_campos
  add column if not exists formato text not null default 'texto',
  add column if not exists personalizado boolean not null default false,
  add column if not exists ativo boolean not null default true;
alter table public.homologacao_campos drop constraint if exists homologacao_campos_formato_ck;
alter table public.homologacao_campos add constraint homologacao_campos_formato_ck check (formato in ('texto', 'data', 'numero'));

alter table public.homologacao_tipos
  add column if not exists personalizado boolean not null default false,
  add column if not exists ativo boolean not null default true;

create or replace function public.incluir_item_homologacao(p_pergunta text, p_formato text, p_obrigatorio boolean, p_validade_dias integer default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pergunta text := regexp_replace(btrim(coalesce(p_pergunta, '')), '\s+', ' ', 'g');
  v_codigo text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  if length(v_pergunta) < 3 or length(v_pergunta) > 200 then raise exception 'Escreva a pergunta ou o pedido (de 3 a 200 letras)'; end if;
  if coalesce(p_formato, '') not in ('texto', 'data', 'numero', 'anexo') then raise exception 'Escolha o formato: texto, data, número ou anexo'; end if;
  if p_obrigatorio is null then raise exception 'Informe se é obrigatório'; end if;
  if p_validade_dias is not null and (p_formato <> 'anexo' or p_validade_dias < 1 or p_validade_dias > 3650) then
    raise exception 'A validade vale só para anexo, de 1 a 3650 dias';
  end if;

  if p_formato = 'anexo' then
    if exists (select 1 from public.homologacao_tipos where ativo and lower(nome) = lower(v_pergunta)) then
      raise exception 'Já existe um documento com este nome';
    end if;
    v_codigo := 'extra_' || substr(md5(gen_random_uuid()::text), 1, 10);
    insert into public.homologacao_tipos (codigo, nome, ordem, obrigatorio, validade_dias, personalizado)
    values (v_codigo, v_pergunta, (select coalesce(max(ordem), 0) + 1 from public.homologacao_tipos), p_obrigatorio, p_validade_dias, true);
  else
    if exists (select 1 from public.homologacao_campos where ativo and lower(rotulo) = lower(v_pergunta)) then
      raise exception 'Já existe uma pergunta com este texto';
    end if;
    v_codigo := 'extra_' || substr(md5(gen_random_uuid()::text), 1, 10);
    insert into public.homologacao_campos (campo, rotulo, secao, ordem, obrigatorio, formato, personalizado)
    values (v_codigo, v_pergunta, 'Perguntas adicionais', (select coalesce(max(ordem), 0) + 1 from public.homologacao_campos), p_obrigatorio, p_formato, true);
  end if;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values (case when p_formato = 'anexo' then 'homologacao_tipos' else 'homologacao_campos' end, '00000000-0000-0000-0000-000000000000',
          'item_homologacao_incluido',
          jsonb_build_object('codigo', v_codigo, 'rotulo', v_pergunta, 'formato', p_formato, 'obrigatorio', p_obrigatorio, 'validade_dias', p_validade_dias), auth.uid());
  return v_codigo;
end $$;

create or replace function public.remover_item_homologacao(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rotulo text;
  v_formato text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  update public.homologacao_campos set ativo = false where campo = p_codigo and personalizado and ativo returning rotulo, formato into v_rotulo, v_formato;
  if v_rotulo is null then
    update public.homologacao_tipos set ativo = false where codigo = p_codigo and personalizado and ativo returning nome into v_rotulo;
    v_formato := 'anexo';
  end if;
  if v_rotulo is null then raise exception 'Só os itens incluídos pelo Suprimentos podem ser removidos'; end if;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values (case when v_formato = 'anexo' then 'homologacao_tipos' else 'homologacao_campos' end, '00000000-0000-0000-0000-000000000000',
          'item_homologacao_removido', jsonb_build_object('codigo', p_codigo, 'rotulo', v_rotulo, 'formato', v_formato), auth.uid());
end $$;

-- Campo ou documento removido não se configura mais.
create or replace function public.configurar_campo_homologacao(p_campo text, p_obrigatorio boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c public.homologacao_campos;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  select * into c from public.homologacao_campos where campo = p_campo and ativo for update;
  if c.campo is null then raise exception 'Campo não encontrado'; end if;
  if c.fixo then raise exception '% é sempre obrigatório', c.rotulo; end if;
  if p_obrigatorio is null or c.obrigatorio = p_obrigatorio then return; end if;
  update public.homologacao_campos set obrigatorio = p_obrigatorio where campo = p_campo;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('homologacao_campos', '00000000-0000-0000-0000-000000000000', 'campo_homologacao_alterado',
          jsonb_build_object('campo', p_campo, 'rotulo', c.rotulo, 'obrigatorio', jsonb_build_object('de', c.obrigatorio, 'para', p_obrigatorio)), auth.uid());
end $$;

create or replace function public.configurar_documento_homologacao(p_codigo text, p_obrigatorio boolean, p_validade_dias integer) returns void
language plpgsql security definer set search_path = public as $$
declare t public.homologacao_tipos;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  select * into t from public.homologacao_tipos where codigo = p_codigo and ativo for update;
  if t.codigo is null then raise exception 'Documento não encontrado'; end if;
  if p_obrigatorio is null then raise exception 'Informe se o documento é obrigatório'; end if;
  if p_validade_dias is not null and (p_validade_dias < 1 or p_validade_dias > 3650) then
    raise exception 'A validade precisa ficar entre 1 e 3650 dias (ou em branco, sem vencimento)';
  end if;
  if t.obrigatorio = p_obrigatorio and t.validade_dias is not distinct from p_validade_dias then return; end if;
  update public.homologacao_tipos set obrigatorio = p_obrigatorio, validade_dias = p_validade_dias where codigo = p_codigo;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('homologacao_tipos', '00000000-0000-0000-0000-000000000000', 'documento_homologacao_alterado',
          jsonb_build_object('codigo', p_codigo, 'nome', t.nome,
            'obrigatorio', jsonb_build_object('de', t.obrigatorio, 'para', p_obrigatorio),
            'validade_dias', jsonb_build_object('de', t.validade_dias, 'para', p_validade_dias)), auth.uid());
end $$;

create or replace function public.historico_configuracao_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'em' desc), '[]'::jsonb) from (
    select jsonb_build_object('em', ev.criado_em, 'quem', u.nome, 'acao', ev.acao, 'detalhe', ev.detalhe) x
    from public.eventos ev left join public.usuarios u on u.id = ev.usuario_id
    where app.eh_gestao_fornecedor()
      and ev.acao in ('campo_homologacao_alterado', 'documento_homologacao_alterado', 'item_homologacao_incluido', 'item_homologacao_removido')
    order by ev.criado_em desc limit 50
  ) s;
$$;

-- Envio: só os itens ativos contam; a resposta de data e número precisa estar no formato certo.
create or replace function public.enviar_homologacao(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  h public.homologacoes;
  faltam text;
begin
  if p_empresa not in (select app.minhas_empresas_cadastro()) then raise exception 'Sem permissão para esta empresa'; end if;
  select * into e from public.empresas where id = p_empresa;
  select * into h from public.homologacoes where empresa_id = p_empresa;
  if e.homologacao not in ('convidada', 'devolvida') then raise exception 'A homologação já foi enviada'; end if;
  select string_agg(c.rotulo, ', ' order by c.ordem) into faltam
  from public.homologacao_campos c
  where c.ativo and c.obrigatorio and c.campo <> 'referencias' and length(btrim(coalesce(h.dados ->> c.campo, ''))) = 0;
  if faltam is not null then raise exception 'Preencha os dados obrigatórios: %', faltam; end if;
  select string_agg(c.rotulo, ', ' order by c.ordem) into faltam
  from public.homologacao_campos c
  where c.ativo and length(btrim(coalesce(h.dados ->> c.campo, ''))) > 0
    and ((c.formato = 'data' and btrim(h.dados ->> c.campo) !~ '^\d{4}-\d{2}-\d{2}$')
      or (c.formato = 'numero' and btrim(h.dados ->> c.campo) !~ '^-?\d+([.,]\d+)?$'));
  if faltam is not null then raise exception 'Confira o formato das respostas: %', faltam; end if;
  if (select obrigatorio and ativo from public.homologacao_campos where campo = 'referencias')
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(h.dados -> 'referencias') = 'array' then h.dados -> 'referencias' else '[]'::jsonb end) r
                     where length(btrim(coalesce(r ->> 'empresa', ''))) > 0) then
    raise exception 'Informe pelo menos uma referência de fornecimento';
  end if;
  select string_agg(t.nome, ', ' order by t.ordem) into faltam
  from public.homologacao_tipos t
  where t.ativo and t.obrigatorio and not exists (
    select 1 from public.homologacao_documentos d where d.empresa_id = p_empresa and d.tipo_codigo = t.codigo and d.status in ('em_analise', 'aprovado'));
  if faltam is not null then raise exception 'Envie os documentos: %', faltam; end if;
  update public.empresas set homologacao = 'enviada' where id = p_empresa;
  update public.homologacoes set enviada_em = now(), motivo = null, atualizado_em = now() where empresa_id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'homologacao_enviada', '{}'::jsonb);
end $$;

create or replace function public.enviar_documento_homologacao(p_empresa uuid, p_tipo text, p_data_emissao date, p_arquivos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  t public.homologacao_tipos;
  v_id uuid;
  a jsonb;
begin
  if p_empresa not in (select app.minhas_empresas_cadastro()) then raise exception 'Sem permissão para esta empresa'; end if;
  select * into e from public.empresas where id = p_empresa;
  if e.homologacao not in ('convidada', 'devolvida', 'homologada') then raise exception 'A homologação está em análise. Aguarde o Suprimentos'; end if;
  select * into t from public.homologacao_tipos where codigo = p_tipo and ativo;
  if t.codigo is null then raise exception 'Documento não encontrado'; end if;
  if p_data_emissao is null then raise exception 'Informe a data de emissão'; end if;
  if p_data_emissao > current_date then raise exception 'A data de emissão não pode ser futura'; end if;
  if jsonb_typeof(p_arquivos) <> 'array' or jsonb_array_length(p_arquivos) = 0 then raise exception 'Anexe o arquivo'; end if;
  for a in select * from jsonb_array_elements(p_arquivos) loop
    if coalesce(a ->> 'caminho', '') not like p_empresa::text || '/h/%' then raise exception 'Arquivo inválido'; end if;
  end loop;
  update public.homologacao_documentos set status = 'substituido'
   where empresa_id = p_empresa and tipo_codigo = p_tipo and status in ('em_analise', 'devolvido');
  insert into public.homologacao_documentos (empresa_id, tipo_codigo, data_emissao, vencimento, arquivos, enviado_por)
  values (p_empresa, p_tipo, p_data_emissao, case when t.validade_dias is null then null else p_data_emissao + t.validade_dias end, p_arquivos, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.homologar_fornecedor(p_empresa uuid, p_qualificacao jsonb, p_comentarios text, p_responsavel text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  pend text;
  d record;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos homologa'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.homologacao <> 'enviada' then raise exception 'A homologação não está aguardando análise'; end if;
  if length(btrim(coalesce(p_responsavel, ''))) < 3 then raise exception 'Informe o responsável pela aprovação'; end if;
  select string_agg(t.nome, ', ' order by t.ordem) into pend
  from public.homologacao_tipos t
  where t.ativo and t.obrigatorio and not exists (
    select 1 from public.homologacao_documentos x where x.empresa_id = p_empresa and x.tipo_codigo = t.codigo and x.status = 'aprovado');
  if pend is not null then raise exception 'Aprove os documentos antes de homologar: %', pend; end if;
  if exists (select 1 from public.homologacao_documentos x where x.empresa_id = p_empresa and x.status = 'em_analise') then
    raise exception 'Ainda há documento em análise';
  end if;
  update public.empresas set homologacao = 'homologada', homologada_em = now(), homologada_por = auth.uid() where id = p_empresa;
  update public.homologacoes
     set qualificacao = coalesce(p_qualificacao, '{}'::jsonb), comentarios = nullif(btrim(coalesce(p_comentarios, '')), ''),
         responsavel_aprovacao = btrim(p_responsavel), decidida_por = auth.uid(), decidida_em = now(), motivo = null, atualizado_em = now()
   where empresa_id = p_empresa;
  for d in select x.id from public.homologacao_documentos x join public.homologacao_tipos t on t.codigo = x.tipo_codigo
           where x.empresa_id = p_empresa and x.status = 'aprovado' and t.tipo_portal is not null loop
    perform app.levar_documento_ao_portal(d.id);
  end loop;
  perform app.registrar_evento('empresas', p_empresa, 'homologada', jsonb_build_object('responsavel', btrim(p_responsavel)));
  perform app.enfileirar_email('homologacao_aprovada', p_empresa, '{}'::jsonb, 'homologada|' || p_empresa);
end $$;

-- ------------------------------------------------------------------------------------------------ E-mails
-- E-mails que o Suprimentos revisa. O "portal liberado" sai do administrativo e fica com ele.
create or replace function app.email_do_suprimentos(p_tipo text) returns boolean
language sql immutable set search_path = '' as $$
  select p_tipo in ('convite_homologacao', 'homologacao_correcoes', 'homologacao_aprovada', 'homologacao_reprovada', 'certidao_vencida');
$$;
grant execute on function app.email_do_suprimentos(text) to authenticated;

drop policy if exists leitura on public.modelos_email;
create policy leitura on public.modelos_email for select to authenticated
  using ((select app.eh_admin()) or ((select app.eh_suprimentos()) and app.email_do_suprimentos(tipo)));
drop policy if exists edicao on public.modelos_email;
create policy edicao on public.modelos_email for update to authenticated
  using ((select app.eh_admin()) or ((select app.eh_suprimentos()) and app.email_do_suprimentos(tipo)))
  with check ((select app.eh_admin()) or ((select app.eh_suprimentos()) and app.email_do_suprimentos(tipo)));
drop policy if exists admin on public.modelos_email_revisoes;
create policy admin on public.modelos_email_revisoes for select to authenticated
  using ((select app.eh_admin()) or ((select app.eh_suprimentos()) and app.email_do_suprimentos(tipo)));

-- ------------------------------------------------------------------------------------------------ Permissões
revoke all on function public.incluir_item_homologacao(text, text, boolean, integer) from public, anon;
revoke all on function public.remover_item_homologacao(text) from public, anon;
grant execute on function public.incluir_item_homologacao(text, text, boolean, integer), public.remover_item_homologacao(text),
  public.configurar_campo_homologacao(text, boolean), public.configurar_documento_homologacao(text, boolean, integer),
  public.historico_configuracao_homologacao(), public.enviar_homologacao(uuid), public.enviar_documento_homologacao(uuid, text, date, jsonb),
  public.homologar_fornecedor(uuid, jsonb, text, text) to authenticated;
