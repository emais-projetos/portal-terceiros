import { supabase } from './supabase';
import { hojeIso } from './formato';
import { lerAlocacoes, type AlocacaoResumo } from './admin';
import { lerTiposMedicao, lerTodasMedicoes, type Medicao, type TipoMedicao } from './medicao';

// Metas de referência dos indicadores. Para mudar uma meta, basta trocar o número aqui.
export const METAS = {
  aprovadas: 90, // % das medições do mês aprovadas
  noPrazo: 80, // % entregues até o dia 25
  conferencia: 3, // dias úteis da Emais, do envio à conclusão
  liberacao: 5, // dias úteis, do envio para análise à validação do TST
  liberadosComPendencia: 0, // % dos liberados com documento vencido ou faltando
};

const PAGINA = 1000;

async function lerTudo<T>(montar: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await montar(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return todas;
}

// ---------------------------------------------------------------- Leitura

type ItemResumo = { medicao_id: string; tipo_codigo: string; status: string };
type Evento = { registro_id: string; acao: string; criado_em: string };
type PendenciaLiberado = { alocacao_id: string; documento: string; situacao: string };

export type BaseIndicadores = {
  medicoes: Medicao[];
  itens: ItemResumo[];
  tipos: TipoMedicao[];
  eventos: Evento[];
  alocacoes: AlocacaoResumo[];
  pendencias: PendenciaLiberado[];
};

export async function lerBaseIndicadores(): Promise<BaseIndicadores> {
  const [medicoes, itens, tipos, eventos, alocacoes, pendencias] = await Promise.all([
    lerTodasMedicoes(),
    lerTudo<ItemResumo>((i, f) =>
      supabase.from('medicoes_itens').select('medicao_id, tipo_codigo, status').order('id').range(i, f) as unknown as PromiseLike<{ data: ItemResumo[] | null; error: unknown }>,
    ),
    lerTiposMedicao(),
    lerTudo<Evento>((i, f) =>
      supabase
        .from('eventos')
        .select('registro_id, acao, criado_em')
        .eq('tabela', 'medicoes')
        .in('acao', ['enviada', 'conferida'])
        .order('criado_em')
        .range(i, f) as unknown as PromiseLike<{ data: Evento[] | null; error: unknown }>,
    ),
    lerAlocacoes(),
    lerTudo<PendenciaLiberado>((i, f) =>
      supabase
        .from('v_pendencias')
        .select('alocacao_id, documento, situacao')
        .eq('impeditivo', true)
        .in('situacao', ['vencido', 'nao_enviado', 'devolvido'])
        .order('alocacao_id')
        .order('tipo_codigo')
        .range(i, f) as unknown as PromiseLike<{ data: PendenciaLiberado[] | null; error: unknown }>,
    ),
  ]);
  return { medicoes, itens, tipos, eventos, alocacoes, pendencias };
}

// ---------------------------------------------------------------- Apoio

// Dias úteis (segunda a sexta) entre duas datas: mesmo dia = 0.
export function diasUteis(inicio: string, fim: string): number {
  const a = new Date(inicio);
  const b = new Date(fim);
  const d0 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const d1 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  if (d1 <= d0) return 0;
  let n = 0;
  for (let t = d0 + 86400000; t <= d1; t += 86400000) {
    const dia = new Date(t).getUTCDay();
    if (dia !== 0 && dia !== 6) n += 1;
  }
  return n;
}

function mesDe(dataHora: string): string {
  const d = new Date(dataHora);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function media(valores: number[]): number | null {
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
}

function pct(parte: number, total: number): number | null {
  return total ? (100 * parte) / total : null;
}

export type Filtro = { obraId: string; desde: string };

// Meses de um intervalo, do mais antigo ao mais novo.
export function mesesEntre(desde: string, ate: string): string[] {
  const lista: string[] = [];
  const [a, m] = desde.split('-').map(Number);
  for (let d = new Date(a, m - 1, 1); ; d.setMonth(d.getMonth() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    if (iso > ate) break;
    lista.push(iso);
  }
  return lista;
}

// ---------------------------------------------------------------- Medição

export type MesMedicao = {
  competencia: string;
  fechado: boolean; // prazo já passou
  total: number;
  aprovadas: number;
  pctAprovadas: number | null;
  doPortal: number;
  noPrazo: number;
  pctNoPrazo: number | null; // nulo quando o mês veio só da planilha (sem data de envio)
};

export type ItemPendente = { codigo: string; rotulo: string; naoEnviado: number; devolvido: number; total: number };

export type ConferenciaMes = { mes: string; conferencias: number; mediaDias: number | null };

export type RankingMedicao = {
  empresa_id: string;
  empresa: string;
  medicoes: number;
  aprovadas: number;
  pctAprovadas: number;
  pctNoPrazo: number | null;
  itensPendentes: number;
  retidas: number;
};

export type IndicadoresMedicao = {
  meses: MesMedicao[];
  ultimoFechado: MesMedicao | null;
  anteriorFechado: MesMedicao | null;
  conferencia: ConferenciaMes[];
  conferenciaMedia: number | null;
  emConferenciaAgora: { qtd: number; maisAntigaDias: number | null };
  itensPendentes: ItemPendente[];
  totalItensPendentes: number;
  naoAprovadas: number;
  nadaEntregue: number;
  entregaParcial: number;
  ranking: RankingMedicao[];
};

export function calcularMedicao(base: BaseIndicadores, filtro: Filtro): IndicadoresMedicao {
  const hoje = hojeIso();
  // Medição dispensada não entra nos indicadores: não havia o que entregar.
  const doFiltro = base.medicoes.filter((m) => !m.dispensada_em && m.competencia >= filtro.desde && (!filtro.obraId || m.obra_id === filtro.obraId));
  const ultimoMes = doFiltro.reduce((max, m) => (m.competencia > max ? m.competencia : max), filtro.desde);
  const meses = mesesEntre(filtro.desde, ultimoMes).map((c) => {
    const l = doFiltro.filter((m) => m.competencia === c);
    const doPortal = l.filter((m) => m.origem === 'portal');
    const aprovadas = l.filter((m) => m.status === 'aprovada').length;
    const noPrazo = doPortal.filter((m) => m.entregue_no_prazo).length;
    const prazo = l[0]?.prazo ?? '';
    return {
      competencia: c,
      fechado: !!prazo && prazo < hoje,
      total: l.length,
      aprovadas,
      pctAprovadas: pct(aprovadas, l.length),
      doPortal: doPortal.length,
      noPrazo,
      pctNoPrazo: doPortal.length ? pct(noPrazo, doPortal.length) : null,
    };
  });
  const fechados = meses.filter((m) => m.fechado && m.total > 0);

  // Tempo de conferência: de cada envio até a conclusão seguinte.
  const ids = new Set(doFiltro.map((m) => m.id));
  const porMedicao = new Map<string, Evento[]>();
  base.eventos.filter((e) => ids.has(e.registro_id)).forEach((e) => porMedicao.set(e.registro_id, [...(porMedicao.get(e.registro_id) ?? []), e]));
  const rodadas: { mes: string; dias: number }[] = [];
  porMedicao.forEach((evs) => {
    let envio: string | null = null;
    evs.forEach((e) => {
      if (e.acao === 'enviada') envio = e.criado_em;
      else if (e.acao === 'conferida' && envio) {
        rodadas.push({ mes: mesDe(e.criado_em), dias: diasUteis(envio, e.criado_em) });
        envio = null;
      }
    });
  });
  const mesesConf = [...new Set(rodadas.map((r) => r.mes))].sort();
  const conferencia = mesesConf.map((mes) => {
    const r = rodadas.filter((x) => x.mes === mes);
    return { mes, conferencias: r.length, mediaDias: media(r.map((x) => x.dias)) };
  });
  const emAnalise = doFiltro.filter((m) => m.status === 'em_analise' && m.enviada_em);
  const idades = emAnalise.map((m) => diasUteis(m.enviada_em!, new Date().toISOString()));

  // Itens pendentes nas medições ainda não aprovadas
  // Separa quem não entregou nada (o problema é a falta de entrega) de quem entregou em parte (o problema é o item).
  const naoAprovadasLista = doFiltro.filter((m) => m.status !== 'aprovada');
  const entregouAlgo = new Set(
    base.itens.filter((i) => ['em_analise', 'aprovado', 'nao_aplica', 'devolvido'].includes(i.status) && i.tipo_codigo !== 'adiantamento').map((i) => i.medicao_id),
  );
  const nadaEntregue = naoAprovadasLista.filter((m) => !entregouAlgo.has(m.id)).length;
  const naoAprovadas = new Set(naoAprovadasLista.filter((m) => entregouAlgo.has(m.id)).map((m) => m.id));
  const itensTodas = new Set(naoAprovadasLista.map((m) => m.id));
  const totalItensPendentes = base.itens.filter((i) => itensTodas.has(i.medicao_id) && (i.status === 'nao_enviado' || i.status === 'devolvido')).length;
  const itensPendentes = base.tipos
    .map((t) => {
      const l = base.itens.filter((i) => i.tipo_codigo === t.codigo && naoAprovadas.has(i.medicao_id));
      const naoEnviado = l.filter((i) => i.status === 'nao_enviado').length;
      const devolvido = l.filter((i) => i.status === 'devolvido').length;
      return { codigo: t.codigo, rotulo: `${t.item}. ${t.nome}`, naoEnviado, devolvido, total: naoEnviado + devolvido };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);

  // Ranking: só meses com prazo vencido, para não pesar o mês em andamento.
  const fechadas = doFiltro.filter((m) => m.prazo < hoje);
  const porEmpresa = new Map<string, Medicao[]>();
  fechadas.forEach((m) => porEmpresa.set(m.empresa_id, [...(porEmpresa.get(m.empresa_id) ?? []), m]));
  const ranking = [...porEmpresa.values()].map((l) => {
    const aprovadas = l.filter((m) => m.status === 'aprovada').length;
    const portal = l.filter((m) => m.origem === 'portal');
    return {
      empresa_id: l[0].empresa_id,
      empresa: l[0].empresa,
      medicoes: l.length,
      aprovadas,
      pctAprovadas: (100 * aprovadas) / l.length,
      pctNoPrazo: portal.length ? (100 * portal.filter((m) => m.entregue_no_prazo).length) / portal.length : null,
      itensPendentes: l.reduce((s, m) => s + (m.status === 'aprovada' ? 0 : m.itens_pendentes), 0),
      retidas: l.filter((m) => m.retida).length,
    };
  });

  return {
    meses,
    ultimoFechado: fechados[fechados.length - 1] ?? null,
    anteriorFechado: fechados[fechados.length - 2] ?? null,
    conferencia,
    conferenciaMedia: media(rodadas.map((r) => r.dias)),
    emConferenciaAgora: { qtd: emAnalise.length, maisAntigaDias: idades.length ? Math.max(...idades) : null },
    itensPendentes,
    totalItensPendentes,
    naoAprovadas: naoAprovadasLista.length,
    nadaEntregue,
    entregaParcial: naoAprovadas.size,
    ranking,
  };
}

export function pioresMedicao(r: RankingMedicao[]): RankingMedicao[] {
  return [...r]
    .filter((x) => x.aprovadas < x.medicoes)
    .sort((a, b) => a.pctAprovadas - b.pctAprovadas || b.retidas - a.retidas || b.itensPendentes - a.itensPendentes || a.empresa.localeCompare(b.empresa, 'pt-BR'))
    .slice(0, 10);
}

export function melhoresMedicao(r: RankingMedicao[]): RankingMedicao[] {
  return [...r]
    .filter((x) => x.medicoes >= 2 && x.aprovadas > 0)
    .sort((a, b) => b.pctAprovadas - a.pctAprovadas || (b.pctNoPrazo ?? -1) - (a.pctNoPrazo ?? -1) || b.medicoes - a.medicoes || a.itensPendentes - b.itensPendentes)
    .slice(0, 10);
}

// ---------------------------------------------------------------- Liberação

export type LiberacaoMes = { mes: string; liberacoes: number; mediaTotal: number | null; mediaEmais: number | null; mediaTst: number | null };

export type RankingLiberacao = { empresa_id: string; empresa: string; liberacoes: number; mediaDias: number };

export type RankingPendencia = { empresa_id: string; empresa: string; liberados: number; comPendencia: number; pct: number };

export type IndicadoresLiberacao = {
  meses: LiberacaoMes[];
  mediaTotal: number | null;
  mediaEmais: number | null;
  mediaTst: number | null;
  liberacoes: number;
  rankingTempo: RankingLiberacao[];
  liberados: number;
  comPendencia: number;
  pctComPendencia: number | null;
  porObra: { obra: string; liberados: number; comPendencia: number; pct: number }[];
  porDocumento: { documento: string; vencido: number; faltando: number; total: number }[];
  rankingPendencia: RankingPendencia[];
};

export function calcularLiberacao(base: BaseIndicadores, filtro: Filtro): IndicadoresLiberacao {
  const daObra = base.alocacoes.filter((a) => !filtro.obraId || a.obra_id === filtro.obraId);

  // Tempo: do envio para análise até a validação do TST, para quem foi liberado no período.
  const liberadas = daObra
    .filter((a) => a.validado_tst_em && a.inicio_conferencia && mesDe(a.validado_tst_em) >= filtro.desde)
    .map((a) => ({
      a,
      mes: mesDe(a.validado_tst_em!),
      total: diasUteis(a.inicio_conferencia!, a.validado_tst_em!),
      emais: a.aprovado_admin_em ? diasUteis(a.inicio_conferencia!, a.aprovado_admin_em) : null,
      tst: a.aprovado_admin_em ? diasUteis(a.aprovado_admin_em, a.validado_tst_em!) : null,
    }));
  const ultimo = liberadas.reduce((max, l) => (l.mes > max ? l.mes : max), filtro.desde);
  const meses = mesesEntre(filtro.desde, ultimo).map((mes) => {
    const l = liberadas.filter((x) => x.mes === mes);
    return {
      mes,
      liberacoes: l.length,
      mediaTotal: media(l.map((x) => x.total)),
      mediaEmais: media(l.filter((x) => x.emais !== null).map((x) => x.emais!)),
      mediaTst: media(l.filter((x) => x.tst !== null).map((x) => x.tst!)),
    };
  });
  const porEmpresa = new Map<string, typeof liberadas>();
  liberadas.forEach((l) => porEmpresa.set(l.a.empresa_id, [...(porEmpresa.get(l.a.empresa_id) ?? []), l]));
  const rankingTempo = [...porEmpresa.values()]
    .filter((l) => l.length >= 3)
    .map((l) => ({ empresa_id: l[0].a.empresa_id, empresa: l[0].a.empresa, liberacoes: l.length, mediaDias: media(l.map((x) => x.total))! }));

  // Foto de hoje: liberados com documento obrigatório vencido ou faltando.
  const liberadosHoje = daObra.filter((a) => a.status === 'liberado');
  const idsLiberados = new Set(liberadosHoje.map((a) => a.alocacao_id));
  const comPendenciaIds = new Set(base.pendencias.filter((p) => idsLiberados.has(p.alocacao_id)).map((p) => p.alocacao_id));

  const obras = new Map<string, { obra: string; liberados: number; comPendencia: number }>();
  liberadosHoje.forEach((a) => {
    const o = obras.get(a.obra_id) ?? { obra: a.obra, liberados: 0, comPendencia: 0 };
    o.liberados += 1;
    if (comPendenciaIds.has(a.alocacao_id)) o.comPendencia += 1;
    obras.set(a.obra_id, o);
  });

  const docs = new Map<string, { documento: string; vencido: number; faltando: number; total: number }>();
  base.pendencias
    .filter((p) => idsLiberados.has(p.alocacao_id))
    .forEach((p) => {
      const d = docs.get(p.documento) ?? { documento: p.documento, vencido: 0, faltando: 0, total: 0 };
      if (p.situacao === 'vencido') d.vencido += 1;
      else d.faltando += 1;
      d.total += 1;
      docs.set(p.documento, d);
    });

  const empresas = new Map<string, RankingPendencia>();
  liberadosHoje.forEach((a) => {
    const e = empresas.get(a.empresa_id) ?? { empresa_id: a.empresa_id, empresa: a.empresa, liberados: 0, comPendencia: 0, pct: 0 };
    e.liberados += 1;
    if (comPendenciaIds.has(a.alocacao_id)) e.comPendencia += 1;
    empresas.set(a.empresa_id, e);
  });
  const rankingPendencia = [...empresas.values()].map((e) => ({ ...e, pct: (100 * e.comPendencia) / e.liberados }));

  return {
    meses,
    mediaTotal: media(liberadas.map((x) => x.total)),
    mediaEmais: media(liberadas.filter((x) => x.emais !== null).map((x) => x.emais!)),
    mediaTst: media(liberadas.filter((x) => x.tst !== null).map((x) => x.tst!)),
    liberacoes: liberadas.length,
    rankingTempo,
    liberados: liberadosHoje.length,
    comPendencia: comPendenciaIds.size,
    pctComPendencia: pct(comPendenciaIds.size, liberadosHoje.length),
    porObra: [...obras.values()].map((o) => ({ ...o, pct: (100 * o.comPendencia) / o.liberados })).sort((a, b) => b.pct - a.pct || b.comPendencia - a.comPendencia),
    porDocumento: [...docs.values()].sort((a, b) => b.total - a.total),
    rankingPendencia,
  };
}

export function obrasDaBase(base: BaseIndicadores): { id: string; nome: string }[] {
  const m = new Map<string, string>();
  base.alocacoes.forEach((a) => m.set(a.obra_id, a.obra));
  base.medicoes.forEach((x) => x.obra_id && x.obra && m.set(x.obra_id, x.obra));
  return [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
