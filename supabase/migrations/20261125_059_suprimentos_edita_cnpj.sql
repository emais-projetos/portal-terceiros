-- O Suprimentos também corrige o CNPJ do fornecedor (o e-mail de acesso muda pela função gerenciar-acesso,
-- porque é o login). A troca fica registrada com o valor anterior.

create or replace function app.cnpj_valido(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  pesos1 int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  pesos2 int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  s int := 0;
  d1 int;
  d2 int;
  i int;
begin
  if length(c) <> 14 or c ~ '^(\d)\1+$' then return false; end if;
  for i in 1..12 loop s := s + substr(c, i, 1)::int * pesos1[i]; end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0;
  for i in 1..13 loop s := s + substr(c, i, 1)::int * pesos2[i]; end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return substr(c, 13, 1)::int = d1 and substr(c, 14, 1)::int = d2;
end $$;

drop function if exists public.salvar_cadastro_fornecedor(uuid, text, text, jsonb);

create or replace function public.salvar_cadastro_fornecedor(p_empresa uuid, p_razao text, p_cnpj text, p_emails text, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_antes jsonb;
  v_novos jsonb := '{}'::jsonb;
  v_razao text := upper(regexp_replace(btrim(coalesce(p_razao, '')), '\s+', ' ', 'g'));
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
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
  if v_cnpj is not null and v_cnpj <> e.cnpj then
    if not app.cnpj_valido(v_cnpj) then raise exception 'CNPJ inválido. Confira os números'; end if;
    if exists (select 1 from public.empresas where cnpj = v_cnpj and id <> p_empresa) then
      raise exception 'Já existe outra empresa com este CNPJ no portal';
    end if;
  end if;
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
    v_mudou := v_mudou || 'razao_social'::text;
    update public.empresas set razao_social = v_razao where id = p_empresa;
  end if;
  if v_cnpj is not null and v_cnpj <> e.cnpj then
    v_mudou := v_mudou || 'cnpj'::text;
    update public.empresas set cnpj = v_cnpj where id = p_empresa;
  end if;
  update public.homologacoes
     set dados = coalesce(dados, '{}'::jsonb) || v_novos || jsonb_build_object('razao_social', v_razao), atualizado_em = now()
   where empresa_id = p_empresa;
  if p_emails is not null then perform public.salvar_emails_empresa(p_empresa, p_emails); end if;
  if cardinality(v_mudou) > 0 then
    perform app.registrar_evento('empresas', p_empresa, 'cadastro_alterado', jsonb_strip_nulls(jsonb_build_object(
      'campos', to_jsonb(v_mudou),
      'razao_social', case when v_razao <> e.razao_social then jsonb_build_object('de', e.razao_social, 'para', v_razao) end,
      'cnpj', case when v_cnpj is not null and v_cnpj <> e.cnpj then jsonb_build_object('de', e.cnpj, 'para', v_cnpj) end)));
  end if;
end $$;

revoke all on function public.salvar_cadastro_fornecedor(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.salvar_cadastro_fornecedor(uuid, text, text, text, jsonb) to authenticated;
