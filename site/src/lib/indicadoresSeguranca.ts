import { supabase } from './supabase';
import { hojeIso, somarDias } from './formato';
import type { Alojamento, Fornecedor, Maquina, NaoConformidade } from './seguranca';

// Indicadores de conformidade da Segurança da obra.
// Conformidade = itens "Sim" (ou "Conforme") ÷ itens aplicáveis ("Sim" + "Não"); "Não se aplica" fica fora.
// É a mesma regra da nota da vistoria (planilha NR-18). No período, soma os itens de todas as inspeções.

export type VistoriaIndicador = {
  id: string;
  obra_id: string;
  alojamento_id: string | null;
  data_vistoria: string;
  situacao: 'rascunho' | 'concluida';
  itens: { texto: string; status: 'sim' | 'nao' | 'na' | null }[];
};
export type FichaIndicador = { id: string; maquina_id: string; competencia: string; itens: string[]; dias: Record<string, { statuses: ('ok' | 'nc' | 'na' | null)[] }> };

// Uma obra ou várias (aba Inspeções com "Todas as obras").
export async function lerDadosIndicadores(obras: string | string[], desde: string) {
  const ids = Array.isArray(obras) ? obras : [obras];
  const [v, f] = await Promise.all([
    supabase
      .from('seg_vistorias')
      .select('id, obra_id, alojamento_id, data_vistoria, situacao, itens')
      .in('obra_id', ids)
      .gte('data_vistoria', desde),
    supabase
      .from('seg_fichas_maquina')
      .select('id, maquina_id, competencia, itens, dias, seg_maquinas!inner(obra_id)')
      .in('seg_maquinas.obra_id', ids)
      .gte('competencia', `${desde.slice(0, 7)}-01`),
  ]);
  if (v.error) throw v.error;
  if (f.error) throw f.error;
  return { vistorias: (v.data ?? []) as VistoriaIndicador[], fichas: (f.data ?? []) as unknown as FichaIndicador[] };
}

type Conta = { sim: number; aplicaveis: number };
const nova = (): Conta => ({ sim: 0, aplicaveis: 0 });
const pct = (c: Conta) => (c.aplicaveis ? (100 * c.sim) / c.aplicaveis : null);
function somarVistoria(c: Conta, v: VistoriaIndicador) {
  v.itens.forEach((i) => {
    if (i.status === 'sim' || i.status === 'nao') c.aplicaveis++;
    if (i.status === 'sim') c.sim++;
  });
}

export function classificar(p: number | null): string {
  if (p === null) return 'sem dado';
  const f = p / 100;
  return f <= 0.3 ? 'Péssimo' : f <= 0.5 ? 'Ruim' : f <= 0.7 ? 'Regular' : f < 1 ? 'Bom' : 'Ótimo';
}

function mesesAte(desde: string): string[] {
  const meses: string[] = [];
  const [a0, m0] = desde.split('-').map(Number);
  const [a1, m1] = hojeIso().split('-').map(Number);
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, (m = 1)) : m++) meses.push(`${a}-${String(m).padStart(2, '0')}`);
  return meses;
}

