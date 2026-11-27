-- Tipos de fornecedor: mão de obra, locação com ou sem operador, serviço técnico e material.
-- Cada tipo diz se o fornecedor põe colaboradores na obra (cadastro e integração) e se entrega o mensal trabalhista.
-- Cada documento da homologação vale para um ou mais tipos; o fornecedor só vê e só precisa enviar os do(s) tipo(s) dele.
-- Uma empresa pode ter mais de um tipo. As que já estão no portal ficam como mão de obra.
-- O Suprimentos revisa os tipos e os documentos de cada um em Configuração.

-- ------------------------------------------------------------------------------------------------ Tipos
create table if not exists public.tipos_fornecedor (
  codigo         text primary key,
  nome           text not null,
  descricao      text,
  colaboradores  boolean not null default true,   -- põe gente na obra: cadastro, documentos e integração
  mensal         boolean not null default true,   -- entrega o mensal trabalhista (medição) de quem trabalhou na obra
  ordem          integer not null,
  personalizado  boolean not null default false,  -- incluído pelo Suprimentos (pode ser removido)
  ativo          boolean not null default true,
  constraint tipos_fornecedor_mensal_ck check (not mensal or colaboradores)
);
alter table public.tipos_fornecedor enable row level security;
drop policy if exists leitura on public.tipos_fornecedor;
create policy leitura on public.tipos_fornecedor for select to authenticated using ((select auth.uid()) is not null);
grant select on public.tipos_fornecedor to authenticated;

insert into public.tipos_fornecedor (codigo, nome, descricao, colaboradores, mensal, ordem) values
  ('mao_de_obra',          'Mão de obra na obra',                  'Empreiteiro ou prestador com equipe trabalhando na obra.',                         true,  true,  1),
  ('locacao_com_operador', 'Locação de equipamento com operador',  'Máquina ou equipamento que vem com operador. Só os operadores entram no portal.',  true,  true,  2),
  ('servico_tecnico',      'Serviço técnico',                      'Projeto, laudo, sondagem, topografia, consultoria. Cadastra quem vai à obra.',      true,  false, 3),
  ('locacao_sem_operador', 'Locação sem operador',                 'Equipamento, andaime, container ou ferramenta sem operador da empresa.',            false, false, 4),
  ('material',             'Material',                             'Fornecimento de material ou produto, sem equipe na obra.',                          false, false, 5)
on conflict (codigo) do nothing;

-- Tipos válidos, sem repetição, na ordem da tabela. Recusa tipo que não existe ou foi removido.
create or replace function app.normalizar_tipos_fornecedor(p_tipos text[]) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v text[];
  fora text;
begin
  if coalesce(cardinality(p_tipos), 0) = 0 then raise exception 'Escolha pelo menos um tipo de fornecedor'; end if;
  select string_agg(x, ', ') into fora from unnest(p_tipos) x
   where not exists (select 1 from public.tipos_fornecedor t where t.codigo = x and t.ativo);
  if fora is not null then raise exception 'Tipo de fornecedor não encontrado: %', fora; end if;
  select array_agg(t.codigo order by t.ordem) into v from public.tipos_fornecedor t where t.codigo = any (p_tipos);
  return v;
end $$;

-- ------------------------------------------------------------------------------------------------ Empresas
alter table public.empresas
  add column if not exists tipos text[] not null default '{mao_de_obra}',
  add column if not exists exige_colaboradores boolean not null default true,
  add column if not exists exige_mensal boolean not null default true;
alter table public.empresas drop constraint if exists empresas_tipos_ck;
alter table public.empresas add constraint empresas_tipos_ck check (cardinality(tipos) > 0);

