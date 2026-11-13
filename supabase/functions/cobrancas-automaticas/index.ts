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

// site/src/lib/regras.ts
var REGRAS_PADRAO = { diaLembrete: 20, diaPrazo: 25, diasTolerancia: 5, primeiroAviso: 30, segundoAviso: 15, diasParado: 3 };
var CHAVES = {
  diaLembrete: "medicao_dia_lembrete",
  diaPrazo: "prazo_medicao_dia",
  diasTolerancia: "medicao_dias_tolerancia",
  primeiroAviso: "dias_a_vencer",
  segundoAviso: "vencimento_segundo_aviso_dias",
  diasParado: "integracao_dias_parado"
};
var atuais = REGRAS_PADRAO;
async function lerRegras() {
  const { data: data2, error } = await supabase.from("parametros").select("chave, valor").in("chave", Object.values(CHAVES));
  if (error) throw error;
  const valor = new Map((data2 ?? []).map((p) => [p.chave, Number(p.valor)]));
  const r = { ...REGRAS_PADRAO };
  Object.keys(CHAVES).forEach((k) => {
    const v = valor.get(CHAVES[k]);
    if (v !== void 0 && Number.isFinite(v)) r[k] = v;
  });
  atuais = r;
  return r;
}
function somarMeses(competencia, n) {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}
function ultimoDia(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}
var doisDigitos = (n) => String(n).padStart(2, "0");
function prazoDe(competencia, r = atuais) {
  return `${somarMeses(competencia, 1).slice(0, 8)}${doisDigitos(r.diaPrazo)}`;
}
function toleranciaDe(competencia, r = atuais) {
  const mes = somarMeses(competencia, 1);
  return `${mes.slice(0, 8)}${doisDigitos(Math.min(r.diaPrazo + r.diasTolerancia, ultimoDia(mes)))}`;
}

// site/src/lib/modelosEmail.ts
var CAMPOS_MODELO = "tipo, nome, quando, para, campos, assunto, corpo, ativo, ordem, revisao, observacao, atualizado_por, atualizado_em";
async function lerModelos() {
  const { data: data2, error } = await supabase.from("modelos_email").select(CAMPOS_MODELO).order("ordem");
  if (error) throw error;
  return data2 ?? [];
}
function aplicarModelo(m, valores) {
  const trocar = (t) => t.replace(/\{[a-z_]+\}/g, (c) => c in valores ? valores[c] : c);
  return {
    assunto: trocar(m.assunto).replace(/\s+/g, " ").trim(),
    corpo: trocar(m.corpo).split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim()
  };
}

