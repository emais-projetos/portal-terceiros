-- "Outro documento" (e qualquer documento sem vencimento) pode ganhar uma vigência na análise.
-- O administrativo informa a data ao aprovar; a partir daí o documento entra nos avisos de vencimento como os demais.

create or replace view public.v_documentos_atuais as
 WITH atuais AS (
         SELECT DISTINCT ON (d.empresa_id, d.colaborador_id, d.tipo_codigo) d.id,
            d.tipo_codigo,
            d.empresa_id,
            d.colaborador_id,
            d.data_emissao,
            d.data_vencimento_informada,
            d.dispensado,
            d.dados,
            d.status,
            d.motivo_devolucao,
            d.aceite_lgpd_em,
            d.enviado_por,
            d.enviado_em,
            d.analisado_por,
            d.analisado_em,
            d.origem
           FROM documentos d
          WHERE (d.status = 'aprovado'::status_documento)
          ORDER BY d.empresa_id, d.colaborador_id, d.tipo_codigo, COALESCE(d.data_emissao, d.data_vencimento_informada) DESC NULLS LAST, d.analisado_em DESC
        )
 SELECT a.id,
    a.tipo_codigo,
    t.nome AS documento,
    t.grupo,
    t.area,
    t.impeditivo,
    a.empresa_id,
    a.colaborador_id,
    a.data_emissao,
    a.dispensado,
        CASE
            WHEN a.dispensado THEN NULL::date
            WHEN (t.regra = 'emissao_mais_prazo'::regra_vencimento) THEN (a.data_emissao + t.validade_dias)
            WHEN (t.regra = 'vigencia_informada'::regra_vencimento) THEN a.data_vencimento_informada
            WHEN (t.regra = 'sem_vencimento'::regra_vencimento) THEN a.data_vencimento_informada
            ELSE NULL::date
        END AS vencimento,
    v.dias_para_vencer,
        CASE
            WHEN a.dispensado THEN 'dispensado'::text
            WHEN (v.dias_para_vencer IS NULL) THEN 'vigente'::text
            WHEN (v.dias_para_vencer <= 0) THEN 'vencido'::text
            WHEN (v.dias_para_vencer <= app.param_int('dias_a_vencer'::text)) THEN 'a_vencer'::text
            ELSE 'vigente'::text
        END AS situacao,
    COALESCE(a.colaborador_id, '00000000-0000-0000-0000-000000000000'::uuid) AS chave_colaborador
   FROM ((atuais a
     JOIN tipos_documento t ON ((t.codigo = a.tipo_codigo)))
     CROSS JOIN LATERAL ( SELECT (
                CASE
                    WHEN a.dispensado THEN NULL::date
                    WHEN (t.regra = 'emissao_mais_prazo'::regra_vencimento) THEN (a.data_emissao + t.validade_dias)
                    WHEN (t.regra = 'vigencia_informada'::regra_vencimento) THEN a.data_vencimento_informada
                    WHEN (t.regra = 'sem_vencimento'::regra_vencimento) THEN a.data_vencimento_informada
                    ELSE NULL::date
                END - CURRENT_DATE) AS dias_para_vencer) v);

drop function if exists public.aprovar_documento(uuid);
create or replace function public.aprovar_documento(p_documento uuid, p_vencimento date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_regra regra_vencimento;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador aprova documentos'; end if;
  select t.regra into v_regra from public.documentos d join public.tipos_documento t on t.codigo = d.tipo_codigo where d.id = p_documento;
  if p_vencimento is not null then
    if v_regra = 'emissao_mais_prazo' then raise exception 'Este documento vence pela data de emissão; a vigência não pode ser informada na análise'; end if;
    if p_vencimento < current_date then raise exception 'A vigência informada já passou'; end if;
  end if;
  update public.documentos
     set status = 'aprovado', analisado_por = auth.uid(), analisado_em = now(), motivo_devolucao = null,
         data_vencimento_informada = coalesce(p_vencimento, data_vencimento_informada)
   where id = p_documento and status = 'em_analise';
  if not found then raise exception 'Documento não está em análise'; end if;
end $$;
revoke execute on function public.aprovar_documento(uuid, date) from anon;
grant execute on function public.aprovar_documento(uuid, date) to authenticated;