-- O que a empresa precisa fazer no portal sai dos tipos dela (basta um tipo pedir).
create or replace function app.calcular_exigencias_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from unnest(new.tipos) x where not exists (select 1 from public.tipos_fornecedor t where t.codigo = x)) then
    raise exception 'Tipo de fornecedor não encontrado';
  end if;
  new.tipos := array(select t.codigo from public.tipos_fornecedor t where t.codigo = any (new.tipos) order by t.ordem);
  new.exige_colaboradores := exists (select 1 from public.tipos_fornecedor t where t.codigo = any (new.tipos) and t.colaboradores);
  new.exige_mensal := exists (select 1 from public.tipos_fornecedor t where t.codigo = any (new.tipos) and t.mensal);
  return new;
end $$;
drop trigger if exists empresas_exigencias on public.empresas;
create trigger empresas_exigencias before insert or update of tipos on public.empresas
  for each row execute function app.calcular_exigencias_empresa();

-- Mudou o que o tipo pede: recalcula as empresas desse tipo.
create or replace function app.tipo_fornecedor_mudou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.colaboradores is distinct from old.colaboradores or new.mensal is distinct from old.mensal then
    update public.empresas set tipos = tipos where new.codigo = any (tipos);
  end if;
  return null;
end $$;
drop trigger if exists tipos_fornecedor_mudou on public.tipos_fornecedor;
create trigger tipos_fornecedor_mudou after update on public.tipos_fornecedor
  for each row execute function app.tipo_fornecedor_mudou();

-- ------------------------------------------------------------------------------------------------ Documentos por tipo
alter table public.homologacao_tipos add column if not exists tipos_fornecedor text[] not null default '{}';

-- Fiscais e cadastrais: todos os tipos. SST e órgão regulador: quem tem equipe trabalhando na obra.
update public.homologacao_tipos
   set tipos_fornecedor = case when codigo in ('pgr', 'pcmso', 'orgao_regulador') then '{mao_de_obra,locacao_com_operador}'::text[]
                               else '{mao_de_obra,locacao_com_operador,servico_tecnico,locacao_sem_operador,material}'::text[] end
 where tipos_fornecedor = '{}';

insert into public.homologacao_tipos (codigo, nome, ordem, obrigatorio, validade_dias, observacao, tipos_fornecedor) values
  ('documentos_maquina',  'Documentos da máquina ou equipamento',        (select coalesce(max(ordem), 0) + 1 from public.homologacao_tipos), true,  365,
   'Nota fiscal ou contrato de locação, plano de manutenção e laudo ou certificado de inspeção.', '{locacao_com_operador}'),
  ('art_conselho',        'ART/RRT ou registro no conselho de classe',   (select coalesce(max(ordem), 0) + 2 from public.homologacao_tipos), true,  365,
   'Registro da empresa ou do responsável técnico no CREA, CAU ou outro conselho.', '{servico_tecnico}'),
  ('certificado_produto', 'Certificado ou ficha técnica do produto',     (select coalesce(max(ordem), 0) + 3 from public.homologacao_tipos), false, null,
   'Se houver: certificado do Inmetro, laudo de ensaio ou ficha técnica.', '{material}')
on conflict (codigo) do nothing;