// site/src/lib/cobrancas.ts
var INICIO_PORTAL = "2026-09-01";
var MAX_LINHAS = 15;
function somarMeses2(competencia, n) {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}
var mesAtual = (hoje) => `${hoje.slice(0, 7)}-01`;
var diaDoMes = (hoje) => Number(hoje.slice(8, 10));
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
var diaNoMes = (mes, dia) => `${mes.slice(0, 8)}${String(dia).padStart(2, "0")}`;
function competenciaDoLembrete(r, hoje = hojeIso()) {
  const d = diaDoMes(hoje);
  return d >= r.diaLembrete && d <= r.diaPrazo ? somarMeses2(mesAtual(hoje), -1) : null;
}
function competenciaDaNotificacao(r, hoje = hojeIso()) {
  const c = somarMeses2(mesAtual(hoje), -1);
  return diaDoMes(hoje) > r.diaPrazo && hoje <= toleranciaDe(c, r) ? c : null;
}
function competenciaDaRetencao(r, hoje = hojeIso()) {
  const c = somarMeses2(mesAtual(hoje), -1);
  return hoje > toleranciaDe(c, r) ? c : somarMeses2(c, -1);
}
function proximaData(r, hoje = hojeIso()) {
  const d = diaDoMes(hoje);
  const mes = mesAtual(hoje);
  const tol = toleranciaDe(somarMeses2(mes, -1), r);
  if (d < r.diaLembrete) return diaNoMes(mes, r.diaLembrete);
  if (d <= r.diaPrazo) return diaNoMes(mes, r.diaPrazo + 1);
  if (hoje <= tol) return somarDiasIso(tol, 1);
  return diaNoMes(somarMeses2(mes, 1), r.diaLembrete);
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
function assinaturaTexto(nome, a) {
  return [...nome ? [nome] : [], `${a.setor} | Grupo Emais`, ...a.contato ? [a.contato] : []].join("\n");
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
async function lerBase(competencias, regras) {
  const [medicoes, tipos, alocacoes, pendencias, empresas, obras, feitas, criadas, devolvidos, parametros2, modelos] = await Promise.all([
    lerTodasMedicoes(),
    lerTiposMedicao(),
    lerAlocacoes(),
    lerTudo2(
      (i, f) => supabase.from("v_pendencias").select(CAMPOS_PEND).in("situacao", ["a_vencer", "vencido", "nao_enviado", "devolvido"]).eq("impeditivo", true).order("alocacao_id").order("tipo_codigo").range(i, f)
    ),
    lerTudo2((i, f) => supabase.from("empresas").select("id, razao_social, email_contato, email_acesso").order("id").range(i, f)),
    lerTudo2((i, f) => supabase.from("obras").select("id, nome, emails_engenharia, situacao").order("id").range(i, f)),
    lerTudo2(
      (i, f) => supabase.from("cobrancas").select("tipo, referencia").order("id").range(i, f)
    ),
    lerTudo2(
      (i, f) => supabase.from("alocacoes").select("id, criado_em").in("status", ["em_cadastro", "pendente_fornecedor"]).order("id").range(i, f)
    ),
    lerTudo2(
      (i, f) => supabase.from("documentos").select("empresa_id, colaborador_id, tipo_codigo, analisado_em").eq("status", "devolvido").order("id").range(i, f)
    ),
    supabase.from("parametros").select("chave, valor").in("chave", ["cobranca_setor", "cobranca_contato"]),
    lerModelos()
  ]);
  const encerradas = new Set(obras.filter((o) => o.situacao === "encerrada").map((o) => o.id));
  const medicoesValidas = medicoes.filter((m) => !(m.obra_id && encerradas.has(m.obra_id)));
  const alocacoesValidas = alocacoes.filter((a) => !encerradas.has(a.obra_id));
  const ids = medicoesValidas.filter((m) => competencias.includes(m.competencia) && m.status !== "aprovada").map((m) => m.id);
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
    medicoes: medicoesValidas,
    itens,
    tipos,
    alocacoes: alocacoesValidas,
    criacao: new Map(criadas.map((a) => [a.id, a.criado_em])),
    devolucoes,
    pendencias,
    empresas,
    obras,
    feitas: new Set(feitas.map((c) => `${c.tipo}|${c.referencia}`)),
    assinatura: { setor: param.get("cobranca_setor") ?? "Gente e Gest\xE3o", contato: param.get("cobranca_contato") ?? "" },
    regras,
    modelos: new Map(modelos.map((m) => [m.tipo, m]))
  };
}
function modeloAtivo(base, tipo) {
  const m = base.modelos.get(tipo);
  return m && m.ativo ? m : null;
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
var pendenteDoFornecedor = (x) => !x.medicao || x.medicao.status === "aberta" || x.medicao.status === "pendente_fornecedor";
function camposMedicao(competencia, r) {
  const mes = mesBarra(competencia);
  const prazo = prazoDe(competencia, r);
  const tol = toleranciaDe(competencia, r);
  return {
    "{mes}": mes,
    "{mes_nome}": mes.split("/")[0],
    "{prazo}": data(prazo),
    "{prazo_curto}": curta(prazo),
    "{tolerancia}": data(tol),
    "{tolerancia_curta}": curta(tol),
    "{link_medicao}": LINK_MEDICAO()
  };
}
function lembretes(base, competencia, nome) {
  const modelo = modeloAtivo(base, "lembrete_medicao");
  if (!modelo) return [];
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const comuns = camposMedicao(competencia, base.regras);
  const lista = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`lembrete_medicao|${referencia}`)) return;
    const texto = aplicarModelo(modelo, {
      ...comuns,
      "{empresa}": nomeLegivel(l[0].empresa, true),
      "{situacao_obras}": limitar(l.map((x) => `- ${nomeObra(x)}: ${situacaoParaLembrete(x)}`), "obras").join("\n"),
      "{assinatura}": assinaturaTexto(nome, base.assinatura)
    });
    lista.push({
      chave: `lembrete|${referencia}`,
      tipo: "lembrete_medicao",
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? "obra" : "obras"} sem envio`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      ...texto,
      registros: [{ tipo: "lembrete_medicao", referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao.id),
      obraId: null
    });
  });
  return lista;
}
function notificacoes(base, competencia, nome, hoje) {
  const modelo = modeloAtivo(base, "notificacao_medicao");
  if (!modelo) return [];
  const tol = toleranciaDe(competencia, base.regras);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const comuns = { ...camposMedicao(competencia, base.regras), "{responder_ate}": curta(proximoDiaUtil(hoje)) };
  const lista = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`notificacao_medicao|${referencia}`)) return;
    const texto = aplicarModelo(modelo, {
      ...comuns,
      "{empresa}": nomeLegivel(l[0].empresa, true),
      "{o_que_falta}": oQueFalta(base, l).join("\n"),
      "{assinatura}": assinaturaTexto(nome, base.assinatura)
    });
    lista.push({
      chave: `notificacao|${referencia}`,
      tipo: "notificacao_medicao",
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? "obra" : "obras"} em atraso, toler\xE2ncia at\xE9 ${curta(tol)}`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      ...texto,
      registros: [{ tipo: "notificacao_medicao", referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao.id),
      obraId: null
    });
  });
  return lista;
}
var combinadaAte = (x, hoje) => x.medicao?.prazo_combinado && x.medicao.prazo_combinado >= hoje ? x.medicao.prazo_combinado : null;
function retencoesFornecedor(base, competencia, nome, hoje) {
  const modelo = modeloAtivo(base, "cobranca_medicao");
  if (!modelo) return [];
  const mes = mesBarra(competencia);
  const tol = toleranciaDe(competencia, base.regras);
  const notificacao = somarDiasIso(prazoDe(competencia, base.regras), 1);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const comuns = camposMedicao(competencia, base.regras);
  const retidas = esperadas(base, competencia).filter((x) => pendenteDoFornecedor(x) && !combinadaAte(x, hoje));
  const lista = [];
  porEmpresa(retidas).forEach((l, empresaId) => {
    const combinada = l.map((x) => x.medicao?.prazo_combinado).filter((d) => !!d && d > tol).sort().pop();
    const referencia = combinada ? `${competencia}:${empresaId}:combinado:${combinada}` : `${competencia}:${empresaId}`;
    if (base.feitas.has(`cobranca_medicao|${referencia}`)) return;
    const texto = aplicarModelo(modelo, {
      ...comuns,
      "{empresa}": nomeLegivel(l[0].empresa, true),
      "{historico_atraso}": combinada ? `A medi\xE7\xE3o de ${mes} estava em atraso e combinamos o envio no portal at\xE9 ${data(combinada)}.` : `No dia ${data(notificacao)} avisamos que a medi\xE7\xE3o de ${mes} estava em atraso, com prazo at\xE9 ${data(tol)} para regulariza\xE7\xE3o no portal.`,
      "{o_que_falta}": oQueFalta(base, l).join("\n"),
      "{assinatura}": assinaturaTexto(nome, base.assinatura)
    });
    lista.push({
      chave: `retencao-fornecedor|${referencia}`,
      tipo: "cobranca_medicao",
      urgente: true,
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? "obra" : "obras"} com pagamento retido`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      ...texto,
      registros: [{ tipo: "cobranca_medicao", referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao.id),
      obraId: null
    });
  });
  return lista;
}
function retencoesObra(base, competencia, nome, hoje) {
  const modelo = modeloAtivo(base, "retencao_obra");
  if (!modelo) return [];
  const tol = toleranciaDe(competencia, base.regras);
  const comuns = camposMedicao(competencia, base.regras);
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
    const aprovadas = l.filter((x) => x.medicao?.status === "aprovada");
    const ordem = (a, b) => a.empresa.localeCompare(b.empresa, "pt-BR");
    const motivo = (x) => !x.medicao || itensPendentes(base, x.medicao.id) >= 12 ? "medi\xE7\xE3o n\xE3o enviada" : x.medicao.status === "em_analise" ? "em confer\xEAncia na Emais" : "documentos pendentes";
    const texto = aplicarModelo(modelo, {
      ...comuns,
      "{obra}": nomeLegivel(nomeDaObra),
      "{prazo_regularizacao}": `${curta(tol)}${vencidaCombinada ? " ou at\xE9 a data combinada" : ""}`,
      "{qtd_empresas}": `${reter.length} ${reter.length === 1 ? "empresa" : "empresas"}`,
      "{empresas_reter}": limitar(reter.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: ${motivo(x)}`), "empresas").join("\n"),
      "{empresas_liberadas}": aprovadas.length ? ["Liberadas para pagamento:", ...limitar(aprovadas.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}`), "empresas")].join("\n") : "",
      "{empresas_aguardando}": aguardando.length ? [
        "Aguardando data combinada com o fornecedor (ainda n\xE3o reter):",
        ...aguardando.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: envio combinado at\xE9 ${curta(combinadaAte(x, hoje))}`)
      ].join("\n") : "",
      "{assinatura}": assinaturaTexto(nome, base.assinatura)
    });
    lista.push({
      chave: `retencao-obra|${referencia}`,
      tipo: "retencao_obra",
      urgente: true,
      titulo: nomeDaObra,
      resumo: `${reter.length} ${reter.length === 1 ? "empresa a reter" : "empresas a reter"}${aguardando.length ? `, ${aguardando.length} com data combinada` : ""}`,
      para: obraPor.get(obraId)?.emails_engenharia ?? "",
      ...texto,
      registros: [{ tipo: "retencao_obra", referencia, empresa_id: null, obra_id: obraId, competencia }],
      medicoes: [],
      obraId
    });
  });
  return lista;
}
var MODELO_DA_FAIXA = { vencido: "vencimento_vencido", "15": "vencimento_segundo", "30": "vencimento_primeiro" };
function vencimentos(base, nome) {
  const r = base.regras;
  const liberadas = new Map(base.alocacoes.filter((a) => a.status === "liberado").map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const docs = /* @__PURE__ */ new Map();
  base.pendencias.forEach((p) => {
    const a = liberadas.get(p.alocacao_id);
    if (!a || !p.vencimento || p.dias_para_vencer === null || p.dias_para_vencer > r.primeiroAviso) return;
    if (p.situacao !== "a_vencer" && p.situacao !== "vencido") return;
    if (p.status_envio_aberto === "em_analise") return;
    const faixa = p.dias_para_vencer <= 0 ? "vencido" : p.dias_para_vencer <= r.segundoAviso ? "15" : "30";
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
    const vencidos = l.filter((d) => d.faixa === "vencido");
    const em15 = l.filter((d) => d.faixa === "15");
    const em30 = l.filter((d) => d.faixa === "30");
    const faixa = vencidos.length ? "vencido" : em15.length ? "15" : "30";
    const modelo = modeloAtivo(base, MODELO_DA_FAIXA[faixa]);
    if (!modelo) return;
    const secoes = [
      ...vencidos.length ? ["", "J\xE1 vencidos:", ...linhas(vencidos)] : [],
      ...em15.length ? ["", `Vencem em at\xE9 ${r.segundoAviso} dias:`, ...linhas(em15)] : [],
      ...em30.length ? ["", `Vencem em at\xE9 ${r.primeiroAviso} dias:`, ...linhas(em30)] : []
    ];
    const texto = aplicarModelo(modelo, {
      "{empresa}": nomeLegivel(e?.razao_social ?? "", true),
      "{dias}": String(faixa === "15" ? r.segundoAviso : r.primeiroAviso),
      "{documentos}": limitarItens(secoes, "documentos").join("\n").trim(),
      "{link_pendencias}": LINK_PENDENCIAS(),
      "{assinatura}": assinaturaTexto(nome, base.assinatura)
    });
    lista.push({
      chave: `documentos|${empresaId}|${l.map((d) => d.chave).sort().join(",")}`,
      tipo: "vencimento_documento",
      urgente: vencidos.length > 0,
      titulo: e?.razao_social ?? "",
      resumo: [
        vencidos.length ? `${vencidos.length} ${vencidos.length === 1 ? "vencido" : "vencidos"}` : "",
        em15.length ? `${em15.length} em ${r.segundoAviso} dias` : "",
        em30.length ? `${em30.length} em ${r.primeiroAviso} dias` : ""
      ].filter(Boolean).join(", "),
      para: emailDaEmpresa(e),
      ...texto,
      registros: l.map((d) => ({ tipo: "vencimento_documento", referencia: d.chave, empresa_id: empresaId, obra_id: null, competencia: null })),
      medicoes: [],
      obraId: null
    });
  });
  return lista;
}
function integracao(base, nome, hoje) {
  const modelo = modeloAtivo(base, "integracao_documentos");
  if (!modelo) return [];
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
      if (!criada || diasUteisDesde(criada, hoje) < base.regras.diasParado) return;
    }
    if (p.situacao === "devolvido") {
      const em = base.devolucoes.get(`${p.empresa_id}|${p.grupo === "empresa" ? "" : p.colaborador_id}|${p.tipo_codigo}`);
      if (em && diasUteisDesde(em, hoje) < base.regras.diasParado) return;
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
    const obras = [...new Set(l.map((x) => x.obra))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const linhas = obras.flatMap((o) => [
      `Obra ${nomeLegivel(o)}`,
      ...l.filter((x) => x.obra === o).sort((a, b) => a.colaborador.localeCompare(b.colaborador, "pt-BR")).map((x) => `- ${x.colaborador}: ${x.docs.join(", ")}`)
    ]);
    const texto = aplicarModelo(modelo, {
      "{empresa}": nomeLegivel(e?.razao_social ?? "", true),
      "{colaboradores}": limitarItens(linhas, "colaboradores").join("\n"),
      "{link_pendencias}": LINK_PENDENCIAS(),
      "{assinatura}": assinaturaTexto(nome, base.assinatura)
    });
    lista.push({
      chave: `integracao|${referencia}`,
      tipo: "integracao_documentos",
      titulo: e?.razao_social ?? "",
      resumo: `${l.length} ${l.length === 1 ? "colaborador" : "colaboradores"} sem libera\xE7\xE3o`,
      para: emailDaEmpresa(e),
      ...texto,
      registros: [{ tipo: "integracao_documentos", referencia, empresa_id: empresaId, obra_id: null, competencia: null }],
      medicoes: [],
      obraId: null
    });
  });
  return lista;
}
async function montarFila(nome, hoje = hojeIso()) {
  const regras = await lerRegras();
  const lembrete = competenciaDoLembrete(regras, hoje);
  const notificacao = competenciaDaNotificacao(regras, hoje);
  const retencao = competenciaDaRetencao(regras, hoje);
  const doPortal = (c) => !!c && c >= INICIO_PORTAL;
  const base = await lerBase([lembrete, notificacao, retencao].filter(doPortal), regras);
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
    proxima: proximaData(regras, hoje),
    assinatura: base.assinatura,
    regras
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
async function liberacoes() {
  const cfg = await parametros();
  const base = { pausada: cfg.pausada, modo_teste: !!cfg.testePara, teste_para: cfg.testePara || null };
  if (cfg.pausada) return { ...base, itens: [] };
  const avisos = await avisosDeLiberacao(cfg);
  const convites = await convitesDeAcesso(cfg);
  const ajuda = await avisosDeAjuda(cfg);
  return { ...base, itens: [...avisos, ...convites, ...ajuda] };
}
async function avisosDeLiberacao(cfg) {
  const limite = new Date(Date.now() - 30 * 6e4).toISOString();
  const { data: data2, error } = await supabase.from("avisos_liberacao").select("id, obra_id, alocacoes, destinatarios, assunto, corpo").or(`situacao_envio.eq.aguardando,and(situacao_envio.eq.enviando,envio_iniciado_em.lt."${limite}")`).order("envio_pedido_em").limit(25);
  if (error) throw error;
  const avisos = data2 ?? [];
  if (!avisos.length) return [];
  const ids = avisos.map((a) => a.id);
  const { error: e1 } = await supabase.from("avisos_liberacao").update({ situacao_envio: "enviando", envio_iniciado_em: (/* @__PURE__ */ new Date()).toISOString() }).in("id", ids);
  if (e1) throw e1;
  const obras = [...new Set(avisos.map((a) => a.obra_id))];
  const { data: os, error: e2 } = await supabase.from("obras").select("id, nome").in("id", obras);
  if (e2) throw e2;
  const nomeObra2 = new Map((os ?? []).map((o) => [o.id, o.nome]));
  const alocs = [...new Set(avisos.flatMap((a) => a.alocacoes))];
  const { data: al, error: e3 } = await supabase.from("v_alocacoes_resumo").select("alocacao_id, empresa_id").in("alocacao_id", alocs);
  if (e3) throw e3;
  const empresaDa = new Map((al ?? []).map((x) => [x.alocacao_id, x.empresa_id]));
  const teste = !!cfg.testePara;
  const itens = avisos.map((a) => {
    const original = (a.destinatarios ?? "").trim();
    return {
      tipo: "aviso_liberacao",
      id: a.id,
      obra_id: a.obra_id,
      titulo: nomeObra2.get(a.obra_id) ?? "",
      para: teste ? cfg.testePara : original,
      para_original: original,
      assunto: teste ? `[TESTE \xB7 para ${original}] ${a.assunto}` : a.assunto,
      corpo: a.corpo,
      empresa_ids: [...new Set(a.alocacoes.map((x) => empresaDa.get(x)).filter((x) => !!x))],
      teste
    };
  });
  return itens;
}
var PORTAL = "https://emais-projetos.github.io/portal-terceiros/";
async function resumoHash(texto) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function codigoAleatorio() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function motivoDoPerfil(perfil, empresas) {
  if (perfil === "fornecedor")
    return `\xC9 por ele que ${empresas.length === 1 ? `a ${nomeLegivel(empresas[0], true)}` : "as suas empresas"} vai cadastrar os colaboradores e enviar a documenta\xE7\xE3o para as obras da Emais.`;
  if (perfil === "tst") return "\xC9 por ele que voc\xEA vai consultar os colaboradores das suas obras e dar a valida\xE7\xE3o final da seguran\xE7a do trabalho.";
  if (perfil === "engenharia")
    return "\xC9 por ele que voc\xEA vai acompanhar, nas suas obras, a integra\xE7\xE3o dos terceiros, a situa\xE7\xE3o dos documentos e a medi\xE7\xE3o de cada empresa, com quem est\xE1 liberado para pagamento.";
  return "\xC9 por ele que voc\xEA vai conferir a documenta\xE7\xE3o dos terceiros e liberar os colaboradores para as obras.";
}
var LINK_OCULTO = `${PORTAL}acesso?c=[c\xF3digo do convite]`;
async function convitesDeAcesso(cfg) {
  const limite = new Date(Date.now() - 30 * 6e4).toISOString();
  const { data: data2, error } = await supabase.from("convites_acesso").select("id, usuario_id, tipo, pedido_por").or(`situacao_envio.eq.aguardando,and(situacao_envio.eq.enviando,envio_iniciado_em.lt."${limite}")`).order("pedido_em").limit(25);
  if (error) throw error;
  const convites = data2 ?? [];
  if (!convites.length) return [];
  const ids = [...new Set(convites.flatMap((c) => [c.usuario_id, c.pedido_por]).filter((x) => !!x))];
  const [{ data: us, error: e1 }, { data: ue, error: e2 }, { data: ms, error: e3 }, { data: ps, error: e4 }] = await Promise.all([
    supabase.from("usuarios").select("id, nome, email, perfil, ativo").in("id", ids),
    supabase.from("usuarios_empresas").select("usuario_id, empresa_id, empresas(razao_social)").in("usuario_id", convites.map((c) => c.usuario_id)),
    supabase.from("modelos_email").select("tipo, assunto, corpo, ativo").in("tipo", ["convite_acesso", "nova_senha_acesso"]),
    supabase.from("parametros").select("chave, valor").in("chave", ["convite_validade_dias", "cobranca_setor", "cobranca_contato"])
  ]);
  if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;
  const usuario = new Map((us ?? []).map((u) => [u.id, u]));
  const modelo = new Map((ms ?? []).map((m) => [m.tipo, m]));
  const param = new Map((ps ?? []).map((x) => [x.chave, (x.valor ?? "").trim()]));
  const dias = Math.max(1, Number(param.get("convite_validade_dias")) || 7);
  const empresasDe = /* @__PURE__ */ new Map();
  (ue ?? []).forEach((x) => {
    const atual = empresasDe.get(x.usuario_id) ?? { ids: [], nomes: [] };
    atual.ids.push(x.empresa_id);
    const nome = x.empresas?.razao_social;
    if (nome) atual.nomes.push(nome);
    empresasDe.set(x.usuario_id, atual);
  });
  const teste = !!cfg.testePara;
  const itens = [];
  for (const c of convites) {
    const u = usuario.get(c.usuario_id);
    const m = modelo.get(c.tipo === "primeiro_acesso" ? "convite_acesso" : "nova_senha_acesso");
    if (!u || !u.ativo || !m?.ativo) {
      const motivo = !u || !u.ativo ? "Acesso desativado" : "Envio autom\xE1tico deste e-mail desligado em Acessos > E-mails";
      await supabase.from("convites_acesso").update({ situacao_envio: "erro", envio_erro: motivo }).eq("id", c.id);
      continue;
    }
    const codigo = codigoAleatorio();
    const expira = new Date(Date.now() + dias * 864e5).toISOString();
    const { error: e5 } = await supabase.from("convites_acesso").update({ situacao_envio: "enviando", envio_iniciado_em: (/* @__PURE__ */ new Date()).toISOString(), token_hash: await resumoHash(codigo), expira_em: expira, para: u.email }).eq("id", c.id);
    if (e5) throw e5;
    const quem = c.pedido_por ? usuario.get(c.pedido_por)?.nome : void 0;
    const assinatura = [quem?.trim(), `${param.get("cobranca_setor") || "Gente e Gest\xE3o"} | Grupo Emais`, param.get("cobranca_contato")].filter(Boolean).join("\n");
    const nome = u.nome.trim();
    const saudacao = u.perfil === "fornecedor" ? nomeLegivel(nome.replace(/^[\d.\/\s-]+/, ""), true) : nomeLegivel(nome.split(/\s+/).find((p) => /[A-Za-zÀ-ÿ]{2}/.test(p)) ?? nome);
    const valores = {
      "{nome}": nome,
      "{primeiro_nome}": saudacao,
      "{motivo}": motivoDoPerfil(u.perfil, empresasDe.get(u.id)?.nomes ?? []),
      "{link}": `${PORTAL}acesso?c=${codigo}`,
      "{validade}": dias === 1 ? "1 dia" : `${dias} dias`,
      "{email}": u.email,
      "{endereco_portal}": PORTAL,
      "{assinatura}": assinatura
    };
    const trocar = (t) => t.replace(/\{[a-z_]+\}/g, (x) => x in valores ? valores[x] : x);
    let corpo = trocar(m.corpo).split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!corpo.includes(valores["{link}"])) corpo += `

${valores["{link}"]}`;
    const assunto = trocar(m.assunto).replace(/\s+/g, " ").trim();
    const original = u.email;
    itens.push({
      tipo: "convite_acesso",
      id: c.id,
      obra_id: "",
      titulo: nome,
      para: teste ? cfg.testePara : original,
      para_original: original,
      assunto: teste ? `[TESTE \xB7 para ${original}] ${assunto}` : assunto,
      corpo,
      empresa_ids: empresasDe.get(u.id)?.ids ?? [],
      teste
    });
  }
  return itens;
}
var NOME_PERFIL = { fornecedor: "Fornecedor", tst: "TST da obra", engenharia: "Engenharia da obra", admin: "Administrativo" };
function horaSaoPaulo(iso) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", "");
}
async function avisosDeAjuda(cfg) {
  const { data: ps, error: e0 } = await supabase.from("parametros").select("chave, valor").in("chave", ["ajuda_email_emais", "ajuda_minutos_aviso", "cobranca_setor", "cobranca_contato"]);
  if (e0) throw e0;
  const param = new Map((ps ?? []).map((x) => [x.chave, (x.valor ?? "").trim()]));
  const minutos = Math.max(5, Number(param.get("ajuda_minutos_aviso")) || 10);
  const limite = new Date(Date.now() - minutos * 6e4).toISOString();
  const { data: ms, error } = await supabase.from("mensagens").select("id, conversa_id, autor_id, da_emais, texto, criado_em, conversas(usuario_id, lida_emais_em, lida_usuario_em)").is("aviso_enviado_em", null).lt("criado_em", limite).order("criado_em").limit(500);
  if (error) throw error;
  const lista = ms ?? [];
  if (!lista.length) return [];
  const { error: e1 } = await supabase.from("mensagens").update({ aviso_enviado_em: (/* @__PURE__ */ new Date()).toISOString() }).in("id", lista.map((m) => m.id));
  if (e1) throw e1;
  const naoLidas = lista.filter((m) => {
    const lida = m.da_emais ? m.conversas?.lida_usuario_em : m.conversas?.lida_emais_em;
    return !lida || lida < m.criado_em;
  });
  if (!naoLidas.length) return [];
  const grupos = /* @__PURE__ */ new Map();
  naoLidas.forEach((m) => {
    const k = `${m.conversa_id}|${m.da_emais ? "emais" : "usuario"}`;
    grupos.set(k, [...grupos.get(k) ?? [], m]);
  });
  const ids = [...new Set(naoLidas.flatMap((m) => [m.conversas?.usuario_id, m.autor_id]).filter((x) => !!x))];
  const [{ data: us, error: e2 }, { data: ue, error: e3 }, { data: to, error: e4 }, { data: mods, error: e5 }] = await Promise.all([
    supabase.from("usuarios").select("id, nome, email, perfil, ativo").in("id", ids),
    supabase.from("usuarios_empresas").select("usuario_id, empresa_id, empresas(razao_social)").in("usuario_id", ids),
    supabase.from("tst_obras").select("usuario_id, obras(nome)").in("usuario_id", ids),
    supabase.from("modelos_email").select("tipo, assunto, corpo, ativo").in("tipo", ["ajuda_para_emais", "ajuda_resposta"])
  ]);
  if (e2 || e3 || e4 || e5) throw e2 ?? e3 ?? e4 ?? e5;
  const usuario = new Map((us ?? []).map((u) => [u.id, u]));
  const modelo = new Map((mods ?? []).map((m) => [m.tipo, m]));
  const empresasDe = /* @__PURE__ */ new Map();
  (ue ?? []).forEach((x) => {
    const a = empresasDe.get(x.usuario_id) ?? { ids: [], nomes: [] };
    a.ids.push(x.empresa_id);
    const n = x.empresas?.razao_social;
    if (n) a.nomes.push(nomeLegivel(n, true));
    empresasDe.set(x.usuario_id, a);
  });
  const obrasDe = /* @__PURE__ */ new Map();
  (to ?? []).forEach((x) => {
    const n = x.obras?.nome;
    if (n) obrasDe.set(x.usuario_id, [...obrasDe.get(x.usuario_id) ?? [], nomeLegivel(n)]);
  });
  const teste = !!cfg.testePara;
  const itens = [];
  for (const [k, msgs] of grupos) {
    const [conversaId, lado] = k.split("|");
    const u = usuario.get(msgs[0].conversas?.usuario_id ?? "");
    if (!u) continue;
    const paraEmais = lado === "usuario";
    const m = modelo.get(paraEmais ? "ajuda_para_emais" : "ajuda_resposta");
    if (!m?.ativo) continue;
    const destino = paraEmais ? param.get("ajuda_email_emais") ?? "" : u.email;
    if (!destino.includes("@") || !paraEmais && !u.ativo) continue;
    const empresas = empresasDe.get(u.id)?.nomes ?? [];
    const obras = obrasDe.get(u.id) ?? [];
    const deOnde = [NOME_PERFIL[u.perfil] ?? u.perfil, empresas.length > 2 ? `${empresas.length} empresas` : empresas.join(", "), obras.join(", ")].filter(Boolean).join(", ");
    const autorEmais = !paraEmais ? usuario.get(msgs[msgs.length - 1].autor_id ?? "")?.nome : void 0;
    const valores = {
      "{nome}": nomeLegivel(u.nome),
      "{primeiro_nome}": nomeLegivel(u.nome.trim().split(/\s+/).find((p) => /[A-Za-zÀ-ÿ]{2}/.test(p)) ?? u.nome),
      "{de_onde}": deOnde,
      "{mensagens}": msgs.map((x) => `${horaSaoPaulo(x.criado_em)}: ${x.texto}`).join("\n\n"),
      "{link}": paraEmais ? `${PORTAL}atendimento?c=${conversaId}` : PORTAL,
      "{assinatura}": [autorEmais?.trim(), `${param.get("cobranca_setor") || "Gente e Gest\xE3o"} | Grupo Emais`, param.get("cobranca_contato")].filter(Boolean).join("\n")
    };
    const trocar = (t) => t.replace(/\{[a-z_]+\}/g, (x) => x in valores ? valores[x] : x);
    const corpo = trocar(m.corpo).split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const assunto = trocar(m.assunto).replace(/\s+/g, " ").trim();
    itens.push({
      tipo: "ajuda",
      id: `${conversaId}|${lado}|${msgs[msgs.length - 1].id}`,
      obra_id: "",
      titulo: `Ajuda: ${u.nome}`,
      para: teste ? cfg.testePara : destino,
      para_original: destino,
      assunto: teste ? `[TESTE \xB7 para ${destino}] ${assunto}` : assunto,
      corpo,
      empresa_ids: empresasDe.get(u.id)?.ids ?? [],
      teste
    });
  }
  return itens;
}
async function registrarAjuda(item, situacao, erro) {
  const { error } = await supabase.from("cobrancas_envios").insert({
    chave: `ajuda|${item.id}`,
    tipo: "ajuda",
    titulo: item.titulo,
    empresa_ids: item.empresa_ids,
    obra_id: null,
    para: item.para,
    para_original: item.para_original,
    assunto: item.assunto,
    corpo: item.corpo,
    situacao,
    erro: situacao === "erro" ? erro ?? "Erro no envio" : null,
    teste: item.teste
  });
  if (error) throw error;
}
async function registrarConvite(item, situacao, erro) {
  const agora = (/* @__PURE__ */ new Date()).toISOString();
  const { error } = await supabase.from("cobrancas_envios").insert({
    chave: `convite|${item.id}`,
    tipo: "convite_acesso",
    titulo: item.titulo,
    empresa_ids: item.empresa_ids,
    obra_id: null,
    para: item.para,
    para_original: item.para_original,
    assunto: item.assunto,
    corpo: item.corpo.replace(/https:\/\/\S+\/acesso\?c=[A-Za-z0-9_-]+/g, LINK_OCULTO),
    situacao,
    erro: situacao === "erro" ? erro ?? "Erro no envio" : null,
    teste: item.teste
  });
  if (error) throw error;
  const mudanca = situacao === "enviada" ? { situacao_envio: "enviado", enviado_em: agora, envio_erro: null, envio_teste: item.teste, envio_para: item.para } : { situacao_envio: "erro", envio_erro: erro ?? "Erro no envio", token_hash: null };
  const { error: e2 } = await supabase.from("convites_acesso").update(mudanca).eq("id", item.id).eq("situacao_envio", "enviando");
  if (e2) throw e2;
}
async function registrarLiberacao(item, situacao, erro) {
  if (item.tipo === "convite_acesso") return registrarConvite(item, situacao, erro);
  if (item.tipo === "ajuda") return registrarAjuda(item, situacao, erro);
  const agora = (/* @__PURE__ */ new Date()).toISOString();
  const { error } = await supabase.from("cobrancas_envios").insert({
    chave: `liberacao|${item.id}`,
    tipo: "aviso_liberacao",
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
  const mudanca = situacao === "enviada" ? { situacao_envio: "enviado", enviado_em: agora, envio_erro: null, envio_teste: item.teste, envio_para: item.para } : { situacao_envio: "erro", envio_erro: erro ?? "Erro no envio" };
  const { error: e2 } = await supabase.from("avisos_liberacao").update(mudanca).eq("id", item.id);
  if (e2) throw e2;
  if (situacao === "enviada" && !item.teste) {
    const { error: e3 } = await supabase.from("avisos_liberacao").update({ marcado_enviado_em: agora }).eq("id", item.id).is("marcado_enviado_em", null);
    if (e3) throw e3;
  }
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
    if (corpo.acao === "liberacoes") return resposta(200, await liberacoes());
    if (corpo.acao === "registrar_liberacao") {
      const situacao = corpo.situacao === "erro" ? "erro" : "enviada";
      await registrarLiberacao(corpo.item, situacao, typeof corpo.erro === "string" ? corpo.erro : void 0);
      return resposta(200, { ok: true });
    }
    if (corpo.acao === "marcar_existentes") {
      if (corpo.confirmar !== "sim") return resposta(400, { erro: 'Envie "confirmar": "sim"' });
      return resposta(200, await marcarExistentes(dataRef));
    }
    return resposta(400, { erro: "A\xE7\xE3o desconhecida" });
  } catch (e) {
    return resposta(500, { erro: e.message ?? String(e) });
  }
});
