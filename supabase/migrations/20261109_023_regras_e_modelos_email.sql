-- Regras e modelos de e-mail editáveis pelo administrativo (Acessos > Regras e Acessos > E-mails).
--
-- Regras: os prazos da cobrança (medição, vencimentos e integração), o envio automático e a assinatura
-- ficam na tabela parametros, com rótulo, grupo, limites e histórico de cada mudança.
-- A validade dos documentos (exames e treinamentos) continua em tipos_documento, alterada pela função
-- alterar_tipo_documento, que exige motivo e grava em tipos_documento_historico.
--
-- E-mails: assunto e texto de cada cobrança em modelos_email. Cada vez que um modelo é salvo, a versão
-- anterior fica em modelos_email_revisoes (Rev. 1, Rev. 2...). O portal e o envio automático do n8n
-- montam os e-mails a partir da revisão em vigor.

-- ---------------------------------------------------------------- Regras

alter table public.parametros
  add column if not exists rotulo text,
  add column if not exists grupo text,
  add column if not exists tipo text not null default 'inteiro',
  add column if not exists minimo integer,
  add column if not exists maximo integer,
  add column if not exists unidade text,
  add column if not exists ordem integer not null default 100;
alter table public.parametros drop constraint if exists parametros_tipo_check;
alter table public.parametros add constraint parametros_tipo_check
  check (tipo in ('inteiro', 'texto', 'email', 'sim_nao', 'empresas', 'lista'));

insert into public.parametros (chave, valor, descricao) values
  ('medicao_dia_lembrete', '20', 'x'),
  ('medicao_dias_tolerancia', '5', 'x'),
  ('vencimento_segundo_aviso_dias', '15', 'x'),
  ('integracao_dias_parado', '3', 'x')
on conflict (chave) do nothing;

update public.parametros set tipo = 'lista' where chave = 'alertas_dias';
update public.parametros set tipo = 'texto' where chave in ('cobranca_setor', 'cobranca_contato');
update public.parametros set tipo = 'empresas' where chave = 'cobranca_automatica_empresas';
update public.parametros set tipo = 'email' where chave = 'cobranca_automatica_teste_para';
update public.parametros set tipo = 'sim_nao' where chave = 'cobranca_automatica_pausada';

update public.parametros p
set rotulo = v.rotulo, grupo = v.grupo, minimo = v.minimo, maximo = v.maximo, unidade = v.unidade, ordem = v.ordem, descricao = v.descricao
from (values
  ('medicao_dia_lembrete', 'Lembrete da medição', 'Medição mensal', 1, 27, 'dia do mês', 10,
   'Dia do mês em que sai o lembrete para as empresas que ainda não enviaram a medição do mês anterior. Precisa ser antes do prazo de entrega.'),
  ('prazo_medicao_dia', 'Prazo de entrega da medição', 'Medição mensal', 2, 28, 'dia do mês', 20,
   'Dia do mês seguinte em que termina o prazo da medição. Vale para as medições abertas depois da mudança. A notificação de atraso sai no dia seguinte.'),
  ('medicao_dias_tolerancia', 'Tolerância depois do prazo', 'Medição mensal', 0, 10, 'dias', 30,
   'Dias depois do prazo para regularizar antes de reter o pagamento e avisar a engenharia da obra. Não passa do último dia do mês.'),
  ('dias_a_vencer', 'Primeiro aviso de vencimento', 'Vencimento de documentos', 1, 120, 'dias antes', 10,
   'O documento dos colaboradores liberados passa a "a vencer" e a empresa recebe o primeiro aviso.'),
  ('vencimento_segundo_aviso_dias', 'Segundo aviso de vencimento', 'Vencimento de documentos', 1, 119, 'dias antes', 20,
   'Novo aviso para o documento que continua sem renovação. Precisa ser menor que o primeiro aviso. No dia do vencimento sai o aviso de documento vencido.'),
  ('integracao_dias_parado', 'Documento parado na integração', 'Integração', 1, 30, 'dias úteis', 10,
   'Toda segunda-feira, a empresa recebe a lista dos colaboradores ainda não liberados com documento obrigatório faltando ou devolvido há esse tempo ou mais.'),
  ('cobranca_automatica_pausada', 'Envio automático pausado', 'Envio automático (n8n)', null, null, null, 10,
   'Sim: o n8n não envia nenhuma cobrança até voltar para Não.'),
  ('cobranca_automatica_empresas', 'Empresas que recebem', 'Envio automático (n8n)', null, null, null, 20,
   'Escreva "todas", ou os CNPJs liberados separados por vírgula. Vazio: ninguém recebe.'),
  ('cobranca_automatica_teste_para', 'Endereço de teste', 'Envio automático (n8n)', null, null, null, 30,
   'Preenchido: todos os e-mails vão só para este endereço, com o destinatário real no assunto, e nada é marcado como cobrado. Vazio: os e-mails vão para os fornecedores e obras.'),
  ('cobranca_setor', 'Setor que assina', 'Assinatura dos e-mails', null, null, null, 10,
   'Aparece na assinatura como "Setor | Grupo Emais".'),
  ('cobranca_contato', 'Contato na assinatura', 'Assinatura dos e-mails', null, null, null, 20,
   'E-mail e telefone abaixo do setor. Pode ficar vazio.')
) as v(chave, rotulo, grupo, minimo, maximo, unidade, ordem, descricao)
where p.chave = v.chave;