-- ------------------------------------------------------------------------------------------------ Configuração (Suprimentos)
-- Inclui (p_codigo nulo) ou altera um tipo. No tipo novo, p_copiar_de traz os documentos de um tipo que já existe.
create or replace function public.salvar_tipo_fornecedor(p_codigo text, p_nome text, p_descricao text, p_colaboradores boolean, p_mensal boolean, p_copiar_de text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_fornecedor;
  v_nome text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_desc text := nullif(regexp_replace(btrim(coalesce(p_descricao, '')), '\s+', ' ', 'g'), '');
  v_codigo text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura os tipos de fornecedor'; end if;
  if length(v_nome) < 3 or length(v_nome) > 80 then raise exception 'Escreva o nome do tipo (de 3 a 80 letras)'; end if;
  if length(coalesce(v_desc, '')) > 300 then raise exception 'A descrição pode ter até 300 letras'; end if;
  if p_colaboradores is null or p_mensal is null then raise exception 'Informe se o tipo tem colaboradores na obra e mensal trabalhista'; end if;
  if p_mensal and not p_colaboradores then raise exception 'Mensal trabalhista só vale para quem tem colaboradores na obra'; end if;
  if exists (select 1 from public.tipos_fornecedor where ativo and lower(nome) = lower(v_nome) and codigo is distinct from p_codigo) then
    raise exception 'Já existe um tipo com este nome';
  end if;

  if p_codigo is null then
    if p_copiar_de is not null and not exists (select 1 from public.tipos_fornecedor where codigo = p_copiar_de and ativo) then
      raise exception 'Tipo de origem dos documentos não encontrado';
    end if;
    v_codigo := 'tipo_' || substr(md5(gen_random_uuid()::text), 1, 10);
    insert into public.tipos_fornecedor (codigo, nome, descricao, colaboradores, mensal, ordem, personalizado)
    values (v_codigo, v_nome, v_desc, p_colaboradores, p_mensal, (select coalesce(max(ordem), 0) + 1 from public.tipos_fornecedor), true);
    if p_copiar_de is not null then
      update public.homologacao_tipos set tipos_fornecedor = tipos_fornecedor || v_codigo where p_copiar_de = any (tipos_fornecedor);
    end if;
    insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
    values ('tipos_fornecedor', '00000000-0000-0000-0000-000000000000', 'tipo_fornecedor_incluido',
            jsonb_build_object('codigo', v_codigo, 'nome', v_nome, 'colaboradores', p_colaboradores, 'mensal', p_mensal,
                               'copiou_de', (select nome from public.tipos_fornecedor where codigo = p_copiar_de)), auth.uid());
    return v_codigo;
  end if;

  select * into t from public.tipos_fornecedor where codigo = p_codigo and ativo for update;
  if t.codigo is null then raise exception 'Tipo de fornecedor não encontrado'; end if;
  if t.nome = v_nome and t.descricao is not distinct from v_desc and t.colaboradores = p_colaboradores and t.mensal = p_mensal then
    return p_codigo;
  end if;
  update public.tipos_fornecedor set nome = v_nome, descricao = v_desc, colaboradores = p_colaboradores, mensal = p_mensal where codigo = p_codigo;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('tipos_fornecedor', '00000000-0000-0000-0000-000000000000', 'tipo_fornecedor_alterado',
          jsonb_build_object('codigo', p_codigo, 'nome', v_nome,
            'nome_antes', case when t.nome <> v_nome then t.nome end,
            'descricao_mudou', t.descricao is distinct from v_desc,
            'colaboradores', jsonb_build_object('de', t.colaboradores, 'para', p_colaboradores),
            'mensal', jsonb_build_object('de', t.mensal, 'para', p_mensal)), auth.uid());
  return p_codigo;
end $$;

-- Remove um tipo incluído pelo Suprimentos. Antes, nenhum fornecedor ativo pode estar com ele.
create or replace function public.remover_tipo_fornecedor(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_fornecedor;
  n integer;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura os tipos de fornecedor'; end if;
  select * into t from public.tipos_fornecedor where codigo = p_codigo and ativo for update;
  if t.codigo is null then raise exception 'Tipo de fornecedor não encontrado'; end if;
  if not t.personalizado then raise exception 'Só os tipos incluídos pelo Suprimentos podem ser removidos'; end if;
  select count(*) into n from public.empresas where ativa and p_codigo = any (tipos);
  if n > 0 then
    raise exception '% com este tipo. Troque o tipo deles antes de remover', case when n = 1 then 'Há 1 fornecedor' else 'Há ' || n || ' fornecedores' end;
  end if;
  update public.tipos_fornecedor set ativo = false where codigo = p_codigo;
  update public.homologacao_tipos set tipos_fornecedor = array_remove(tipos_fornecedor, p_codigo) where p_codigo = any (tipos_fornecedor);
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('tipos_fornecedor', '00000000-0000-0000-0000-000000000000', 'tipo_fornecedor_removido',
          jsonb_build_object('codigo', p_codigo, 'nome', t.nome), auth.uid());
end $$;

-- Tipos com quantos fornecedores e documentos cada um tem (tela de configuração).
create or replace function public.lista_tipos_fornecedor() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'codigo', t.codigo, 'nome', t.nome, 'descricao', t.descricao, 'colaboradores', t.colaboradores, 'mensal', t.mensal,
    'ordem', t.ordem, 'personalizado', t.personalizado,
    'fornecedores', (select count(*) from public.empresas e where e.ativa and t.codigo = any (e.tipos)),
    'documentos', (select count(*) from public.homologacao_tipos d where d.ativo and t.codigo = any (d.tipos_fornecedor)),
    'obrigatorios', (select count(*) from public.homologacao_tipos d where d.ativo and d.obrigatorio and t.codigo = any (d.tipos_fornecedor))
  ) order by t.ordem), '[]'::jsonb)
  from public.tipos_fornecedor t
  where t.ativo and app.eh_gestao_fornecedor();
