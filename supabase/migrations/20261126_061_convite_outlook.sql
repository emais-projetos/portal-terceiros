-- Convite da homologação:
-- 1. O cadastro recusa, antes de criar a empresa, um e-mail que já é login de outro acesso do portal.
-- 2. Reenviar o convite troca o que ainda está na fila (não manda dois e-mails iguais).
-- 3. O Suprimentos pode mandar o convite pelo próprio Outlook; aí marca o item da fila como enviado à mão,
--    para o envio automático não mandar de novo.

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
  if exists (select 1 from public.usuarios where lower(email) = v_email) then
    raise exception 'Este e-mail já é o login de outro acesso do portal. Use o e-mail do fornecedor';
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

create or replace function public.enviar_convite_homologacao(p_empresa uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  h public.homologacoes;
  e public.empresas;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos'; end if;
  select * into e from public.empresas where id = p_empresa;
  select * into h from public.homologacoes where empresa_id = p_empresa;
  if h.empresa_id is null then raise exception 'Fornecedor não está em homologação'; end if;
  if e.homologacao not in ('convidada', 'devolvida') then raise exception 'A homologação já foi enviada pelo fornecedor'; end if;
  -- O convite que ainda não saiu é trocado pelo novo (e-mail e texto atualizados).
  delete from public.envios_fila
   where empresa_id = p_empresa and tipo = 'convite_homologacao' and situacao_envio in ('aguardando', 'erro', 'sem_email');
  perform app.registrar_evento('empresas', p_empresa, 'convite_homologacao', jsonb_build_object('para', coalesce(e.email_acesso, h.dados ->> 'email')));
  return app.enfileirar_email('convite_homologacao', p_empresa,
    jsonb_build_object('email', coalesce(e.email_acesso, h.dados ->> 'email')), null, coalesce(e.email_acesso, h.dados ->> 'email'));
end $$;

create or replace function public.marcar_envio_manual(p_envio uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.envios_fila;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos e o administrativo'; end if;
  select * into f from public.envios_fila where id = p_envio for update;
  if f.id is null then raise exception 'E-mail não encontrado na fila'; end if;
  if f.situacao_envio not in ('aguardando', 'erro', 'sem_email') then raise exception 'Este e-mail já foi enviado'; end if;
  update public.envios_fila
     set situacao_envio = 'enviado', enviado_em = now(), envio_para = 'Outlook (enviado à mão)', envio_erro = null
   where id = p_envio;
  perform app.registrar_evento('empresas', f.empresa_id, 'email_enviado_outlook', jsonb_build_object('tipo', f.tipo, 'para', f.para));
end $$;

revoke all on function public.marcar_envio_manual(uuid) from public, anon;
grant execute on function public.marcar_envio_manual(uuid), public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[]),
  public.enviar_convite_homologacao(uuid) to authenticated;
