import { supabase } from './supabase';
import { problemaNoArquivo } from './fornecedor';

export { problemaNoArquivo };

// ---------------------------------------------------------------- Tipos

export type StatusMedicao = 'aberta' | 'em_analise' | 'pendente_fornecedor' | 'aprovada';
export type StatusItem = 'nao_enviado' | 'em_analise' | 'aprovado' | 'devolvido' | 'nao_aplica';
export type SituacaoColaborador = 'trabalhou' | 'rescisao' | 'dono' | 'pj' | 'afastado';
export type Marcacao = 'ok' | 'pendente' | 'na';

export type TipoMedicao = {
  codigo: string;
  item: string;
  nome: string;
  coletivo: boolean;
  conferencias: string[];
  impeditivo: boolean;
  quando_aplicavel: boolean;
  ordem: number;
};

export type Medicao = {
  id: string;
  empresa_id: string;
  empresa: string;
  cnpj: string;
  email_cobranca: string | null;
  obra_id: string | null;
  obra: string | null;
  competencia: string;
  prazo: string;
  status: StatusMedicao;
  primeiro_envio_em: string | null;
  enviada_em: string | null;
  conferente: string | null;
  ultima_analise_em: string | null;
  ultima_cobranca_em: string | null;
  observacao: string | null;
  origem: 'portal' | 'migracao';
  qtd_colaboradores: number;
  entregue_no_prazo: boolean;
  retida: boolean; // não aprovada depois da tolerância (dia 30) e da data combinada
  em_atraso: boolean; // passou do dia 25, ainda dentro da tolerância ou da data combinada
  tolerancia: string;
  prazo_combinado: string | null;
  prazo_combinado_obs: string | null;
  itens_pendentes: number;
  itens_em_analise: number;
  itens_devolvidos: number;
  colaboradores_pendentes: number;
};

export type ArquivoMedicao = {
  id: string;
  versao: number;
  caminho: string;
  nome_original: string;
  tamanho_bytes: number | null;
  enviado_em: string;
  baixado_em: string | null;
  apagado_em: string | null;
};

export type ItemMedicao = {
  id: string;
  tipo_codigo: string;
  status: StatusItem;
  versao: number;
  justificativa: string | null;
  motivo_devolucao: string | null;
  enviado_em: string | null;
  analisado_em: string | null;
  medicoes_arquivos: ArquivoMedicao[];
};

export type LinhaColaborador = {
  id: string;
  colaborador_id: string | null;
  nome: string;
  situacao: SituacaoColaborador;
  conferencia: Partial<Record<ChaveConferencia, Marcacao>>;
  observacao: string | null;
};

export const CHAVES_CONFERENCIA = ['holerite', 'pg_holerite', 'vale', 'pg_vale', 'vt', 'ponto', 're'] as const;
export type ChaveConferencia = (typeof CHAVES_CONFERENCIA)[number];

export const rotuloConferencia: Record<ChaveConferencia, string> = {
  holerite: 'Holerite',
  pg_holerite: 'Pgto holerite',
  vale: 'Vale',
  pg_vale: 'Pgto vale',
  vt: 'VT',
  ponto: 'Ponto',
  re: 'RE',
};

export const rotuloStatusMedicao: Record<StatusMedicao, string> = {
  aberta: 'Em preenchimento',
  em_analise: 'Em conferência',
  pendente_fornecedor: 'Com pendência',
  aprovada: 'Aprovada',
};

export const rotuloStatusItem: Record<StatusItem, string> = {
  nao_enviado: 'Não enviado',
  em_analise: 'Em conferência',
  aprovado: 'Aprovado',
  devolvido: 'Devolvido',
  nao_aplica: 'Não se aplica',
};

// Reaproveita as cores dos selos de documento.
export const seloItem: Record<StatusItem, string> = {
  nao_enviado: 'selo-doc-nao_enviado',
  em_analise: 'selo-doc-em_analise',
  aprovado: 'selo-doc-vigente',
  devolvido: 'selo-doc-devolvido',
  nao_aplica: 'selo-doc-dispensado',
};

export const seloMedicao: Record<StatusMedicao, string> = {
  aberta: 'selo-doc-a_vencer',
  em_analise: 'selo-doc-em_analise',
  pendente_fornecedor: 'selo-doc-devolvido',
  aprovada: 'selo-doc-vigente',
};

