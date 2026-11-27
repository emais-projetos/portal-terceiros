-- Categorias de serviço: lista padrão que o Suprimentos mantém em Configuração (incluir, editar, remover).
-- O fornecedor escolhe uma ou mais no F.31; o Suprimentos ajusta no cadastro. O "Ramo de atividade" em texto livre continua.

create table if not exists public.categorias_servico (
  codigo     text primary key,
  nome       text not null,
  ordem      integer not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
alter table public.categorias_servico enable row level security;
drop policy if exists leitura on public.categorias_servico;
create policy leitura on public.categorias_servico for select to authenticated using ((select auth.uid()) is not null);
grant select on public.categorias_servico to authenticated;

insert into public.categorias_servico (codigo, nome, ordem) values
  ('terraplenagem',       'Terraplenagem',                       1),
  ('pavimentacao',        'Pavimentação',                        2),
  ('drenagem',            'Drenagem',                            3),
  ('agua_esgoto',         'Redes de água e esgoto',              4),
  ('rede_eletrica',       'Rede elétrica e iluminação pública',  5),
  ('instalacoes_eletricas','Instalações elétricas',              6),
  ('instalacoes_hidraulicas','Instalações hidráulicas',          7),
  ('alvenaria_estrutura', 'Alvenaria e estrutura',               8),
  ('concreto_formas',     'Concreto, fôrmas e armação',          9),
  ('muros_cercamento',    'Muros e cercamento',                 10),
  ('pintura',             'Pintura',                            11),
  ('paisagismo',          'Paisagismo',                         12),
  ('sinalizacao',         'Sinalização viária',                 13),
  ('topografia',          'Topografia',                         14),
  ('sondagem',            'Sondagem e geotecnia',               15),
  ('projetos',            'Projetos de engenharia',             16),
  ('laudos_consultoria',  'Laudos e consultoria',               17),
  ('locacao_maquinas',    'Locação de máquinas e equipamentos', 18),
  ('transporte',          'Transporte e frete',                 19),
  ('materiais',           'Materiais de construção',            20),
  ('limpeza',             'Limpeza e conservação',              21),
  ('seguranca_portaria',  'Segurança patrimonial e portaria',   22)
on conflict (codigo) do nothing;

alter table public.empresas add column if not exists categorias text[] not null default '{}';

-- Categorias válidas, sem repetição, na ordem da lista. Vazio é permitido.
create or replace function app.normalizar_categorias(p_categorias text[]) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare fora text;
begin
  if coalesce(cardinality(p_categorias), 0) = 0 then return '{}'; end if;
  select string_agg(x, ', ') into fora from unnest(p_categorias) x
   where not exists (select 1 from public.categorias_servico c where c.codigo = x and c.ativo);
  if fora is not null then raise exception 'Categoria de serviço não encontrada: %', fora; end if;
  return array(select c.codigo from public.categorias_servico c where c.codigo = any (p_categorias) order by c.ordem);
end $$;
revoke all on function app.normalizar_categorias(text[]) from public, anon, authenticated;

-- Inclui (p_codigo nulo) ou renomeia uma categoria.
create or replace function public.salvar_categoria_servico(p_codigo text, p_nome text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.categorias_servico;
  v_nome text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_codigo text;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura as categorias de serviço'; end if;
  if length(v_nome) < 3 or length(v_nome) > 80 then raise exception 'Escreva o nome da categoria (de 3 a 80 letras)'; end if;
  if exists (select 1 from public.categorias_servico where ativo and lower(nome) = lower(v_nome) and codigo is distinct from p_codigo) then
    raise exception 'Já existe uma categoria com este nome';
  end if;
  if p_codigo is null then
    v_codigo := 'cat_' || substr(md5(gen_random_uuid()::text), 1, 10);
    insert into public.categorias_servico (codigo, nome, ordem)
    values (v_codigo, v_nome, (select coalesce(max(ordem), 0) + 1 from public.categorias_servico));
    insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
    values ('categorias_servico', '00000000-0000-0000-0000-000000000000', 'categoria_servico_incluida', jsonb_build_object('codigo', v_codigo, 'nome', v_nome), auth.uid());
    return v_codigo;
  end if;
  select * into c from public.categorias_servico where codigo = p_codigo and ativo for update;
  if c.codigo is null then raise exception 'Categoria não encontrada'; end if;
  if c.nome = v_nome then return p_codigo; end if;
  update public.categorias_servico set nome = v_nome where codigo = p_codigo;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('categorias_servico', '00000000-0000-0000-0000-000000000000', 'categoria_servico_alterada',
          jsonb_build_object('codigo', p_codigo, 'nome', v_nome, 'nome_antes', c.nome), auth.uid());
  return p_codigo;
end $$;

-- Remove a categoria da lista e dos fornecedores que estavam com ela.
create or replace function public.remover_categoria_servico(p_codigo text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  c public.categorias_servico;
  n integer;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura as categorias de serviço'; end if;
  select * into c from public.categorias_servico where codigo = p_codigo and ativo for update;
  if c.codigo is null then raise exception 'Categoria não encontrada'; end if;
  update public.categorias_servico set ativo = false where codigo = p_codigo;
  update public.empresas set categorias = array_remove(categorias, p_codigo) where p_codigo = any (categorias);
  get diagnostics n = row_count;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('categorias_servico', '00000000-0000-0000-0000-000000000000', 'categoria_servico_removida',
          jsonb_build_object('codigo', p_codigo, 'nome', c.nome, 'fornecedores', n), auth.uid());
  return n;
end $$;

create or replace function public.lista_categorias_servico() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nome', c.nome, 'ordem', c.ordem,
    'fornecedores', (select count(*) from public.empresas e where e.situacao_fornecedor <> 'inativo' and c.codigo = any (e.categorias))) order by c.nome), '[]'::jsonb)
  from public.categorias_servico c
  where c.ativo and app.eh_gestao_fornecedor();