create or replace function app.validar_parametro() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nome text := coalesce(new.rotulo, new.chave);
  n bigint;
  outro integer;
  item text;
begin
  new.valor := btrim(coalesce(new.valor, ''));
  if new.tipo = 'inteiro' then
    if new.valor !~ '^[0-9]{1,6}$' then raise exception '% precisa ser um número inteiro', nome using errcode = '22023'; end if;
    n := new.valor::bigint;
    if n < coalesce(new.minimo, 0) or n > coalesce(new.maximo, 999999) then
      raise exception '% precisa ficar entre % e %', nome, coalesce(new.minimo, 0), coalesce(new.maximo, 999999) using errcode = '22023';
    end if;
  elsif new.tipo = 'email' then
    if new.valor <> '' and new.valor !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' then
      raise exception '% precisa ser um e-mail válido (ou ficar vazio)', nome using errcode = '22023';
    end if;
  elsif new.tipo = 'sim_nao' then
    new.valor := lower(new.valor);
    if new.valor not in ('sim', 'nao') then raise exception '% precisa ser sim ou não', nome using errcode = '22023'; end if;
  elsif new.tipo = 'empresas' then
    if lower(new.valor) = 'todas' then
      new.valor := 'todas';
    elsif new.valor <> '' then
      foreach item in array regexp_split_to_array(new.valor, '[,;[:space:]]+') loop
        if item <> '' and regexp_replace(item, '\D', '', 'g') !~ '^[0-9]{14}$' then
          raise exception 'CNPJ inválido em %: %', nome, item using errcode = '22023';
        end if;
      end loop;
    end if;
  elsif new.tipo = 'texto' then
    if length(new.valor) > 200 then raise exception '% pode ter até 200 caracteres', nome using errcode = '22023'; end if;
  end if;

  -- Regras que dependem uma da outra.
  if new.chave = 'medicao_dia_lembrete' then
    outro := app.param_int('prazo_medicao_dia');
    if new.valor::int >= outro then raise exception 'O lembrete precisa ser antes do prazo de entrega (dia %)', outro using errcode = '22023'; end if;
  elsif new.chave = 'prazo_medicao_dia' then
    outro := app.param_int('medicao_dia_lembrete');
    if new.valor::int <= outro then raise exception 'O prazo de entrega precisa ser depois do lembrete (dia %)', outro using errcode = '22023'; end if;
  elsif new.chave = 'vencimento_segundo_aviso_dias' then
    outro := app.param_int('dias_a_vencer');
    if new.valor::int >= outro then raise exception 'O segundo aviso precisa ser menor que o primeiro (% dias)', outro using errcode = '22023'; end if;
  elsif new.chave = 'dias_a_vencer' then
    outro := app.param_int('vencimento_segundo_aviso_dias');
    if new.valor::int <= outro then raise exception 'O primeiro aviso precisa ser maior que o segundo (% dias)', outro using errcode = '22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists valida on public.parametros;
