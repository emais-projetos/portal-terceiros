-- Alocação "em cadastro" vai sozinha para "em análise" quando não falta documento obrigatório.
--
-- Antes ela só saía de "em cadastro" quando o fornecedor clicava em "Enviar para análise", mesmo com tudo em dia
-- (ex.: colaborador já liberado em outra obra e alocado numa obra nova). Agora o banco confere na hora em que:
--   1. a alocação é criada (pelo fornecedor ou pelo administrativo);
--   2. um documento é enviado, aprovado, devolvido ou dispensado (do colaborador ou da empresa);
--   3. muda a obrigatoriedade de um treinamento só daquele colaborador;
--   4. muda a função, a situação ou o bloqueio do colaborador.
-- Continua em cadastro quem tem documento obrigatório não enviado, devolvido ou vencido (a mesma regra do botão).
-- "Pendente do fornecedor" não muda: continua voltando para análise pelo botão do fornecedor ou pela correção da Emais.

create or replace function app.avancar_para_analise(p_empresa uuid, p_colaborador uuid, p_alocacao uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select a.id
    from public.alocacoes a
    join public.colaboradores c on c.id = a.colaborador_id
    where a.status = 'em_cadastro'
      and c.situacao = 'ativo' and not coalesce(c.bloqueado, false)
      and (a.id = p_alocacao
           or (p_alocacao is null and (a.colaborador_id = p_colaborador or (p_colaborador is null and c.empresa_id = p_empresa))))
      and not exists (
        select 1 from public.v_pendencias p
        where p.alocacao_id = a.id and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido'))
    for update of a
  loop
    update public.alocacoes set status = 'em_analise', inicio_conferencia = coalesce(inicio_conferencia, now())
     where id = r.id and status = 'em_cadastro';
    perform app.registrar_evento('alocacoes', r.id, 'enviada_analise_automatica',
      jsonb_build_object('motivo', 'documentos obrigatórios em dia'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function app.avancar_para_analise(uuid, uuid, uuid) from public;

create or replace function app.avancar_analise_alocacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'em_cadastro' then perform app.avancar_para_analise(null, null, new.id); end if;
  return null;
end $$;

create or replace function app.avancar_analise_documento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.avancar_para_analise(new.empresa_id, new.colaborador_id);
  return null;
end $$;

create or replace function app.avancar_analise_extras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_colab uuid := case when tg_op = 'DELETE' then old.colaborador_id else new.colaborador_id end;
begin
  perform app.avancar_para_analise(null, v_colab);
  return null;
end $$;

create or replace function app.avancar_analise_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.avancar_para_analise(null, new.id);
  return null;
end $$;

-- Os nomes começam com "z_" para rodar depois dos outros gatilhos da mesma tabela (ordem alfabética).
drop trigger if exists z_alocacoes_avancar_analise on public.alocacoes;
create trigger z_alocacoes_avancar_analise after insert on public.alocacoes
  for each row execute function app.avancar_analise_alocacao();

drop trigger if exists z_documentos_avancar_analise on public.documentos;
create trigger z_documentos_avancar_analise after insert or update of status, dispensado on public.documentos
  for each row execute function app.avancar_analise_documento();

drop trigger if exists z_extras_avancar_analise on public.colaboradores_documentos_extras;
create trigger z_extras_avancar_analise after insert or update or delete on public.colaboradores_documentos_extras
  for each row execute function app.avancar_analise_extras();

drop trigger if exists z_colaboradores_avancar_analise on public.colaboradores;
create trigger z_colaboradores_avancar_analise after update of funcao_id, situacao, bloqueado on public.colaboradores
  for each row execute function app.avancar_analise_colaborador();

-- As que já estão em cadastro com tudo em dia vão agora para a análise.
select app.avancar_para_analise(e.id, null) from public.empresas e;
