import { supabase, enderecoDoSite } from './supabase';
import { data, hojeIso } from './formato';
import { lerAlocacoes, type AlocacaoResumo } from './admin';
import { lerTiposMedicao, lerTodasMedicoes, type Medicao, type TipoMedicao } from './medicao';
import { lerRegras, prazoDe, toleranciaDe, type Regras } from './regras';
import { aplicarModelo, lerModelos, type Modelo, type TipoModelo } from './modelosEmail';

export { prazoDe, toleranciaDe } from './regras';

// Calendário de cobrança (dias editáveis em Acessos > Regras; padrão aprovado com o administrativo):
// medição: lembrete no dia 20 (prazo dia 25); no dia seguinte ao prazo, notificação de atraso com tolerância
// de 5 dias; depois da tolerância, pagamento retido e aviso à engenharia da obra, salvo quando há data
// combinada com o fornecedor;
// documentos dos liberados: no primeiro aviso (30 dias), no segundo (15 dias) e quando vencem;
// integração: toda segunda-feira, colaboradores ainda não liberados com documento obrigatório parado há
// 3 dias úteis ou mais.
// Os textos saem dos modelos de Acessos > E-mails. No portal, cada e-mail é aberto no Outlook por uma pessoa,
// que confere e envia; no envio automático, o n8n envia. Depois de enviado, aberto ou dispensado, sai da fila.

// Antes disso a medição era controlada na planilha, que já tem as cobranças feitas.
const INICIO_PORTAL = '2026-09-01';
const MAX_LINHAS = 15;

export type TipoCobranca =
  | 'lembrete_medicao'
  | 'notificacao_medicao'
  | 'cobranca_medicao'
  | 'retencao_obra'
  | 'vencimento_documento'
  | 'integracao_documentos';

export type Registro = { tipo: TipoCobranca; referencia: string; empresa_id: string | null; obra_id: string | null; competencia: string | null };

export type Cobranca = {
  chave: string;
  tipo: TipoCobranca;
  titulo: string;
  resumo: string;
  para: string;
  assunto: string;
  corpo: string;
  registros: Registro[];
  medicoes: string[];
  obraId: string | null;
  urgente?: boolean; // pagamento retido ou documento já vencido
};

export type Assinatura = { setor: string; contato: string };

export type Fila = { cobrancas: Cobranca[]; proxima: string; assinatura: Assinatura; regras: Regras };

// ---------------------------------------------------------------- Datas

function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

const mesAtual = (hoje: string) => `${hoje.slice(0, 7)}-01`;
const diaDoMes = (hoje: string) => Number(hoje.slice(8, 10));

function diaSemana(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

function somarDiasIso(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

function proximoDiaUtil(iso: string): string {
  let d = somarDiasIso(iso, 1);
  while (diaSemana(d) === 0 || diaSemana(d) === 6) d = somarDiasIso(d, 1);
  return d;
}

function diasUteisDesde(inicio: string, hoje: string): number {
  let n = 0;
  for (let d = somarDiasIso(inicio.slice(0, 10), 1); d <= hoje; d = somarDiasIso(d, 1)) if (diaSemana(d) !== 0 && diaSemana(d) !== 6) n += 1;
  return n;
}

function segundaDaSemana(hoje: string): string {
  const dia = diaSemana(hoje);
  return somarDiasIso(hoje, dia === 0 ? -6 : 1 - dia);
}

const curta = (iso: string) => data(iso).slice(0, 5);

// '2026-09-01' -> 'setembro/2026'
export function mesBarra(competencia: string): string {
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [a, m] = competencia.split('-').map(Number);
  return `${nomes[m - 1]}/${a}`;
}

const diaNoMes = (mes: string, dia: number) => `${mes.slice(0, 8)}${String(dia).padStart(2, '0')}`;

// Lembrete: do dia do lembrete até o prazo. Notificação: do dia seguinte ao prazo até o fim da tolerância.
export function competenciaDoLembrete(r: Regras, hoje = hojeIso()): string | null {
  const d = diaDoMes(hoje);
  return d >= r.diaLembrete && d <= r.diaPrazo ? somarMeses(mesAtual(hoje), -1) : null;
}

export function competenciaDaNotificacao(r: Regras, hoje = hojeIso()): string | null {
  const c = somarMeses(mesAtual(hoje), -1);
  return diaDoMes(hoje) > r.diaPrazo && hoje <= toleranciaDe(c, r) ? c : null;
}

// Retenção: o último mês trabalhado cuja tolerância já passou.
export function competenciaDaRetencao(r: Regras, hoje = hojeIso()): string {
  const c = somarMeses(mesAtual(hoje), -1);
  return hoje > toleranciaDe(c, r) ? c : somarMeses(c, -1);
}

export function proximaData(r: Regras, hoje = hojeIso()): string {
  const d = diaDoMes(hoje);
  const mes = mesAtual(hoje);
  const tol = toleranciaDe(somarMeses(mes, -1), r);
  if (d < r.diaLembrete) return diaNoMes(mes, r.diaLembrete);
  if (d <= r.diaPrazo) return diaNoMes(mes, r.diaPrazo + 1);
  if (hoje <= tol) return somarDiasIso(tol, 1);
  return diaNoMes(somarMeses(mes, 1), r.diaLembrete);
}

// ---------------------------------------------------------------- Textos

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'a']);
const SUFIXOS = /\s*(-\s*)?\b(LTDA|ME|EPP|EIRELI|S\/?A|LIMITADA)\.?\s*$/i;