create trigger valida before insert or update on public.parametros for each row execute function app.validar_parametro();

create table if not exists public.parametros_historico (
  id             bigint generated always as identity primary key,
  chave          text not null references public.parametros (chave) on delete cascade,
  valor_anterior text,
  valor_novo     text,
  alterado_por   uuid default auth.uid(),
  alterado_em    timestamptz not null default now()
);
create index if not exists parametros_historico_chave on public.parametros_historico (chave, alterado_em desc);
alter table public.parametros_historico enable row level security;
drop policy if exists admin on public.parametros_historico;
create policy admin on public.parametros_historico for select to authenticated using ((select app.eh_admin()));
grant select on public.parametros_historico to authenticated;

create or replace function app.parametro_mudou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.valor is distinct from old.valor then
    insert into public.parametros_historico (chave, valor_anterior, valor_novo) values (new.chave, old.valor, new.valor);
  end if;
  return new;
end $$;
drop trigger if exists historico on public.parametros;
create trigger historico after update on public.parametros for each row execute function app.parametro_mudou();

-- Tolerância da medição: dias depois do prazo, sem passar do fim do mês.
create or replace view public.v_medicoes with (security_invoker = true) as
 SELECT m.id,
    m.empresa_id,
    e.razao_social AS empresa,
    e.cnpj,
    COALESCE(e.email_contato, e.email_acesso) AS email_cobranca,
    m.obra_id,
    o.nome AS obra,
    m.competencia,
    m.prazo,
    m.status,
    m.primeiro_envio_em,
    m.enviada_em,
    m.conferente,
    m.ultima_analise_em,
    m.ultima_cobranca_em,
    m.observacao,
    m.origem,
    COALESCE(m.qtd_colaboradores::bigint, ( SELECT count(*) AS count
           FROM medicoes_colaboradores c
          WHERE c.medicao_id = m.id))::integer AS qtd_colaboradores,
    m.primeiro_envio_em IS NOT NULL AND (m.primeiro_envio_em AT TIME ZONE 'America/Sao_Paulo'::text)::date <= m.prazo AS entregue_no_prazo,
    m.status <> 'aprovada'::status_medicao AND CURRENT_DATE > GREATEST(t.tolerancia, COALESCE(m.prazo_combinado, t.tolerancia)) AS retida,
    (( SELECT count(*) AS count
           FROM medicoes_itens i
             JOIN tipos_medicao t2 ON t2.codigo = i.tipo_codigo
          WHERE i.medicao_id = m.id AND t2.impeditivo AND (i.status = ANY (ARRAY['nao_enviado'::status_item_medicao, 'devolvido'::status_item_medicao]))))::integer AS itens_pendentes,
    (( SELECT count(*) AS count
           FROM medicoes_itens i
          WHERE i.medicao_id = m.id AND i.status = 'em_analise'::status_item_medicao))::integer AS itens_em_analise,
    (( SELECT count(*) AS count
           FROM medicoes_itens i
          WHERE i.medicao_id = m.id AND i.status = 'devolvido'::status_item_medicao))::integer AS itens_devolvidos,
    (( SELECT count(*) AS count
           FROM medicoes_colaboradores c
          WHERE c.medicao_id = m.id AND (EXISTS ( SELECT 1
                   FROM jsonb_each_text(c.conferencia) x(key, value)
                  WHERE x.value = 'pendente'::text))))::integer AS colaboradores_pendentes,
    m.prazo_combinado,
    m.prazo_combinado_obs,
    t.tolerancia,
    m.status <> 'aprovada'::status_medicao AND CURRENT_DATE > m.prazo AND CURRENT_DATE <= GREATEST(t.tolerancia, COALESCE(m.prazo_combinado, t.tolerancia)) AS em_atraso
   FROM medicoes m
     JOIN empresas e ON e.id = m.empresa_id
     LEFT JOIN obras o ON o.id = m.obra_id
     CROSS JOIN LATERAL ( SELECT LEAST((date_trunc('month'::text, m.prazo::timestamp with time zone) + '1 mon -1 days'::interval)::date,
                                       m.prazo + COALESCE(app.param_int('medicao_dias_tolerancia'), 5)) AS tolerancia) t;