$$;

-- Categorias de um fornecedor, ajustadas pelo Suprimentos.
create or replace function public.definir_categorias_fornecedor(p_empresa uuid, p_categorias text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v text[];
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos ajusta as categorias do fornecedor'; end if;
  select * into e from public.empresas where id = p_empresa for update;
  if e.id is null then raise exception 'Fornecedor não encontrado'; end if;
  v := app.normalizar_categorias(p_categorias);
  if v = e.categorias then return; end if;
  update public.empresas set categorias = v where id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'categorias_alteradas', jsonb_build_object('de', to_jsonb(e.categorias), 'para', to_jsonb(v)));
end $$;

create or replace function public.historico_configuracao_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'em' desc), '[]'::jsonb) from (
    select jsonb_build_object('em', ev.criado_em, 'quem', u.nome, 'acao', ev.acao, 'detalhe', ev.detalhe) x
    from public.eventos ev left join public.usuarios u on u.id = ev.usuario_id
    where app.eh_gestao_fornecedor()
      and ev.acao in ('campo_homologacao_alterado', 'documento_homologacao_alterado', 'item_homologacao_incluido', 'item_homologacao_removido',
                      'tipo_fornecedor_incluido', 'tipo_fornecedor_alterado', 'tipo_fornecedor_removido',
                      'categoria_servico_incluida', 'categoria_servico_alterada', 'categoria_servico_removida')
    order by ev.criado_em desc limit 50
  ) s;
$$;

-- No F.31: campo "Categorias de serviço", logo depois do ramo de atividade. Obrigatório por padrão (o Suprimentos muda em Configuração).
update public.homologacao_campos set ordem = ordem + 1 where ordem > 3 and not exists (select 1 from public.homologacao_campos where campo = 'categorias');
insert into public.homologacao_campos (campo, rotulo, secao, ordem, obrigatorio, fixo)
values ('categorias', 'Categorias de serviço', 'Dados da empresa', 4, true, false)
on conflict (campo) do nothing;

