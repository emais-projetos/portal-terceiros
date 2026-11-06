import { supabase, enderecoDoSite } from './supabase';
import { data, hojeIso } from './formato';
import { lerAlocacoes, type AlocacaoResumo } from './admin';
import { lerTiposMedicao, lerTodasMedicoes, type Medicao, type TipoMedicao } from './medicao';

// Calendário de cobrança (aprovado com o administrativo):
// medição: dia 20 lembrete (prazo dia 25); dia 26 notificação de atraso com tolerância até o dia 30
// (as guias vencem no dia 20); depois do dia 30, pagamento retido e aviso à engenharia da obra, salvo
// quando há data combinada com o fornecedor;
// documentos dos liberados: quando entram em 30 dias, em 15 dias e quando vencem;
// integração: toda segunda-feira, colaboradores ainda não liberados com documento obrigatório parado há
// 3 dias úteis ou mais.
// Cada e-mail é aberto no Outlook por uma pessoa, que confere e envia. Depois de aberto ou dispensado, sai da fila.

export const DIA_LEMBRETE = 20;
export const DIA_NOTIFICACAO = 26;
// Antes disso a medição era controlada na planilha, que já tem as cobranças feitas.
const INICIO_PORTAL = '2026-09-01';
const MAX_LINHAS = 15;
const DIAS_PARADO = 3;

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

export type Fila = { cobrancas: Cobranca[]; proxima: string; assinatura: Assinatura };

// ---------------------------------------------------------------- Datas

function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

const mesAtual = (hoje: string) => `${hoje.slice(0, 7)}-01`;
const diaDoMes = (hoje: string) => Number(hoje.slice(8, 10));

