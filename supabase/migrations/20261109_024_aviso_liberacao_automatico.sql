-- Aviso de liberação pelo envio automático: o administrativo clica em Enviar e o n8n manda o e-mail.
--
-- O texto sai do modelo "aviso_liberacao" (Acessos > E-mails, com revisões). O aviso entra na fila
-- (situacao_envio = aguardando); o n8n busca a cada 10 minutos, envia e registra se saiu ou deu erro.
-- O modo de teste e a pausa do envio automático (Acessos > Regras) valem também aqui.
-- "Abrir no Outlook" continua disponível para quem preferir enviar à mão.

alter table public.avisos_liberacao
  add column if not exists situacao_envio text check (situacao_envio in ('aguardando', 'enviando', 'enviado', 'erro')),
  add column if not exists envio_pedido_em timestamptz,
  add column if not exists envio_iniciado_em timestamptz,
  add column if not exists enviado_em timestamptz,
  add column if not exists envio_erro text,
  add column if not exists envio_teste boolean not null default false,
  add column if not exists envio_para text;
create index if not exists avisos_liberacao_fila on public.avisos_liberacao (envio_pedido_em) where situacao_envio in ('aguardando', 'enviando');

insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('aviso_liberacao', 'Aviso de liberação', 'Quando o administrativo clica em Enviar na tela Aviso de liberação', 'Fornecedor, TST e quem mais estiver no Para', 90,
 array['{obra}', '{data}', '{qtd}', '{frase_liberados}', '{liberados}', '{assinatura}'],
 'Texto inicial (o mesmo do aviso pelo Outlook)',
 'Liberação para integração: {obra} ({data})',
 E'Olá,\n\n{frase_liberados} para a integração na obra {obra}:\n\n{liberados}\n\nA documentação foi conferida pelo Gente e Gestão e validada pela Segurança do Trabalho da obra.\n\nAtenciosamente,\n{assinatura}')
on conflict (tipo) do nothing;

-- Monta o aviso a partir do modelo em vigor.
create or replace function public.gerar_aviso_liberacao(p_obra uuid, p_alocacoes uuid[], p_destinatarios text)
returns public.avisos_liberacao
language plpgsql security definer set search_path = public as $$
declare
  v public.avisos_liberacao;
  m public.modelos_email;
  nome_obra text;
  lista text;
  qtd integer;
  assinatura text;
  quem text;
  assunto text;
  corpo text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador gera o aviso'; end if;
  select nome into nome_obra from public.obras where id = p_obra;
  if nome_obra is null then raise exception 'Obra não encontrada'; end if;

  select string_agg(format('- %s, %s (%s)', r.colaborador, coalesce(lower(r.funcao), 'função não informada'), r.empresa),
                    E'\n' order by r.empresa, r.colaborador),
         count(*)
    into lista, qtd
  from public.v_alocacoes_resumo r
  where r.alocacao_id = any (p_alocacoes) and r.obra_id = p_obra and r.status = 'liberado';
  if lista is null then raise exception 'Nenhuma alocação liberada nesta obra entre as selecionadas'; end if;

  select * into m from public.modelos_email where tipo = 'aviso_liberacao';
  select nome into quem from public.usuarios where id = auth.uid();
  select concat_ws(E'\n',
           nullif(btrim(coalesce(quem, '')), ''),
           coalesce(nullif((select valor from public.parametros where chave = 'cobranca_setor'), ''), 'Gente e Gestão') || ' | Grupo Emais',
           nullif(btrim(coalesce((select valor from public.parametros where chave = 'cobranca_contato'), '')), ''))
    into assinatura;

  assunto := m.assunto;
  corpo := m.corpo;
  assunto := replace(replace(replace(assunto, '{obra}', nome_obra), '{data}', to_char(current_date, 'DD/MM/YYYY')), '{qtd}', qtd::text);
  corpo := replace(corpo, '{obra}', nome_obra);
  corpo := replace(corpo, '{data}', to_char(current_date, 'DD/MM/YYYY'));
  corpo := replace(corpo, '{qtd}', qtd::text);
  corpo := replace(corpo, '{frase_liberados}', case when qtd = 1 then 'O colaborador abaixo está liberado' else 'Os colaboradores abaixo estão liberados' end);
  corpo := replace(corpo, '{liberados}', lista);
  corpo := replace(corpo, '{assinatura}', assinatura);
  assunto := replace(assunto, '{frase_liberados}', case when qtd = 1 then 'colaborador liberado' else 'colaboradores liberados' end);
  assunto := btrim(regexp_replace(replace(replace(assunto, '{liberados}', ''), '{assinatura}', ''), '\s+', ' ', 'g'));
  corpo := btrim(regexp_replace(corpo, E'\n{3,}', E'\n\n', 'g'));

  insert into public.avisos_liberacao (obra_id, alocacoes, destinatarios, assunto, corpo)
  values (p_obra, p_alocacoes, p_destinatarios, assunto, corpo)
  returning * into v;
  return v;
