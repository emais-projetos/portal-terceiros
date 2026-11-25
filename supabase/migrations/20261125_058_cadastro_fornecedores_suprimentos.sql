-- Fornecedores (Suprimentos): cadastro completo de cada empresa, situação dos documentos e edição do cadastro.
-- Os dados do cadastro (endereço, contato, dados bancários) ficam em homologacoes.dados, para os fornecedores
-- novos (vêm do F.31) e para os antigos (o Suprimentos preenche aqui). Fornecedor antigo ganha a linha sem convite.
-- O Suprimentos vê só a situação dos documentos (nome, situação e vencimento), sem abrir arquivo, e dos
-- colaboradores só os números, sem nome nem documento.

alter table public.homologacoes alter column convidada_em drop not null;

-- E-mails de aviso da empresa: o Suprimentos também altera.
create or replace function public.salvar_emails_empresa(p_empresa uuid, p_emails text) returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  item text;
  lista text[] := '{}';
  v_novo text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o administrativo e o Suprimentos alteram os e-mails da empresa'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Empresa não encontrada'; end if;
  foreach item in array regexp_split_to_array(lower(btrim(coalesce(p_emails, ''))), '[,;[:space:]]+') loop
    if item = '' then continue; end if;
    if item !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'E-mail inválido: %', item using errcode = '22023'; end if;
    if not item = any (lista) then lista := lista || item; end if;
  end loop;
  if cardinality(lista) > 10 then raise exception 'Informe até 10 e-mails'; end if;
  v_novo := nullif(array_to_string(lista, '; '), '');
  if v_novo is distinct from e.email_contato then
    update public.empresas set email_contato = v_novo where id = p_empresa;
    perform app.registrar_evento('empresas', p_empresa, 'emails_alterados', jsonb_build_object('de', e.email_contato, 'para', v_novo));
  end if;
  return v_novo;
end $$;

-- Lista (ou um fornecedor, com p_empresa) com cadastro, contratos, documentos da empresa e números dos colaboradores.
create or replace function public.fornecedores_cadastro(p_empresa uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.* from public.empresas e
    where app.eh_gestao_fornecedor() and (case when p_empresa is null then e.ativa else e.id = p_empresa end)
  ),
  docs as (
    select distinct on (p.empresa_id, p.tipo_codigo) p.empresa_id, p.tipo_codigo, p.documento, p.impeditivo, p.situacao, p.vencimento
    from public.v_pendencias p
    where p.grupo = 'empresa' and p.empresa_id in (select id from emp)
    order by p.empresa_id, p.tipo_codigo,
      case p.situacao when 'vencido' then 1 when 'nao_enviado' then 2 when 'devolvido' then 3 when 'a_vencer' then 4 when 'em_analise' then 5 else 6 end
  ),
  colab as (
    select p.empresa_id,
      count(distinct p.colaborador_id) filter (where p.situacao = 'vencido') as com_vencido,
      count(distinct p.colaborador_id) filter (where p.situacao = 'a_vencer') as com_vencendo
    from public.v_pendencias p
    where p.grupo = 'colaborador' and p.empresa_id in (select id from emp)
    group by p.empresa_id
  ),
  aloc as (
    select c.empresa_id,
      count(distinct c.id) filter (where a.status <> 'encerrado') as em_obra,
      count(distinct c.id) filter (where a.status = 'liberado') as liberados
    from public.alocacoes a join public.colaboradores c on c.id = a.colaborador_id
    where c.empresa_id in (select id from emp) and c.situacao = 'ativo'
    group by c.empresa_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'ativa', e.ativa, 'homologacao', e.homologacao,
    'codigo_bp', e.codigo_bp, 'liberado_em', e.portal_liberado_em, 'email_acesso', e.email_acesso, 'emails_contato', e.email_contato,
    'dados', coalesce(h.dados, '{}'::jsonb) - 'referencias' - 'email',
    'subcontratada', exists (select 1 from public.empresas_obras eo where eo.empresa_id = e.id and eo.ativo)
                     and not exists (select 1 from public.empresas_obras eo where eo.empresa_id = e.id and eo.ativo and not eo.subcontratada),
    'obras', coalesce((select jsonb_agg(o.nome order by o.nome) from public.empresas_obras eo join public.obras o on o.id = eo.obra_id
                       where eo.empresa_id = e.id and eo.ativo and o.ativa), '[]'::jsonb),
    'contratos_ativos', (select count(*) from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo'),
    'proximo_termino', (select min(c.termino) from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo'),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('nome', d.documento, 'situacao', d.situacao, 'vencimento', d.vencimento, 'impeditivo', d.impeditivo)
                            order by d.documento) from docs d where d.empresa_id = e.id), '[]'::jsonb),
    'certidoes', coalesce((
      select jsonb_agg(jsonb_build_object('nome', t.nome, 'vencimento', x.vencimento) order by x.vencimento)
      from public.homologacao_documentos x join public.homologacao_tipos t on t.codigo = x.tipo_codigo
      where x.empresa_id = e.id and x.status = 'aprovado' and x.vencimento is not null and x.vencimento <= current_date + 15
        and not exists (select 1 from public.homologacao_documentos n where n.empresa_id = x.empresa_id and n.tipo_codigo = x.tipo_codigo
                        and n.status = 'em_analise' and n.enviado_em > x.enviado_em)), '[]'::jsonb),
    'colaboradores', jsonb_build_object('em_obra', coalesce(al.em_obra, 0), 'liberados', coalesce(al.liberados, 0),
                                        'com_vencido', coalesce(cl.com_vencido, 0), 'com_vencendo', coalesce(cl.com_vencendo, 0))
  ) order by e.razao_social), '[]'::jsonb)
  from emp e
  left join public.homologacoes h on h.empresa_id = e.id
  left join colab cl on cl.empresa_id = e.id
  left join aloc al on al.empresa_id = e.id;
