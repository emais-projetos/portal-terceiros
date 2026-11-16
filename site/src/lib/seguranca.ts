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
  fechamento: { operador_nome: string; tst_nome: string; operador_assinatura?: string | null; tst_assinatura?: string | null } | null;
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
export type Pessoa = { colaborador_id?: string | null; nome: string; cargo?: string; assinatura: string | null };
export type Vistoria = {
  id: string;
  obra_id: string;
  modelo_codigo: string;
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
  vistorias: Pick<Vistoria, 'id' | 'data_vistoria' | 'classificacao' | 'situacao' | 'fotos_expiram_em' | 'fotos_excluidas_em'>[];
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
    .select('id, obra_id, nome, endereco, empresa_id, empresa_a_vincular, ativo, vistorias:seg_vistorias(id, data_vistoria, classificacao, situacao, fotos_expiram_em, fotos_excluidas_em)')
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
    .select('id, obra_id, modelo_codigo, alojamento_id, data_vistoria, horario, qtd_funcionarios, itens, funcionarios, envolvidos, pontuacao, classificacao, situacao, concluida_em, fotos_expiram_em, fotos_excluidas_em, origem')
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

// ---------------------------------------------------------------- Preenchimento (TST e administrativo)

export type AlojamentoComObra = Omit<Alojamento, 'vistorias'> & { obra: { nome: string } };
export type MaquinaComObra = Omit<Maquina, 'fichas'> & { obra: { nome: string } };

export async function lerAlojamento(id: string): Promise<AlojamentoComObra> {
  const { data, error } = await supabase
    .from('seg_alojamentos')
    .select('id, obra_id, nome, endereco, empresa_id, empresa_a_vincular, ativo, obra:obras(nome)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as AlojamentoComObra;
}

export async function lerMaquina(id: string): Promise<MaquinaComObra> {
  const { data, error } = await supabase
    .from('seg_maquinas')
    .select('id, obra_id, modelo_codigo, identificacao, empresa_id, locadora_id, empresa_a_vincular, ativo, obra:obras(nome)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as MaquinaComObra;
}

export async function criarAlojamento(c: { obraId: string; nome: string; endereco: string; empresaId: string | null }): Promise<string> {
  const { data, error } = await supabase
    .from('seg_alojamentos')
    .insert({ obra_id: c.obraId, nome: c.nome.trim(), endereco: c.endereco.trim() || null, empresa_id: c.empresaId })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('Já existe um alojamento com esse nome nesta obra.');
    throw error;
  }
  return data.id as string;
}

export async function criarMaquina(c: { obraId: string; modelo: string; identificacao: string; responsavel: Responsavel }): Promise<string> {
  const { data, error } = await supabase
    .from('seg_maquinas')
    .insert({
      obra_id: c.obraId,
      modelo_codigo: c.modelo,
      identificacao: c.identificacao.trim(),
      empresa_id: c.responsavel.tipo === 'fornecedor' ? c.responsavel.id : null,
      locadora_id: c.responsavel.tipo === 'locadora' ? c.responsavel.id : null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('Esta máquina já está cadastrada na obra. Escolha na lista.');
    throw error;
  }
  return data.id as string;
}

export async function criarVistoria(c: { obraId: string; alojamentoId: string; modelo: Modelo; data: string; horario: string; tst: string }): Promise<string> {
  const { data, error } = await supabase
    .from('seg_vistorias')
    .insert({
      modelo_codigo: c.modelo.codigo,
      obra_id: c.obraId,
      alojamento_id: c.alojamentoId,
      data_vistoria: c.data,
      horario: c.horario || null,
      itens: c.modelo.itens.map((texto) => ({ texto, status: null, recomendacao: '', prazo: null, fotos: [] })),
      envolvidos: [{ nome: c.tst, cargo: 'Técnico de Segurança do Trabalho', assinatura: null }],
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export type CamposVistoria = Pick<Vistoria, 'data_vistoria' | 'horario' | 'qtd_funcionarios' | 'itens' | 'funcionarios' | 'envolvidos'>;

export async function gravarVistoria(id: string, c: CamposVistoria) {
  const { error, count } = await supabase
    .from('seg_vistorias')
    .update({ data_vistoria: c.data_vistoria, horario: c.horario || null, qtd_funcionarios: c.qtd_funcionarios, itens: c.itens, funcionarios: c.funcionarios, envolvidos: c.envolvidos }, { count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('A vistoria não está mais em edição. Recarregue a página.');
}

export async function concluirVistoria(id: string): Promise<{ classificacao: string | null }> {
  const { data, error } = await supabase.rpc('concluir_vistoria_seg', { p_vistoria: id });
  if (error) throw error;
  return data as { classificacao: string | null };
}

export async function reabrirVistoria(id: string, motivo: string) {
  const { error } = await supabase.rpc('reabrir_vistoria_seg', { p_vistoria: id, p_motivo: motivo });
  if (error) throw error;
}

export async function excluirRascunho(id: string) {
  const { error, count } = await supabase.from('seg_vistorias').delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('Só dá para excluir vistoria em edição.');
}

export async function abrirFicha(maquinaId: string, dia: string): Promise<string> {
  const { data, error } = await supabase.rpc('abrir_ficha_maquina', { p_maquina: maquinaId, p_competencia: dia });
  if (error) throw error;
  return data as string;
}

export async function salvarDiaFicha(fichaId: string, dia: number, dados: Omit<DiaFicha, 'statuses'> & { statuses: string[] } | null) {
  const { error } = await supabase.rpc('salvar_dia_ficha', { p_ficha: fichaId, p_dia: dia, p_dados: dados });
  if (error) throw error;
}

export async function fecharFicha(fichaId: string, f: { operador_nome: string; operador_assinatura: string | null; tst_nome: string; tst_assinatura: string | null }) {
  const { error } = await supabase.rpc('fechar_ficha_maquina', { p_ficha: fichaId, p_fechamento: f });
  if (error) throw error;
}

export type ColaboradorAtivo = { id: string; nome: string; funcao: string | null };

export async function colaboradoresAtivos(empresaId: string): Promise<ColaboradorAtivo[]> {
  const { data, error } = await supabase.rpc('colaboradores_ativos_empresa', { p_empresa: empresaId });
  if (error) throw error;
  return (data ?? []) as ColaboradorAtivo[];
}

// Foto ou assinatura na pasta privada. O caminho já diz de quem é (vistoria/<id>/..., ficha/<id>/...).
export async function enviarImagem(caminho: string, arquivo: Blob) {
  const { error } = await supabase.storage.from('seguranca').upload(caminho, arquivo, { contentType: arquivo.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(`Não foi possível enviar a imagem: ${error.message}`);
  return caminho;
}

// Celular tira foto de 4 a 12 MB; reduzimos para no máximo 1600 px e JPEG, o que dá algo entre 200 e 500 KB.
export async function comprimirFoto(arquivo: File, lado = 1600): Promise<Blob> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error('Arquivo de imagem inválido.'));
      i.src = url;
    });
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível ler a foto.'))), 'image/jpeg', 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function itensRespondidos(itens: { status: string | null }[]) {
  return itens.filter((i) => i.status).length;
}

// Mesma regra de app.seg_nota (planilha NR-18), para mostrar a nota antes de concluir.
export function notaPrevia(itens: { status: string | null }[]) {
  const sim = itens.filter((i) => i.status === 'sim').length;
  const aplicaveis = itens.filter((i) => i.status === 'sim' || i.status === 'nao').length;
  if (!aplicaveis) return null;
  const f = sim / aplicaveis;
  return { pontuacao: f, classificacao: f <= 0.3 ? 'Péssimo' : f <= 0.5 ? 'Ruim' : f <= 0.7 ? 'Regular' : f < 1 ? 'Bom' : 'Ótimo' };
}