function ultimoDia(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

// Prazo (dia 25) e tolerância (dia 30, ou o último dia do mês) da medição de uma competência.
export function prazoDe(competencia: string): string {
  return `${somarMeses(competencia, 1).slice(0, 8)}25`;
}

export function toleranciaDe(competencia: string): string {
  const mes = somarMeses(competencia, 1);
  return `${mes.slice(0, 8)}${String(Math.min(30, ultimoDia(mes))).padStart(2, '0')}`;
}

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

export function competenciaDoLembrete(hoje = hojeIso()): string | null {
  const d = diaDoMes(hoje);
  return d >= DIA_LEMBRETE && d < DIA_NOTIFICACAO ? somarMeses(mesAtual(hoje), -1) : null;
}

export function competenciaDaNotificacao(hoje = hojeIso()): string | null {
  const c = somarMeses(mesAtual(hoje), -1);
  return diaDoMes(hoje) >= DIA_NOTIFICACAO && hoje <= toleranciaDe(c) ? c : null;
}

// Retenção: o último mês trabalhado cuja tolerância já passou.
export function competenciaDaRetencao(hoje = hojeIso()): string {
  const c = somarMeses(mesAtual(hoje), -1);
  return hoje > toleranciaDe(c) ? c : somarMeses(c, -1);
}

export function proximaData(hoje = hojeIso()): string {
  const d = diaDoMes(hoje);
  const mes = mesAtual(hoje);
  const tol = toleranciaDe(somarMeses(mes, -1));
  if (d < DIA_LEMBRETE) return `${mes.slice(0, 8)}${DIA_LEMBRETE}`;
  if (d < DIA_NOTIFICACAO) return `${mes.slice(0, 8)}${DIA_NOTIFICACAO}`;
  if (hoje <= tol) return somarDiasIso(tol, 1);
  return `${somarMeses(mes, 1).slice(0, 8)}${DIA_LEMBRETE}`;
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
type Obra = { id: string; nome: string; emails_engenharia: string | null };
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
};

const CAMPOS_PEND = 'alocacao_id, colaborador_id, empresa_id, tipo_codigo, documento, grupo, vencimento, dias_para_vencer, status_envio_aberto, motivo_devolucao, situacao';

type Devolvido = { empresa_id: string; colaborador_id: string | null; tipo_codigo: string; analisado_em: string | null };

async function lerBase(competencias: string[]): Promise<Base> {
  const [medicoes, tipos, alocacoes, pendencias, empresas, obras, feitas, criadas, devolvidos, parametros] = await Promise.all([
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
    lerTudo<Obra>((i, f) => supabase.from('obras').select('id, nome, emails_engenharia').order('id').range(i, f) as unknown as PromiseLike<{ data: Obra[] | null; error: unknown }>),
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
  ]);
  const ids = medicoes.filter((m) => competencias.includes(m.competencia) && m.status !== 'aprovada').map((m) => m.id);
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
    assinatura: { setor: param.get('cobranca_setor') ?? 'Gente e Gestão', contato: param.get('cobranca_contato') ?? '' },
  };
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

const COMO_ENVIAR_MEDICAO = (mes: string) => [
  'Como enviar:',
  `1. Acesse ${LINK_MEDICAO()}`,
  `2. Escolha a obra e o mês de ${mes} e clique em Começar.`,
  '3. Anexe um arquivo por item ou marque "não se aplica" quando for o caso.',
  '4. Confira a lista de colaboradores do mês e clique em Enviar para conferência.',
];

const COMO_REGULARIZAR = (mes: string, final: string) => [
  `1. Acesse ${LINK_MEDICAO()}`,
  `2. Abra ${mes}, envie ou corrija os itens acima e clique em Enviar para conferência.`,
  `3. ${final}`,
];

const pendenteDoFornecedor = (x: Esperada) => !x.medicao || x.medicao.status === 'aberta' || x.medicao.status === 'pendente_fornecedor';

function lembretes(base: Base, competencia: string, nome: string): Cobranca[] {
  const mes = mesBarra(competencia);
  const prazo = prazoDe(competencia);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const lista: Cobranca[] = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`lembrete_medicao|${referencia}`)) return;
    const empresa = nomeLegivel(l[0].empresa, true);
    lista.push({
      chave: `lembrete|${referencia}`,
      tipo: 'lembrete_medicao',
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} sem envio`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Medição de ${mes}: envio até ${curta(prazo)}, ${empresa}`,
      corpo: [
        `Olá, equipe da ${empresa},`,
        '',
        `A medição de ${mes} deve ser enviada pelo Portal de Terceiros até ${data(prazo)}.`,
        '',
        'Situação hoje:',
        ...limitar(l.map((x) => `- ${nomeObra(x)}: ${situacaoParaLembrete(x)}`), 'obras'),
        '',
        'Por que é importante:',
        `O pagamento do mês só é liberado depois que a Emais confere os documentos da medição (holerites, ponto, folha, FGTS, INSS, DCTFWeb, DARF e seguro de vida). Se a medição não for apresentada no prazo, o pagamento de ${mes.split('/')[0]} pode ser retido.`,
        '',
        ...COMO_ENVIAR_MEDICAO(mes),
        '',
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura),
      ].join('\n'),
      registros: [{ tipo: 'lembrete_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

function notificacoes(base: Base, competencia: string, nome: string, hoje: string): Cobranca[] {
  const mes = mesBarra(competencia);
  const mesNome = mes.split('/')[0];
  const prazo = prazoDe(competencia);
  const tol = toleranciaDe(competencia);
  const resposta = proximoDiaUtil(hoje);
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const lista: Cobranca[] = [];
  porEmpresa(esperadas(base, competencia).filter(pendenteDoFornecedor)).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`notificacao_medicao|${referencia}`)) return;
    const empresa = nomeLegivel(l[0].empresa, true);
    lista.push({
      chave: `notificacao|${referencia}`,
      tipo: 'notificacao_medicao',
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} em atraso, tolerância até ${curta(tol)}`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Medição de ${mes} em atraso: envie até ${curta(tol)} para evitar a retenção do pagamento, ${empresa}`,
      corpo: [
        `Olá, equipe da ${empresa},`,
        '',
        `O prazo da medição de ${mes} terminou em ${data(prazo)} e ainda faltam documentos. Para que o pagamento de ${mesNome} não seja retido, regularize pelo portal até ${data(tol)}.`,
        '',
        'O que falta:',
        ...oQueFalta(base, l),
        '',
        `Pedimos que responda este e-mail até ${curta(resposta)} informando a data em que os documentos serão enviados no portal.`,
        '',
        `Se não for regularizado até ${data(tol)}:`,
        `- o pagamento de ${mesNome} fica retido até a aprovação da medição;`,
        '- a engenharia da obra é avisada da retenção;',
        '- o atraso fica registrado no histórico de entregas da empresa, considerado na avaliação de fornecedores da Emais.',
        '',
        'Como regularizar:',
        ...COMO_REGULARIZAR(mes, 'A Emais confere em até 3 dias úteis.'),
        '',
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura),
      ].join('\n'),
      registros: [{ tipo: 'notificacao_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

const combinadaAte = (x: Esperada, hoje: string) => (x.medicao?.prazo_combinado && x.medicao.prazo_combinado >= hoje ? x.medicao.prazo_combinado : null);

function retencoesFornecedor(base: Base, competencia: string, nome: string, hoje: string): Cobranca[] {
  const mes = mesBarra(competencia);
  const mesNome = mes.split('/')[0];
  const tol = toleranciaDe(competencia);
  const notificacao = `${somarMeses(competencia, 1).slice(0, 8)}${DIA_NOTIFICACAO}`;
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  // Em conferência na Emais não é cobrado do fornecedor: ele já fez a parte dele.
  const retidas = esperadas(base, competencia).filter((x) => pendenteDoFornecedor(x) && !combinadaAte(x, hoje));
  const lista: Cobranca[] = [];
  porEmpresa(retidas).forEach((l, empresaId) => {
    const empresa = nomeLegivel(l[0].empresa, true);
    const combinada = l.map((x) => x.medicao?.prazo_combinado).filter((d): d is string => !!d && d > tol).sort().pop();
    // Quando a data combinada vence, sai uma nova cobrança, mesmo que a do dia 31 já tenha sido enviada.
    const referencia = combinada ? `${competencia}:${empresaId}:combinado:${combinada}` : `${competencia}:${empresaId}`;
    if (base.feitas.has(`cobranca_medicao|${referencia}`)) return;
    lista.push({
      chave: `retencao-fornecedor|${referencia}`,
      tipo: 'cobranca_medicao',
      urgente: true,
      titulo: l[0].empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} com pagamento retido`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Pagamento retido: medição de ${mes} pendente, ${empresa}`,
      corpo: [
        `Olá, equipe da ${empresa},`,
        '',
        combinada && combinada > tol
          ? `A medição de ${mes} estava em atraso e combinamos o envio no portal até ${data(combinada)}. Como os itens abaixo continuam pendentes, o pagamento de ${mesNome} está retido.`
          : `No dia ${data(notificacao)} avisamos que a medição de ${mes} estava em atraso, com prazo até ${data(tol)} para regularização no portal. Como os itens abaixo continuam pendentes, o pagamento de ${mesNome} está retido.`,
        '',
        'O que falta:',
        ...oQueFalta(base, l),
        '',
        'O pagamento é liberado assim que a medição for aprovada:',
        ...COMO_REGULARIZAR(mes, 'A Emais confere em até 3 dias úteis e avisa a obra da liberação.'),
        '',
        'O atraso fica registrado no histórico de entregas da empresa, considerado na avaliação de fornecedores da Emais.',
        '',
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura),
      ].join('\n'),
      registros: [{ tipo: 'cobranca_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

function retencoesObra(base: Base, competencia: string, nome: string, hoje: string): Cobranca[] {
  const mes = mesBarra(competencia);
  const mesNome = mes.split('/')[0];
  const tol = toleranciaDe(competencia);
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
    const obra = nomeLegivel(nomeDaObra);
    const aprovadas = l.filter((x) => x.medicao?.status === 'aprovada');
    const ordem = (a: Esperada, b: Esperada) => a.empresa.localeCompare(b.empresa, 'pt-BR');
    const motivo = (x: Esperada) =>
      !x.medicao || itensPendentes(base, x.medicao.id) >= 12 ? 'medição não enviada' : x.medicao.status === 'em_analise' ? 'em conferência na Emais' : 'documentos pendentes';
    lista.push({
      chave: `retencao-obra|${referencia}`,
      tipo: 'retencao_obra',
      urgente: true,
      titulo: nomeDaObra,
      resumo: `${reter.length} ${reter.length === 1 ? 'empresa a reter' : 'empresas a reter'}${aguardando.length ? `, ${aguardando.length} com data combinada` : ''}`,
      para: obraPor.get(obraId)?.emails_engenharia ?? '',
      assunto: `${obra}: reter pagamento de ${reter.length} ${reter.length === 1 ? 'empresa' : 'empresas'} (medição de ${mes})`,
      corpo: [
        'Olá,',
        '',
        `As empresas abaixo não regularizaram a medição de ${mes} até ${curta(tol)}${vencidaCombinada ? ' ou até a data combinada' : ''}, mesmo após notificação. Ação: não liberar o pagamento de ${mesNome} dessas empresas até novo aviso.`,
        '',
        'Reter pagamento:',
        ...limitar(reter.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: ${motivo(x)}`), 'empresas'),
        ...(aprovadas.length ? ['', 'Liberadas para pagamento:', ...limitar(aprovadas.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}`), 'empresas')] : []),
        ...(aguardando.length
          ? ['', 'Aguardando data combinada com o fornecedor (ainda não reter):', ...aguardando.sort(ordem).map((x) => `- ${nomeLegivel(x.empresa, true)}: envio combinado até ${curta(combinadaAte(x, hoje)!)}`)]
          : []),
        '',
        'Os fornecedores já foram notificados. Assim que cada empresa for aprovada, enviamos a liberação.',
        ...assinatura(nome, base.assinatura),
      ].join('\n'),
      registros: [{ tipo: 'retencao_obra', referencia, empresa_id: null, obra_id: obraId, competencia }],
      medicoes: [],
      obraId,
    });
  });
  return lista;
}

// ---------------------------------------------------------------- Documentos dos liberados

type Faixa = 'vencido' | '15' | '30';

function vencimentos(base: Base, nome: string): Cobranca[] {
  const liberadas = new Map(base.alocacoes.filter((a) => a.status === 'liberado').map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  type Doc = { chave: string; faixa: Faixa; empresa_id: string; quem: string; documento: string; vencimento: string };
  const docs = new Map<string, Doc>();
  base.pendencias.forEach((p) => {
    const a = liberadas.get(p.alocacao_id);
    if (!a || !p.vencimento || p.dias_para_vencer === null || p.dias_para_vencer > 30) return;
    if (p.situacao !== 'a_vencer' && p.situacao !== 'vencido') return;
    if (p.status_envio_aberto === 'em_analise') return; // renovação já enviada, esperando a análise
    const faixa: Faixa = p.dias_para_vencer <= 0 ? 'vencido' : p.dias_para_vencer <= 15 ? '15' : '30';
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
    const empresa = nomeLegivel(e?.razao_social ?? '', true);
    const vencidos = l.filter((d) => d.faixa === 'vencido');
    const em15 = l.filter((d) => d.faixa === '15');
    const em30 = l.filter((d) => d.faixa === '30');
    const assunto = vencidos.length
      ? `Colaboradores impedidos de entrar na obra: documentos vencidos, ${empresa}`
      : em15.length
        ? `Faltam 15 dias: documentos vencendo, ${empresa}`
        : `Documentos vencem nos próximos 30 dias: renove no portal para manter a liberação, ${empresa}`;
    const secoes = [
      ...(vencidos.length ? ['', 'Já vencidos:', ...linhas(vencidos)] : []),
      ...(em15.length ? ['', 'Vencem em até 15 dias:', ...linhas(em15)] : []),
      ...(em30.length ? ['', 'Vencem em até 30 dias:', ...linhas(em30)] : []),
    ];
    lista.push({
      chave: `documentos|${empresaId}|${l.map((d) => d.chave).sort().join(',')}`,
      tipo: 'vencimento_documento',
      urgente: vencidos.length > 0,
      titulo: e?.razao_social ?? '',
      resumo: [vencidos.length ? `${vencidos.length} ${vencidos.length === 1 ? 'vencido' : 'vencidos'}` : '', em15.length ? `${em15.length} em 15 dias` : '', em30.length ? `${em30.length} em 30 dias` : ''].filter(Boolean).join(', '),
      para: emailDaEmpresa(e),
      assunto,
      corpo: [
        `Olá, equipe da ${empresa},`,
        '',
        'Os documentos abaixo, de colaboradores liberados nas obras da Emais, precisam ser renovados no portal. Para que eles continuem trabalhando sem interrupção, envie a renovação antes do vencimento.',
        ...limitarItens(secoes, 'documentos'),
        '',
        'Se o documento vencer:',
        '- o colaborador fica impedido de entrar na obra até a renovação ser aprovada;',
        '- se for preciso refazer exame (ASO) ou treinamento (NR), conte o tempo de agendamento;',
        '- sem colaborador liberado, o serviço contratado pode atrasar.',
        '',
        'Como enviar:',
        `1. Acesse ${LINK_PENDENCIAS()}`,
        '2. Localize o colaborador e clique em Enviar novo no documento.',
        '3. Anexe o arquivo atualizado e informe a data de emissão.',
        '4. A Emais confere em até 2 dias úteis.',
        '',
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura),
      ].join('\n'),
      registros: l.map((d) => ({ tipo: 'vencimento_documento' as const, referencia: d.chave, empresa_id: empresaId, obra_id: null, competencia: null })),
      medicoes: [],
      obraId: null,
    });
  });
  return lista;
}

// ---------------------------------------------------------------- Integração (semanal)

function integracao(base: Base, nome: string, hoje: string): Cobranca[] {
  const semana = segundaDaSemana(hoje);
  const travadas = new Map(base.alocacoes.filter((a) => a.status === 'em_cadastro' || a.status === 'pendente_fornecedor').map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  type Falta = { empresa_id: string; obra: string; colaborador: string; docs: string[] };
  const porColaborador = new Map<string, Falta>();
  base.pendencias.forEach((p) => {
    const a = travadas.get(p.alocacao_id);
    if (!a || !['nao_enviado', 'devolvido', 'vencido'].includes(p.situacao)) return;
    if (p.status_envio_aberto === 'em_analise') return;
    // Parado há 3 dias úteis: desde o cadastro (não enviado) ou desde a devolução.
    if (p.situacao === 'nao_enviado') {
      const criada = base.criacao.get(p.alocacao_id);
      if (!criada || diasUteisDesde(criada, hoje) < DIAS_PARADO) return;
    }
    if (p.situacao === 'devolvido') {
      const em = base.devolucoes.get(`${p.empresa_id}|${p.grupo === 'empresa' ? '' : p.colaborador_id}|${p.tipo_codigo}`);
      if (em && diasUteisDesde(em, hoje) < DIAS_PARADO) return;
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
    const empresa = nomeLegivel(e?.razao_social ?? '', true);
    const obras = [...new Set(l.map((x) => x.obra))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const linhas = obras.flatMap((o) => [
      `Obra ${nomeLegivel(o)}`,
      ...l
        .filter((x) => x.obra === o)
        .sort((a, b) => a.colaborador.localeCompare(b.colaborador, 'pt-BR'))
        .map((x) => `- ${x.colaborador}: ${x.docs.join(', ')}`),
    ]);
    lista.push({
      chave: `integracao|${referencia}`,
      tipo: 'integracao_documentos',
      titulo: e?.razao_social ?? '',
      resumo: `${l.length} ${l.length === 1 ? 'colaborador' : 'colaboradores'} sem liberação`,
      para: emailDaEmpresa(e),
      assunto: `Colaboradores sem liberação para a obra: documentos pendentes, ${empresa}`,
      corpo: [
        `Olá, equipe da ${empresa},`,
        '',
        'Os colaboradores abaixo estão cadastrados no portal, mas ainda não podem ser liberados porque faltam documentos obrigatórios. Sem eles, o colaborador não faz a integração de segurança e não entra na obra.',
        '',
        ...limitarItens(linhas, 'colaboradores'),
        '',
        'Como enviar:',
        `1. Acesse ${LINK_PENDENCIAS()}`,
        '2. Envie os documentos de cada colaborador.',
        '3. Com tudo enviado, clique em Enviar para análise.',
        '4. A Emais confere em até 2 dias úteis; depois o TST da obra valida e agenda a integração.',
        '',
        AVISO_PORTAL,
        ...assinatura(nome, base.assinatura),
      ].join('\n'),
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
  const lembrete = competenciaDoLembrete(hoje);
  const notificacao = competenciaDaNotificacao(hoje);
  const retencao = competenciaDaRetencao(hoje);
  const doPortal = (c: string | null): c is string => !!c && c >= INICIO_PORTAL;
  const base = await lerBase([lembrete, notificacao, retencao].filter(doPortal));
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
    proxima: proximaData(hoje),
    assinatura: base.assinatura,
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

export const titulosGrupo: Record<TipoCobranca, { titulo: string; apoio: string }> = {
  lembrete_medicao: { titulo: 'Medição: lembrete (dia 20)', apoio: 'Empresas que ainda não enviaram a medição do mês. O prazo é o dia 25.' },
  notificacao_medicao: {
    titulo: 'Medição: notificação de atraso (dia 26)',
    apoio: 'Prazo vencido: tolerância até o dia 30 e pedido de retorno com a data de envio. Quando o fornecedor responder, registre a data combinada na medição.',
  },
  cobranca_medicao: { titulo: 'Medição: pagamento retido', apoio: 'Passou a tolerância do dia 30 (ou a data combinada) e a medição continua pendente.' },
  retencao_obra: { titulo: 'Medição: aviso de retenção para as obras', apoio: 'Para a engenharia de cada obra, com quem reter, quem está liberado e quem tem data combinada.' },
  vencimento_documento: { titulo: 'Documentos vencendo dos liberados', apoio: 'Documentos que vencem em até 30 dias, em até 15 dias ou que já venceram. Cada documento entra uma vez por faixa.' },
  integracao_documentos: {
    titulo: 'Integração: colaboradores sem liberação (semanal)',
    apoio: 'Toda segunda-feira: colaboradores cadastrados com documento obrigatório faltando ou devolvido, parado há 3 dias úteis ou mais.',
  },
};