export function indicadoresAlojamento(
  vistorias: VistoriaIndicador[],
  alojamentos: Alojamento[],
  fornecedores: Fornecedor[],
  ncs: NaoConformidade[],
  desde: string,
) {
  const concluidas = vistorias.filter((v) => v.situacao === 'concluida' && v.alojamento_id);
  const total = nova();
  concluidas.forEach((v) => somarVistoria(total, v));

  const porMes = new Map<string, Conta & { qtd: number }>();
  concluidas.forEach((v) => {
    const k = v.data_vistoria.slice(0, 7);
    const c = porMes.get(k) ?? { ...nova(), qtd: 0 };
    somarVistoria(c, v);
    c.qtd++;
    porMes.set(k, c);
  });

  const aloj = new Map(alojamentos.map((a) => [a.id, a]));
  // Por alojamento: a última vistoria concluída no período (retrato atual de cada um).
  const ultima = new Map<string, VistoriaIndicador>();
  [...concluidas].sort((a, b) => a.data_vistoria.localeCompare(b.data_vistoria)).forEach((v) => ultima.set(v.alojamento_id!, v));
  const porAlojamento = [...ultima.entries()]
    .map(([id, v]) => {
      const c = nova();
      somarVistoria(c, v);
      return { id, nome: aloj.get(id)?.nome ?? 'Alojamento', data: v.data_vistoria, pct: pct(c) ?? 0 };
    })
    .sort((a, b) => a.pct - b.pct);

  // Por responsável: média ponderada pelos itens, todas as vistorias do período.
  const porResp = new Map<string, Conta & { qtd: number }>();
  concluidas.forEach((v) => {
    const a = aloj.get(v.alojamento_id!);
    const nome = a?.empresa_id ? fornecedores.find((f) => f.id === a.empresa_id)?.nome ?? 'Fornecedor' : a?.empresa_a_vincular ? 'A vincular' : 'Emais';
    const c = porResp.get(nome) ?? { ...nova(), qtd: 0 };
    somarVistoria(c, v);
    c.qtd++;
    porResp.set(nome, c);
  });

  // Perguntas com mais "Não".
  const naos = new Map<string, number>();
  concluidas.forEach((v) => v.itens.forEach((i) => i.status === 'nao' && naos.set(i.texto, (naos.get(i.texto) ?? 0) + 1)));

  const ativos = alojamentos.filter((a) => a.ativo);
  const vistoriados = new Set(concluidas.map((v) => v.alojamento_id));
  const limite30 = somarDias(hojeIso(), -30);
  const semVistoria30 = ativos.filter((a) => !a.vistorias.some((v) => v.situacao === 'concluida' && v.data_vistoria >= limite30)).length;
  const abertas = ncs.filter((n) => n.situacao === 'aberta' || n.situacao === 'reaberta');

  return {
    conformidade: pct(total),
    concluidas: concluidas.length,
    emAndamento: vistorias.filter((v) => v.situacao === 'rascunho' && v.alojamento_id).length,
    ativos: ativos.length,
    vistoriados: ativos.filter((a) => vistoriados.has(a.id)).length,
    semVistoria30,
    ncsAbertas: abertas.length,
    ncsVencidas: abertas.filter((n) => n.prazo < hojeIso()).length,
    ncsParaAvaliar: ncs.filter((n) => n.situacao === 'respondida').length,
    meses: mesesAte(desde).map((m) => {
      const c = porMes.get(m);
      return { mes: m, pct: c ? pct(c) : null, qtd: c?.qtd ?? 0, sim: c?.sim ?? 0, aplicaveis: c?.aplicaveis ?? 0 };
    }),
    porAlojamento,
    porResponsavel: [...porResp.entries()].map(([nome, c]) => ({ nome, pct: pct(c) ?? 0, qtd: c.qtd })).sort((a, b) => a.pct - b.pct),
    maisReprovadas: [...naos.entries()].map(([texto, qtd]) => ({ texto, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 6),
  };
}

export function indicadoresMaquinas(fichas: FichaIndicador[], maquinas: Maquina[], desde: string) {
  const total = nova();
  const nc = new Map<string, number>();
  const porMes = new Map<string, Conta & { dias: number; nc: number }>();
  let dias = 0;
  fichas.forEach((f) => {
    const k = f.competencia.slice(0, 7);
    const c = porMes.get(k) ?? { ...nova(), dias: 0, nc: 0 };
    Object.entries(f.dias).forEach(([d, dia]) => {
      if (`${k}-${d}` < desde) return;
      dias++;
      c.dias++;
      dia.statuses.forEach((s, i) => {
        if (s === 'ok' || s === 'nc') {
          total.aplicaveis++;
          c.aplicaveis++;
        }
        if (s === 'ok') {
          total.sim++;
          c.sim++;
        }
        if (s === 'nc') {
          c.nc++;
          nc.set(f.itens[i], (nc.get(f.itens[i]) ?? 0) + 1);
        }
      });
    });
    porMes.set(k, c);
  });
  const mesAtual = hojeIso().slice(0, 7);
  const ativas = maquinas.filter((m) => m.ativo);
  const comChecklistNoMes = new Set(fichas.filter((f) => f.competencia.startsWith(mesAtual) && Object.keys(f.dias).length > 0).map((f) => f.maquina_id));
  return {
    conformidade: pct(total),
    dias,
    ativas: ativas.length,
    comChecklistNoMes: ativas.filter((m) => comChecklistNoMes.has(m.id)).length,
    naoConformes: [...nc.values()].reduce((a, b) => a + b, 0),
    meses: mesesAte(desde).map((m) => {
      const c = porMes.get(m);
      return { mes: m, pct: c ? pct(c) : null, dias: c?.dias ?? 0, nc: c?.nc ?? 0 };
    }),
    maisReprovadas: [...nc.entries()].map(([texto, qtd]) => ({ texto, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 5),
  };
}

// Metas de Regras > Segurança da obra (padrão 90% alojamento e 85% canteiro).
export async function lerMetas(): Promise<{ alojamento: number; canteiro: number }> {
  const { data, error } = await supabase.from('parametros').select('chave, valor').in('chave', ['seg_meta_alojamento', 'seg_meta_canteiro']);
  if (error) throw error;
  const p = new Map((data ?? []).map((x) => [x.chave as string, Number(x.valor)]));
  return { alojamento: p.get('seg_meta_alojamento') || 90, canteiro: p.get('seg_meta_canteiro') || 85 };
}

// Canteiro: vistorias sem alojamento.
export function indicadoresCanteiro(vistorias: VistoriaIndicador[], desde: string) {
  const concluidas = vistorias.filter((v) => v.situacao === 'concluida' && !v.alojamento_id);
  const total = nova();
  concluidas.forEach((v) => somarVistoria(total, v));
  const porMes = new Map<string, Conta & { qtd: number }>();
  concluidas.forEach((v) => {
    const k = v.data_vistoria.slice(0, 7);
    const c = porMes.get(k) ?? { ...nova(), qtd: 0 };
    somarVistoria(c, v);
    c.qtd++;
    porMes.set(k, c);
  });
  const naos = new Map<string, number>();
  concluidas.forEach((v) => v.itens.forEach((i) => i.status === 'nao' && naos.set(i.texto, (naos.get(i.texto) ?? 0) + 1)));
  const ultima = [...concluidas].sort((a, b) => b.data_vistoria.localeCompare(a.data_vistoria))[0];
  return {
    conformidade: pct(total),
    concluidas: concluidas.length,
    emAndamento: vistorias.filter((v) => v.situacao === 'rascunho' && !v.alojamento_id).length,
    ultima: ultima?.data_vistoria ?? null,
    meses: mesesAte(desde).map((m) => {
      const c = porMes.get(m);
      return { mes: m, pct: c ? pct(c) : null, qtd: c?.qtd ?? 0, sim: c?.sim ?? 0, aplicaveis: c?.aplicaveis ?? 0 };
    }),
    maisReprovadas: [...naos.entries()].map(([texto, qtd]) => ({ texto, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 6),
  };
}
