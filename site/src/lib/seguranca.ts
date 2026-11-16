import { supabase } from './supabase';

// Segurança da obra: máquinas (ficha mensal), alojamentos (vistoria NR-18) e locadoras de equipamentos.
// As regras de quem vê e quem altera estão no banco (migrações 032 a 034).

export type Fornecedor = { id: string; nome: string; ativo_na_obra: boolean };
export type Locadora = { id: string; nome: string; cnpj: string | null; telefone: string | null; ativo: boolean };
export type Modelo = { codigo: string; grupo: 'maquina' | 'alojamento' | 'canteiro'; nome: string; itens: string[] };

export type DiaFicha = {
  statuses: ('ok' | 'nc' | 'na' | null)[];
  operador: string;
  observacao: string;
  fotos: string[];
  assinatura: string | null;
};
export type Ficha = {
  id: string;
  maquina_id: string;
  competencia: string;
  itens: string[];
  dias: Record<string, DiaFicha>;
  fechamento: { operador_nome: string; tst_nome: string } | null;
  fechada_em: string | null;
  origem: string;
};
export type Maquina = {
  id: string;
  obra_id: string;
  modelo_codigo: string;
  identificacao: string;
  empresa_id: string | null;
  locadora_id: string | null;
  empresa_a_vincular: string | null;
  ativo: boolean;
  fichas: Pick<Ficha, 'id' | 'competencia' | 'fechada_em'>[];
};

export type ItemVistoria = { texto: string; status: 'sim' | 'nao' | 'na' | null; recomendacao: string; prazo: string | null; fotos: string[] };
export type Pessoa = { nome: string; cargo?: string; assinatura: string | null };
export type Vistoria = {
  id: string;
  alojamento_id: string | null;
  data_vistoria: string;
  horario: string | null;
  qtd_funcionarios: number | null;
  itens: ItemVistoria[];
  funcionarios: Pessoa[];
  envolvidos: Pessoa[];
  pontuacao: number | null;
  classificacao: string | null;
  situacao: 'rascunho' | 'concluida';
  concluida_em: string | null;
  fotos_expiram_em: string | null;
  fotos_excluidas_em: string | null;
  origem: string;
};
export type NaoConformidade = { id: string; vistoria_id: string; situacao: 'aberta' | 'respondida' | 'regularizada' | 'reaberta'; prazo: string };
export type Alojamento = {
  id: string;
  obra_id: string;
  nome: string;
  endereco: string | null;
  empresa_id: string | null;
  empresa_a_vincular: string | null;
  ativo: boolean;
  vistorias: Pick<Vistoria, 'id' | 'data_vistoria' | 'classificacao' | 'situacao'>[];
};

export const NOMES_STATUS_VISTORIA = { sim: 'Sim', nao: 'Não', na: 'Não se aplica' } as const;
export const NOMES_STATUS_FICHA = { ok: 'Conforme', nc: 'Não conforme', na: 'Não se aplica' } as const;

export async function lerModelos(): Promise<Modelo[]> {
  const { data, error } = await supabase.from('seg_modelos').select('codigo, grupo, nome, itens').eq('ativo', true).order('ordem');
  if (error) throw error;
  return (data ?? []) as Modelo[];
}

export async function lerFornecedoresDaObra(obraId: string): Promise<Fornecedor[]> {
  const { data, error } = await supabase.rpc('seg_fornecedores_obra', { p_obra: obraId });
  if (error) throw error;
  return (data ?? []) as Fornecedor[];
}

export async function lerLocadoras(): Promise<Locadora[]> {
  const { data, error } = await supabase.from('seg_locadoras').select('id, nome, cnpj, telefone, ativo').order('nome');
  if (error) throw error;
  return (data ?? []) as Locadora[];
}

export async function salvarLocadora(l: { id?: string; nome: string; cnpj: string; telefone: string; ativo?: boolean }): Promise<Locadora> {
  const linha = { nome: l.nome.trim(), cnpj: l.cnpj.trim() || null, telefone: l.telefone.trim() || null, ativo: l.ativo ?? true };
  const consulta = l.id
    ? supabase.from('seg_locadoras').update(linha).eq('id', l.id)
    : supabase.from('seg_locadoras').insert(linha);
  const { data, error } = await consulta.select('id, nome, cnpj, telefone, ativo').single();
  if (error) {
    if (error.code === '23505') throw new Error('Já existe uma locadora com esse nome.');
    throw error;
  }
  return data as Locadora;
}