$$;

-- Tipo(s) de um fornecedor, escolhidos pelo Suprimentos.
create or replace function public.definir_tipos_fornecedor(p_empresa uuid, p_tipos text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v text[];
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos define o tipo do fornecedor'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Fornecedor não encontrado'; end if;
  v := app.normalizar_tipos_fornecedor(p_tipos);
  if v = e.tipos then return; end if;
  update public.empresas set tipos = v where id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'tipos_fornecedor_alterados',
    jsonb_build_object('de', to_jsonb(e.tipos), 'para', to_jsonb(v)));
end $$;

-- Documento: obrigatório, validade e para quais tipos vale (p_tipos nulo: não muda; vazio: não é pedido a ninguém).
drop function if exists public.configurar_documento_homologacao(text, boolean, integer);
create or replace function public.configurar_documento_homologacao(p_codigo text, p_obrigatorio boolean, p_validade_dias integer, p_tipos text[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.homologacao_tipos;
  v_tipos text[];
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  select * into t from public.homologacao_tipos where codigo = p_codigo and ativo for update;
  if t.codigo is null then raise exception 'Documento não encontrado'; end if;
  if p_obrigatorio is null then raise exception 'Informe se o documento é obrigatório'; end if;
  if p_validade_dias is not null and (p_validade_dias < 1 or p_validade_dias > 3650) then
    raise exception 'A validade precisa ficar entre 1 e 3650 dias (ou em branco, sem vencimento)';
  end if;
  v_tipos := case when p_tipos is null then t.tipos_fornecedor
                  when cardinality(p_tipos) = 0 then '{}'::text[]
                  else app.normalizar_tipos_fornecedor(p_tipos) end;
  if t.obrigatorio = p_obrigatorio and t.validade_dias is not distinct from p_validade_dias and t.tipos_fornecedor = v_tipos then return; end if;
  update public.homologacao_tipos set obrigatorio = p_obrigatorio, validade_dias = p_validade_dias, tipos_fornecedor = v_tipos where codigo = p_codigo;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('homologacao_tipos', '00000000-0000-0000-0000-000000000000', 'documento_homologacao_alterado',
          jsonb_build_object('codigo', p_codigo, 'nome', t.nome,
            'obrigatorio', jsonb_build_object('de', t.obrigatorio, 'para', p_obrigatorio),
            'validade_dias', jsonb_build_object('de', t.validade_dias, 'para', p_validade_dias),
            'tipos', jsonb_build_object(
              'entrou', (select coalesce(jsonb_agg(f.nome order by f.ordem), '[]'::jsonb) from public.tipos_fornecedor f where f.codigo = any (v_tipos) and not f.codigo = any (t.tipos_fornecedor)),
              'saiu', (select coalesce(jsonb_agg(f.nome order by f.ordem), '[]'::jsonb) from public.tipos_fornecedor f where f.codigo = any (t.tipos_fornecedor) and not f.codigo = any (v_tipos)))), auth.uid());
end $$;

-- Item novo: o documento (anexo) vale para os tipos escolhidos; sem escolha, para todos.
drop function if exists public.incluir_item_homologacao(text, text, boolean, integer);
create or replace function public.incluir_item_homologacao(p_pergunta text, p_formato text, p_obrigatorio boolean, p_validade_dias integer default null, p_tipos text[] default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pergunta text := regexp_replace(btrim(coalesce(p_pergunta, '')), '\s+', ' ', 'g');
  v_codigo text;
  v_tipos text[];
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
    v_tipos := case when p_tipos is null then array(select codigo from public.tipos_fornecedor where ativo order by ordem)
                    else app.normalizar_tipos_fornecedor(p_tipos) end;
    v_codigo := 'extra_' || substr(md5(gen_random_uuid()::text), 1, 10);
    insert into public.homologacao_tipos (codigo, nome, ordem, obrigatorio, validade_dias, personalizado, tipos_fornecedor)
    values (v_codigo, v_pergunta, (select coalesce(max(ordem), 0) + 1 from public.homologacao_tipos), p_obrigatorio, p_validade_dias, true, v_tipos);
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
          jsonb_build_object('codigo', v_codigo, 'rotulo', v_pergunta, 'formato', p_formato, 'obrigatorio', p_obrigatorio, 'validade_dias', p_validade_dias,
            'tipos', case when p_formato = 'anexo' then (select jsonb_agg(f.nome order by f.ordem) from public.tipos_fornecedor f where f.codigo = any (v_tipos)) end), auth.uid());
  return v_codigo;
end $$;

create or replace function public.historico_configuracao_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'em' desc), '[]'::jsonb) from (
    select jsonb_build_object('em', ev.criado_em, 'quem', u.nome, 'acao', ev.acao, 'detalhe', ev.detalhe) x
    from public.eventos ev left join public.usuarios u on u.id = ev.usuario_id
    where app.eh_gestao_fornecedor()
      and ev.acao in ('campo_homologacao_alterado', 'documento_homologacao_alterado', 'item_homologacao_incluido', 'item_homologacao_removido',
                      'tipo_fornecedor_incluido', 'tipo_fornecedor_alterado', 'tipo_fornecedor_removido')
    order by ev.criado_em desc limit 50
  ) s;