// 'A SSB CONSTRUTORA LTDA' -> 'A SSB Construtora'; 'JOSE LIMA VAZ' -> 'Jose Lima Vaz'
export function nomeLegivel(texto: string, empresa = false): string {
  let t = texto.trim();
  if (empresa) for (let i = 0; i < 2; i++) t = t.replace(SUFIXOS, '').trim();
  return t
    .split(/\s+/)
    .map((p, i) => {
      const so = p.replace(/[^A-Za-zÀ-ÿ]/g, '');
      if (!so) return p;
      if (/[.&/]/.test(p) || (so.length <= 4 && !/[AEIOUÁÉÍÓÚÂÊÔÃÕ]/i.test(so))) return p.toUpperCase();
      const baixo = p.toLowerCase();
      if (i > 0 && MINUSCULAS.has(baixo)) return baixo;
      return baixo.charAt(0).toUpperCase() + baixo.slice(1);
    })
    .join(' ');
}

export const AVISO_PORTAL = 'Importante: documentos e correções são recebidos somente pelo portal. Arquivos enviados por e-mail não são considerados na conferência.';

export function assinatura(nome: string, a: Assinatura): string[] {
  return ['', 'Atenciosamente,', ...(nome ? [nome] : []), `${a.setor} | Grupo Emais`, ...(a.contato ? [a.contato] : [])];
}

// Campo {assinatura} dos modelos: o "Atenciosamente," fica no próprio texto do modelo.
function assinaturaTexto(nome: string, a: Assinatura): string {
  return [...(nome ? [nome] : []), `${a.setor} | Grupo Emais`, ...(a.contato ? [a.contato] : [])].join('\n');
}

// Corta listas longas: o link do Outlook tem limite de tamanho.
function limitar(linhas: string[], oQue: string): string[] {
  if (linhas.length <= MAX_LINHAS) return linhas;
  return [...linhas.slice(0, MAX_LINHAS), `- e mais ${linhas.length - MAX_LINHAS} ${oQue}: veja a lista completa no portal`];
}

// Corta só as linhas de item ("- ..."), mantendo os títulos de obra ou de seção.
function limitarItens(linhas: string[], oQue: string): string[] {
  let contadas = 0;
  const saida = linhas.filter((s) => !s.startsWith('- ') || ++contadas <= MAX_LINHAS);
  return contadas > MAX_LINHAS ? [...saida, `- e mais ${contadas - MAX_LINHAS} ${oQue}: veja a lista completa no portal`] : saida;
}

// ---------------------------------------------------------------- Leitura

type Empresa = { id: string; razao_social: string; email_contato: string | null; email_acesso: string | null };
type Obra = { id: string; nome: string; emails_engenharia: string | null; situacao?: string };
type ItemMed = { medicao_id: string; tipo_codigo: string; status: string; motivo_devolucao: string | null };
type PendDoc = {
  alocacao_id: string;
  colaborador_id: string;
  empresa_id: string;
  tipo_codigo: string;
  documento: string;
  grupo: string;
  vencimento: string | null;
  dias_para_vencer: number | null;
  status_envio_aberto: string | null;
  motivo_devolucao: string | null;
  situacao: string;
};

async function lerTudo<T>(montar: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data: d, error } = await montar(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...(d ?? []));
    if (!d || d.length < 1000) break;
  }
  return todas;
}

type Base = {
  medicoes: Medicao[];
  itens: ItemMed[];
  tipos: TipoMedicao[];
  alocacoes: AlocacaoResumo[];
  criacao: Map<string, string>;
  devolucoes: Map<string, string>;
  pendencias: PendDoc[];
  empresas: Empresa[];
  obras: Obra[];
  feitas: Set<string>;
  assinatura: Assinatura;
  regras: Regras;
  modelos: Map<TipoModelo, Modelo>;
};

const CAMPOS_PEND = 'alocacao_id, colaborador_id, empresa_id, tipo_codigo, documento, grupo, vencimento, dias_para_vencer, status_envio_aberto, motivo_devolucao, situacao';

type Devolvido = { empresa_id: string; colaborador_id: string | null; tipo_codigo: string; analisado_em: string | null };

