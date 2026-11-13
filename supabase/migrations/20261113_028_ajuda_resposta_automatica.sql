-- Ajuda: resposta automática da Emais logo depois da mensagem de quem usa o portal.
-- Aparece na primeira mensagem da conversa e quando a pessoa volta a escrever depois de um tempo sem mensagens
-- (Regras > Ajuda). O texto muda dentro e fora do horário de atendimento (Acessos > E-mails).
-- A resposta automática não gera e-mail.

insert into public.parametros (chave, valor, descricao, rotulo, grupo, tipo, minimo, maximo, unidade, ordem) values
  ('ajuda_hora_inicio', '8', 'Início do atendimento da Ajuda, de segunda a sexta.', 'Atendimento começa às', 'Ajuda', 'inteiro', 0, 23, 'h', 30),
  ('ajuda_hora_fim', '18', 'Fim do atendimento da Ajuda, de segunda a sexta.', 'Atendimento termina às', 'Ajuda', 'inteiro', 1, 24, 'h', 40),
  ('ajuda_feriados', '', 'Datas sem atendimento, separadas por vírgula (ex.: 20/11, 25/12, 01/01/2027). Sem o ano, vale todo ano.',
   'Feriados sem atendimento', 'Ajuda', 'texto', null, null, null, 50),
  ('ajuda_horas_novo_assunto', '12',
   'Se a pessoa voltar a escrever depois desse tempo sem mensagens na conversa, a resposta automática aparece de novo.',
   'Resposta automática de novo depois de', 'Ajuda', 'inteiro', 1, 168, 'horas', 60)
on conflict (chave) do nothing;

insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('ajuda_automatica', 'Ajuda: resposta automática (no horário)',
 'No chat, logo depois da primeira mensagem (ou de um novo assunto), dentro do horário de atendimento. Não é e-mail: o assunto não aparece.',
 'Quem escreveu na Ajuda', 140,
 array['{primeiro_nome}', '{horario}'],
 'Texto inicial',
 'Resposta automática da Ajuda',
 E'Olá, {primeiro_nome}! Recebemos sua mensagem e já vamos responder por aqui. Se precisar sair, fique tranquilo: a resposta também chega no seu e-mail. Para agilizar, se a dúvida for sobre um colaborador ou documento, informe o nome dele.'),
('ajuda_automatica_fora', 'Ajuda: resposta automática (fora do horário)',
 'No chat, logo depois da primeira mensagem (ou de um novo assunto), à noite, no fim de semana e nos feriados de Regras. Não é e-mail: o assunto não aparece.',
 'Quem escreveu na Ajuda', 150,
 array['{primeiro_nome}', '{horario}'],
 'Texto inicial',
 'Resposta automática da Ajuda (fora do horário)',
 E'Olá, {primeiro_nome}! Recebemos sua mensagem. Nosso atendimento é {horario}, e respondemos no próximo dia útil por aqui e no seu e-mail.')
on conflict (tipo) do nothing;

-- Feriados: dd/mm ou dd/mm/aaaa, separados por vírgula. Início antes do fim.
create or replace function app.validar_parametro_ajuda() returns trigger
language plpgsql as $$
declare
  item text;
begin
  if new.chave = 'ajuda_feriados' and new.valor <> '' then
    foreach item in array regexp_split_to_array(new.valor, '\s*[,;]\s*') loop
      if item <> '' and item !~ '^\d{1,2}/\d{1,2}(/\d{4})?$' then
        raise exception 'Data inválida em Feriados sem atendimento: % (use dd/mm ou dd/mm/aaaa)', item using errcode = '22023';
      end if;
    end loop;
  elsif new.chave = 'ajuda_hora_inicio' and new.valor::int >= app.param_int('ajuda_hora_fim') then
    raise exception 'O atendimento precisa começar antes de terminar (%h)', app.param_int('ajuda_hora_fim') using errcode = '22023';
  elsif new.chave = 'ajuda_hora_fim' and new.valor::int <= app.param_int('ajuda_hora_inicio') then
    raise exception 'O atendimento precisa terminar depois de começar (%h)', app.param_int('ajuda_hora_inicio') using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists parametros_ajuda on public.parametros;
create trigger parametros_ajuda before update on public.parametros
  for each row when (new.chave like 'ajuda_%') execute function app.validar_parametro_ajuda();

-- Dentro do horário de atendimento agora (horário de Brasília)?
create or replace function app.ajuda_no_horario() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  agora timestamp := now() at time zone 'America/Sao_Paulo';
  hora numeric := extract(hour from agora) + extract(minute from agora) / 60.0;
  feriados text := coalesce((select valor from public.parametros where chave = 'ajuda_feriados'), '');
  item text;