$$;

-- Cadastro do fornecedor novo já com o(s) tipo(s). Sem tipo, fica como mão de obra.
drop function if exists public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[]);
create or replace function public.cadastrar_fornecedor_homologacao(p_razao text, p_cnpj text, p_email text, p_contato text, p_obras uuid[], p_tipos text[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_tipos text[];
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos cadastra fornecedores'; end if;
  if length(btrim(coalesce(p_razao, ''))) < 3 then raise exception 'Informe a razão social'; end if;
  if length(v_cnpj) <> 14 then raise exception 'Informe o CNPJ com 14 números'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido'; end if;
  v_tipos := app.normalizar_tipos_fornecedor(coalesce(p_tipos, '{mao_de_obra}'));
  if exists (select 1 from public.empresas where regexp_replace(cnpj, '\D', '', 'g') = v_cnpj) then
    raise exception 'Já existe uma empresa com este CNPJ no portal';
  end if;
  if exists (select 1 from public.usuarios where lower(email) = v_email and perfil <> 'fornecedor') then
    raise exception 'Este e-mail já é o login de um acesso da Emais. Use o e-mail do fornecedor';
  end if;
  insert into public.empresas (razao_social, cnpj, email_contato, homologacao, portal_liberado_em, origem, tipos)
  values (upper(btrim(p_razao)), v_cnpj, null, 'convidada', null, 'portal', v_tipos)
  returning id into v_id;
  insert into public.homologacoes (empresa_id, dados, obras_previstas, convidada_por)
  values (v_id, jsonb_build_object('email', v_email, 'contato', nullif(btrim(coalesce(p_contato, '')), '')),
          coalesce((select array_agg(o.id) from public.obras o where o.id = any (coalesce(p_obras, '{}')) and o.ativa), '{}'), auth.uid());
  perform app.registrar_evento('empresas', v_id, 'homologacao_cadastrada', jsonb_build_object('cnpj', v_cnpj, 'email', v_email, 'tipos', to_jsonb(v_tipos)));
  return v_id;
end $$;

-- ------------------------------------------------------------------------------------------------ Leituras e verificações
-- A partir daqui: as funções de antes, com os tipos (o que mudou está marcado com "tipos" ou "mensal").
create or replace function public.minha_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.homologacao,
    'liberado', e.portal_liberado_em is not null, 'tipos', to_jsonb(e.tipos), 'dados', h.dados, 'motivo', h.motivo, 'enviada_em', h.enviada_em,
    'documentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo_codigo, 'data_emissao', d.data_emissao, 'vencimento', d.vencimento,
        'status', d.status, 'motivo', d.motivo_devolucao, 'arquivos', d.arquivos, 'enviado_em', d.enviado_em) order by d.enviado_em desc)
      from public.homologacao_documentos d where d.empresa_id = e.id and d.status <> 'substituido'), '[]'::jsonb)
  ) order by e.razao_social), '[]'::jsonb)
  from public.empresas e
  join public.homologacoes h on h.empresa_id = e.id
  where e.id in (select app.minhas_empresas_cadastro()) and e.homologacao <> 'anterior';
