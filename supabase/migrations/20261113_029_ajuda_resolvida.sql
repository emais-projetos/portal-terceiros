-- Ajuda: quando a Emais marca o atendimento como resolvido, a pessoa recebe o aviso no chat.
-- Se ela voltar a escrever depois disso, é um novo atendimento: a resposta automática aparece de novo.

insert into public.modelos_email (tipo, nome, quando, para, ordem, campos, observacao, assunto, corpo) values
('ajuda_resolvida', 'Ajuda: atendimento resolvido',
 'No chat, quando a Emais clica em Marcar como resolvida em Atendimento. Não é e-mail: o assunto não aparece.',
 'Quem escreveu na Ajuda', 160,
 array['{primeiro_nome}'],
 'Texto inicial',
 'Atendimento resolvido',
 E'Marcamos este atendimento como resolvido. Se precisar de mais alguma coisa, é só escrever aqui que abrimos um novo atendimento. Obrigado, {primeiro_nome}!')
on conflict (tipo) do nothing;

create or replace function public.resolver_conversa(p_conversa uuid, p_resolvida boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_situacao text;
  v_usuario uuid;
  v_modelo public.modelos_email;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo'; end if;
  select situacao, usuario_id into v_situacao, v_usuario from public.conversas where id = p_conversa for update;
  if not found then raise exception 'Conversa não encontrada'; end if;
  update public.conversas set situacao = case when p_resolvida then 'resolvida' else 'aberta' end, lida_emais_em = now() where id = p_conversa;

  -- Aviso no chat (só na passagem para resolvida; não vira e-mail).
  if p_resolvida and v_situacao <> 'resolvida' then
    select * into v_modelo from public.modelos_email where tipo = 'ajuda_resolvida';
    if found and v_modelo.ativo then
      insert into public.mensagens (conversa_id, autor_id, da_emais, automatica, texto, aviso_enviado_em)
      values (p_conversa, auth.uid(), true, true,
              btrim(replace(v_modelo.corpo, '{primeiro_nome}', coalesce(app.ajuda_saudacao(v_usuario), ''))), now());
      update public.conversas set ultima_mensagem_em = now() where id = p_conversa;
    end if;
  end if;
end $$;
revoke execute on function public.resolver_conversa(uuid, boolean) from anon, public;
grant execute on function public.resolver_conversa(uuid, boolean) to authenticated;

-- Nova mensagem depois de "resolvida" abre um novo atendimento: volta a resposta automática.
create or replace function public.enviar_mensagem(p_texto text, p_conversa uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_perfil text;
  v_conversa uuid;
  v_id uuid;
  v_anterior timestamptz;
  v_resolvida boolean;
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
  select situacao = 'resolvida' into v_resolvida from public.conversas where id = v_conversa;
  select max(criado_em) into v_anterior from public.mensagens where conversa_id = v_conversa;
  v_id := app.gravar_mensagem(v_conversa, auth.uid(), false, p_texto);

  if v_anterior is null or v_resolvida
     or v_anterior < now() - make_interval(hours => app.param_int('ajuda_horas_novo_assunto')) then
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
