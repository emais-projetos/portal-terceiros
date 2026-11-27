import { supabase } from './supabase';

// Tipos de fornecedor (mão de obra, locação, serviço técnico, material...). Cada tipo diz se o fornecedor
// põe colaboradores na obra e se entrega o mensal trabalhista; cada documento da homologação vale para um ou mais tipos.

export type TipoFornecedor = {
  codigo: string;
  nome: string;
  descricao: string | null;
  colaboradores: boolean;
  mensal: boolean;
  ordem: number;
  personalizado: boolean;
  ativo: boolean;
};

export type TipoFornecedorResumo = TipoFornecedor & { fornecedores: number; documentos: number; obrigatorios: number };

// Nomes curtos para as colunas e etiquetas (os tipos incluídos pelo Suprimentos usam o nome inteiro).
export const NOME_CURTO: Record<string, string> = {
  mao_de_obra: 'Mão de obra',
  locacao_com_operador: 'Locação c/ operador',
  servico_tecnico: 'Serviço técnico',
  locacao_sem_operador: 'Locação s/ operador',
  material: 'Material',
};

let cache: TipoFornecedor[] | null = null;

export async function lerTiposFornecedor(novo = false): Promise<TipoFornecedor[]> {
  if (cache && !novo) return cache;
  const { data, error } = await supabase.from('tipos_fornecedor').select('*').eq('ativo', true).order('ordem');
  if (error) throw error;
  cache = (data ?? []) as TipoFornecedor[];
  return cache;
}

export async function lerResumoTipos(): Promise<TipoFornecedorResumo[]> {
  const { data, error } = await supabase.rpc('lista_tipos_fornecedor');
  if (error) throw error;
  cache = null;
  return (data ?? []) as TipoFornecedorResumo[];
}

export function nomeCurto(t: Pick<TipoFornecedor, 'codigo' | 'nome'>): string {
  return NOME_CURTO[t.codigo] ?? t.nome;
}

// "Mão de obra, Material" a partir dos códigos.
export function nomesDosTipos(codigos: string[] | null | undefined, tipos: TipoFornecedor[], curto = true): string {
  const lista = codigos?.length ? codigos : ['mao_de_obra'];
  return lista
    .map((c) => tipos.find((t) => t.codigo === c))
    .filter((t): t is TipoFornecedor => !!t)
    .map((t) => (curto ? nomeCurto(t) : t.nome))
    .join(', ');
}

export async function salvarTipoFornecedor(dados: { codigo: string | null; nome: string; descricao: string; colaboradores: boolean; mensal: boolean; copiarDe?: string | null }) {
  const { data, error } = await supabase.rpc('salvar_tipo_fornecedor', {
    p_codigo: dados.codigo, p_nome: dados.nome, p_descricao: dados.descricao || null, p_colaboradores: dados.colaboradores, p_mensal: dados.mensal,
    p_copiar_de: dados.copiarDe ?? null,
  });
  cache = null;
  if (error) throw error;
  return data as string;
}

export async function removerTipoFornecedor(codigo: string) {
  const { error } = await supabase.rpc('remover_tipo_fornecedor', { p_codigo: codigo });
  cache = null;
  if (error) throw error;
}

export async function definirTiposFornecedor(empresaId: string, tipos: string[]) {
  const { error } = await supabase.rpc('definir_tipos_fornecedor', { p_empresa: empresaId, p_tipos: tipos });
  if (error) throw error;
}