$$;

create or replace function public.lista_homologacoes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'ordem', x ->> 'razao_social'), '[]'::jsonb) from (
    select jsonb_build_object(
      'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.homologacao,
      'ordem', case e.homologacao when 'enviada' then '1' when 'devolvida' then '2' when 'convidada' then '3' when 'homologada' then '4' else '5' end,
      'email', coalesce(e.email_acesso, h.dados ->> 'email'), 'convidada_em', h.convidada_em, 'enviada_em', h.enviada_em,
      'decidida_em', h.decidida_em, 'tipos', to_jsonb(e.tipos), 'liberado_em', e.portal_liberado_em, 'codigo_bp', e.codigo_bp,
      'tem_acesso', exists (select 1 from public.usuarios_empresas ue join public.usuarios u on u.id = ue.usuario_id where ue.empresa_id = e.id and u.ativo),
      'contratos', (select count(*) from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo'),
      'docs_em_analise', (select count(*) from public.homologacao_documentos d where d.empresa_id = e.id and d.status = 'em_analise'),
      'docs_devolvidos', (select count(*) from public.homologacao_documentos d where d.empresa_id = e.id and d.status = 'devolvido'),
      'obras_previstas', coalesce((select jsonb_agg(o.nome order by o.nome) from public.obras o where o.id = any (h.obras_previstas)), '[]'::jsonb)
    ) x
    from public.empresas e join public.homologacoes h on h.empresa_id = e.id
    where app.eh_gestao_fornecedor() and e.homologacao <> 'anterior'
  ) s;
$$;

create or replace function public.detalhe_homologacao(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'empresa_id', e.id, 'razao_social', e.razao_social, 'cnpj', e.cnpj, 'situacao', e.homologacao, 'codigo_bp', e.codigo_bp, 'tipos', to_jsonb(e.tipos),
    'liberado_em', e.portal_liberado_em, 'email', coalesce(e.email_acesso, h.dados ->> 'email'),
    'dados', h.dados, 'qualificacao', h.qualificacao, 'comentarios', h.comentarios, 'responsavel', h.responsavel_aprovacao,
    'motivo', h.motivo, 'convidada_em', h.convidada_em, 'enviada_em', h.enviada_em, 'decidida_em', h.decidida_em,
    'decidida_por', (select nome from public.usuarios where id = h.decidida_por),
    'obras_previstas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome) order by o.nome) from public.obras o where o.id = any (h.obras_previstas)), '[]'::jsonb),
    'documentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo_codigo, 'data_emissao', d.data_emissao, 'vencimento', d.vencimento,
        'status', d.status, 'motivo', d.motivo_devolucao, 'arquivos', d.arquivos, 'enviado_em', d.enviado_em,
        'analisado_em', d.analisado_em, 'analisado_por', (select nome from public.usuarios where id = d.analisado_por)) order by d.enviado_em desc)
      from public.homologacao_documentos d where d.empresa_id = e.id and d.status <> 'substituido'), '[]'::jsonb),
    'contratos', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'codigo_bp', c.codigo_bp, 'inicio', c.inicio, 'termino', c.termino,
        'arquivo', c.arquivo, 'arquivo_nome', c.arquivo_nome, 'situacao', c.situacao,
        'obras', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome) order by o.nome) from public.contratos_obras co join public.obras o on o.id = co.obra_id where co.contrato_id = c.id), '[]'::jsonb))
        order by c.situacao, c.termino desc)
      from public.contratos_fornecedor c where c.empresa_id = e.id), '[]'::jsonb),
    'obras_ativas', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'numero_contrato', eo.numero_contrato) order by o.nome)
      from public.empresas_obras eo join public.obras o on o.id = eo.obra_id where eo.empresa_id = e.id and eo.ativo), '[]'::jsonb)
  )
  from public.empresas e left join public.homologacoes h on h.empresa_id = e.id
  where e.id = p_empresa and app.eh_gestao_fornecedor();