export const rotuloSituacaoColaborador: Record<SituacaoColaborador, string> = {
  trabalhou: 'Trabalhou no mês',
  rescisao: 'Rescisão no mês',
  dono: 'Sócio ou dono',
  pj: 'PJ',
  afastado: 'Afastado',
};

// Nome curto de cada item, para o nome dos arquivos baixados.
const NOME_CURTO: Record<string, string> = {
  holerite: 'Holerite',
  adiantamento: 'Adiantamento',
  cartao_ponto: 'Cartao de ponto',
  folha: 'Folha de pagamento',
  vt: 'Vale-transporte',
  fgts_detalhe: 'Detalhe FGTS',
  fgts_guia: 'Guia FGTS',
  fgts_pagamento: 'Pgto FGTS',
  dctfweb: 'DCTFWeb',
  inss_guia: 'Guia INSS',
  inss_pagamento: 'Pgto INSS',
  darf_guia: 'DARF',
  darf_pagamento: 'Pgto DARF',
  seguro_vida: 'Seguro de vida',
  rescisao: 'Rescisao',
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// '2026-09-01' -> 'setembro de 2026'
export function mesPorExtenso(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

// '2026-09-01' -> 'set/2026'
export function mesCurto(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return `${MESES[m - 1].slice(0, 3)}/${a}`;
}

// Competências que o fornecedor pode abrir: do mês atual até seis meses atrás.
export function competenciasRecentes(hoje = new Date()): string[] {
  const lista: string[] = [];
  for (let i = 0; i <= 6; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return lista;
}

export function competenciaPadrao(hoje = new Date()): string {
  return competenciasRecentes(hoje)[1];
}

export function editavelPeloFornecedor(m: Pick<Medicao, 'status'>): boolean {
  return m.status === 'aberta' || m.status === 'pendente_fornecedor';
}

// ---------------------------------------------------------------- Leitura

export async function lerTiposMedicao(): Promise<TipoMedicao[]> {
  const { data, error } = await supabase
    .from('tipos_medicao')
    .select('codigo, item, nome, coletivo, conferencias, impeditivo, quando_aplicavel, ordem')
    .eq('ativo', true)
    .order('ordem');
  if (error) throw error;
  return (data ?? []) as TipoMedicao[];
}

const CAMPOS_MEDICAO =
  'id, empresa_id, empresa, cnpj, email_cobranca, obra_id, obra, competencia, prazo, status, primeiro_envio_em, enviada_em, conferente, ultima_analise_em, ultima_cobranca_em, observacao, origem, qtd_colaboradores, entregue_no_prazo, retida, em_atraso, tolerancia, prazo_combinado, prazo_combinado_obs, itens_pendentes, itens_em_analise, itens_devolvidos, colaboradores_pendentes';

export async function lerMedicoes(filtro: { competencia?: string; empresaId?: string } = {}): Promise<Medicao[]> {
  let q = supabase.from('v_medicoes').select(CAMPOS_MEDICAO);
  if (filtro.competencia) q = q.eq('competencia', filtro.competencia);
  if (filtro.empresaId) q = q.eq('empresa_id', filtro.empresaId);
  const { data, error } = await q.order('competencia', { ascending: false }).order('empresa').limit(1000);
  if (error) throw error;
  return (data ?? []) as Medicao[];
}

// Todas as medições, em páginas de 1.000 (o histórico cresce todo mês).
export async function lerTodasMedicoes(): Promise<Medicao[]> {
  const todas: Medicao[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase.from('v_medicoes').select(CAMPOS_MEDICAO).order('id').range(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...((data ?? []) as Medicao[]));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

export type DetalheMedicao = { medicao: Medicao; itens: ItemMedicao[]; colaboradores: LinhaColaborador[] };

export async function lerMedicao(id: string): Promise<DetalheMedicao> {
  const [{ data: m, error: e1 }, { data: itens, error: e2 }, { data: colabs, error: e3 }] = await Promise.all([
    supabase.from('v_medicoes').select(CAMPOS_MEDICAO).eq('id', id).single(),
    supabase
      .from('medicoes_itens')
      .select('id, tipo_codigo, status, versao, justificativa, motivo_devolucao, enviado_em, analisado_em, medicoes_arquivos(id, versao, caminho, nome_original, tamanho_bytes, enviado_em, baixado_em, apagado_em)')
      .eq('medicao_id', id),
    supabase.from('medicoes_colaboradores').select('id, colaborador_id, nome, situacao, conferencia, observacao').eq('medicao_id', id).order('nome'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  return { medicao: m as Medicao, itens: (itens ?? []) as ItemMedicao[], colaboradores: (colabs ?? []) as LinhaColaborador[] };
}

// Arquivos da versão atual de um item (os anteriores ficam guardados, mas não contam).
export function arquivosAtuais(item: ItemMedicao): ArquivoMedicao[] {
  return item.medicoes_arquivos.filter((a) => a.versao === item.versao).sort((a, b) => a.caminho.localeCompare(b.caminho));
}

// ---------------------------------------------------------------- Fornecedor

export async function abrirMedicao(empresaId: string, obraId: string, competencia: string): Promise<string> {
  const { data, error } = await supabase.rpc('abrir_medicao', { p_empresa: empresaId, p_obra: obraId, p_competencia: competencia });
  if (error) throw error;
  return (data as { id: string }).id;
}

function nomeSeguro(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return semAcento.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'arquivo';
}

function tipoDoArquivo(arquivo: File): string {
  if (arquivo.type) return arquivo.type;
  const ext = arquivo.name.split('.').pop()?.toLowerCase();
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  return '';
}

export async function enviarItemMedicao(dados: {
  medicao: Pick<Medicao, 'id' | 'empresa_id'>;
  item: Pick<ItemMedicao, 'tipo_codigo' | 'versao'>;
  arquivos: File[];
  aceiteLgpd: boolean;
  aoProgredir?: (feitos: number, total: number) => void;
}) {
  if (!dados.aceiteLgpd) throw new Error('É preciso aceitar o termo de LGPD para enviar');
  const versao = dados.item.versao + 1;
  const pasta = `${dados.medicao.empresa_id}/medicao/${dados.medicao.id}/${dados.item.tipo_codigo}/${versao}-`;
  const enviados: { caminho: string; nome: string; tamanho: number; tipo: string }[] = [];
  for (let i = 0; i < dados.arquivos.length; i++) {
    const arquivo = dados.arquivos[i];
    const caminho = `${pasta}${i + 1}-${nomeSeguro(arquivo.name)}`;
    const tipo = tipoDoArquivo(arquivo);
    const { error } = await supabase.storage.from('documentos').upload(caminho, arquivo, { contentType: tipo, upsert: false });
    if (error) throw new Error(`Não foi possível enviar ${arquivo.name}. Confira a internet e tente de novo.`);
    enviados.push({ caminho, nome: arquivo.name, tamanho: arquivo.size, tipo });
    dados.aoProgredir?.(i + 1, dados.arquivos.length);
  }
  const { error } = await supabase.rpc('enviar_item_medicao', {
    p_medicao: dados.medicao.id,
    p_tipo: dados.item.tipo_codigo,
    p_arquivos: enviados,
    p_nao_aplica: false,
    p_justificativa: null,
    p_aceite_lgpd: true,
  });
  if (error) {
    // O registro não entrou: tira os arquivos que já subiram, para nenhum arquivo ficar sem vínculo.
    await supabase.storage.from('documentos').remove(enviados.map((a) => a.caminho)).catch(() => undefined);
    throw error;
  }
}

export async function marcarNaoSeAplica(medicaoId: string, tipo: string, justificativa: string) {
  const { error } = await supabase.rpc('enviar_item_medicao', {
    p_medicao: medicaoId,
    p_tipo: tipo,
    p_arquivos: [],
    p_nao_aplica: true,
    p_justificativa: justificativa,
  });
  if (error) throw error;
}

export async function definirColaborador(medicaoId: string, colaboradorId: string, situacao: SituacaoColaborador) {
  const { error } = await supabase.rpc('definir_colaborador_medicao', {
    p_medicao: medicaoId,
    p_colaborador: colaboradorId,
    p_situacao: situacao,
    p_observacao: null,
  });
  if (error) throw error;
}

export async function removerColaborador(medicaoId: string, colaboradorId: string) {
  const { error } = await supabase.rpc('remover_colaborador_medicao', { p_medicao: medicaoId, p_colaborador: colaboradorId });
  if (error) throw error;
}

export async function enviarMedicao(medicaoId: string) {
  const { error } = await supabase.rpc('enviar_medicao', { p_medicao: medicaoId });
  if (error) throw error;
}

// ---------------------------------------------------------------- Administrativo

export async function avaliarItem(itemId: string, aprovar: boolean, motivo?: string) {
  const { error } = await supabase.rpc('avaliar_item_medicao', { p_item: itemId, p_aprovar: aprovar, p_motivo: motivo ?? null });
  if (error) throw error;
}

export async function conferirColaborador(linhaId: string, conferencia: LinhaColaborador['conferencia'], situacao?: SituacaoColaborador) {
  const { error } = await supabase.rpc('conferir_colaborador_medicao', { p_linha: linhaId, p_conferencia: conferencia, p_situacao: situacao ?? null });
  if (error) throw error;
}

export async function concluirConferencia(medicaoId: string): Promise<StatusMedicao> {
  const { data, error } = await supabase.rpc('concluir_conferencia_medicao', { p_medicao: medicaoId });
  if (error) throw error;
  return data as StatusMedicao;
}

export async function combinarPrazo(medicaoId: string, dataIso: string | null, obs: string | null) {
  const { error } = await supabase.rpc('combinar_prazo_medicao', { p_medicao: medicaoId, p_data: dataIso, p_obs: obs });
  if (error) throw error;
}

export async function registrarCobranca(ids: string[]) {
  const { error } = await supabase.rpc('registrar_cobranca_medicao', { p_medicoes: ids });
  if (error) throw error;
}

function limparParaNome(texto: string): string {
  return texto.replace(/[\\/]+/g, '-').replace(/[:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
}

// Nome para o SharePoint: AAAAMM_documento_empresa, com "(1 de 2)" quando o item tem mais de um arquivo.
export function nomeArquivoMedicao(m: Pick<Medicao, 'competencia' | 'empresa'>, item: Pick<ItemMedicao, 'tipo_codigo'>, arquivo: ArquivoMedicao, ordem: number, total: number): string {
  const mes = m.competencia.slice(0, 7).replace('-', '');
  const extensao = arquivo.nome_original.includes('.') ? arquivo.nome_original.split('.').pop()!.toLowerCase() : 'pdf';
  const parte = total > 1 ? ` (${ordem} de ${total})` : '';
  return `${mes}_${NOME_CURTO[item.tipo_codigo] ?? item.tipo_codigo}_${limparParaNome(m.empresa)}${parte}.${extensao}`;
}

export async function abrirArquivoMedicao(caminho: string) {
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(caminho, 300);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

export async function baixarMedicao(d: DetalheMedicao, aoProgredir?: (feitos: number, total: number) => void): Promise<number> {
  const { zipSync } = await import('fflate');
  const lista = d.itens.flatMap((item) => {
    const ativos = arquivosAtuais(item).filter((a) => !a.apagado_em);
    return ativos.map((a, i) => ({ a, nome: nomeArquivoMedicao(d.medicao, item, a, i + 1, ativos.length) }));
  });
  if (lista.length === 0) throw new Error('Esta medição ainda não tem arquivos.');
  const conteudo: Record<string, Uint8Array> = {};
  let feitos = 0;
  for (const { a, nome } of lista) {
    const { data: blob, error } = await supabase.storage.from('documentos').download(a.caminho);
    if (error || !blob) throw new Error(`Não foi possível baixar ${a.nome_original}. Tente de novo.`);
    let caminho = nome;
    for (let n = 2; conteudo[caminho]; n++) caminho = nome.replace(/(\.[^.]+)$/, ` ${n}$1`);
    conteudo[caminho] = new Uint8Array(await blob.arrayBuffer());
    feitos += 1;
    aoProgredir?.(feitos, lista.length);
  }
  const zip = zipSync(conteudo, { level: 0 });
  const { error } = await supabase.rpc('registrar_download_medicao', { p_arquivos: lista.map((x) => x.a.id) });
  if (error) throw error;
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${d.medicao.competencia.slice(0, 7).replace('-', '')}_medicao_${limparParaNome(d.medicao.empresa).replace(/\s+/g, '_')}${d.medicao.obra ? `_${limparParaNome(d.medicao.obra).replace(/\s+/g, '_')}` : ''}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return lista.length;
}

export async function baixarArquivoMedicao(m: Pick<Medicao, 'competencia' | 'empresa'>, item: ItemMedicao, arquivo: ArquivoMedicao) {
  const ativos = arquivosAtuais(item).filter((a) => !a.apagado_em);
  const nome = nomeArquivoMedicao(m, item, arquivo, ativos.indexOf(arquivo) + 1, ativos.length);
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(arquivo.caminho, 300, { download: nome });
  if (error) throw error;
  const { error: e2 } = await supabase.rpc('registrar_download_medicao', { p_arquivos: [arquivo.id] });
  if (e2) throw e2;
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
