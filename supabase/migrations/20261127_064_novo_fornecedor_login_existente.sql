-- Novo fornecedor com o e-mail de um login de fornecedor que já existe (ex.: escritório de contabilidade que cuida
-- de várias empresas): o cadastro aceita, e a empresa nova entra nesse mesmo acesso (a função gerenciar-acesso liga).
-- E-mail de login de outro perfil (administrativo, Suprimentos, TST, engenharia) continua recusado.

create or replace function public.cadastrar_fornecedor_homologacao(p_razao text, p_cnpj text, p_email text, p_contato text, p_obras uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos cadastra fornecedores'; end if;
  if length(btrim(coalesce(p_razao, ''))) < 3 then raise exception 'Informe a razão social'; end if;
  if length(v_cnpj) <> 14 then raise exception 'Informe o CNPJ com 14 números'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido'; end if;
  if exists (select 1 from public.empresas where regexp_replace(cnpj, '\D', '', 'g') = v_cnpj) then
    raise exception 'Já existe uma empresa com este CNPJ no portal';
  end if;
  if exists (select 1 from public.usuarios where lower(email) = v_email and perfil <> 'fornecedor') then
    raise exception 'Este e-mail já é o login de um acesso da Emais. Use o e-mail do fornecedor';
  end if;
  insert into public.empresas (razao_social, cnpj, email_contato, homologacao, portal_liberado_em, origem)
  values (upper(btrim(p_razao)), v_cnpj, null, 'convidada', null, 'portal')
  returning id into v_id;
  insert into public.homologacoes (empresa_id, dados, obras_previstas, convidada_por)
  values (v_id, jsonb_build_object('email', v_email, 'contato', nullif(btrim(coalesce(p_contato, '')), '')),
          coalesce((select array_agg(o.id) from public.obras o where o.id = any (coalesce(p_obras, '{}')) and o.ativa), '{}'), auth.uid());
  perform app.registrar_evento('empresas', v_id, 'homologacao_cadastrada', jsonb_build_object('cnpj', v_cnpj, 'email', v_email));
  return v_id;
end $$;