-- ---------------------------------------------------------------- Modelos de e-mail

create table if not exists public.modelos_email (
  tipo          text primary key,
  nome          text not null,
  quando        text not null,
  para          text not null,
  campos        text[] not null,
  assunto       text not null check (btrim(assunto) <> ''),
  corpo         text not null check (btrim(corpo) <> ''),
  ativo         boolean not null default true,
  ordem         integer not null default 100,
  revisao       integer not null default 1,
  observacao    text,
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
alter table public.modelos_email enable row level security;
drop policy if exists leitura on public.modelos_email;
drop policy if exists edicao on public.modelos_email;
create policy leitura on public.modelos_email for select to authenticated using ((select app.eh_admin()));
create policy edicao on public.modelos_email for update to authenticated using ((select app.eh_admin())) with check ((select app.eh_admin()));
grant select, update (assunto, corpo, ativo, observacao) on public.modelos_email to authenticated;

create table if not exists public.modelos_email_revisoes (
  id         bigint generated always as identity primary key,
  tipo       text not null references public.modelos_email (tipo) on delete cascade,
  revisao    integer not null,
  assunto    text not null,
  corpo      text not null,
  ativo      boolean not null,
  observacao text,
  salvo_por  uuid,
  salvo_em   timestamptz not null default now(),
  unique (tipo, revisao)
);
alter table public.modelos_email_revisoes enable row level security;
drop policy if exists admin on public.modelos_email_revisoes;
create policy admin on public.modelos_email_revisoes for select to authenticated using ((select app.eh_admin()));
grant select on public.modelos_email_revisoes to authenticated;

-- Só os campos do próprio modelo; cada mudança de texto ou de envio vira uma nova revisão.
create or replace function app.antes_salvar_modelo_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare marca text;
begin
  for marca in select (regexp_matches(new.assunto || ' ' || new.corpo, '\{[^{}]*\}', 'g'))[1] loop
    if not marca = any (new.campos) then
      raise exception 'O campo % não existe neste e-mail. Use só os campos listados na tela.', marca using errcode = '22023';
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    new.campos := old.campos;
    if new.assunto is distinct from old.assunto or new.corpo is distinct from old.corpo or new.ativo is distinct from old.ativo then
      new.revisao := old.revisao + 1;
      new.atualizado_por := auth.uid();
      new.atualizado_em := now();
    else
      new.revisao := old.revisao;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists antes_salvar on public.modelos_email;
create trigger antes_salvar before insert or update on public.modelos_email for each row execute function app.antes_salvar_modelo_email();

create or replace function app.depois_salvar_modelo_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.revisao <> old.revisao then
    insert into public.modelos_email_revisoes (tipo, revisao, assunto, corpo, ativo, observacao, salvo_por, salvo_em)
    values (new.tipo, new.revisao, new.assunto, new.corpo, new.ativo, new.observacao, new.atualizado_por, new.atualizado_em)
    on conflict (tipo, revisao) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists depois_salvar on public.modelos_email;
create trigger depois_salvar after insert or update on public.modelos_email for each row execute function app.depois_salvar_modelo_email();

-- Textos iguais aos que o portal usava até aqui.
insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('lembrete_medicao', 'Lembrete da medição', 'No dia do lembrete, para quem ainda não enviou a medição do mês anterior', 'Fornecedor', 10,
 array['{empresa}', '{mes}', '{mes_nome}', '{prazo}', '{prazo_curto}', '{situacao_obras}', '{link_medicao}', '{assinatura}'],
 'Texto inicial',
 'Medição de {mes}: envio até {prazo_curto}, {empresa}',
 E'Olá, equipe da {empresa},\n\nA medição de {mes} deve ser enviada pelo Portal de Terceiros até {prazo}.\n\nSituação hoje:\n{situacao_obras}\n\nPor que é importante:\nO pagamento do mês só é liberado depois que a Emais confere os documentos da medição (holerites, ponto, folha, FGTS, INSS, DCTFWeb, DARF e seguro de vida). Se a medição não for apresentada no prazo, o pagamento de {mes_nome} pode ser retido.\n\nComo enviar:\n1. Acesse {link_medicao}\n2. Escolha a obra e o mês de {mes} e clique em Começar.\n3. Anexe um arquivo por item ou marque "não se aplica" quando for o caso.\n4. Confira a lista de colaboradores do mês e clique em Enviar para conferência.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}'),
('notificacao_medicao', 'Medição em atraso', 'No dia seguinte ao prazo, para quem ainda não enviou', 'Fornecedor', 20,
 array['{empresa}', '{mes}', '{mes_nome}', '{prazo}', '{tolerancia}', '{tolerancia_curta}', '{responder_ate}', '{o_que_falta}', '{link_medicao}', '{assinatura}'],
 'Texto inicial',
 'Medição de {mes} em atraso: envie até {tolerancia_curta} para evitar a retenção do pagamento, {empresa}',
 E'Olá, equipe da {empresa},\n\nO prazo da medição de {mes} terminou em {prazo} e ainda faltam documentos. Para que o pagamento de {mes_nome} não seja retido, regularize pelo portal até {tolerancia}.\n\nO que falta:\n{o_que_falta}\n\nPedimos que responda este e-mail até {responder_ate} informando a data em que os documentos serão enviados no portal.\n\nSe não for regularizado até {tolerancia}:\n- o pagamento de {mes_nome} fica retido até a aprovação da medição;\n- a engenharia da obra é avisada da retenção;\n- o atraso fica registrado no histórico de entregas da empresa, considerado na avaliação de fornecedores da Emais.\n\nComo regularizar:\n1. Acesse {link_medicao}\n2. Abra {mes}, envie ou corrija os itens acima e clique em Enviar para conferência.\n3. A Emais confere em até 3 dias úteis.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}'),
('cobranca_medicao', 'Pagamento retido', 'Depois da tolerância (ou da data combinada), com a medição ainda pendente', 'Fornecedor', 30,
 array['{empresa}', '{mes}', '{mes_nome}', '{historico_atraso}', '{o_que_falta}', '{link_medicao}', '{assinatura}'],
 'Texto inicial',
 'Pagamento retido: medição de {mes} pendente, {empresa}',
 E'Olá, equipe da {empresa},\n\n{historico_atraso} Como os itens abaixo continuam pendentes, o pagamento de {mes_nome} está retido.\n\nO que falta:\n{o_que_falta}\n\nO pagamento é liberado assim que a medição for aprovada:\n1. Acesse {link_medicao}\n2. Abra {mes}, envie ou corrija os itens acima e clique em Enviar para conferência.\n3. A Emais confere em até 3 dias úteis e avisa a obra da liberação.\n\nO atraso fica registrado no histórico de entregas da empresa, considerado na avaliação de fornecedores da Emais.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}'),
('retencao_obra', 'Aviso de retenção para a obra', 'Junto com o pagamento retido', 'Engenharia da obra', 40,
 array['{obra}', '{mes}', '{mes_nome}', '{prazo_regularizacao}', '{qtd_empresas}', '{empresas_reter}', '{empresas_liberadas}', '{empresas_aguardando}', '{assinatura}'],
 'Texto inicial',
 '{obra}: reter pagamento de {qtd_empresas} (medição de {mes})',
 E'Olá,\n\nAs empresas abaixo não regularizaram a medição de {mes} até {prazo_regularizacao}, mesmo após notificação. Ação: não liberar o pagamento de {mes_nome} dessas empresas até novo aviso.\n\nReter pagamento:\n{empresas_reter}\n\n{empresas_liberadas}\n\n{empresas_aguardando}\n\nOs fornecedores já foram notificados. Assim que cada empresa for aprovada, enviamos a liberação.\n\nAtenciosamente,\n{assinatura}'),
('vencimento_primeiro', 'Documentos vencendo: primeiro aviso', 'Quando o documento entra no primeiro aviso de vencimento', 'Fornecedor', 50,
 array['{empresa}', '{dias}', '{documentos}', '{link_pendencias}', '{assinatura}'],
 'Texto inicial',
 'Documentos vencem nos próximos {dias} dias: renove no portal para manter a liberação, {empresa}',
 E'Olá, equipe da {empresa},\n\nOs documentos abaixo, de colaboradores liberados nas obras da Emais, precisam ser renovados no portal. Para que eles continuem trabalhando sem interrupção, envie a renovação antes do vencimento.\n\n{documentos}\n\nSe o documento vencer:\n- o colaborador fica impedido de entrar na obra até a renovação ser aprovada;\n- se for preciso refazer exame (ASO) ou treinamento (NR), conte o tempo de agendamento;\n- sem colaborador liberado, o serviço contratado pode atrasar.\n\nComo enviar:\n1. Acesse {link_pendencias}\n2. Localize o colaborador e clique em Enviar novo no documento.\n3. Anexe o arquivo atualizado e informe a data de emissão.\n4. A Emais confere em até 2 dias úteis.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}'),
('vencimento_segundo', 'Documentos vencendo: segundo aviso', 'Quando o documento entra no segundo aviso de vencimento', 'Fornecedor', 60,
 array['{empresa}', '{dias}', '{documentos}', '{link_pendencias}', '{assinatura}'],
 'Texto inicial',
 'Faltam {dias} dias: documentos vencendo, {empresa}',
 E'Olá, equipe da {empresa},\n\nOs documentos abaixo, de colaboradores liberados nas obras da Emais, precisam ser renovados no portal. Para que eles continuem trabalhando sem interrupção, envie a renovação antes do vencimento.\n\n{documentos}\n\nSe o documento vencer:\n- o colaborador fica impedido de entrar na obra até a renovação ser aprovada;\n- se for preciso refazer exame (ASO) ou treinamento (NR), conte o tempo de agendamento;\n- sem colaborador liberado, o serviço contratado pode atrasar.\n\nComo enviar:\n1. Acesse {link_pendencias}\n2. Localize o colaborador e clique em Enviar novo no documento.\n3. Anexe o arquivo atualizado e informe a data de emissão.\n4. A Emais confere em até 2 dias úteis.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}'),
('vencimento_vencido', 'Documentos vencidos', 'No dia em que o documento vence', 'Fornecedor', 70,
 array['{empresa}', '{documentos}', '{link_pendencias}', '{assinatura}'],
 'Texto inicial',
 'Colaboradores impedidos de entrar na obra: documentos vencidos, {empresa}',
 E'Olá, equipe da {empresa},\n\nOs documentos abaixo, de colaboradores liberados nas obras da Emais, precisam ser renovados no portal. Para que eles continuem trabalhando sem interrupção, envie a renovação antes do vencimento.\n\n{documentos}\n\nSe o documento vencer:\n- o colaborador fica impedido de entrar na obra até a renovação ser aprovada;\n- se for preciso refazer exame (ASO) ou treinamento (NR), conte o tempo de agendamento;\n- sem colaborador liberado, o serviço contratado pode atrasar.\n\nComo enviar:\n1. Acesse {link_pendencias}\n2. Localize o colaborador e clique em Enviar novo no documento.\n3. Anexe o arquivo atualizado e informe a data de emissão.\n4. A Emais confere em até 2 dias úteis.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}'),
('integracao_documentos', 'Colaboradores sem liberação', 'Toda segunda-feira, com documento parado na integração', 'Fornecedor', 80,
 array['{empresa}', '{colaboradores}', '{link_pendencias}', '{assinatura}'],
 'Texto inicial',
 'Colaboradores sem liberação para a obra: documentos pendentes, {empresa}',
 E'Olá, equipe da {empresa},\n\nOs colaboradores abaixo estão cadastrados no portal, mas ainda não podem ser liberados porque faltam documentos obrigatórios. Sem eles, o colaborador não faz a integração de segurança e não entra na obra.\n\n{colaboradores}\n\nComo enviar:\n1. Acesse {link_pendencias}\n2. Envie os documentos de cada colaborador.\n3. Com tudo enviado, clique em Enviar para análise.\n4. A Emais confere em até 2 dias úteis; depois o TST da obra valida e agenda a integração.\n\nImportante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.\n\nAtenciosamente,\n{assinatura}')
on conflict (tipo) do nothing;

-- Histórico da validade dos documentos para a aba Regras.
grant select on public.tipos_documento_historico to authenticated;
