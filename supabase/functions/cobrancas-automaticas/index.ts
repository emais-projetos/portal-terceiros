// Gerado por empacotar.mjs a partir de fonte.ts e site/src/lib. Não edite este arquivo.

// supabase/functions/cobrancas-automaticas/servidor-supabase.ts
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
var supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false }
});
var enderecoDoSite = "https://emais-projetos.github.io/portal-terceiros/";

// site/src/lib/formato.ts
function data(valor) {
  if (!valor) return "";
  const [a, m, d] = valor.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : "";
}
function hojeIso() {
  const h = /* @__PURE__ */ new Date();
  const local = new Date(h.getTime() - h.getTimezoneOffset() * 6e4);
  return local.toISOString().slice(0, 10);
}

// site/src/lib/admin.ts
import { FunctionsHttpError } from "npm:@supabase/supabase-js@2.117.2";
var TAMANHO_PAGINA = 1e3;
async function lerTudo(montar) {
  const todas = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data: data2, error } = await montar(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    todas.push(...data2 ?? []);
    if (!data2 || data2.length < TAMANHO_PAGINA) break;
  }
  return todas;
}
async function lerAlocacoes() {
  return lerTudo(
    (inicio, fim) => supabase.from("v_alocacoes_resumo").select(
      "alocacao_id, status, obra_id, obra, colaborador_id, colaborador, funcao, empresa_id, empresa, inicio_conferencia, aprovado_admin_em, validado_tst_em, data_integracao, vencimento_integracao, impeditivos_pendentes, pendentes_adm, pendentes_sst, devolvidos, em_analise, a_vencer, bloqueado, bloqueio_motivo"
    ).order("alocacao_id").range(inicio, fim)
  );
}

// site/src/lib/fornecedor.ts
var TAMANHO_MAXIMO = 10 * 1024 * 1024;

// site/src/lib/medicao.ts
async function lerTiposMedicao() {
  const { data: data2, error } = await supabase.from("tipos_medicao").select("codigo, item, nome, coletivo, conferencias, impeditivo, quando_aplicavel, ordem").eq("ativo", true).order("ordem");
  if (error) throw error;
  return data2 ?? [];
}
var CAMPOS_MEDICAO = "id, empresa_id, empresa, cnpj, email_cobranca, obra_id, obra, competencia, prazo, status, primeiro_envio_em, enviada_em, conferente, ultima_analise_em, ultima_cobranca_em, observacao, origem, qtd_colaboradores, entregue_no_prazo, retida, em_atraso, tolerancia, prazo_combinado, prazo_combinado_obs, itens_pendentes, itens_em_analise, itens_devolvidos, colaboradores_pendentes";
async function lerTodasMedicoes() {
  const todas = [];
  for (let inicio = 0; ; inicio += 1e3) {
    const { data: data2, error } = await supabase.from("v_medicoes").select(CAMPOS_MEDICAO).order("id").range(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...data2 ?? []);
    if (!data2 || data2.length < 1e3) break;
  }
  return todas;
}