$$;

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
    'codigo_bp', e.codigo_bp, 'tipos', to_jsonb(e.tipos), 'exige_colaboradores', e.exige_colaboradores, 'exige_mensal', e.exige_mensal, 'liberado_em', e.portal_liberado_em, 'email_acesso', e.email_acesso, 'emails_contato', e.email_contato,
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
  where t.ativo and t.obrigatorio and t.tipos_fornecedor && e.tipos and not exists (
    select 1 from public.homologacao_documentos d where d.empresa_id = p_empresa and d.tipo_codigo = t.codigo and d.status in ('em_analise', 'aprovado'));
  if faltam is not null then raise exception 'Envie os documentos: %', faltam; end if;
  update public.empresas set homologacao = 'enviada' where id = p_empresa;
  update public.homologacoes set enviada_em = now(), motivo = null, atualizado_em = now() where empresa_id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'homologacao_enviada', '{}'::jsonb);
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
  where t.ativo and t.obrigatorio and t.tipos_fornecedor && e.tipos and not exists (
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

create or replace function public.painel_obra(p_obra uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  resultado jsonb;
  v_empresas uuid[];  -- nulo: todas as empresas da obra; fornecedor: só as dele
begin
  if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then
    v_empresas := array(select app.minhas_empresas());
    if cardinality(v_empresas) = 0 or p_obra not in (select app.obras_do_fornecedor()) then
      raise exception 'Obra fora do seu acesso';
    end if;
  end if;

  -- Pendências calculadas uma vez para a obra inteira (a visão é pesada; por colaborador ficaria lento).
  with pend as (
    select p.alocacao_id, p.documento, p.grupo, p.situacao, p.vencimento
    from public.v_pendencias p
    where p.obra_id = p_obra and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido', 'em_analise', 'a_vencer')
      and (v_empresas is null or p.empresa_id = any (v_empresas))
  ), por_alocacao as (
    select alocacao_id,
      jsonb_agg(jsonb_build_object('documento', documento, 'grupo', grupo, 'situacao', situacao, 'vencimento', vencimento) order by documento)
        filter (where situacao <> 'a_vencer') as pendencias,
      jsonb_agg(jsonb_build_object('documento', documento, 'grupo', grupo, 'vencimento', vencimento) order by vencimento)
        filter (where situacao = 'a_vencer') as a_vencer
    from pend group by alocacao_id
  )
  select jsonb_build_object(
    'obra', (select nome from public.obras where id = p_obra),
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alocacao_id', a.alocacao_id, 'colaborador', a.colaborador, 'funcao', a.funcao, 'empresa_id', a.empresa_id, 'empresa', a.empresa,
        'status', a.status, 'data_integracao', a.data_integracao, 'vencimento_integracao', a.vencimento_integracao,
        'liberado_em', a.validado_tst_em,
        'bloqueado', a.bloqueado, 'bloqueio_motivo', a.bloqueio_motivo,
        'mensal', coalesce((select x.exige_mensal from public.empresas x where x.id = a.empresa_id), true),
        'pendencias', coalesce(pa.pendencias, '[]'::jsonb),
        'a_vencer', coalesce(pa.a_vencer, '[]'::jsonb)
      ) order by a.empresa, a.colaborador)
      from public.v_alocacoes_resumo a
      left join por_alocacao pa on pa.alocacao_id = a.alocacao_id
      where a.obra_id = p_obra and a.status <> 'encerrado'
        and (v_empresas is null or a.empresa_id = any (v_empresas))
    ), '[]'::jsonb),
    'medicoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'empresa_id', m.empresa_id, 'empresa', m.empresa, 'competencia', m.competencia, 'prazo', m.prazo,
        'tolerancia', m.tolerancia, 'status', m.status, 'retida', m.retida, 'em_atraso', m.em_atraso,
        'cnpj', m.cnpj, 'obra', m.obra, 'origem', m.origem,
        'prazo_combinado', m.prazo_combinado, 'primeiro_envio_em', m.primeiro_envio_em, 'ultima_analise_em', m.ultima_analise_em,
        'itens_pendentes', coalesce((
          select jsonb_agg(t.item || '. ' || t.nome order by t.ordem)
          from public.medicoes_itens i join public.tipos_medicao t on t.codigo = i.tipo_codigo
          where i.medicao_id = m.id and t.impeditivo and i.status in ('nao_enviado', 'devolvido')
        ), '[]'::jsonb)
      ) order by m.competencia desc, m.empresa)
      from public.v_medicoes m
      where (v_empresas is null or m.empresa_id = any (v_empresas))
        and (m.obra_id = p_obra
         or (m.obra_id is null and m.empresa_id in (
              select c.empresa_id from public.alocacoes a join public.colaboradores c on c.id = a.colaborador_id
              where a.obra_id = p_obra)))
    ), '[]'::jsonb),
    'integracoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'data', i.data, 'horario', i.horario, 'local', i.local, 'responsavel', i.responsavel,
        'concluida_em', i.concluida_em,
        'participantes', (select count(*) from public.integracoes_participantes x where x.integracao_id = i.id),
        'presentes', (select count(*) from public.integracoes_participantes x where x.integracao_id = i.id and x.presente)
      ) order by i.data desc)
      from public.integracoes i
      where i.obra_id = p_obra and i.cancelada_em is null and i.data >= current_date - 90
        and v_empresas is null
    ), '[]'::jsonb)
  ) into resultado;
  return resultado;
