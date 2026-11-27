-- Consulta do CNPJ na Receita (fluxo "Portal de Terceiros - Consulta CNPJ na Receita" do n8n, chamado pela função consultar-cnpj).
-- A última consulta de cada CNPJ fica guardada: mostra a situação na Receita no cadastro e preenche o F.31 do fornecedor novo.
-- Só a função (chave de serviço) grava; o Suprimentos e o administrativo leem.

create table if not exists public.consultas_receita (
  cnpj            text primary key check (cnpj ~ '^\d{14}$'),
  situacao        text,
  resultado       jsonb not null,
  consultada_em   timestamptz not null default now(),
  consultada_por  uuid references public.usuarios (id) on delete set null
);
alter table public.consultas_receita enable row level security;
drop policy if exists "gestao le" on public.consultas_receita;
create policy "gestao le" on public.consultas_receita for select to authenticated using (app.eh_gestao_fornecedor());
grant select on public.consultas_receita to authenticated;

-- Campos do F.31 que vêm da Receita (consulta dos últimos 7 dias). A razão social fica a do cadastro; o e-mail da Receita
-- costuma ser o do contador, então não entra.
create or replace function app.dados_f31_da_receita(p_cnpj text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_object_agg(t.k, btrim(t.v))
    from public.consultas_receita r, jsonb_each_text(case when jsonb_typeof(r.resultado -> 'preenche_no_portal') = 'object' then r.resultado -> 'preenche_no_portal' else '{}'::jsonb end) t(k, v)
    where r.cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g') and r.consultada_em > now() - interval '7 days'
      and t.k in ('nome_fantasia', 'ramo', 'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'telefone', 'inscricao_estadual')
      and length(btrim(coalesce(t.v, ''))) > 0
  ), '{}'::jsonb);
$$;
revoke all on function app.dados_f31_da_receita(text) from public, anon, authenticated;

-- Fornecedor novo: o F.31 já nasce com os dados da Receita (o fornecedor confere e completa).
do $$
declare
  f text := pg_get_functiondef('public.cadastrar_fornecedor_homologacao(text, text, text, text, uuid[], text[])'::regprocedure);
  antiga text := $x$values (v_id, jsonb_build_object('email', v_email, 'contato',$x$;
begin
  if strpos(f, 'dados_f31_da_receita') > 0 then return; end if;
  if strpos(f, antiga) = 0 then raise exception 'cadastrar_fornecedor_homologacao mudou: revise o preenchimento pela Receita'; end if;
  execute replace(f, antiga, $x$values (v_id, app.dados_f31_da_receita(v_cnpj) || jsonb_build_object('email', v_email, 'contato',$x$);
end $$;

-- Cadastro: a última consulta na Receita de cada fornecedor.
do $$
declare
  f text := pg_get_functiondef('public.fornecedores_cadastro(uuid)'::regprocedure);
  antiga text := $x$'categorias', to_jsonb(e.categorias),$x$;
begin
  if strpos(f, 'consultas_receita') > 0 then return; end if;
  if strpos(f, antiga) = 0 then raise exception 'fornecedores_cadastro mudou: revise a inclusão da Receita'; end if;
  execute replace(f, antiga, antiga || $x$
    'receita', (select jsonb_build_object('situacao', r.situacao, 'consultada_em', r.consultada_em,
                  'aviso', r.resultado ->> 'aviso_para_o_suprimentos', 'situacao_desde', r.resultado ->> 'situacao_desde',
                  'abertura', r.resultado -> 'so_para_consulta' ->> 'abertura', 'cnae', r.resultado -> 'so_para_consulta' ->> 'cnae_principal')
                from public.consultas_receita r where r.cnpj = regexp_replace(e.cnpj, '\D', '', 'g')),$x$);
end $$;

select app.travar_visualizacao_em_tudo();