end $$;

create or replace function app.validar_destinatarios(p text) returns text
language plpgsql immutable as $$
declare
  item text;
  lista text[] := '{}';
begin
  foreach item in array regexp_split_to_array(coalesce(p, ''), '[,;[:space:]]+') loop
    if item = '' then continue; end if;
    if item !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'E-mail inválido no Para: %', item using errcode = '22023'; end if;
    if not lower(item) = any (lista) then lista := lista || lower(item); end if;
  end loop;
  if cardinality(lista) = 0 then raise exception 'Informe ao menos um e-mail no Para' using errcode = '22023'; end if;
  return array_to_string(lista, ', ');
end $$;

-- Gera o aviso e coloca na fila do envio automático.
create or replace function public.enviar_aviso_liberacao(p_obra uuid, p_alocacoes uuid[], p_destinatarios text)
returns public.avisos_liberacao
language plpgsql security definer set search_path = public as $$
declare
  v public.avisos_liberacao;
  para text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador envia o aviso'; end if;
  if not exists (select 1 from public.modelos_email where tipo = 'aviso_liberacao' and ativo) then
    raise exception 'O envio automático do aviso de liberação está desligado em Acessos > E-mails. Use Abrir no Outlook.';
  end if;
  para := app.validar_destinatarios(p_destinatarios);
  v := public.gerar_aviso_liberacao(p_obra, p_alocacoes, para);
  update public.avisos_liberacao
     set situacao_envio = 'aguardando', envio_pedido_em = now(), envio_iniciado_em = null, envio_erro = null
   where id = v.id
  returning * into v;
  return v;
end $$;

-- Coloca de novo na fila (depois de erro, ou de um envio em modo de teste).
create or replace function public.reenviar_aviso_liberacao(p_aviso uuid)
returns public.avisos_liberacao
language plpgsql security definer set search_path = public as $$
declare v public.avisos_liberacao;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador envia o aviso'; end if;
  select * into v from public.avisos_liberacao where id = p_aviso for update;
  if v.id is null then raise exception 'Aviso não encontrado'; end if;
  if v.situacao_envio in ('aguardando', 'enviando') then raise exception 'Este aviso já está na fila de envio'; end if;
  if v.situacao_envio = 'enviado' and not v.envio_teste then raise exception 'Este aviso já foi enviado'; end if;
  perform app.validar_destinatarios(v.destinatarios);
  update public.avisos_liberacao
     set situacao_envio = 'aguardando', envio_pedido_em = now(), envio_iniciado_em = null, envio_erro = null
   where id = p_aviso
  returning * into v;
  return v;
end $$;

revoke execute on function public.enviar_aviso_liberacao(uuid, uuid[], text) from anon;
revoke execute on function public.reenviar_aviso_liberacao(uuid) from anon;