async function lerBase(competencias: string[], regras: Regras): Promise<Base> {
  const [medicoes, tipos, alocacoes, pendencias, empresas, obras, feitas, criadas, devolvidos, parametros, modelos] = await Promise.all([
    lerTodasMedicoes(),
    lerTiposMedicao(),
    lerAlocacoes(),
    lerTudo<PendDoc>((i, f) =>
      supabase
        .from('v_pendencias')
        .select(CAMPOS_PEND)
        .in('situacao', ['a_vencer', 'vencido', 'nao_enviado', 'devolvido'])
        .eq('impeditivo', true)
        .order('alocacao_id')
        .order('tipo_codigo')
        .range(i, f) as unknown as PromiseLike<{ data: PendDoc[] | null; error: unknown }>,
    ),
    lerTudo<Empresa>((i, f) => supabase.from('empresas').select('id, razao_social, email_contato, email_acesso').order('id').range(i, f) as unknown as PromiseLike<{ data: Empresa[] | null; error: unknown }>),
    lerTudo<Obra>((i, f) => supabase.from('obras').select('id, nome, emails_engenharia, situacao').order('id').range(i, f) as unknown as PromiseLike<{ data: Obra[] | null; error: unknown }>),
    lerTudo<{ tipo: string; referencia: string }>((i, f) =>
      supabase.from('cobrancas').select('tipo, referencia').order('id').range(i, f) as unknown as PromiseLike<{ data: { tipo: string; referencia: string }[] | null; error: unknown }>,
    ),
    lerTudo<{ id: string; criado_em: string }>((i, f) =>
      supabase.from('alocacoes').select('id, criado_em').in('status', ['em_cadastro', 'pendente_fornecedor']).order('id').range(i, f) as unknown as PromiseLike<{ data: { id: string; criado_em: string }[] | null; error: unknown }>,
    ),
    lerTudo<Devolvido>((i, f) =>
      supabase.from('documentos').select('empresa_id, colaborador_id, tipo_codigo, analisado_em').eq('status', 'devolvido').order('id').range(i, f) as unknown as PromiseLike<{ data: Devolvido[] | null; error: unknown }>,
    ),
    supabase.from('parametros').select('chave, valor').in('chave', ['cobranca_setor', 'cobranca_contato']),
    lerModelos(),
  ]);
  // Obra encerrada sai das cobranças (medição, retenção e documentos).
  const encerradas = new Set(obras.filter((o) => o.situacao === 'encerrada').map((o) => o.id));
  const medicoesValidas = medicoes.filter((m) => !(m.obra_id && encerradas.has(m.obra_id)));
  const alocacoesValidas = alocacoes.filter((a) => !encerradas.has(a.obra_id));
  const ids = medicoesValidas.filter((m) => competencias.includes(m.competencia) && m.status !== 'aprovada').map((m) => m.id);
  const itens: ItemMed[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: d, error } = await supabase.from('medicoes_itens').select('medicao_id, tipo_codigo, status, motivo_devolucao').in('medicao_id', ids.slice(i, i + 150));
    if (error) throw error;
    itens.push(...((d ?? []) as ItemMed[]));
  }
  if (parametros.error) throw parametros.error;
  const param = new Map((parametros.data ?? []).map((p) => [p.chave as string, p.valor as string]));
  const devolucoes = new Map<string, string>();
  devolvidos.forEach((d) => {
    const k = `${d.empresa_id}|${d.colaborador_id ?? ''}|${d.tipo_codigo}`;
    if (d.analisado_em && (!devolucoes.has(k) || devolucoes.get(k)! < d.analisado_em)) devolucoes.set(k, d.analisado_em);
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
    assinatura: { setor: param.get('cobranca_setor') ?? 'Gente e Gestão', contato: param.get('cobranca_contato') ?? '' },
    regras,
    modelos: new Map(modelos.map((m) => [m.tipo, m])),
  };
}

// Modelo em vigor do e-mail; desligado em Acessos > E-mails, a cobrança não entra na fila.
function modeloAtivo(base: Base, tipo: TipoModelo): Modelo | null {
  const m = base.modelos.get(tipo);
  return m && m.ativo ? m : null;
}

// ---------------------------------------------------------------- Medição

const LINK_MEDICAO = () => `${enderecoDoSite}medicao`;
const LINK_PENDENCIAS = () => `${enderecoDoSite}pendencias`;

function emailDaEmpresa(e: Empresa | undefined): string {
  return (e?.email_contato ?? e?.email_acesso ?? '').trim();
}

type Esperada = { empresa_id: string; empresa: string; obra_id: string | null; obra: string; medicao: Medicao | null };

// Quem deveria entregar a medição do mês: as que existem e as empresas com liberados na obra sem medição.
function esperadas(base: Base, competencia: string): Esperada[] {
  const doMes = base.medicoes.filter((m) => m.competencia === competencia);
  const lista: Esperada[] = doMes.map((m) => ({ empresa_id: m.empresa_id, empresa: m.empresa, obra_id: m.obra_id, obra: m.obra ?? '', medicao: m }));
  const tem = new Set(doMes.map((m) => `${m.empresa_id}|${m.obra_id ?? ''}`));
  const vistos = new Set<string>();
  base.alocacoes
    .filter((a) => a.status === 'liberado')
    .forEach((a) => {
      const k = `${a.empresa_id}|${a.obra_id}`;
      if (tem.has(k) || vistos.has(k)) return;
      vistos.add(k);
      lista.push({ empresa_id: a.empresa_id, empresa: a.empresa, obra_id: a.obra_id, obra: a.obra, medicao: null });
    });
  return lista;
}