export async function lerMaquinas(obraId: string): Promise<Maquina[]> {
  const { data, error } = await supabase
    .from('seg_maquinas')
    .select('id, obra_id, modelo_codigo, identificacao, empresa_id, locadora_id, empresa_a_vincular, ativo, fichas:seg_fichas_maquina(id, competencia, fechada_em)')
    .eq('obra_id', obraId)
    .order('identificacao');
  if (error) throw error;
  return (data ?? []) as Maquina[];
}

export async function lerFicha(id: string): Promise<Ficha> {
  const { data, error } = await supabase
    .from('seg_fichas_maquina')
    .select('id, maquina_id, competencia, itens, dias, fechamento, fechada_em, origem')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Ficha;
}

export async function lerAlojamentos(obraId: string): Promise<Alojamento[]> {
  const { data, error } = await supabase
    .from('seg_alojamentos')
    .select('id, obra_id, nome, endereco, empresa_id, empresa_a_vincular, ativo, vistorias:seg_vistorias(id, data_vistoria, classificacao, situacao)')
    .eq('obra_id', obraId)
    .order('nome');
  if (error) throw error;
  return ((data ?? []) as Alojamento[]).map((a) => ({
    ...a,
    vistorias: [...a.vistorias].sort((x, y) => y.data_vistoria.localeCompare(x.data_vistoria)),
  }));
}

export async function lerNaoConformidadesDaObra(alojamentos: string[]): Promise<NaoConformidade[]> {
  if (!alojamentos.length) return [];
  const { data, error } = await supabase
    .from('seg_nao_conformidades')
    .select('id, vistoria_id, situacao, prazo, seg_vistorias!inner(alojamento_id)')
    .in('seg_vistorias.alojamento_id', alojamentos);
  if (error) throw error;
  return (data ?? []) as unknown as NaoConformidade[];
}

export async function lerVistoria(id: string): Promise<Vistoria> {
  const { data, error } = await supabase
    .from('seg_vistorias')
    .select('id, alojamento_id, data_vistoria, horario, qtd_funcionarios, itens, funcionarios, envolvidos, pontuacao, classificacao, situacao, concluida_em, fotos_expiram_em, fotos_excluidas_em, origem')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Vistoria;
}

// Responsável pela máquina: fornecedor da obra, locadora ou Emais (os dois vazios). Escolher tira a pendência
// da importação (o banco limpa empresa_a_vincular quando há fornecedor ou locadora).
export type Responsavel = { tipo: 'emais' } | { tipo: 'fornecedor'; id: string } | { tipo: 'locadora'; id: string };

export async function salvarMaquina(id: string, identificacao: string, r: Responsavel, ativo: boolean) {
  const { error } = await supabase
    .from('seg_maquinas')
    .update({
      identificacao: identificacao.trim(),
      empresa_id: r.tipo === 'fornecedor' ? r.id : null,
      locadora_id: r.tipo === 'locadora' ? r.id : null,
      empresa_a_vincular: null,
      ativo,
    })
    .eq('id', id);
  if (error) {
    if (error.code === '23505') throw new Error('Já existe uma máquina desse tipo com essa identificação nesta obra.');
    throw error;
  }
}

export async function salvarAlojamento(id: string, campos: { nome: string; endereco: string; empresaId: string | null; ativo: boolean }) {
  const { error } = await supabase
    .from('seg_alojamentos')
    .update({ nome: campos.nome.trim(), endereco: campos.endereco.trim() || null, empresa_id: campos.empresaId, empresa_a_vincular: null, ativo: campos.ativo })
    .eq('id', id);
  if (error) {
    if (error.code === '23505') throw new Error('Já existe um alojamento com esse nome nesta obra.');
    throw error;
  }
}

// Fotos e assinaturas ficam na pasta privada "seguranca"; o link vale por 10 minutos.
export async function linksDosArquivos(caminhos: string[]): Promise<Record<string, string>> {
  const unicos = [...new Set(caminhos.filter(Boolean))];
  if (!unicos.length) return {};
  const { data, error } = await supabase.storage.from('seguranca').createSignedUrls(unicos, 600);
  if (error) throw error;
  const saida: Record<string, string> = {};
  (data ?? []).forEach((d) => {
    if (d.path && d.signedUrl) saida[d.path] = d.signedUrl;
  });
  return saida;
}

export function competencia(iso: string): string {
  const [a, m] = iso.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m) - 1]}/${a}`;
}