begin
  if extract(isodow from agora) > 5 then return false; end if;
  if hora < app.param_int('ajuda_hora_inicio') or hora >= app.param_int('ajuda_hora_fim') then return false; end if;
  foreach item in array regexp_split_to_array(feriados, '\s*[,;]\s*') loop
    if item = '' then continue; end if;
    if item ~ '^\d{1,2}/\d{1,2}/\d{4}$' and to_date(item, 'DD/MM/YYYY') = agora::date then return false; end if;
    if item ~ '^\d{1,2}/\d{1,2}$' and to_char(agora, 'DD/MM') = to_char(to_date(item || '/2000', 'DD/MM/YYYY'), 'DD/MM') then return false; end if;
  end loop;
  return true;
end $$;

-- Nome do "Olá": primeiro nome da pessoa; no acesso de fornecedor (nome da empresa), o nome da empresa sem CNPJ e sem LTDA.
create or replace function app.ajuda_saudacao(p_usuario uuid) returns text
language sql stable security definer set search_path = public as $$
  select btrim(replace(replace(replace(replace(replace(replace(replace(' ' || n || ' ',
           ' De ', ' de '), ' Da ', ' da '), ' Do ', ' do '), ' Das ', ' das '), ' Dos ', ' dos '), ' E ', ' e '), ' Em ', ' em '))
  from (
    select btrim(case
      when u.perfil = 'fornecedor' then
        initcap(btrim(regexp_replace(regexp_replace(regexp_replace(u.nome, '\s+e mais \d+\s*$', '', 'i'), '^[\d./\s-]+', ''), '\s*-?\s*\m(LTDA|ME|EPP|EIRELI|LIMITADA)\.?\s*$', '', 'i')))
      else initcap(coalesce((select p from regexp_split_to_table(btrim(u.nome), '\s+') p where p ~ '[A-Za-zÀ-ÿ]{2}' limit 1), u.nome))
    end) n
    from public.usuarios u where u.id = p_usuario
  ) x;
$$;

-- Quem usa o portal escreve; na primeira mensagem (ou num novo assunto) a Emais responde sozinha.
create or replace function public.enviar_mensagem(p_texto text, p_conversa uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_perfil text;
  v_conversa uuid;
  v_id uuid;
  v_anterior timestamptz;
  v_modelo public.modelos_email;
  v_horario text;
begin
  select perfil::text into v_perfil from public.usuarios where id = auth.uid() and ativo;
  if v_perfil is null then raise exception 'Faça login para continuar'; end if;
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'Escreva a mensagem'; end if;
  if length(p_texto) > 4000 then raise exception 'Mensagem muito longa (até 4.000 caracteres)'; end if;
  if v_perfil = 'admin' then
    if p_conversa is null then raise exception 'Escolha a conversa'; end if;
    return app.gravar_mensagem(p_conversa, auth.uid(), true, p_texto);
  end if;

  v_conversa := app.conversa_do_usuario(auth.uid());
  select max(criado_em) into v_anterior from public.mensagens where conversa_id = v_conversa;
  v_id := app.gravar_mensagem(v_conversa, auth.uid(), false, p_texto);

  if v_anterior is null or v_anterior < now() - make_interval(hours => app.param_int('ajuda_horas_novo_assunto')) then
    select * into v_modelo from public.modelos_email
     where tipo = case when app.ajuda_no_horario() then 'ajuda_automatica' else 'ajuda_automatica_fora' end;
    if found and v_modelo.ativo then
      v_horario := format('de segunda a sexta, das %sh às %sh', app.param_int('ajuda_hora_inicio'), app.param_int('ajuda_hora_fim'));
      -- Um instante depois da mensagem, para aparecer logo abaixo dela; já marcada como avisada (não vira e-mail).
      insert into public.mensagens (conversa_id, autor_id, da_emais, automatica, texto, criado_em, aviso_enviado_em)
      values (v_conversa, null, true, true,
              btrim(replace(replace(v_modelo.corpo, '{primeiro_nome}', coalesce(app.ajuda_saudacao(auth.uid()), '')), '{horario}', v_horario)),
              now() + interval '1 second', now());
      update public.conversas set lida_usuario_em = now() + interval '1 second' where id = v_conversa;
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.enviar_mensagem(text, uuid) from anon, public;
grant execute on function public.enviar_mensagem(text, uuid) to authenticated;