function porEmpresa<T extends { empresa_id: string }>(l: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  l.forEach((x) => m.set(x.empresa_id, [...(m.get(x.empresa_id) ?? []), x]));
  return m;
}

const nomeObra = (x: { obra_id: string | null; obra: string }) => (x.obra_id ? `Obra ${nomeLegivel(x.obra)}` : 'Medição do mês');

function situacaoParaLembrete(x: Esperada): string {
  if (!x.medicao) return 'medição não iniciada';
  if (x.medicao.status === 'pendente_fornecedor') return 'devolvida pela Emais, falta corrigir no portal e reenviar';
  return 'iniciada, falta enviar para conferência';
}

function itensPendentes(base: Base, medicaoId: string): number {
  return base.itens.filter((i) => i.medicao_id === medicaoId && (i.status === 'nao_enviado' || i.status === 'devolvido')).length;
}

// "O que falta" por obra, com os itens da medição.
function oQueFalta(base: Base, l: Esperada[]): string[] {
  const tipoPor = new Map(base.tipos.map((t) => [t.codigo, t]));
  const linhas: string[] = [];
  l.forEach((x) => {
    linhas.push(nomeObra(x));
    if (!x.medicao) {
      linhas.push('- Medição não enviada');
      return;
    }
    const itens = base.itens
      .filter((i) => i.medicao_id === x.medicao!.id && (i.status === 'nao_enviado' || i.status === 'devolvido'))
      .map((i) => ({ i, t: tipoPor.get(i.tipo_codigo) }))
      .filter((y): y is { i: ItemMed; t: TipoMedicao } => !!y.t)
      .sort((a, b) => a.t.ordem - b.t.ordem);
    if (itens.length >= 12) linhas.push('- Medição não enviada');
    else if (itens.length === 0)
      linhas.push(x.medicao.status === 'aberta' ? '- Documentos enviados, falta clicar em Enviar para conferência' : '- Corrigir no portal os colaboradores com pendência e reenviar');
    else
      linhas.push(
        ...itens.map(({ i, t }) => `- ${t.item}. ${t.nome}${i.status === 'devolvido' ? ` (devolvido${i.motivo_devolucao ? `: ${i.motivo_devolucao.toLowerCase()}` : ''}; corrija no portal)` : ''}`),
      );
  });
  return limitarItens(linhas, 'itens');
}

const pendenteDoFornecedor = (x: Esperada) => !x.medicao || x.medicao.status === 'aberta' || x.medicao.status === 'pendente_fornecedor';

// Campos comuns da medição de uma competência.
function camposMedicao(competencia: string, r: Regras) {
  const mes = mesBarra(competencia);
  const prazo = prazoDe(competencia, r);
  const tol = toleranciaDe(competencia, r);
  return {
    '{mes}': mes,
    '{mes_nome}': mes.split('/')[0],
    '{prazo}': data(prazo),
    '{prazo_curto}': curta(prazo),
    '{tolerancia}': data(tol),
    '{tolerancia_curta}': curta(tol),
    '{link_medicao}': LINK_MEDICAO(),
  };
}