-- O fornecedor salva as categorias junto com o F.31 (ficam na empresa, não nos dados do formulário).
create or replace function public.salvar_homologacao(p_empresa uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.empresas;
  v_cat text[];
begin
  if p_empresa not in (select app.minhas_empresas_cadastro()) then raise exception 'Sem permissão para esta empresa'; end if;
  select * into e from public.empresas where id = p_empresa;
  if e.homologacao not in ('convidada', 'devolvida') then raise exception 'A homologação já foi enviada. Aguarde a análise do Suprimentos'; end if;
  if jsonb_typeof(coalesce(p_dados, '{}'::jsonb)) <> 'object' or length(p_dados::text) > 20000 then raise exception 'Dados inválidos'; end if;
  if p_dados ? 'categorias' then
    if jsonb_typeof(p_dados -> 'categorias') <> 'array' then raise exception 'Categorias inválidas'; end if;
    v_cat := app.normalizar_categorias(array(select jsonb_array_elements_text(p_dados -> 'categorias')));
    if v_cat is distinct from e.categorias then update public.empresas set categorias = v_cat where id = p_empresa; end if;
  end if;
  -- O e-mail do convite fica guardado; o resto vem do formulário.
  update public.homologacoes set dados = (p_dados - 'categorias') || jsonb_build_object('email', dados ->> 'email'), atualizado_em = now() where empresa_id = p_empresa;
end $$;

-- Funções de antes, com as categorias.
-- Funções de antes, com as categorias: troca de trecho sobre a definição atual (preserva os ajustes feitos depois).
do $$
declare
  nome text;
  f text;
  antiga text := $x$'tipos', to_jsonb(e.tipos),$x$;
  nova text := $x$'tipos', to_jsonb(e.tipos), 'categorias', to_jsonb(e.categorias),$x$;
begin
  foreach nome in array array['public.minha_homologacao()', 'public.detalhe_homologacao(uuid)', 'public.fornecedores_cadastro(uuid)'] loop
    f := pg_get_functiondef(nome::regprocedure);
    if strpos(f, 'to_jsonb(e.categorias)') > 0 then continue; end if;
    if strpos(f, antiga) = 0 then raise exception '% mudou: revise a inclusão das categorias', nome; end if;
    execute replace(f, antiga, nova);
  end loop;
end $$;

-- Envio da homologação: categorias saem da conferência genérica e têm a conferência própria.
do $$
declare
  f text := pg_get_functiondef('public.enviar_homologacao(uuid)'::regprocedure);
  a1 text := $x$c.ativo and c.obrigatorio and c.campo <> 'referencias' and$x$;
  a2 text := $x$    raise exception 'Informe pelo menos uma referência de fornecimento';
  end if;$x$;
begin
  if strpos(f, 'categoria de serviço') > 0 then return; end if;
  if strpos(f, a1) = 0 or strpos(f, a2) = 0 then raise exception 'enviar_homologacao mudou: revise a conferência das categorias'; end if;
  f := replace(f, a1, $x$c.ativo and c.obrigatorio and c.campo not in ('referencias', 'categorias') and$x$);
  f := replace(f, a2, a2 || $x$
  if (select obrigatorio and ativo from public.homologacao_campos where campo = 'categorias') and cardinality(e.categorias) = 0 then
    raise exception 'Escolha pelo menos uma categoria de serviço';
  end if;$x$);
  execute f;
end $$;

revoke all on function public.salvar_categoria_servico(text, text) from public, anon;
revoke all on function public.remover_categoria_servico(text) from public, anon;
revoke all on function public.lista_categorias_servico() from public, anon;
revoke all on function public.definir_categorias_fornecedor(uuid, text[]) from public, anon;
grant execute on function public.salvar_categoria_servico(text, text), public.remover_categoria_servico(text),
  public.lista_categorias_servico(), public.definir_categorias_fornecedor(uuid, text[]) to authenticated;

select app.travar_visualizacao_em_tudo();
