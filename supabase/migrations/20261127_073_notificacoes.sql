-- Notificações e validação de SST pelo administrativo.
-- 1) Documento da homologação "validado pelo administrativo" (PGR e PCMSO de início): só o administrativo aprova ou devolve.
-- 2) minhas_notificacoes(): tudo o que espera alguém, para todos os perfis, com "comigo" para o que é de quem está logado.

-- ------------------------------------------------------------------ 1. Validação pelo administrativo
alter table public.homologacao_tipos add column if not exists valida_admin boolean not null default false;
update public.homologacao_tipos set valida_admin = true where codigo in ('pgr', 'pcmso') and not valida_admin;

create or replace function public.marcar_validacao_admin(p_codigo text, p_valida boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t public.homologacao_tipos;
begin
  if not app.eh_gestao_fornecedor() then raise exception 'Apenas o Suprimentos configura a homologação'; end if;
  select * into t from public.homologacao_tipos where codigo = p_codigo and ativo for update;
  if t.codigo is null then raise exception 'Documento não encontrado'; end if;
  if p_valida is null or t.valida_admin = p_valida then return; end if;
  update public.homologacao_tipos set valida_admin = p_valida where codigo = p_codigo;
  insert into public.eventos (tabela, registro_id, acao, detalhe, usuario_id)
  values ('homologacao_tipos', '00000000-0000-0000-0000-000000000000', 'documento_homologacao_alterado',
          jsonb_build_object('codigo', p_codigo, 'nome', t.nome, 'valida_admin', jsonb_build_object('de', t.valida_admin, 'para', p_valida)), auth.uid());
end $$;
revoke all on function public.marcar_validacao_admin(text, boolean) from public, anon;
grant execute on function public.marcar_validacao_admin(text, boolean) to authenticated;

-- A análise do documento marcado só pode ser feita pelo administrativo (texto da função alterado por substituição).
do $$
declare
  v_def text := pg_get_functiondef('public.analisar_documento_homologacao(uuid, boolean, text)'::regprocedure);
  v_ancora text := 'then raise exception ''Documento não encontrado ou substituído''; end if;';
begin
  if strpos(v_def, 'valida_admin') > 0 then return; end if;
  if strpos(v_def, v_ancora) = 0 then raise exception 'analisar_documento_homologacao: trecho esperado não encontrado'; end if;
  execute replace(v_def, v_ancora, v_ancora || E'\n  if not app.eh_admin() and exists (select 1 from public.homologacao_tipos t where t.codigo = d.tipo_codigo and t.valida_admin) then\n    raise exception ''Este documento é validado pelo administrativo'';\n  end if;');
end $$;

-- ------------------------------------------------------------------ 2. Notificações
create or replace function public.minhas_notificacoes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_perfil text;
  v_admin boolean;
  r jsonb := '[]'::jsonb;
begin
  select u.perfil into v_perfil from public.usuarios u where u.id = v_uid and u.ativo;
  if v_perfil is null then return '[]'::jsonb; end if;
  v_admin := v_perfil = 'admin';

  if v_perfil in ('admin', 'suprimentos') then
    -- Documento de SST da homologação esperando o administrativo.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'sst-' || d.id, 'tipo', 'validar_sst', 'vez', 'admin', 'comigo', v_admin,
        'titulo', 'Validar o ' || regexp_replace(t.nome, '^SST: ', '') || ' enviado na homologação',
        'detalhe', 'O Suprimentos só homologa depois da validação do administrativo.',
        'empresa_id', e.id, 'empresa', e.razao_social, 'obra', null, 'desde', d.enviado_em, 'ref', d.id,
        'extra', jsonb_build_object('documento', regexp_replace(t.nome, '^SST: ', ''), 'data_emissao', d.data_emissao, 'vencimento', d.vencimento,
                                    'validade_dias', t.validade_dias, 'arquivos', d.arquivos)))
      from public.homologacao_documentos d
      join public.homologacao_tipos t on t.codigo = d.tipo_codigo
      join public.empresas e on e.id = d.empresa_id
      where d.status = 'em_analise' and t.valida_admin and e.situacao_fornecedor <> 'inativo'), '[]'::jsonb);

    -- Homologação enviada para o Suprimentos analisar.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'hom-' || e.id, 'tipo', 'homologacao', 'vez', 'suprimentos', 'comigo', not v_admin,
        'titulo', 'Homologação enviada para análise',
        'detalhe', nullif(concat_ws('; ',
          case when x.conferir > 0 then x.conferir || ' documento(s) para conferir' end,
          case when x.sst > 0 then x.sst || ' de SST com o administrativo' end), ''),
        'empresa_id', e.id, 'empresa', e.razao_social, 'obra', null, 'desde', coalesce(h.enviada_em, h.atualizado_em), 'ref', e.id, 'extra', null))
      from public.empresas e
      join public.homologacoes h on h.empresa_id = e.id
      cross join lateral (
        select count(*) filter (where not t.valida_admin) as conferir, count(*) filter (where t.valida_admin) as sst
        from public.homologacao_documentos d join public.homologacao_tipos t on t.codigo = d.tipo_codigo
        where d.empresa_id = e.id and d.status = 'em_analise') x
      where e.homologacao = 'enviada' and e.situacao_fornecedor = 'ativo'), '[]'::jsonb);

    -- Homologado sem contrato (antes de liberar o portal): o Suprimentos registra.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'ctr-' || e.id, 'tipo', 'registrar_contrato', 'vez', 'suprimentos', 'comigo', not v_admin,
        'titulo', 'Homologado e sem contrato registrado',
        'detalhe', 'Sem o contrato, o administrativo não consegue liberar o portal.',
        'empresa_id', e.id, 'empresa', e.razao_social, 'obra', null, 'desde', e.homologada_em, 'ref', e.id,
        'extra', jsonb_build_object('codigo_bp', e.codigo_bp, 'obras_ids', to_jsonb(coalesce(h.obras_previstas, '{}'::uuid[])))))
      from public.empresas e
      left join public.homologacoes h on h.empresa_id = e.id
      where e.homologacao = 'homologada' and e.portal_liberado_em is null and e.situacao_fornecedor = 'ativo'
        and not exists (select 1 from public.contratos_fornecedor c where c.empresa_id = e.id and c.situacao = 'ativo')), '[]'::jsonb);

    -- Homologado e com contrato: o administrativo libera o portal.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'lib-' || e.id, 'tipo', 'liberar_portal', 'vez', 'admin', 'comigo', v_admin,
        'titulo', 'Homologado e com contrato: falta liberar o portal',
        'detalhe', 'Contrato ' || c.numero || ' registrado' || coalesce(' por ' || u.nome, '') || '.',
        'empresa_id', e.id, 'empresa', e.razao_social, 'obra', c.obras, 'desde', greatest(e.homologada_em, c.criado_em), 'ref', e.id, 'extra', null))
      from public.empresas e
      cross join lateral (
        select cf.numero, cf.criado_em, cf.criado_por,
               (select string_agg(o.nome, ', ' order by o.nome) from public.contratos_obras co join public.obras o on o.id = co.obra_id where co.contrato_id = cf.id) as obras
        from public.contratos_fornecedor cf where cf.empresa_id = e.id and cf.situacao = 'ativo' order by cf.criado_em desc limit 1) c
      left join public.usuarios u on u.id = c.criado_por
      where e.homologacao = 'homologada' and e.portal_liberado_em is null and e.situacao_fornecedor = 'ativo'), '[]'::jsonb);

    -- Pedido para atuar em outra obra.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'ped-' || p.id, 'tipo', 'pedido_obra', 'vez', 'suprimentos', 'comigo', not v_admin,
        'titulo', 'Pedido para atuar em outra obra',
        'detalhe', nullif(concat_ws(' · ', case when p.numero_contrato is not null then 'Contrato informado: ' || p.numero_contrato end, p.observacao), ''),
        'empresa_id', e.id, 'empresa', e.razao_social, 'obra', o.nome, 'desde', p.pedido_em, 'ref', p.id,
        'extra', jsonb_build_object('obra_id', p.obra_id, 'numero_contrato', p.numero_contrato, 'codigo_bp', e.codigo_bp)))
      from public.pedidos_obra p join public.empresas e on e.id = p.empresa_id join public.obras o on o.id = p.obra_id
      where p.situacao = 'pendente'), '[]'::jsonb);
  end if;

  if v_perfil = 'fornecedor' then
    -- O fornecedor acompanha os pedidos dele.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'ped-' || p.id, 'tipo', 'pedido_obra', 'vez', 'suprimentos', 'comigo', false,
        'titulo', 'Seu pedido para atuar em outra obra', 'detalhe', 'Aguardando o Suprimentos registrar o contrato da obra.',
        'empresa_id', e.id, 'empresa', e.razao_social, 'obra', o.nome, 'desde', p.pedido_em, 'ref', p.id, 'extra', null))
      from public.pedidos_obra p join public.empresas e on e.id = p.empresa_id join public.obras o on o.id = p.obra_id
      where p.situacao = 'pendente' and p.empresa_id in (select app.minhas_empresas())), '[]'::jsonb);
  end if;

  if v_admin then
    -- Conversa da Ajuda em que a última mensagem (fora as automáticas) é de quem pediu ajuda.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'aj-' || c.id, 'tipo', 'ajuda', 'vez', 'admin', 'comigo', true,
        'titulo', u.nome || ': "' || left(ult.texto, 90) || case when length(ult.texto) > 90 then '..."' else '"' end,
        'detalhe', case when m.qtd > 1 then m.qtd || ' mensagens sem resposta' end,
        'empresa_id', null,
        'empresa', coalesce((select string_agg(e.razao_social, ', ') from public.usuarios_empresas ue join public.empresas e on e.id = ue.empresa_id where ue.usuario_id = u.id), initcap(u.perfil::text)),
        'obra', null, 'desde', m.primeira, 'ref', c.id, 'extra', jsonb_build_object('perfil', u.perfil)))
      from public.conversas c
      join public.usuarios u on u.id = c.usuario_id
      cross join lateral (select x.texto, x.da_emais from public.mensagens x where x.conversa_id = c.id and not x.automatica order by x.criado_em desc limit 1) ult
      cross join lateral (
        select count(*) as qtd, min(x.criado_em) as primeira from public.mensagens x
        where x.conversa_id = c.id and not x.da_emais and not x.automatica
          and x.criado_em > coalesce((select max(y.criado_em) from public.mensagens y where y.conversa_id = c.id and y.da_emais and not y.automatica), '-infinity'::timestamptz)) m
      where c.situacao = 'aberta' and not ult.da_emais), '[]'::jsonb);
  else
    -- Resposta da Emais que a pessoa ainda não leu.
    r := r || coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', 'aj-' || c.id, 'tipo', 'ajuda', 'vez', 'voce', 'comigo', true,
        'titulo', 'Resposta da Emais na Ajuda',
        'detalhe', '"' || left(ult.texto, 140) || case when length(ult.texto) > 140 then '..."' else '"' end,
        'empresa_id', null, 'empresa', null, 'obra', null, 'desde', ult.criado_em, 'ref', c.id, 'extra', null))
      from public.conversas c
      cross join lateral (select x.texto, x.criado_em from public.mensagens x where x.conversa_id = c.id and x.da_emais and not x.automatica order by x.criado_em desc limit 1) ult
      where c.usuario_id = v_uid and ult.criado_em > coalesce(c.lida_usuario_em, '-infinity'::timestamptz)), '[]'::jsonb);
  end if;

  return r;
end $$;
revoke all on function public.minhas_notificacoes() from public, anon;
grant execute on function public.minhas_notificacoes() to authenticated;