$$;

-- Edição do cadastro pelo Suprimentos (CNPJ e e-mail de acesso não mudam por aqui).
create or replace function public.salvar_cadastro_fornecedor(p_empresa uuid, p_razao text, p_emails text, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_antes jsonb;
  v_novos jsonb := '{}'::jsonb;
  v_razao text := upper(regexp_replace(btrim(coalesce(p_razao, '')), '\s+', ' ', 'g'));
  k text;
  v text;
  v_mudou text[] := '{}';
  permitidos text[] := array['nome_fantasia', 'ramo', 'praca', 'inscricao_estadual', 'inscricao_municipal', 'cep', 'endereco', 'numero',
                             'complemento', 'bairro', 'cidade', 'estado', 'contato', 'telefone', 'celular', 'email_empresa', 'banco', 'agencia', 'conta'];
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos altera o cadastro do fornecedor'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Fornecedor não encontrado'; end if;
  if length(v_razao) < 3 then raise exception 'Informe a razão social'; end if;
  if jsonb_typeof(coalesce(p_dados, '{}'::jsonb)) <> 'object' then raise exception 'Dados inválidos'; end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_dados, '{}'::jsonb)) loop
    if not k = any (permitidos) then continue; end if;
    v := btrim(coalesce(v, ''));
    if length(v) > 500 then raise exception 'Texto muito longo em %', k; end if;
    v_novos := v_novos || jsonb_build_object(k, v);
  end loop;
  if coalesce(v_novos ->> 'email_empresa', '') <> '' and v_novos ->> 'email_empresa' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail da empresa inválido';
  end if;
  if coalesce(v_novos ->> 'estado', '') <> '' and v_novos ->> 'estado' !~* '^[a-z]{2}$' then raise exception 'Estado: use a sigla, ex.: SP'; end if;

  select dados into v_antes from public.homologacoes where empresa_id = p_empresa;
  if not found then
    insert into public.homologacoes (empresa_id, dados, convidada_em) values (p_empresa, '{}'::jsonb, null);
    v_antes := '{}'::jsonb;
  end if;
  for k in select jsonb_object_keys(v_novos) loop
    if coalesce(v_antes ->> k, '') <> coalesce(v_novos ->> k, '') then v_mudou := v_mudou || k; end if;
  end loop;
  if v_razao <> e.razao_social then
    v_mudou := v_mudou || 'razao_social';
    update public.empresas set razao_social = v_razao where id = p_empresa;
  end if;
  update public.homologacoes
     set dados = coalesce(dados, '{}'::jsonb) || v_novos || jsonb_build_object('razao_social', v_razao), atualizado_em = now()
   where empresa_id = p_empresa;
  if p_emails is not null then perform public.salvar_emails_empresa(p_empresa, p_emails); end if;
  if cardinality(v_mudou) > 0 then
    perform app.registrar_evento('empresas', p_empresa, 'cadastro_alterado',
      jsonb_build_object('campos', to_jsonb(v_mudou), 'razao_social', case when v_razao <> e.razao_social then jsonb_build_object('de', e.razao_social, 'para', v_razao) end));
  end if;
end $$;

revoke all on function public.fornecedores_cadastro(uuid) from public, anon;
revoke all on function public.salvar_cadastro_fornecedor(uuid, text, text, jsonb) from public, anon;
grant execute on function public.fornecedores_cadastro(uuid), public.salvar_cadastro_fornecedor(uuid, text, text, jsonb),
  public.salvar_emails_empresa(uuid, text) to authenticated;
