-- Segurança da obra: preenchimento pelo portal.
-- Ficha da máquina: uma por mês, criada na primeira inspeção; cada dia é gravado sozinho, para dois TSTs não
-- apagarem o dia um do outro. Vistoria concluída pode ser reaberta pelo TST para corrigir (fica registrado).

create or replace function public.abrir_ficha_maquina(p_maquina uuid, p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.seg_maquinas;
  v_id uuid;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_itens jsonb;
begin
  select * into m from public.seg_maquinas where id = p_maquina;
  if m.id is null then raise exception 'Máquina não encontrada'; end if;
  if not app.tst_da_obra(m.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo preenche a ficha'; end if;
  select id into v_id from public.seg_fichas_maquina where maquina_id = p_maquina and competencia = v_comp;
  if v_id is not null then return v_id; end if;
  if not m.ativo then raise exception 'Esta máquina saiu da obra'; end if;
  if v_comp > date_trunc('month', current_date)::date then raise exception 'Não dá para abrir a ficha de um mês que ainda não chegou'; end if;
  select itens into v_itens from public.seg_modelos where codigo = m.modelo_codigo;
  insert into public.seg_fichas_maquina (maquina_id, competencia, itens, criado_por)
  values (p_maquina, v_comp, v_itens, auth.uid())
  on conflict (maquina_id, competencia) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.seg_fichas_maquina where maquina_id = p_maquina and competencia = v_comp;
  end if;
  return v_id;
end $$;

-- Grava um dia da ficha (p_dados null apaga o dia).
create or replace function public.salvar_dia_ficha(p_ficha uuid, p_dia int, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.seg_fichas_maquina;
  v_obra uuid;
  v_chave text := lpad(p_dia::text, 2, '0');
  v_pasta text := 'ficha/' || p_ficha || '/';
  v_ultimo int;
begin
  select * into f from public.seg_fichas_maquina where id = p_ficha for update;
  if f.id is null then raise exception 'Ficha não encontrada'; end if;
  select obra_id into v_obra from public.seg_maquinas where id = f.maquina_id;
  if not app.tst_da_obra(v_obra) then raise exception 'Apenas o TST da obra ou o administrativo preenche a ficha'; end if;
  if f.fechada_em is not null and not app.eh_admin() then raise exception 'A ficha deste mês já foi fechada'; end if;
  v_ultimo := extract(day from (f.competencia + interval '1 month' - interval '1 day'))::int;
  if p_dia is null or p_dia < 1 or p_dia > v_ultimo then raise exception 'Dia inválido para o mês da ficha'; end if;
  if f.competencia + (p_dia - 1) > current_date then raise exception 'Não dá para preencher um dia que ainda não chegou'; end if;

  if p_dados is null then
    update public.seg_fichas_maquina set dias = dias - v_chave where id = p_ficha;
    perform app.registrar_evento('seg_fichas_maquina', p_ficha, 'dia_apagado', jsonb_build_object('dia', p_dia));
    return;
  end if;

  if jsonb_typeof(p_dados->'statuses') is distinct from 'array' or jsonb_array_length(p_dados->'statuses') <> jsonb_array_length(f.itens)
     or exists (select 1 from jsonb_array_elements_text(p_dados->'statuses') s where s is null or s not in ('ok', 'nc', 'na')) then
    raise exception 'Responda todos os itens do checklist';
  end if;
  if length(btrim(coalesce(p_dados->>'operador', ''))) < 2 then raise exception 'Informe o operador da máquina'; end if;
  if jsonb_typeof(coalesce(p_dados->'fotos', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_dados->'fotos', '[]'::jsonb)) > 10
     or exists (select 1 from jsonb_array_elements_text(coalesce(p_dados->'fotos', '[]'::jsonb)) c where left(c, length(v_pasta)) <> v_pasta) then
    raise exception 'Fotos inválidas (até 10, da própria ficha)';
  end if;
  if nullif(p_dados->>'assinatura', '') is not null and left(p_dados->>'assinatura', length(v_pasta)) <> v_pasta then
    raise exception 'Assinatura fora da pasta da ficha';
  end if;

  update public.seg_fichas_maquina
     set dias = dias || jsonb_build_object(v_chave, jsonb_build_object(
           'statuses', p_dados->'statuses',
           'operador', btrim(p_dados->>'operador'),
           'observacao', btrim(coalesce(p_dados->>'observacao', '')),
           'fotos', coalesce(p_dados->'fotos', '[]'::jsonb),
           'assinatura', nullif(p_dados->>'assinatura', ''),
           'atualizado_em', now(),
           'atualizado_por', auth.uid()))
   where id = p_ficha;
end $$;

-- Volta a vistoria concluída para edição. Some da tela do fornecedor até ser concluída de novo.
create or replace function public.reabrir_vistoria_seg(p_vistoria uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v public.seg_vistorias;
begin
  select * into v from public.seg_vistorias where id = p_vistoria for update;
  if v.id is null then raise exception 'Vistoria não encontrada'; end if;
  if not app.tst_da_obra(v.obra_id) then raise exception 'Apenas o TST da obra ou o administrativo reabre a vistoria'; end if;
  if v.situacao <> 'concluida' then raise exception 'A vistoria já está em edição'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Diga o que vai ser corrigido'; end if;
  update public.seg_vistorias set situacao = 'rascunho', concluida_em = null, concluida_por = null where id = p_vistoria;
  update public.seg_avisos set situacao_envio = 'cancelado'
   where vistoria_id = p_vistoria and tipo = 'vistoria_pdf' and situacao_envio = 'aguardando';
  perform app.registrar_evento('seg_vistorias', p_vistoria, 'reaberta', jsonb_build_object('motivo', btrim(p_motivo)));
end $$;

revoke execute on function public.abrir_ficha_maquina(uuid, date) from anon, public;
revoke execute on function public.salvar_dia_ficha(uuid, int, jsonb) from anon, public;
revoke execute on function public.reabrir_vistoria_seg(uuid, text) from anon, public;
grant execute on function public.abrir_ficha_maquina(uuid, date) to authenticated;
grant execute on function public.salvar_dia_ficha(uuid, int, jsonb) to authenticated;
grant execute on function public.reabrir_vistoria_seg(uuid, text) to authenticated;