// site/src/lib/cobrancas.ts
var DIA_LEMBRETE = 20;
var DIA_NOTIFICACAO = 26;
var INICIO_PORTAL = "2026-09-01";
var MAX_LINHAS = 15;
var DIAS_PARADO = 3;
function somarMeses(competencia, n) {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}
var mesAtual = (hoje) => `${hoje.slice(0, 7)}-01`;
var diaDoMes = (hoje) => Number(hoje.slice(8, 10));
function ultimoDia(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}
function prazoDe(competencia) {
  return `${somarMeses(competencia, 1).slice(0, 8)}25`;
}
function toleranciaDe(competencia) {
  const mes = somarMeses(competencia, 1);
  return `${mes.slice(0, 8)}${String(Math.min(30, ultimoDia(mes))).padStart(2, "0")}`;
}
function diaSemana(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}
function somarDiasIso(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function proximoDiaUtil(iso) {
  let d = somarDiasIso(iso, 1);
  while (diaSemana(d) === 0 || diaSemana(d) === 6) d = somarDiasIso(d, 1);
  return d;
}
function diasUteisDesde(inicio, hoje) {
  let n = 0;
  for (let d = somarDiasIso(inicio.slice(0, 10), 1); d <= hoje; d = somarDiasIso(d, 1)) if (diaSemana(d) !== 0 && diaSemana(d) !== 6) n += 1;
  return n;
}
function segundaDaSemana(hoje) {
  const dia = diaSemana(hoje);
  return somarDiasIso(hoje, dia === 0 ? -6 : 1 - dia);
}
var curta = (iso) => data(iso).slice(0, 5);
function mesBarra(competencia) {
  const nomes = ["janeiro", "fevereiro", "mar\xE7o", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const [a, m] = competencia.split("-").map(Number);
  return `${nomes[m - 1]}/${a}`;
}
function competenciaDoLembrete(hoje = hojeIso()) {
  const d = diaDoMes(hoje);
  return d >= DIA_LEMBRETE && d < DIA_NOTIFICACAO ? somarMeses(mesAtual(hoje), -1) : null;
}
function competenciaDaNotificacao(hoje = hojeIso()) {
  const c = somarMeses(mesAtual(hoje), -1);
  return diaDoMes(hoje) >= DIA_NOTIFICACAO && hoje <= toleranciaDe(c) ? c : null;
}
function competenciaDaRetencao(hoje = hojeIso()) {
  const c = somarMeses(mesAtual(hoje), -1);
  return hoje > toleranciaDe(c) ? c : somarMeses(c, -1);
}
function proximaData(hoje = hojeIso()) {
  const d = diaDoMes(hoje);
  const mes = mesAtual(hoje);
  const tol = toleranciaDe(somarMeses(mes, -1));
  if (d < DIA_LEMBRETE) return `${mes.slice(0, 8)}${DIA_LEMBRETE}`;
  if (d < DIA_NOTIFICACAO) return `${mes.slice(0, 8)}${DIA_NOTIFICACAO}`;
  if (hoje <= tol) return somarDiasIso(tol, 1);
  return `${somarMeses(mes, 1).slice(0, 8)}${DIA_LEMBRETE}`;
}
var MINUSCULAS = /* @__PURE__ */ new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "a"]);
var SUFIXOS = /\s*(-\s*)?\b(LTDA|ME|EPP|EIRELI|S\/?A|LIMITADA)\.?\s*$/i;
function nomeLegivel(texto, empresa = false) {
  let t = texto.trim();
  if (empresa) for (let i = 0; i < 2; i++) t = t.replace(SUFIXOS, "").trim();
  return t.split(/\s+/).map((p, i) => {
    const so = p.replace(/[^A-Za-zÀ-ÿ]/g, "");
    if (!so) return p;
    if (/[.&/]/.test(p) || so.length <= 4 && !/[AEIOUÁÉÍÓÚÂÊÔÃÕ]/i.test(so)) return p.toUpperCase();
    const baixo = p.toLowerCase();
    if (i > 0 && MINUSCULAS.has(baixo)) return baixo;
    return baixo.charAt(0).toUpperCase() + baixo.slice(1);
  }).join(" ");
}
var AVISO_PORTAL = "Importante: documentos e corre\xE7\xF5es s\xE3o recebidos somente pelo portal. Arquivos enviados por e-mail n\xE3o s\xE3o considerados na confer\xEAncia.";
function assinatura(nome, a) {
  return ["", "Atenciosamente,", ...nome ? [nome] : [], `${a.setor} | Grupo Emais`, ...a.contato ? [a.contato] : []];
}
function limitar(linhas, oQue) {
  if (linhas.length <= MAX_LINHAS) return linhas;
  return [...linhas.slice(0, MAX_LINHAS), `- e mais ${linhas.length - MAX_LINHAS} ${oQue}: veja a lista completa no portal`];
}
function limitarItens(linhas, oQue) {
  let contadas = 0;
  const saida = linhas.filter((s) => !s.startsWith("- ") || ++contadas <= MAX_LINHAS);
  return contadas > MAX_LINHAS ? [...saida, `- e mais ${contadas - MAX_LINHAS} ${oQue}: veja a lista completa no portal`] : saida;
}
async function lerTudo2(montar) {
  const todas = [];
  for (let inicio = 0; ; inicio += 1e3) {
    const { data: d, error } = await montar(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...d ?? []);
    if (!d || d.length < 1e3) break;
  }
  return todas;
}
var CAMPOS_PEND = "alocacao_id, colaborador_id, empresa_id, tipo_codigo, documento, grupo, vencimento, dias_para_vencer, status_envio_aberto, motivo_devolucao, situacao";
async function lerBase(competencias) {
  const [medicoes, tipos, alocacoes, pendencias, empresas, obras, feitas, criadas, devolvidos, parametros2] = await Promise.all([
    lerTodasMedicoes(),
    lerTiposMedicao(),
    lerAlocacoes(),
    lerTudo2(
      (i, f) => supabase.from("v_pendencias").select(CAMPOS_PEND).in("situacao", ["a_vencer", "vencido", "nao_enviado", "devolvido"]).eq("impeditivo", true).order("alocacao_id").order("tipo_codigo").range(i, f)
    ),
    lerTudo2((i, f) => supabase.from("empresas").select("id, razao_social, email_contato, email_acesso").order("id").range(i, f)),
    lerTudo2((i, f) => supabase.from("obras").select("id, nome, emails_engenharia").order("id").range(i, f)),
    lerTudo2(
      (i, f) => supabase.from("cobrancas").select("tipo, referencia").order("id").range(i, f)
    ),
    lerTudo2(
      (i, f) => supabase.from("alocacoes").select("id, criado_em").in("status", ["em_cadastro", "pendente_fornecedor"]).order("id").range(i, f)
    ),
    lerTudo2(
      (i, f) => supabase.from("documentos").select("empresa_id, colaborador_id, tipo_codigo, analisado_em").eq("status", "devolvido").order("id").range(i, f)
    ),
    supabase.from("parametros").select("chave, valor").in("chave", ["cobranca_setor", "cobranca_contato"])
  ]);
  const ids = medicoes.filter((m) => competencias.includes(m.competencia) && m.status !== "aprovada").map((m) => m.id);
  const itens = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: d, error } = await supabase.from("medicoes_itens").select("medicao_id, tipo_codigo, status, motivo_devolucao").in("medicao_id", ids.slice(i, i + 150));
    if (error) throw error;
    itens.push(...d ?? []);
  }
  if (parametros2.error) throw parametros2.error;
  const param = new Map((parametros2.data ?? []).map((p) => [p.chave, p.valor]));
  const devolucoes = /* @__PURE__ */ new Map();
  devolvidos.forEach((d) => {
    const k = `${d.empresa_id}|${d.colaborador_id ?? ""}|${d.tipo_codigo}`;
    if (d.analisado_em && (!devolucoes.has(k) || devolucoes.get(k) < d.analisado_em)) devolucoes.set(k, d.analisado_em);
  });
  return {
    medicoes,
    itens,
    tipos,
    alocacoes,
    criacao: new Map(criadas.map((a) => [a.id, a.criado_em])),
    devolucoes,
    pendencias,
    empresas,
    obras,
    feitas: new Set(feitas.map((c) => `${c.tipo}|${c.referencia}`)),
    assinatura: { setor: param.get("cobranca_setor") ?? "Gente e Gest\xE3o", contato: param.get("cobranca_contato") ?? "" }
  };
}
var LINK_MEDICAO = () => `${enderecoDoSite}medicao`;
var LINK_PENDENCIAS = () => `${enderecoDoSite}pendencias`;
function emailDaEmpresa(e) {
  return (e?.email_contato ?? e?.email_acesso ?? "").trim();
}
function esperadas(base, competencia) {
  const doMes = base.medicoes.filter((m) => m.competencia === competencia);
  const lista = doMes.map((m) => ({ empresa_id: m.empresa_id, empresa: m.empresa, obra_id: m.obra_id, obra: m.obra ?? "", medicao: m }));
  const tem = new Set(doMes.map((m) => `${m.empresa_id}|${m.obra_id ?? ""}`));
  const vistos = /* @__PURE__ */ new Set();
  base.alocacoes.filter((a) => a.status === "liberado").forEach((a) => {
    const k = `${a.empresa_id}|${a.obra_id}`;
    if (tem.has(k) || vistos.has(k)) return;
    vistos.add(k);
    lista.push({ empresa_id: a.empresa_id, empresa: a.empresa, obra_id: a.obra_id, obra: a.obra, medicao: null });
  });
  return lista;
}
function porEmpresa(l) {
  const m = /* @__PURE__ */ new Map();
  l.forEach((x) => m.set(x.empresa_id, [...m.get(x.empresa_id) ?? [], x]));
  return m;
}
var nomeObra = (x) => x.obra_id ? `Obra ${nomeLegivel(x.obra)}` : "Medi\xE7\xE3o do m\xEAs";
function situacaoParaLembrete(x) {
  if (!x.medicao) return "medi\xE7\xE3o n\xE3o iniciada";
  if (x.medicao.status === "pendente_fornecedor") return "devolvida pela Emais, falta corrigir no portal e reenviar";
  return "iniciada, falta enviar para confer\xEAncia";
}
function itensPendentes(base, medicaoId) {
  return base.itens.filter((i) => i.medicao_id === medicaoId && (i.status === "nao_enviado" || i.status === "devolvido")).length;
}
function oQueFalta(base, l) {
  const tipoPor = new Map(base.tipos.map((t) => [t.codigo, t]));
  const linhas = [];
  l.forEach((x) => {
    linhas.push(nomeObra(x));
    if (!x.medicao) {
      linhas.push("- Medi\xE7\xE3o n\xE3o enviada");
      return;
    }
    const itens = base.itens.filter((i) => i.medicao_id === x.medicao.id && (i.status === "nao_enviado" || i.status === "devolvido")).map((i) => ({ i, t: tipoPor.get(i.tipo_codigo) })).filter((y) => !!y.t).sort((a, b) => a.t.ordem - b.t.ordem);
    if (itens.length >= 12) linhas.push("- Medi\xE7\xE3o n\xE3o enviada");
    else if (itens.length === 0)
      linhas.push(x.medicao.status === "aberta" ? "- Documentos enviados, falta clicar em Enviar para confer\xEAncia" : "- Corrigir no portal os colaboradores com pend\xEAncia e reenviar");
    else
      linhas.push(
        ...itens.map(({ i, t }) => `- ${t.item}. ${t.nome}${i.status === "devolvido" ? ` (devolvido${i.motivo_devolucao ? `: ${i.motivo_devolucao.toLowerCase()}` : ""}; corrija no portal)` : ""}`)
      );
  });
  return limitarItens(linhas, "itens");
}
var COMO_ENVIAR_MEDICAO = (mes) => [
  "Como enviar:",
  `1. Acesse ${LINK_MEDICAO()}`,
  `2. Escolha a obra e o m\xEAs de ${mes} e clique em Come\xE7ar.`,
  '3. Anexe um arquivo por item ou marque "n\xE3o se aplica" quando for o caso.',
  "4. Confira a lista de colaboradores do m\xEAs e clique em Enviar para confer\xEAncia."
];
var COMO_REGULARIZAR = (mes, final) => [
  `1. Acesse ${LINK_MEDICAO()}`,
  `2. Abra ${mes}, envie ou corrija os itens acima e clique em Enviar para confer\xEAncia.`,
  `3. ${final}`
];
var pendenteDoFornecedor = (x) => !x.medicao || x.medicao.status === "aberta" || x.medicao.status === "pendente_fornecedor";
function lembretes(base, competencia, nome) {
  const mes = mesBarra(competencia);
  const prazo = prazoDe(competencia);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const lista = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`lembrete_medicao|${referencia}`)) return;
    const empresa = nomeLegivel(l[0].empresa, true);
    lista.push({
      chave: `lembrete|${referencia}`,
      tipo: "lembrete_medicao",
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? "obra" : "obras"} sem envio`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Medi\xE7\xE3o de ${mes}: envio at\xE9 ${curta(prazo)}, ${empresa}`,
      corpo: [
        `Ol\xE1, equipe da ${empresa},`,
        "",
        `A medi\xE7\xE3o de ${mes} deve ser enviada pelo Portal de Terceiros at\xE9 ${data(prazo)}.`,
        "",
        "Situa\xE7\xE3o hoje:",
        ...limitar(l.map((x) => `- ${nomeObra(x)}: ${situacaoParaLembrete(x)}`), "obras"),
        "",
        "Por que \xE9 importante:",
        `O pagamento do m\xEAs s\xF3 \xE9 liberado depois que a Emais confere os documentos da medi\xE7\xE3o (holerites, ponto, folha, FGTS, INSS, DCTFWeb, DARF e seguro de vida). Se a medi\xE7\xE3o n\xE3o for apresentada no prazo, o pagamento de ${mes.split("/")[0]} pode ser retido.`,
        "",
        ...COMO_ENVIAR_MEDICAO(mes),
        "",
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura)
      ].join("\n"),
      registros: [{ tipo: "lembrete_medicao", referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao.id),
      obraId: null
    });
  });
  return lista;
}
function notificacoes(base, competencia, nome, hoje) {
  const mes = mesBarra(competencia);
  const mesNome = mes.split("/")[0];
  const prazo = prazoDe(competencia);
  const tol = toleranciaDe(competencia);
  const resposta2 = proximoDiaUtil(hoje);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const lista = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`notificacao_medicao|${referencia}`)) return;
    const empresa = nomeLegivel(l[0].empresa, true);
    lista.push({
      chave: `notificacao|${referencia}`,
      tipo: "notificacao_medicao",
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? "obra" : "obras"} em atraso, toler\xE2ncia at\xE9 ${curta(tol)}`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Medi\xE7\xE3o de ${mes} em atraso: envie at\xE9 ${curta(tol)} para evitar a reten\xE7\xE3o do pagamento, ${empresa}`,
      corpo: [
        `Ol\xE1, equipe da ${empresa},`,
        "",
        `O prazo da medi\xE7\xE3o de ${mes} terminou em ${data(prazo)} e ainda faltam documentos. Para que o pagamento de ${mesNome} n\xE3o seja retido, regularize pelo portal at\xE9 ${data(tol)}.`,
        "",
        "O que falta:",
        ...oQueFalta(base, l),
        "",
        `Pedimos que responda este e-mail at\xE9 ${curta(resposta2)} informando a data em que os documentos ser\xE3o enviados no portal.`,
        "",
        `Se n\xE3o for regularizado at\xE9 ${data(tol)}:`,
        `- o pagamento de ${mesNome} fica retido at\xE9 a aprova\xE7\xE3o da medi\xE7\xE3o;`,
        "- a engenharia da obra \xE9 avisada da reten\xE7\xE3o;",
        "- o atraso fica registrado no hist\xF3rico de entregas da empresa, considerado na avalia\xE7\xE3o de fornecedores da Emais.",
        "",
        "Como regularizar:",
        ...COMO_REGULARIZAR(mes, "A Emais confere em at\xE9 3 dias \xFAteis."),
        "",
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura)
      ].join("\n"),
      registros: [{ tipo: "notificacao_medicao", referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao.id),
      obraId: null
    });
  });
  return lista;
}
var combinadaAte = (x, hoje) => x.medicao?.prazo_combinado && x.medicao.prazo_combinado >= hoje ? x.medicao.prazo_combinado : null;
function retencoesFornecedor(base, competencia, nome, hoje) {
  const mes = mesBarra(competencia);
  const mesNome = mes.split("/")[0];
  const tol = toleranciaDe(competencia);
  const notificacao = `${somarMeses(competencia, 1).slice(0, 8)}${DIA_NOTIFICACAO}`;
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const retidas = esperadas(base, competencia).filter((x) => pendenteDoFornecedor(x) && !combinadaAte(x, hoje));
  const lista = [];
  porEmpresa(retidas).forEach((l, empresaId) => {
    const empresa = nomeLegivel(l[0].empresa, true);
    const combinada = l.map((x) => x.medicao?.prazo_combinado).filter((d) => !!d && d > tol).sort().pop();
    const referencia = combinada ? `${competencia}:${empresaId}:combinado:${combinada}` : `${competencia}:${empresaId}`;
    if (base.feitas.has(`cobranca_medicao|${referencia}`)) return;
    lista.push({
      chave: `retencao-fornecedor|${referencia}`,
      tipo: "cobranca_medicao",
      urgente: true,
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? "obra" : "obras"} com pagamento retido`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Pagamento retido: medi\xE7\xE3o de ${mes} pendente, ${empresa}`,
      corpo: [
        `Ol\xE1, equipe da ${empresa},`,
        "",
        combinada && combinada > tol ? `A medi\xE7\xE3o de ${mes} estava em atraso e combinamos o envio no portal at\xE9 ${data(combinada)}. Como os itens abaixo continuam pendentes, o pagamento de ${mesNome} est\xE1 retido.` : `No dia ${data(notificacao)} avisamos que a medi\xE7\xE3o de ${mes} estava em atraso, com prazo at\xE9 ${data(tol)} para regulariza\xE7\xE3o no portal. Como os itens abaixo continuam pendentes, o pagamento de ${mesNome} est\xE1 retido.`,
        "",
        "O que falta:",
        ...oQueFalta(base, l),
        "",
        "O pagamento \xE9 liberado assim que a medi\xE7\xE3o for aprovada:",
        ...COMO_REGULARIZAR(mes, "A Emais confere em at\xE9 3 dias \xFAteis e avisa a obra da libera\xE7\xE3o."),
        "",
        "O atraso fica registrado no hist\xF3rico de entregas da empresa, considerado na avalia\xE7\xE3o de fornecedores da Emais.",
        "",
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura)
      ].join("\n"),
      registros: [{ tipo: "cobranca_medicao", referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao.id),
      obraId: null
    });
  });
  return lista;
}
function retencoesObra(base, competencia, nome, hoje) {
  const mes = mesBarra(competencia);
  const mesNome = mes.split("/")[0];
  const tol = toleranciaDe(competencia);
  const obraPor = new Map(base.obras.map((o) => [o.id, o]));
  const porObra = /* @__PURE__ */ new Map();
  esperadas(base, competencia).filter((x) => x.obra_id).forEach((x) => porObra.set(x.obra_id, [...porObra.get(x.obra_id) ?? [], x]));
  const lista = [];
  porObra.forEach((l, obraId) => {
    const pendentes = l.filter((x) => !x.medicao || x.medicao.status !== "aprovada");
    const reter = pendentes.filter((x) => !combinadaAte(x, hoje));
    const aguardando = pendentes.filter((x) => combinadaAte(x, hoje));
    if (reter.length === 0) return;
    const vencidaCombinada = reter.map((x) => x.medicao?.prazo_combinado).filter((d) => !!d && d > tol).sort().pop();
    const referencia = vencidaCombinada ? `${competencia}:${obraId}:combinado:${vencidaCombinada}` : `${competencia}:${obraId}`;
    if (base.feitas.has(`retencao_obra|${referencia}`)) return;
    const nomeDaObra = obraPor.get(obraId)?.nome ?? l[0].obra;
    const obra = nomeLegivel(nomeDaObra);
    const aprovadas = l.filter((x) => x.medicao?.status === "aprovada");
    const ordem = (a, b) => a.empresa.localeCompare(b.empresa, "pt-BR");
    const motivo = (x) => !x.medicao || itensPendentes(base, x.medicao.id) >= 12 ? "medi\xE7\xE3o n\xE3o enviada" : x.medicao.status === "em_analise" ? "em confer\xEAncia na Emais" : "documentos pendentes";
    lista.push({
      chave: `retencao-obra|${referencia}`,
      tipo: "retencao_obra",
      urgente: true,
      titulo: nomeDaObra,
      resumo: `${reter.length} ${reter.length === 1 ? "empresa a reter" : "empresas a reter"}${aguardando.length ? `, ${aguardando.length} com data combinada` : ""}`,
      para: obraPor.get(obraId)?.emails_engenharia ?? "",
      assunto: `${obra}: reter pagamento de ${reter.length} ${reter.length === 1 ? "empresa" : "empresas"} (medi\xE7\xE3o de ${mes})`,
      corpo: [
        "Ol\xE1,",
        "",
        `As empresas abaixo n\xE3o regularizaram a medi\xE7\xE3o de ${mes} at\xE9 ${curta(tol)}${vencidaCombinada ? " ou at\xE9 a data combinada" : ""}, mesmo ap\xF3s notifica\xE7\xE3o. A\xE7\xE3o: n\xE3o liberar o pagamento de ${mesNome} dessas empresas at\xE9 novo aviso.`,
        "",
        "Reter pagamento:",
        ...limitar(reter.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: ${motivo(x)}`), "empresas"),
        ...aprovadas.length ? ["", "Liberadas para pagamento:", ...limitar(aprovadas.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}`), "empresas")] : [],
        ...aguardando.length ? ["", "Aguardando data combinada com o fornecedor (ainda n\xE3o reter):", ...aguardando.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: envio combinado at\xE9 ${curta(combinadaAte(x, hoje))}`)] : [],
        "",
        "Os fornecedores j\xE1 foram notificados. Assim que cada empresa for aprovada, enviamos a libera\xE7\xE3o.",
        ...assinatura(nome, base.assinatura)
      ].join("\n"),
      registros: [{ tipo: "retencao_obra", referencia, empresa_id: null, obra_id: obraId, competencia }],
      medicoes: [],
      obraId
    });
  });
  return lista;
}
function vencimentos(base, nome) {
  const liberadas = new Map(base.alocacoes.filter((a) => a.status === "liberado").map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const docs = /* @__PURE__ */ new Map();
  base.pendencias.forEach((p) => {
    const a = liberadas.get(p.alocacao_id);
    if (!a || !p.vencimento || p.dias_para_vencer === null || p.dias_para_vencer > 30) return;
    if (p.situacao !== "a_vencer" && p.situacao !== "vencido") return;
    if (p.status_envio_aberto === "em_analise") return;
    const faixa = p.dias_para_vencer <= 0 ? "vencido" : p.dias_para_vencer <= 15 ? "15" : "30";
    const deQuem = p.grupo === "empresa" ? "empresa" : p.colaborador_id;
    const chave = `${faixa}:${p.empresa_id}:${p.tipo_codigo}:${deQuem}:${p.vencimento}`;
    if (base.feitas.has(`vencimento_documento|${chave}`) || docs.has(chave)) return;
    docs.set(chave, { chave, faixa, empresa_id: p.empresa_id, quem: p.grupo === "empresa" ? "Documento da empresa" : nomeLegivel(a.colaborador), documento: p.documento, vencimento: p.vencimento });
  });
  function linhas(l) {
    const grupos = /* @__PURE__ */ new Map();
    l.forEach((d) => grupos.set(`${d.quem}|${d.vencimento}`, [...grupos.get(`${d.quem}|${d.vencimento}`) ?? [], d]));
    return [...grupos.values()].sort((a, b) => a[0].vencimento.localeCompare(b[0].vencimento) || a[0].quem.localeCompare(b[0].quem, "pt-BR")).map((g) => {
      const nomes = g.map((d) => d.documento);
      const lista2 = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
      const verbo = g[0].faixa === "vencido" ? g.length > 1 ? "venceram" : "venceu" : g.length > 1 ? "vencem" : "vence";
      return `- ${g[0].quem}: ${lista2}, ${verbo} em ${data(g[0].vencimento)}`;
    });
  }
  const lista = [];
  porEmpresa([...docs.values()]).forEach((l, empresaId) => {
    const e = empresaPor.get(empresaId);
    const empresa = nomeLegivel(e?.razao_social ?? "", true);
    const vencidos = l.filter((d) => d.faixa === "vencido");
    const em15 = l.filter((d) => d.faixa === "15");
    const em30 = l.filter((d) => d.faixa === "30");
    const assunto = vencidos.length ? `Colaboradores impedidos de entrar na obra: documentos vencidos, ${empresa}` : em15.length ? `Faltam 15 dias: documentos vencendo, ${empresa}` : `Documentos vencem nos pr\xF3ximos 30 dias: renove no portal para manter a libera\xE7\xE3o, ${empresa}`;
    const secoes = [
      ...vencidos.length ? ["", "J\xE1 vencidos:", ...linhas(vencidos)] : [],
      ...em15.length ? ["", "Vencem em at\xE9 15 dias:", ...linhas(em15)] : [],
      ...em30.length ? ["", "Vencem em at\xE9 30 dias:", ...linhas(em30)] : []
    ];
    lista.push({
      chave: `documentos|${empresaId}|${l.map((d) => d.chave).sort().join(",")}`,
      tipo: "vencimento_documento",
      urgente: vencidos.length > 0,
      titulo: e?.razao_social ?? "",
      resumo: [vencidos.length ? `${vencidos.length} ${vencidos.length === 1 ? "vencido" : "vencidos"}` : "", em15.length ? `${em15.length} em 15 dias` : "", em30.length ? `${em30.length} em 30 dias` : ""].filter(Boolean).join(", "),
      para: emailDaEmpresa(e),
      assunto,
      corpo: [
        `Ol\xE1, equipe da ${empresa},`,
        "",
        "Os documentos abaixo, de colaboradores liberados nas obras da Emais, precisam ser renovados no portal. Para que eles continuem trabalhando sem interrup\xE7\xE3o, envie a renova\xE7\xE3o antes do vencimento.",
        ...limitarItens(secoes, "documentos"),
        "",
        "Se o documento vencer:",
        "- o colaborador fica impedido de entrar na obra at\xE9 a renova\xE7\xE3o ser aprovada;",
        "- se for preciso refazer exame (ASO) ou treinamento (NR), conte o tempo de agendamento;",
        "- sem colaborador liberado, o servi\xE7o contratado pode atrasar.",
        "",
        "Como enviar:",
        `1. Acesse ${LINK_PENDENCIAS()}`,
        "2. Localize o colaborador e clique em Enviar novo no documento.",
        "3. Anexe o arquivo atualizado e informe a data de emiss\xE3o.",
        "4. A Emais confere em at\xE9 2 dias \xFAteis.",
        "",
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura)
      ].join("\n"),
      registros: l.map((d) => ({ tipo: "vencimento_documento", referencia: d.chave, empresa_id: empresaId, obra_id: null, competencia: null })),
      medicoes: [],
      obraId: null
    });
  });
  return lista;
}
function integracao(base, nome, hoje) {
  const semana = segundaDaSemana(hoje);
  const travadas = new Map(base.alocacoes.filter((a) => a.status === "em_cadastro" || a.status === "pendente_fornecedor").map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const porColaborador = /* @__PURE__ */ new Map();
  base.pendencias.forEach((p) => {
    const a = travadas.get(p.alocacao_id);
    if (!a || !["nao_enviado", "devolvido", "vencido"].includes(p.situacao)) return;
    if (p.status_envio_aberto === "em_analise") return;
    if (p.situacao === "nao_enviado") {
      const criada = base.criacao.get(p.alocacao_id);
      if (!criada || diasUteisDesde(criada, hoje) < DIAS_PARADO) return;
    }
    if (p.situacao === "devolvido") {
      const em = base.devolucoes.get(`${p.empresa_id}|${p.grupo === "empresa" ? "" : p.colaborador_id}|${p.tipo_codigo}`);
      if (em && diasUteisDesde(em, hoje) < DIAS_PARADO) return;
    }
    const f = porColaborador.get(p.alocacao_id) ?? { empresa_id: a.empresa_id, obra: a.obra, colaborador: nomeLegivel(a.colaborador), docs: [] };
    const doc = p.situacao === "devolvido" ? `${p.documento} (devolvido${p.motivo_devolucao ? `: ${p.motivo_devolucao.toLowerCase()}` : ""}; corrija no portal)` : p.situacao === "vencido" ? `${p.documento} (vencido)` : p.documento;
    if (!f.docs.includes(doc)) f.docs.push(doc);
    porColaborador.set(p.alocacao_id, f);
  });
  const lista = [];
  porEmpresa([...porColaborador.values()]).forEach((l, empresaId) => {
    const referencia = `${semana}:${empresaId}`;
    if (base.feitas.has(`integracao_documentos|${referencia}`)) return;
    const e = empresaPor.get(empresaId);
    const empresa = nomeLegivel(e?.razao_social ?? "", true);
    const obras = [...new Set(l.map((x) => x.obra))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const linhas = obras.flatMap((o) => [
      `Obra ${nomeLegivel(o)}`,
      ...l.filter((x) => x.obra === o).sort((a, b) => a.colaborador.localeCompare(b.colaborador, "pt-BR")).map((x) => `- ${x.colaborador}: ${x.docs.join(", ")}`)
    ]);
    lista.push({
      chave: `integracao|${referencia}`,
      tipo: "integracao_documentos",
      titulo: e?.razao_social ?? "",
      resumo: `${l.length} ${l.length === 1 ? "colaborador" : "colaboradores"} sem libera\xE7\xE3o`,
      para: emailDaEmpresa(e),
      assunto: `Colaboradores sem libera\xE7\xE3o para a obra: documentos pendentes, ${empresa}`,
      corpo: [
        `Ol\xE1, equipe da ${empresa},`,
        "",
        "Os colaboradores abaixo est\xE3o cadastrados no portal, mas ainda n\xE3o podem ser liberados porque faltam documentos obrigat\xF3rios. Sem eles, o colaborador n\xE3o faz a integra\xE7\xE3o de seguran\xE7a e n\xE3o entra na obra.",
        "",
        ...limitarItens(linhas, "colaboradores"),
        "",
        "Como enviar:",
        `1. Acesse ${LINK_PENDENCIAS()}`,
        "2. Envie os documentos de cada colaborador.",
        "3. Com tudo enviado, clique em Enviar para an\xE1lise.",
        "4. A Emais confere em at\xE9 2 dias \xFAteis; depois o TST da obra valida e agenda a integra\xE7\xE3o.",
        "",
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura)
      ].join("\n"),
      registros: [{ tipo: "integracao_documentos", referencia, empresa_id: empresaId, obra_id: null, competencia: null }],
      medicoes: [],
      obraId: null
    });
  });
  return lista;
}
async function montarFila(nome, hoje = hojeIso()) {
  const lembrete = competenciaDoLembrete(hoje);
  const notificacao = competenciaDaNotificacao(hoje);
  const retencao = competenciaDaRetencao(hoje);
  const doPortal = (c) => !!c && c >= INICIO_PORTAL;
  const base = await lerBase([lembrete, notificacao, retencao].filter(doPortal));
  const ordem = (a, b) => a.titulo.localeCompare(b.titulo, "pt-BR");
  return {
    cobrancas: [
      ...doPortal(lembrete) ? lembretes(base, lembrete, nome).sort(ordem) : [],
      ...doPortal(notificacao) ? notificacoes(base, notificacao, nome, hoje).sort(ordem) : [],
      ...doPortal(retencao) ? retencoesFornecedor(base, retencao, nome, hoje).sort(ordem) : [],
      ...doPortal(retencao) ? retencoesObra(base, retencao, nome, hoje).sort(ordem) : [],
      ...vencimentos(base, nome).sort(ordem),
      ...integracao(base, nome, hoje).sort(ordem)
    ],
    proxima: proximaData(hoje),
    assinatura: base.assinatura
  };
}

// supabase/functions/cobrancas-automaticas/fonte.ts
var cabecalhos = { "Content-Type": "application/json" };
var resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: cabecalhos });
function hojeSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
}
async function parametros() {
  const { data: data2, error } = await supabase.from("parametros").select("chave, valor").in("chave", ["cobranca_automatica_empresas", "cobranca_automatica_teste_para", "cobranca_automatica_pausada"]);
  if (error) throw error;
  const p = new Map((data2 ?? []).map((x) => [x.chave, (x.valor ?? "").trim()]));
  const lista = (p.get("cobranca_automatica_empresas") ?? "").toLowerCase();
  return {
    todas: lista === "todas",
    cnpjs: lista === "todas" ? [] : lista.split(/[,;\s]+/).map((c) => c.replace(/\D/g, "")).filter((c) => c.length === 14),
    testePara: p.get("cobranca_automatica_teste_para") ?? "",
    pausada: (p.get("cobranca_automatica_pausada") ?? "").toLowerCase() === "sim"
  };
}
async function empresasDasCobrancas(cobrancas) {
  const obras = [...new Set(cobrancas.filter((c) => !c.registros.some((r) => r.empresa_id) && c.obraId).map((c) => c.obraId))];
  const porObra = /* @__PURE__ */ new Map();
  if (obras.length) {
    const { data: data2, error } = await supabase.from("empresas_obras").select("obra_id, empresa_id").in("obra_id", obras).eq("ativo", true);
    if (error) throw error;
    (data2 ?? []).forEach((x) => porObra.set(x.obra_id, [...porObra.get(x.obra_id) ?? [], x.empresa_id]));
  }
  return new Map(
    cobrancas.map((c) => {
      const dosRegistros = c.registros.map((r) => r.empresa_id).filter((x) => !!x);
      const ids = dosRegistros.length ? dosRegistros : c.obraId ? porObra.get(c.obraId) ?? [] : [];
      return [c.chave, [...new Set(ids)]];
    })
  );
}
async function fila(dataRef) {
  const cfg = await parametros();
  const base = { data: dataRef, pausada: cfg.pausada, modo_teste: !!cfg.testePara, teste_para: cfg.testePara || null };
  if (cfg.pausada) return { ...base, itens: [], sem_destinatario: [], fora_da_lista: 0 };
  const { cobrancas } = await montarFila("", dataRef);
  const empresas = await empresasDasCobrancas(cobrancas);
  let liberadas = null;
  if (!cfg.todas) {
    liberadas = /* @__PURE__ */ new Set();
    if (cfg.cnpjs.length) {
      const { data: data2, error } = await supabase.from("empresas").select("id").in("cnpj", cfg.cnpjs);
      if (error) throw error;
      (data2 ?? []).forEach((e) => liberadas.add(e.id));
    }
  }
  const itens = [];
  const semDestinatario = [];
  let fora = 0;
  for (const c of cobrancas) {
    const ids = empresas.get(c.chave) ?? [];
    const avisoDeObraParcial = liberadas && !cfg.testePara && c.tipo === "retencao_obra";
    if (avisoDeObraParcial || liberadas && !ids.some((id) => liberadas.has(id))) {
      fora += 1;
      continue;
    }
    const original = c.para.trim();
    if (!original.includes("@")) {
      semDestinatario.push({ titulo: c.titulo, tipo: c.tipo });
      continue;
    }
    const teste = !!cfg.testePara;
    itens.push({
      chave: c.chave,
      tipo: c.tipo,
      titulo: c.titulo,
      para: teste ? cfg.testePara : original,
      para_original: original,
      assunto: teste ? `[TESTE \xB7 para ${original}] ${c.assunto}` : c.assunto,
      corpo: c.corpo,
      empresa_ids: ids,
      obra_id: c.obraId,
      registros: c.registros,
      medicoes: c.medicoes,
      teste
    });
  }
  return { ...base, itens, sem_destinatario: semDestinatario, fora_da_lista: fora };
}
async function registrar(item, situacao, erro) {
  const { error } = await supabase.from("cobrancas_envios").insert({
    chave: item.chave,
    tipo: item.tipo,
    titulo: item.titulo,
    empresa_ids: item.empresa_ids,
    obra_id: item.obra_id,
    para: item.para,
    para_original: item.para_original,
    assunto: item.assunto,
    corpo: item.corpo,
    situacao,
    erro: situacao === "erro" ? erro ?? "Erro no envio" : null,
    teste: item.teste
  });
  if (error) throw error;
  if (situacao !== "enviada" || item.teste) return;
  const linhas = item.registros.map((r) => ({ ...r, situacao: "enviada", destinatarios: item.para, assunto: item.assunto, corpo: item.corpo, canal: "n8n" }));
  const { error: e2 } = await supabase.from("cobrancas").upsert(linhas, { onConflict: "tipo,referencia", ignoreDuplicates: true });
  if (e2) throw e2;
  if (item.medicoes.length) {
    const { error: e3 } = await supabase.from("medicoes").update({ ultima_cobranca_em: (/* @__PURE__ */ new Date()).toISOString() }).in("id", item.medicoes);
    if (e3) throw e3;
  }
}
async function resumo(dataRef) {
  const inicio = (/* @__PURE__ */ new Date(`${dataRef}T00:00:00-03:00`)).toISOString();
  const fim = (/* @__PURE__ */ new Date(`${dataRef}T23:59:59-03:00`)).toISOString();
  const { data: data2, error } = await supabase.from("cobrancas_envios").select("titulo, tipo, para_original, assunto, situacao, erro, teste").gte("enviado_em", inicio).lte("enviado_em", fim).order("enviado_em");
  if (error) throw error;
  const envios = data2 ?? [];
  const pendentes = await fila(dataRef);
  const ok = envios.filter((e) => e.situacao === "enviada");
  const falhas = envios.filter((e) => e.situacao === "erro");
  const [a, m, d] = dataRef.split("-");
  const linhas = [
    "Ol\xE1,",
    "",
    `Resumo das cobran\xE7as autom\xE1ticas de ${d}/${m}/${a}${pendentes.modo_teste ? " (modo de teste)" : ""}:`,
    "",
    `- Enviadas: ${ok.length}`,
    `- Com erro: ${falhas.length}`,
    `- Sem e-mail cadastrado (n\xE3o enviadas): ${pendentes.sem_destinatario.length}`,
    ...pendentes.pausada ? ["- O envio autom\xE1tico est\xE1 pausado."] : [],
    "",
    ...ok.length ? ["Enviadas:", ...ok.map((e) => `- ${e.titulo}: ${e.assunto}`), ""] : [],
    ...falhas.length ? ["Com erro (o portal tenta de novo no pr\xF3ximo envio):", ...falhas.map((e) => `- ${e.titulo}: ${e.erro}`), ""] : [],
    ...pendentes.sem_destinatario.length ? ["Sem e-mail cadastrado (cadastre no portal para a cobran\xE7a sair):", ...pendentes.sem_destinatario.map((s) => `- ${s.titulo}`), ""] : [],
    "Gente e Gest\xE3o | Grupo Emais"
  ];
  return {
    tem_conteudo: envios.length > 0 || pendentes.sem_destinatario.length > 0,
    assunto: `Cobran\xE7as autom\xE1ticas de ${d}/${m}: ${ok.length} enviadas${falhas.length ? `, ${falhas.length} com erro` : ""}`,
    corpo: linhas.join("\n")
  };
}
async function marcarExistentes(dataRef) {
  const { cobrancas } = await montarFila("", dataRef);
  const linhas = cobrancas.flatMap(
    (c) => c.registros.map((r) => ({ ...r, situacao: "dispensada", destinatarios: c.para, assunto: c.assunto, canal: "carga" }))
  );
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from("cobrancas").upsert(linhas.slice(i, i + 500), { onConflict: "tipo,referencia", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { marcadas: cobrancas.length };
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return resposta(405, { erro: "Use POST" });
  const chave = Deno.env.get("CHAVE_N8N");
  if (!chave || req.headers.get("x-chave-n8n") !== chave) return resposta(401, { erro: "Chave inv\xE1lida" });
  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: "Pedido inv\xE1lido" });
  }
  const dataRef = typeof corpo.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corpo.data) ? corpo.data : hojeSaoPaulo();
  try {
    if (corpo.acao === "fila") return resposta(200, await fila(dataRef));
    if (corpo.acao === "registrar") {
      const situacao = corpo.situacao === "erro" ? "erro" : "enviada";
      await registrar(corpo.item, situacao, typeof corpo.erro === "string" ? corpo.erro : void 0);
      return resposta(200, { ok: true });
    }
    if (corpo.acao === "resumo") return resposta(200, await resumo(dataRef));
    if (corpo.acao === "marcar_existentes") {
      if (corpo.confirmar !== "sim") return resposta(400, { erro: 'Envie "confirmar": "sim"' });
      return resposta(200, await marcarExistentes(dataRef));
    }
    return resposta(400, { erro: "A\xE7\xE3o desconhecida" });
  } catch (e) {
    return resposta(500, { erro: e.message ?? String(e) });
  }
});
