import { supabase } from './supabase';
import { diasAte, hojeIso } from './formato';
import type { StatusAlocacao } from './consultas';
import type { StatusMedicao } from './medicao';
import { prazoDe, toleranciaDe } from './regras';

// Painel de acompanhamento da obra (engenharia, TST, administrativo e, só com as próprias empresas, fornecedor). Só leitura.
// Os dados vêm de uma função do banco que confere a obra do acesso e não devolve CPF nem arquivos.

export type PendenciaDoc = {
  documento: string;
  grupo?: 'empresa' | 'colaborador' | 'obra';
  situacao: 'nao_enviado' | 'devolvido' | 'vencido' | 'em_analise';
  vencimento: string | null;
};

export type ColaboradorObra = {
  alocacao_id: string;
  colaborador: string;
  funcao: string | null;
  empresa_id: string;
  empresa: string;
  status: StatusAlocacao;
  data_integracao: string | null;
  vencimento_integracao: string | null;
  liberado_em: string | null;
  bloqueado?: boolean;
  bloqueio_motivo?: string | null;
  pendencias: PendenciaDoc[];
  a_vencer: { documento: string; grupo?: 'empresa' | 'colaborador' | 'obra'; vencimento: string }[];
};

export type MedicaoObra = {
  id: string;
  empresa_id: string;
  empresa: string;
  cnpj: string;
  obra: string | null; // vazio nas medições da planilha (março a agosto de 2026)
  origem: 'portal' | 'migracao';
  competencia: string;
  prazo: string;
  tolerancia: string;
  status: StatusMedicao;
  retida: boolean;
  em_atraso: boolean;
  prazo_combinado: string | null;
  primeiro_envio_em: string | null;
  ultima_analise_em: string | null;
  itens_pendentes: string[];
};

export type TurmaObra = {
  id: string;
  data: string;
  horario: string | null;
  local: string | null;
  responsavel: string;
  concluida_em: string | null;
  participantes: number;
  presentes: number;
};

export type PainelObra = { obra: string; colaboradores: ColaboradorObra[]; medicoes: MedicaoObra[]; integracoes: TurmaObra[] };

export type SituacaoObra = 'ativa' | 'em_encerramento' | 'encerrada';
export type ObraDoPainel = { id: string; nome: string; situacao: SituacaoObra };

export async function lerObrasDoPainel(): Promise<ObraDoPainel[]> {
  const { data, error } = await supabase.rpc('painel_obras');
  if (error) throw error;
  return (data ?? []) as ObraDoPainel[];
}

export async function lerPainelObra(obraId: string): Promise<PainelObra> {
  const { data, error } = await supabase.rpc('painel_obra', { p_obra: obraId });
  if (error) throw error;
  return data as PainelObra;
}

// ---------------------------------------------------------------- Regras de leitura

export const DIAS_AVISO_INTEGRACAO = 30;

export type SituacaoIntegracao = 'em_dia' | 'vencendo' | 'vencida' | 'sem';

export function situacaoIntegracao(c: Pick<ColaboradorObra, 'data_integracao' | 'vencimento_integracao'>): SituacaoIntegracao {
  if (!c.data_integracao || !c.vencimento_integracao) return 'sem';
  const d = diasAte(c.vencimento_integracao);
  if (d <= 0) return 'vencida';
  if (d <= DIAS_AVISO_INTEGRACAO) return 'vencendo';
  return 'em_dia';
}

export type Pagamento = { acao: 'liberar' | 'reter' | 'aguardar'; motivo: string; ate?: string };

// O que a engenharia faz com o pagamento da empresa no mês.
export function pagamentoDe(m: Pick<MedicaoObra, 'status' | 'prazo' | 'tolerancia' | 'prazo_combinado'> | null, competencia: string, hoje = hojeIso()): Pagamento {
  if (m?.status === 'aprovada') return { acao: 'liberar', motivo: 'Medição aprovada' };
  const prazo = m?.prazo ?? prazoDe(competencia);
  const tolerancia = m?.tolerancia ?? toleranciaDe(competencia);
  const limite = m?.prazo_combinado && m.prazo_combinado > tolerancia ? m.prazo_combinado : tolerancia;
  if (m?.status === 'em_analise') return { acao: 'aguardar', motivo: 'Em conferência na Emais' };
  if (hoje > limite) return { acao: 'reter', motivo: m ? 'Medição não aprovada' : 'Medição não enviada' };
  if (m?.prazo_combinado && m.prazo_combinado > tolerancia) return { acao: 'aguardar', motivo: 'Data combinada com o fornecedor', ate: m.prazo_combinado };
  if (hoje > prazo) return { acao: 'aguardar', motivo: 'Em atraso, dentro da tolerância', ate: tolerancia };
  return { acao: 'aguardar', motivo: 'Dentro do prazo de entrega', ate: prazo };
}

function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

// Prazo e tolerância seguem as Regras (Acessos > Regras).
export { prazoDe, toleranciaDe };

// Primeiro mês com medição feita no portal. Antes disso só há o histórico da planilha,
// então uma empresa sem medição nesses meses não aparece como "não enviada".
export const INICIO_MEDICAO_PORTAL = '2026-09-01';

// Meses para escolher no painel: os que têm medição na obra e o mês anterior ao atual.
export function mesesDoPainel(medicoes: MedicaoObra[], hoje = hojeIso()): string[] {
  const anterior = somarMeses(`${hoje.slice(0, 7)}-01`, -1);
  return [...new Set([anterior, ...medicoes.map((m) => m.competencia)])].sort().reverse();
}