function lembretes(base: Base, competencia: string, nome: string): Cobranca[] {
  const modelo = modeloAtivo(base, 'lembrete_medicao');
  if (!modelo) return [];
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const comuns = camposMedicao(competencia, base.regras);
  const lista: Cobranca[] = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`lembrete_medicao|${referencia}`)) return;
    const texto = aplicarModelo(modelo, {
      ...comuns,
      '{empresa}': nomeLegivel(l[0].empresa, true),
      '{situacao_obras}': limitar(l.map((x) => `- ${nomeObra(x)}: ${situacaoParaLembrete(x)}`), 'obras').join('\n'),
      '{assinatura}': assinaturaTexto(nome, base.assinatura),
    });
    lista.push({
      chave: `lembrete|${referencia}`,
      tipo: 'lembrete_medicao',
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} sem envio`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      ...texto,
      registros: [{ tipo: 'lembrete_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

function notificacoes(base: Base, competencia: string, nome: string, hoje: string): Cobranca[] {
  const modelo = modeloAtivo(base, 'notificacao_medicao');
  if (!modelo) return [];
  const tol = toleranciaDe(competencia, base.regras);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const comuns = { ...camposMedicao(competencia, base.regras), '{responder_ate}': curta(proximoDiaUtil(hoje)) };
  const lista: Cobranca[] = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`notificacao_medicao|${referencia}`)) return;
    const texto = aplicarModelo(modelo, {
      ...comuns,
      '{empresa}': nomeLegivel(l[0].empresa, true),
      '{o_que_falta}': oQueFalta(base, l).join('\n'),
      '{assinatura}': assinaturaTexto(nome, base.assinatura),
    });
    lista.push({
      chave: `notificacao|${referencia}`,
      tipo: 'notificacao_medicao',
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} em atraso, tolerância até ${curta(tol)}`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      ...texto,
      registros: [{ tipo: 'notificacao_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

const combinadaAte = (x: Esperada, hoje: string) => (x.medicao?.prazo_combinado && x.medicao.prazo_combinado >= hoje ? x.medicao.prazo_combinado : null);

function retencoesFornecedor(base: Base, competencia: string, nome: string, hoje: string): Cobranca[] {
  const modelo = modeloAtivo(base, 'cobranca_medicao');
  if (!modelo) return [];
  const mes = mesBarra(competencia);
  const tol = toleranciaDe(competencia, base.regras);
  // A notificação saiu no dia seguinte ao prazo.
  const notificacao = somarDiasIso(prazoDe(competencia, base.regras), 1);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const comuns = camposMedicao(competencia, base.regras);
  // Em conferência na Emais não é cobrado do fornecedor: ele já fez a parte dele.
  const retidas = esperadas(base, competencia).filter((x) => pendenteDoFornecedor(x) && !combinadaAte(x, hoje));
  const lista: Cobranca[] = [];
  porEmpresa(retidas).forEach((l, empresaId) => {
    const combinada = l.map((x) => x.medicao?.prazo_combinado).filter((d): d is string => !!d && d > tol).sort().pop();
    // Quando a data combinada vence, sai uma nova cobrança, mesmo que a do fim da tolerância já tenha sido enviada.
    const referencia = combinada ? `${competencia}:${empresaId}:combinado:${combinada}` : `${competencia}:${empresaId}`;
    if (base.feitas.has(`cobranca_medicao|${referencia}`)) return;
    const texto = aplicarModelo(modelo, {
      ...comuns,
      '{empresa}': nomeLegivel(l[0].empresa, true),
      '{historico_atraso}': combinada
        ? `A medição de ${mes} estava em atraso e combinamos o envio no portal até ${data(combinada)}.`
        : `No dia ${data(notificacao)} avisamos que a medição de ${mes} estava em atraso, com prazo até ${data(tol)} para regularização no portal.`,
      '{o_que_falta}': oQueFalta(base, l).join('\n'),
      '{assinatura}': assinaturaTexto(nome, base.assinatura),
    });
    lista.push({
      chave: `retencao-fornecedor|${referencia}`,
      tipo: 'cobranca_medicao',
      urgente: true,
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} com pagamento retido`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      ...texto,
      registros: [{ tipo: 'cobranca_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

function retencoesObra(base: Base, competencia: string, nome: string, hoje: string): Cobranca[] {
  const modelo = modeloAtivo(base, 'retencao_obra');
  if (!modelo) return [];
  const tol = toleranciaDe(competencia, base.regras);
  const comuns = camposMedicao(competencia, base.regras);
  const obraPor = new Map(base.obras.map((o) => [o.id, o]));
  const porObra = new Map<string, Esperada[]>();
  esperadas(base, competencia)
    .filter((x) => x.obra_id)
    .forEach((x) => porObra.set(x.obra_id!, [...(porObra.get(x.obra_id!) ?? []), x]));
  const lista: Cobranca[] = [];
  porObra.forEach((l, obraId) => {
    const pendentes = l.filter((x) => !x.medicao || x.medicao.status !== 'aprovada');
    const reter = pendentes.filter((x) => !combinadaAte(x, hoje));
    const aguardando = pendentes.filter((x) => combinadaAte(x, hoje));
    if (reter.length === 0) return;
    const vencidaCombinada = reter.map((x) => x.medicao?.prazo_combinado).filter((d): d is string => !!d && d > tol).sort().pop();
    const referencia = vencidaCombinada ? `${competencia}:${obraId}:combinado:${vencidaCombinada}` : `${competencia}:${obraId}`;
    if (base.feitas.has(`retencao_obra|${referencia}`)) return;
    const nomeDaObra = obraPor.get(obraId)?.nome ?? l[0].obra;
    const aprovadas = l.filter((x) => x.medicao?.status === 'aprovada');
    const ordem = (a: Esperada, b: Esperada) => a.empresa.localeCompare(b.empresa, 'pt-BR');
    const motivo = (x: Esperada) =>
      !x.medicao || itensPendentes(base, x.medicao.id) >= 12 ? 'medição não enviada' : x.medicao.status === 'em_analise' ? 'em conferência na Emais' : 'documentos pendentes';
    const texto = aplicarModelo(modelo, {
      ...comuns,
      '{obra}': nomeLegivel(nomeDaObra),
      '{prazo_regularizacao}': `${curta(tol)}${vencidaCombinada ? ' ou até a data combinada' : ''}`,
      '{qtd_empresas}': `${reter.length} ${reter.length === 1 ? 'empresa' : 'empresas'}`,
      '{empresas_reter}': limitar(reter.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: ${motivo(x)}`), 'empresas').join('\n'),
      '{empresas_liberadas}': aprovadas.length
        ? ['Liberadas para pagamento:', ...limitar(aprovadas.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}`), 'empresas')].join('\n')
        : '',
      '{empresas_aguardando}': aguardando.length
        ? [
            'Aguardando data combinada com o fornecedor (ainda não reter):',
            ...aguardando.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: envio combinado até ${curta(combinadaAte(x, hoje)!)}`),
          ].join('\n')
        : '',
      '{assinatura}': assinaturaTexto(nome, base.assinatura),
    });
    lista.push({
      chave: `retencao-obra|${referencia}`,
      tipo: 'retencao_obra',
      urgente: true,
      titulo: nomeDaObra,
      resumo: `${reter.length} ${reter.length === 1 ? 'empresa a reter' : 'empresas a reter'}${aguardando.length ? `, ${aguardando.length} com data combinada` : ''}`,
      para: obraPor.get(obraId)?.emails_engenharia ?? '',
      ...texto,
      registros: [{ tipo: 'retencao_obra', referencia, empresa_id: null, obra_id: obraId, competencia }],
      medicoes: [],
      obraId,
    });
  });
  return lista;
}

