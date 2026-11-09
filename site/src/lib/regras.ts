import { supabase } from './supabase';

// Regras da cobrança, editáveis em Acessos > Regras (tabela parametros).
export type Regras = {
  diaLembrete: number; // dia do mês do lembrete da medição
  diaPrazo: number; // dia do mês seguinte em que termina o prazo da medição
  diasTolerancia: number; // dias depois do prazo antes de reter o pagamento
  primeiroAviso: number; // dias antes do vencimento do documento
  segundoAviso: number;
  diasParado: number; // dias úteis com documento parado na integração
};

export const REGRAS_PADRAO: Regras = { diaLembrete: 20, diaPrazo: 25, diasTolerancia: 5, primeiroAviso: 30, segundoAviso: 15, diasParado: 3 };

const CHAVES: Record<keyof Regras, string> = {
  diaLembrete: 'medicao_dia_lembrete',
  diaPrazo: 'prazo_medicao_dia',
  diasTolerancia: 'medicao_dias_tolerancia',
  primeiroAviso: 'dias_a_vencer',
  segundoAviso: 'vencimento_segundo_aviso_dias',
  diasParado: 'integracao_dias_parado',
};

let atuais: Regras = REGRAS_PADRAO;

// As últimas regras lidas (ou as padrão, antes da primeira leitura).
export const regrasAtuais = () => atuais;

export async function lerRegras(): Promise<Regras> {
  const { data, error } = await supabase.from('parametros').select('chave, valor').in('chave', Object.values(CHAVES));
  if (error) throw error;
  const valor = new Map((data ?? []).map((p) => [p.chave as string, Number(p.valor)]));
  const r = { ...REGRAS_PADRAO };
  (Object.keys(CHAVES) as (keyof Regras)[]).forEach((k) => {
    const v = valor.get(CHAVES[k]);
    if (v !== undefined && Number.isFinite(v)) r[k] = v;
  });
  atuais = r;
  return r;
}

function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function ultimoDia(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

// Prazo e tolerância da medição de uma competência ('2026-10-01' -> prazo em novembro).
export function prazoDe(competencia: string, r = atuais): string {
  return `${somarMeses(competencia, 1).slice(0, 8)}${doisDigitos(r.diaPrazo)}`;
}

export function toleranciaDe(competencia: string, r = atuais): string {
  const mes = somarMeses(competencia, 1);
  return `${mes.slice(0, 8)}${doisDigitos(Math.min(r.diaPrazo + r.diasTolerancia, ultimoDia(mes)))}`;
}

// ---------------------------------------------------------------- Tela de regras

export type TipoRegra = 'inteiro' | 'texto' | 'email' | 'sim_nao' | 'empresas' | 'lista';

export type Parametro = {
  chave: string;
  valor: string;
  descricao: string | null;
  rotulo: string | null;
  grupo: string | null;
  tipo: TipoRegra;
  minimo: number | null;
  maximo: number | null;
  unidade: string | null;
  ordem: number;
};

export type MudancaRegra = { chave: string; valor_anterior: string | null; valor_novo: string | null; alterado_em: string; quem: string };

export type ValidadeDocumento = { codigo: string; nome: string; grupo: string; area: string | null; validade_dias: number; ordem: number };

export type MudancaValidade = { codigo: string; valor_anterior: string | null; valor_novo: string | null; motivo: string | null; alterado_em: string; quem: string };

async function nomesDeUsuarios(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const { data, error } = await supabase.from('usuarios').select('id, nome').in('id', unicos);
  if (error) throw error;
  return new Map((data ?? []).map((u) => [u.id as string, u.nome as string]));
}

export async function lerParametros(): Promise<Parametro[]> {
  const { data, error } = await supabase.from('parametros').select('chave, valor, descricao, rotulo, grupo, tipo, minimo, maximo, unidade, ordem').not('grupo', 'is', null).order('ordem');
  if (error) throw error;
  return (data ?? []) as Parametro[];
}

export async function lerHistoricoRegras(): Promise<MudancaRegra[]> {
  const { data, error } = await supabase.from('parametros_historico').select('chave, valor_anterior, valor_novo, alterado_por, alterado_em').order('alterado_em', { ascending: false }).limit(300);
  if (error) throw error;
  const nomes = await nomesDeUsuarios((data ?? []).map((h) => h.alterado_por as string | null));
  return (data ?? []).map((h) => ({ ...(h as Omit<MudancaRegra, 'quem'>), quem: nomes.get(h.alterado_por as string) ?? 'Sistema' }));
}

export async function salvarParametro(chave: string, valor: string) {
  const { error } = await supabase.from('parametros').update({ valor: valor.trim() }).eq('chave', chave);
  if (error) throw error;
}

export async function lerValidades(): Promise<ValidadeDocumento[]> {
  const { data, error } = await supabase
    .from('tipos_documento')
    .select('codigo, nome, grupo, area, validade_dias, ordem')
    .eq('ativo', true)
    .eq('regra', 'emissao_mais_prazo')
    .not('validade_dias', 'is', null)
    .order('ordem');
  if (error) throw error;
  return (data ?? []) as ValidadeDocumento[];
}

export async function lerHistoricoValidades(): Promise<MudancaValidade[]> {
  const { data, error } = await supabase
    .from('tipos_documento_historico')
    .select('codigo, valor_anterior, valor_novo, motivo, alterado_por, alterado_em')
    .eq('campo', 'validade_dias')
    .order('alterado_em', { ascending: false })
    .limit(300);
  if (error) throw error;
  const nomes = await nomesDeUsuarios((data ?? []).map((h) => h.alterado_por as string | null));
  return (data ?? []).map((h) => ({ ...(h as Omit<MudancaValidade, 'quem'>), quem: nomes.get(h.alterado_por as string) ?? 'Sistema' }));
}

export async function salvarValidade(codigo: string, dias: number, motivo: string) {
  const { error } = await supabase.rpc('alterar_tipo_documento', { p_codigo: codigo, p_validade_dias: dias, p_impeditivo: null, p_motivo: motivo.trim() });
  if (error) throw error;
}