end $$;

-- ------------------------------------------------------------------------------------------------ Permissões
revoke all on function app.normalizar_tipos_fornecedor(text[]) from public, anon, authenticated;
revoke all on function public.salvar_tipo_fornecedor(text, text, text, boolean, boolean, text) from public, anon;
revoke all on function public.remover_tipo_fornecedor(text) from public, anon;
revoke all on function public.lista_tipos_fornecedor() from public, anon;
revoke all on function public.definir_tipos_fornecedor(uuid, text[]) from public, anon;
revoke all on function public.configurar_documento_homologacao(text, boolean, integer, text[]) from public, anon;
revoke all on function public.incluir_item_homologacao(text, text, boolean, integer, text[]) from public, anon;
revoke all on function public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[], text[]) from public, anon;
grant execute on function public.salvar_tipo_fornecedor(text, text, text, boolean, boolean, text), public.remover_tipo_fornecedor(text),
  public.lista_tipos_fornecedor(), public.definir_tipos_fornecedor(uuid, text[]),
  public.configurar_documento_homologacao(text, boolean, integer, text[]), public.incluir_item_homologacao(text, text, boolean, integer, text[]),
  public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[], text[]) to authenticated;

-- Trava do "Ver como" na tabela nova.
select app.travar_visualizacao_em_tudo();
