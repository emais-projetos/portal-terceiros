-- Configuração do formulário da homologação (Suprimentos): quais dados do F.31 são obrigatórios e,
-- nos documentos, quais são obrigatórios e a validade em dias. Toda mudança fica registrada em eventos.
-- A validade nova vale para os próximos envios; o vencimento de um documento já enviado não muda.
-- Nos eventos, registro_id fica zerado: a mudança é da configuração, não de um registro.

create table if not exists public.homologacao_campos (
  campo       text primary key,
  rotulo      text not null,
  secao       text not null,
  ordem       integer not null,
  obrigatorio boolean not null default false,
  fixo        boolean not null default false   -- sempre obrigatório (não aparece como opção)
);
alter table public.homologacao_campos enable row level security;
drop policy if exists leitura on public.homologacao_campos;
create policy leitura on public.homologacao_campos for select to authenticated using ((select auth.uid()) is not null);
grant select on public.homologacao_campos to authenticated;

insert into public.homologacao_campos (campo, rotulo, secao, ordem, obrigatorio, fixo) values
  ('razao_social',        'Razão social',             'Dados da empresa',       1, true,  true),
  ('nome_fantasia',       'Nome fantasia',            'Dados da empresa',       2, false, false),
  ('ramo',                'Ramo de atividade',        'Dados da empresa',       3, true,  false),
  ('praca',               'Praça de atuação',         'Dados da empresa',       4, false, false),
  ('inscricao_estadual',  'Inscrição estadual',       'Dados da empresa',       5, false, false),
  ('inscricao_municipal', 'Inscrição municipal',      'Dados da empresa',       6, false, false),
  ('cep',                 'CEP',                      'Endereço',               7, true,  false),
  ('endereco',            'Endereço',                 'Endereço',               8, true,  false),
  ('numero',              'Número',                   'Endereço',               9, true,  false),
  ('complemento',         'Complemento',              'Endereço',              10, false, false),
  ('bairro',              'Bairro',                   'Endereço',              11, true,  false),
  ('cidade',              'Cidade',                   'Endereço',              12, true,  false),
  ('estado',              'Estado',                   'Endereço',              13, true,  false),
  ('contato',             'Pessoa de contato',        'Contato',               14, true,  false),
  ('telefone',            'Telefone',                 'Contato',               15, true,  false),
  ('celular',             'Celular',                  'Contato',               16, false, false),
  ('email_empresa',       'E-mail da empresa',        'Contato',               17, true,  true),
  ('banco',               'Banco',                    'Dados bancários',       18, true,  false),
  ('agencia',             'Agência',                  'Dados bancários',       19, true,  false),
  ('conta',               'Conta',                    'Dados bancários',       20, true,  false),
  ('referencias',         'Pelo menos uma referência comercial', 'Referências comerciais', 21, true, false)
on conflict (campo) do nothing;

-- Os documentos passam a ser configurados só pela função abaixo (com registro).
drop policy if exists edicao on public.homologacao_tipos;
revoke update on public.homologacao_tipos from authenticated;

create or replace function public.configurar_campo_homologacao(p_campo text, p_obrigatorio boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c public.homologacao_campos;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  select * into c from public.homologacao_campos where campo = p_campo for update;
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
  select * into t from public.homologacao_tipos where codigo = p_codigo for update;
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

-- Histórico das mudanças da configuração (últimas 50).
create or replace function public.historico_configuracao_homologacao() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'em' desc), '[]'::jsonb) from (
    select jsonb_build_object('em', ev.criado_em, 'quem', u.nome, 'acao', ev.acao, 'detalhe', ev.detalhe) x
    from public.eventos ev left join public.usuarios u on u.id = ev.usuario_id
    where app.eh_gestao_fornecedor() and ev.acao in ('campo_homologacao_alterado', 'documento_homologacao_alterado')
    order by ev.criado_em desc limit 50
  ) s;
$$;

-- Envio da homologação: os campos obrigatórios vêm da configuração.
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
  where c.obrigatorio and c.campo <> 'referencias' and length(btrim(coalesce(h.dados ->> c.campo, ''))) = 0;
  if faltam is not null then raise exception 'Preencha os dados obrigatórios: %', faltam; end if;
  if (select obrigatorio from public.homologacao_campos where campo = 'referencias')
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(h.dados -> 'referencias') = 'array' then h.dados -> 'referencias' else '[]'::jsonb end) r
                     where length(btrim(coalesce(r ->> 'empresa', ''))) > 0) then
    raise exception 'Informe pelo menos uma referência de fornecimento';
  end if;
  select string_agg(t.nome, ', ' order by t.ordem) into faltam
  from public.homologacao_tipos t
  where t.obrigatorio and not exists (
    select 1 from public.homologacao_documentos d where d.empresa_id = p_empresa and d.tipo_codigo = t.codigo and d.status in ('em_analise', 'aprovado'));
  if faltam is not null then raise exception 'Envie os documentos: %', faltam; end if;
  update public.empresas set homologacao = 'enviada' where id = p_empresa;
  update public.homologacoes set enviada_em = now(), motivo = null, atualizado_em = now() where empresa_id = p_empresa;
  perform app.registrar_evento('empresas', p_empresa, 'homologacao_enviada', '{}'::jsonb);
end $$;

revoke all on function public.configurar_campo_homologacao(text, boolean) from public, anon;
revoke all on function public.configurar_documento_homologacao(text, boolean, integer) from public, anon;
revoke all on function public.historico_configuracao_homologacao() from public, anon;
revoke all on function public.enviar_homologacao(uuid) from public, anon;
grant execute on function public.configurar_campo_homologacao(text, boolean), public.configurar_documento_homologacao(text, boolean, integer),
  public.historico_configuracao_homologacao(), public.enviar_homologacao(uuid) to authenticated;
