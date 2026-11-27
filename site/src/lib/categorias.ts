import { supabase } from './supabase';

// Categorias de serviço: lista padrão mantida pelo Suprimentos em Configuração. O fornecedor escolhe no F.31.

export type CategoriaServico = { codigo: string; nome: string; ordem: number; ativo: boolean };
export type CategoriaResumo = { codigo: string; nome: string; ordem: number; fornecedores: number };

let cache: CategoriaServico[] | null = null;

export async function lerCategorias(novo = false): Promise<CategoriaServico[]> {
  if (cache && !novo) return cache;
  const { data, error } = await supabase.from('categorias_servico').select('codigo, nome, ordem, ativo').eq('ativo', true).order('nome');
  if (error) throw error;
  cache = (data ?? []) as CategoriaServico[];
  return cache;
}

export async function lerResumoCategorias(): Promise<CategoriaResumo[]> {
  const { data, error } = await supabase.rpc('lista_categorias_servico');
  if (error) throw error;
  cache = null;
  return (data ?? []) as CategoriaResumo[];
}

export function nomesDasCategorias(codigos: string[] | null | undefined, lista: CategoriaServico[]): string {
  return (codigos ?? [])
    .map((c) => lista.find((x) => x.codigo === c)?.nome)
    .filter(Boolean)
    .join(', ');
}

export async function salvarCategoria(codigo: string | null, nome: string) {
  const { error } = await supabase.rpc('salvar_categoria_servico', { p_codigo: codigo, p_nome: nome });
  cache = null;
  if (error) throw error;
}

export async function removerCategoria(codigo: string): Promise<number> {
  const { data, error } = await supabase.rpc('remover_categoria_servico', { p_codigo: codigo });
  cache = null;
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function definirCategoriasFornecedor(empresaId: string, categorias: string[]) {
  const { error } = await supabase.rpc('definir_categorias_fornecedor', { p_empresa: empresaId, p_categorias: categorias });
  if (error) throw error;
}
