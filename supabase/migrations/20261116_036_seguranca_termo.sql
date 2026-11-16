-- Segurança da obra: termo de uso do alojamento (entrada do colaborador).
-- Documento assinado não muda: só inclusão. As assinaturas sobem antes, na pasta do alojamento
-- (termo/<alojamento>/...), e o termo é gravado já com os caminhos.

alter table public.seg_termos_alojamento
  add column funcao text,
  add column data_ingresso date,
  add column local text,
  add column representante_nome text,
  add column representante_assinatura text;

create or replace function app.seg_antes_gravar_termo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pasta text := 'termo/' || new.alojamento_id || '/';
begin
  if length(btrim(coalesce(new.nome, ''))) < 3 then raise exception 'Informe o nome do colaborador'; end if;
  if length(btrim(coalesce(new.representante_nome, ''))) < 3 then raise exception 'Informe o responsável da empresa'; end if;
  if new.assinatura is null or new.representante_assinatura is null then raise exception 'Colete as duas assinaturas'; end if;
  if left(new.assinatura, length(v_pasta)) <> v_pasta or left(new.representante_assinatura, length(v_pasta)) <> v_pasta then
    raise exception 'Assinatura fora da pasta do alojamento';
  end if;
  if new.colaborador_id is not null and not exists (
    select 1 from public.colaboradores c join public.seg_alojamentos a on a.id = new.alojamento_id
    where c.id = new.colaborador_id and c.empresa_id = a.empresa_id) then
    raise exception 'O colaborador não é do fornecedor responsável pelo alojamento';
  end if;
  new.criado_por := coalesce(new.criado_por, auth.uid());
  new.criado_em := now();
  return new;
end $$;
create trigger seg_termos_antes before insert on public.seg_termos_alojamento
  for each row execute function app.seg_antes_gravar_termo();

-- Arquivos do termo ficam na pasta do alojamento (o termo só existe depois das assinaturas).
create or replace function app.seg_arquivo(p_caminho text, p_gravar boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  partes text[] := string_to_array(p_caminho, '/');
  v_id uuid;
  v_obra uuid;
  v_empresa uuid;
  v_situacao text;
begin
  if array_length(partes, 1) < 3 then return false; end if;
  begin
    v_id := partes[2]::uuid;
  exception when others then
    return false;
  end;
  if partes[1] = 'vistoria' then
    select v.obra_id, a.empresa_id, v.situacao into v_obra, v_empresa, v_situacao
    from public.seg_vistorias v left join public.seg_alojamentos a on a.id = v.alojamento_id where v.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return v_situacao = 'rascunho' and app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra) or (v_situacao = 'concluida' and v_empresa in (select app.minhas_empresas()));
  elsif partes[1] = 'nc' then
    select v.obra_id, n.empresa_id, n.situacao into v_obra, v_empresa, v_situacao
    from public.seg_nao_conformidades n join public.seg_vistorias v on v.id = n.vistoria_id where n.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return v_situacao in ('aberta', 'reaberta') and (v_empresa in (select app.minhas_empresas()) or app.eh_admin()); end if;
    return app.ve_obra_seguranca(v_obra) or v_empresa in (select app.minhas_empresas());
  elsif partes[1] = 'ficha' then
    select m.obra_id into v_obra
    from public.seg_fichas_maquina f join public.seg_maquinas m on m.id = f.maquina_id where f.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  elsif partes[1] = 'termo' then
    select a.obra_id into v_obra from public.seg_alojamentos a where a.id = v_id;
    if v_obra is null then return false; end if;
    if p_gravar then return app.tst_da_obra(v_obra); end if;
    return app.ve_obra_seguranca(v_obra);
  end if;
  return false;
end $$;