// ---------------------------------------------------------------- Documentos dos liberados

// Faixas do aviso. Os nomes '30' e '15' ficam fixos (primeiro e segundo aviso) porque entram na referência
// das cobranças já feitas; os dias de cada aviso vêm das Regras.
type Faixa = 'vencido' | '15' | '30';
const MODELO_DA_FAIXA: Record<Faixa, TipoModelo> = { vencido: 'vencimento_vencido', '15': 'vencimento_segundo', '30': 'vencimento_primeiro' };

function vencimentos(base: Base, nome: string): Cobranca[] {
  const r = base.regras;
  const liberadas = new Map(base.alocacoes.filter((a) => a.status === 'liberado').map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  type Doc = { chave: string; faixa: Faixa; empresa_id: string; quem: string; documento: string; vencimento: string };
  const docs = new Map<string, Doc>();
  base.pendencias.forEach((p) => {
    const a = liberadas.get(p.alocacao_id);
    if (!a || !p.vencimento || p.dias_para_vencer === null || p.dias_para_vencer > r.primeiroAviso) return;
    if (p.situacao !== 'a_vencer' && p.situacao !== 'vencido') return;
    if (p.status_envio_aberto === 'em_analise') return; // renovação já enviada, esperando a análise
    const faixa: Faixa = p.dias_para_vencer <= 0 ? 'vencido' : p.dias_para_vencer <= r.segundoAviso ? '15' : '30';
    const deQuem = p.grupo === 'empresa' ? 'empresa' : p.colaborador_id;
    const chave = `${faixa}:${p.empresa_id}:${p.tipo_codigo}:${deQuem}:${p.vencimento}`;
    if (base.feitas.has(`vencimento_documento|${chave}`) || docs.has(chave)) return;
    docs.set(chave, { chave, faixa, empresa_id: p.empresa_id, quem: p.grupo === 'empresa' ? 'Documento da empresa' : nomeLegivel(a.colaborador), documento: p.documento, vencimento: p.vencimento });
  });

  // Junta documentos da mesma pessoa que vencem no mesmo dia: "ASO e NR-11, vencem em 13/11/2026".
  function linhas(l: Doc[]): string[] {
    const grupos = new Map<string, Doc[]>();
    l.forEach((d) => grupos.set(`${d.quem}|${d.vencimento}`, [...(grupos.get(`${d.quem}|${d.vencimento}`) ?? []), d]));
    return [...grupos.values()]
      .sort((a, b) => a[0].vencimento.localeCompare(b[0].vencimento) || a[0].quem.localeCompare(b[0].quem, 'pt-BR'))
      .map((g) => {
        const nomes = g.map((d) => d.documento);
        const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
        const verbo = g[0].faixa === 'vencido' ? (g.length > 1 ? 'venceram' : 'venceu') : g.length > 1 ? 'vencem' : 'vence';
        return `- ${g[0].quem}: ${lista}, ${verbo} em ${data(g[0].vencimento)}`;
      });
  }

  const lista: Cobranca[] = [];
  porEmpresa([...docs.values()]).forEach((l, empresaId) => {
    const e = empresaPor.get(empresaId);
    const vencidos = l.filter((d) => d.faixa === 'vencido');
    const em15 = l.filter((d) => d.faixa === '15');
    const em30 = l.filter((d) => d.faixa === '30');
    // O e-mail segue o modelo da faixa mais grave; os documentos das outras faixas vão junto.
    const faixa: Faixa = vencidos.length ? 'vencido' : em15.length ? '15' : '30';
    const modelo = modeloAtivo(base, MODELO_DA_FAIXA[faixa]);
    if (!modelo) return;
    const secoes = [
      ...(vencidos.length ? ['', 'Já vencidos:', ...linhas(vencidos)] : []),
      ...(em15.length ? ['', `Vencem em até ${r.segundoAviso} dias:`, ...linhas(em15)] : []),
      ...(em30.length ? ['', `Vencem em até ${r.primeiroAviso} dias:`, ...linhas(em30)] : []),
    ];
    const texto = aplicarModelo(modelo, {
      '{empresa}': nomeLegivel(e?.razao_social ?? '', true),
      '{dias}': String(faixa === '15' ? r.segundoAviso : r.primeiroAviso),
      '{documentos}': limitarItens(secoes, 'documentos').join('\n').trim(),
      '{link_pendencias}': LINK_PENDENCIAS(),
      '{assinatura}': assinaturaTexto(nome, base.assinatura),
    });
    lista.push({
      chave: `documentos|${empresaId}|${l.map((d) => d.chave).sort().join(',')}`,
      tipo: 'vencimento_documento',
      urgente: vencidos.length > 0,
      titulo: e?.razao_social ?? '',
      resumo: [
        vencidos.length ? `${vencidos.length} ${vencidos.length === 1 ? 'vencido' : 'vencidos'}` : '',
        em15.length ? `${em15.length} em ${r.segundoAviso} dias` : '',
        em30.length ? `${em30.length} em ${r.primeiroAviso} dias` : '',
      ]
        .filter(Boolean)
        .join(', '),
      para: emailDaEmpresa(e),
      ...texto,
      registros: l.map((d) => ({ tipo: 'vencimento_documento' as const, referencia: d.chave, empresa_id: empresaId, obra_id: null, competencia: null })),
      medicoes: [],
      obraId: null,
    });
  });
  return lista;
}

// ---------------------------------------------------------------- Integração (semanal)

function integracao(base: Base, nome: string, hoje: string): Cobranca[] {
  const modelo = modeloAtivo(base, 'integracao_documentos');
  if (!modelo) return [];
  const semana = segundaDaSemana(hoje);
  const travadas = new Map(base.alocacoes.filter((a) => a.status === 'em_cadastro' || a.status === 'pendente_fornecedor').map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  type Falta = { empresa_id: string; obra: string; colaborador: string; docs: string[] };
  const porColaborador = new Map<string, Falta>();
  base.pendencias.forEach((p) => {
    const a = travadas.get(p.alocacao_id);
    if (!a || !['nao_enviado', 'devolvido', 'vencido'].includes(p.situacao)) return;
    if (p.status_envio_aberto === 'em_analise') return;
    // Parado há X dias úteis (Regras): desde o cadastro (não enviado) ou desde a devolução.
    if (p.situacao === 'nao_enviado') {
      const criada = base.criacao.get(p.alocacao_id);
      if (!criada || diasUteisDesde(criada, hoje) < base.regras.diasParado) return;
    }
    if (p.situacao === 'devolvido') {
      const em = base.devolucoes.get(`${p.empresa_id}|${p.grupo === 'empresa' ? '' : p.colaborador_id}|${p.tipo_codigo}`);
      if (em && diasUteisDesde(em, hoje) < base.regras.diasParado) return;
    }
    const f = porColaborador.get(p.alocacao_id) ?? { empresa_id: a.empresa_id, obra: a.obra, colaborador: nomeLegivel(a.colaborador), docs: [] };
    const doc =
      p.situacao === 'devolvido'
        ? `${p.documento} (devolvido${p.motivo_devolucao ? `: ${p.motivo_devolucao.toLowerCase()}` : ''}; corrija no portal)`
        : p.situacao === 'vencido'
          ? `${p.documento} (vencido)`
          : p.documento;
    if (!f.docs.includes(doc)) f.docs.push(doc);
    porColaborador.set(p.alocacao_id, f);
  });

  const lista: Cobranca[] = [];
  porEmpresa([...porColaborador.values()]).forEach((l, empresaId) => {
    const referencia = `${semana}:${empresaId}`;
    if (base.feitas.has(`integracao_documentos|${referencia}`)) return;
    const e = empresaPor.get(empresaId);
    const obras = [...new Set(l.map((x) => x.obra))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const linhas = obras.flatMap((o) => [
      `Obra ${nomeLegivel(o)}`,
      ...l
        .filter((x) => x.obra === o)
        .sort((a, b) => a.colaborador.localeCompare(b.colaborador, 'pt-BR'))
        .map((x) => `- ${x.colaborador}: ${x.docs.join(', ')}`),
    ]);
    const texto = aplicarModelo(modelo, {
      '{empresa}': nomeLegivel(e?.razao_social ?? '', true),
      '{colaboradores}': limitarItens(linhas, 'colaboradores').join('\n'),
      '{link_pendencias}': LINK_PENDENCIAS(),
      '{assinatura}': assinaturaTexto(nome, base.assinatura),
    });
    lista.push({
      chave: `integracao|${referencia}`,
      tipo: 'integracao_documentos',
      titulo: e?.razao_social ?? '',
      resumo: `${l.length} ${l.length === 1 ? 'colaborador' : 'colaboradores'} sem liberação`,
      para: emailDaEmpresa(e),
      ...texto,
      registros: [{ tipo: 'integracao_documentos', referencia, empresa_id: empresaId, obra_id: null, competencia: null }],
      medicoes: [],
      obraId: null,
    });
  });
  return lista;
}

// ---------------------------------------------------------------- Fila

// hoje: a data de referência (o envio automático informa a data de São Paulo, ou uma data simulada no teste).
export async function montarFila(nome: string, hoje = hojeIso()): Promise<Fila> {
  const regras = await lerRegras();
  const lembrete = competenciaDoLembrete(regras, hoje);
  const notificacao = competenciaDaNotificacao(regras, hoje);
  const retencao = competenciaDaRetencao(regras, hoje);
  const doPortal = (c: string | null): c is string => !!c && c >= INICIO_PORTAL;
  const base = await lerBase([lembrete, notificacao, retencao].filter(doPortal), regras);
  const ordem = (a: Cobranca, b: Cobranca) => a.titulo.localeCompare(b.titulo, 'pt-BR');
  return {
    cobrancas: [
      ...(doPortal(lembrete) ? lembretes(base, lembrete, nome).sort(ordem) : []),
      ...(doPortal(notificacao) ? notificacoes(base, notificacao, nome, hoje).sort(ordem) : []),
      ...(doPortal(retencao) ? retencoesFornecedor(base, retencao, nome, hoje).sort(ordem) : []),
      ...(doPortal(retencao) ? retencoesObra(base, retencao, nome, hoje).sort(ordem) : []),
      ...vencimentos(base, nome).sort(ordem),
      ...integracao(base, nome, hoje).sort(ordem),
    ],
    proxima: proximaData(regras, hoje),
    assinatura: base.assinatura,
    regras,
  };
}

let cacheContagem: { valor: number; em: number } | null = null;

export async function contarCobrancas(nome: string): Promise<number> {
  if (cacheContagem && Date.now() - cacheContagem.em < 5 * 60000) return cacheContagem.valor;
  const fila = await montarFila(nome);
  cacheContagem = { valor: fila.cobrancas.length, em: Date.now() };
  return cacheContagem.valor;
}

export function esquecerContagem() {
  cacheContagem = null;
}

export async function registrarCobrancas(lista: Cobranca[], situacao: 'aberta_no_outlook' | 'dispensada', para?: Map<string, string>) {
  const linhas = lista.flatMap((c) => c.registros.map((r) => ({ ...r, situacao, destinatarios: para?.get(c.chave) ?? c.para, assunto: c.assunto })));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('cobrancas').upsert(linhas.slice(i, i + 500), { onConflict: 'tipo,referencia', ignoreDuplicates: true });
    if (error) throw error;
  }
  const medicoes = situacao === 'aberta_no_outlook' ? lista.flatMap((c) => c.medicoes) : [];
  if (medicoes.length > 0) {
    const { error } = await supabase.rpc('registrar_cobranca_medicao', { p_medicoes: medicoes });
    if (error) throw error;
  }
  esquecerContagem();
}

export async function guardarDestinatariosObra(obraId: string, emails: string) {
  const { error } = await supabase.from('obras').update({ emails_engenharia: emails.trim() || null }).eq('id', obraId);
  if (error) throw error;
}

export async function lerAssinatura(): Promise<Assinatura> {
  const { data: d, error } = await supabase.from('parametros').select('chave, valor').in('chave', ['cobranca_setor', 'cobranca_contato']);
  if (error) throw error;
  const p = new Map((d ?? []).map((x) => [x.chave as string, x.valor as string]));
  return { setor: p.get('cobranca_setor') ?? 'Gente e Gestão', contato: p.get('cobranca_contato') ?? '' };
}

export async function lerDestinatariosObra(obraId: string): Promise<string> {
  const { data: d, error } = await supabase.from('obras').select('emails_engenharia').eq('id', obraId).single();
  if (error) throw error;
  return (d?.emails_engenharia as string | null) ?? '';
}

export async function guardarAssinatura(a: Assinatura) {
  for (const [chave, valor] of [
    ['cobranca_setor', a.setor.trim() || 'Gente e Gestão'],
    ['cobranca_contato', a.contato.trim()],
  ]) {
    const { error } = await supabase.from('parametros').update({ valor }).eq('chave', chave);
    if (error) throw error;
  }
  esquecerContagem();
}

// Títulos dos grupos da aba Cobranças, com os dias das Regras.
export function titulosGrupo(r: Regras): Record<TipoCobranca, { titulo: string; apoio: string }> {
  return {
    lembrete_medicao: { titulo: `Medição: lembrete (dia ${r.diaLembrete})`, apoio: `Empresas que ainda não enviaram a medição do mês. O prazo é o dia ${r.diaPrazo}.` },
    notificacao_medicao: {
      titulo: `Medição: notificação de atraso (dia ${r.diaPrazo + 1})`,
      apoio: `Prazo vencido: tolerância de ${r.diasTolerancia} dias e pedido de retorno com a data de envio. Quando o fornecedor responder, registre a data combinada na medição.`,
    },
    cobranca_medicao: { titulo: 'Medição: pagamento retido', apoio: 'Passou a tolerância (ou a data combinada) e a medição continua pendente.' },
    retencao_obra: { titulo: 'Medição: aviso de retenção para as obras', apoio: 'Para a engenharia de cada obra, com quem reter, quem está liberado e quem tem data combinada.' },
    vencimento_documento: {
      titulo: 'Documentos vencendo dos liberados',
      apoio: `Documentos que vencem em até ${r.primeiroAviso} dias, em até ${r.segundoAviso} dias ou que já venceram. Cada documento entra uma vez por faixa.`,
    },
    integracao_documentos: {
      titulo: 'Integração: colaboradores sem liberação (semanal)',
      apoio: `Toda segunda-feira: colaboradores cadastrados com documento obrigatório faltando ou devolvido, parado há ${r.diasParado} dias úteis ou mais.`,
    },
  };
}
