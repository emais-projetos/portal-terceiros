// Homologação de fornecedores (Suprimentos), contratos e liberação do portal (administrativo).
// As regras ficam no banco (migração 055); aqui só chamamos as funções e montamos os dados para as telas.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, enderecoDoSite } from './supabase';
import { nomeSeguro, tipoDoArquivo } from './fornecedor';
import { editarAcesso, lerAcessosFornecedores, type Acesso } from './admin';

export type SituacaoHomologacao = 'anterior' | 'convidada' | 'enviada' | 'devolvida' | 'homologada' | 'reprovada';

export const NOMES_SITUACAO_HOMOLOGACAO: Record<SituacaoHomologacao, string> = {
  anterior: 'Homologação anterior ao portal',
  convidada: 'Aguardando o fornecedor',
  enviada: 'Para analisar',
  devolvida: 'Com correções no fornecedor',
  homologada: 'Homologado',
  reprovada: 'Reprovado',
};

export type TipoHomologacao = {
  codigo: string;
  nome: string;
  ordem: number;
  obrigatorio: boolean;
  validade_dias: number | null;
  tipo_portal: string | null;
  observacao: string | null;
  personalizado: boolean;
  ativo: boolean;
  tipos_fornecedor: string[];
};

// O documento é pedido a quem tem pelo menos um destes tipos.
export function documentoSeAplica(t: Pick<TipoHomologacao, 'tipos_fornecedor'>, tiposEmpresa: string[] | null | undefined): boolean {
  const da = tiposEmpresa?.length ? tiposEmpresa : ['mao_de_obra'];
  return (t.tipos_fornecedor ?? []).some((x) => da.includes(x));
}

export type ArquivoHomologacao = { caminho: string; nome?: string; tamanho?: number; tipo?: string };

export type DocumentoHomologacao = {
  id: string;
  tipo: string;
  data_emissao: string | null;
  vencimento: string | null;
  status: 'em_analise' | 'aprovado' | 'devolvido';
  motivo: string | null;
  arquivos: ArquivoHomologacao[];
  enviado_em: string;
  analisado_em?: string | null;
  analisado_por?: string | null;
};

export type Referencia = { empresa: string; endereco: string; cidade: string; estado: string; telefone: string; email: string; contato: string };

// Campos do F.31 (Homologação de fornecedores, SGQ). Os marcados com * são obrigatórios para enviar.
export type DadosF31 = {
  razao_social?: string;
  nome_fantasia?: string;
  ramo?: string;
  praca?: string;
  limite_faturamento?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  telefone?: string;
  celular?: string;
  contato?: string;
  email_empresa?: string;
  inscricao_municipal?: string;
  inscricao_estadual?: string;
  banco?: string;
  agencia?: string;
  conta?: string;
  referencias?: Referencia[];
  email?: string;
  // Respostas das perguntas incluídas pelo Suprimentos (Configuração > Formulário da homologação).
  [extra: `extra_${string}`]: string | undefined;
};

// Campos do F.31 e se são obrigatórios: o Suprimentos define em Configuração > Formulário da homologação.
export type FormatoCampo = 'texto' | 'data' | 'numero';
export type CampoHomologacao = {
  campo: keyof DadosF31 | 'referencias';
  rotulo: string;
  secao: string;
  ordem: number;
  obrigatorio: boolean;
  fixo: boolean;
  formato: FormatoCampo;
  personalizado: boolean;
  ativo: boolean;
};
export const NOMES_FORMATO: Record<FormatoCampo | 'anexo', string> = { texto: 'Texto', data: 'Data', numero: 'Número', anexo: 'Anexo de documento' };

// Resposta de uma pergunta incluída pelo Suprimentos, pronta para mostrar (data no formato dd/mm/aaaa).
export function respostaAdicional(dados: DadosF31 | null | undefined, c: CampoHomologacao): string {
  const v = String((dados as Record<string, unknown> | null | undefined)?.[c.campo] ?? '').trim();
  if (c.formato === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return v;
}

export async function incluirItem(pergunta: string, formato: FormatoCampo | 'anexo', obrigatorio: boolean, validadeDias: number | null, tipos: string[] | null = null) {
  const { error } = await supabase.rpc('incluir_item_homologacao', {
    p_pergunta: pergunta, p_formato: formato, p_obrigatorio: obrigatorio, p_validade_dias: validadeDias, p_tipos: formato === 'anexo' ? tipos : null,
  });
  tiposCache = null;
  if (error) throw error;
}

export async function removerItem(codigo: string) {
  const { error } = await supabase.rpc('remover_item_homologacao', { p_codigo: codigo });
  tiposCache = null;
  if (error) throw error;
}

export async function lerCamposHomologacao(): Promise<CampoHomologacao[]> {
  const { data, error } = await supabase.from('homologacao_campos').select('*').order('ordem');
  if (error) throw error;
  return (data ?? []) as CampoHomologacao[];
}

export async function configurarCampo(campo: string, obrigatorio: boolean) {
  const { error } = await supabase.rpc('configurar_campo_homologacao', { p_campo: campo, p_obrigatorio: obrigatorio });
  if (error) throw error;
}

export async function configurarDocumento(codigo: string, obrigatorio: boolean, validadeDias: number | null, tipos: string[] | null = null) {
  const { error } = await supabase.rpc('configurar_documento_homologacao', { p_codigo: codigo, p_obrigatorio: obrigatorio, p_validade_dias: validadeDias, p_tipos: tipos });
  tiposCache = null;
  if (error) throw error;
}

export type MudancaConfiguracao = {
  em: string;
  quem: string | null;
  acao:
    | 'campo_homologacao_alterado'
    | 'documento_homologacao_alterado'
    | 'item_homologacao_incluido'
    | 'item_homologacao_removido'
    | 'tipo_fornecedor_incluido'
    | 'tipo_fornecedor_alterado'
    | 'tipo_fornecedor_removido';
  detalhe: {
    rotulo?: string;
    formato?: FormatoCampo | 'anexo';
    nome?: string;
    obrigatorio?: boolean | { de: boolean; para: boolean };
    validade_dias?: number | null | { de: number | null; para: number | null };
    tipos?: string[] | { entrou: string[]; saiu: string[] } | null;
    nome_antes?: string | null;
    descricao_mudou?: boolean;
    colaboradores?: boolean | { de: boolean; para: boolean };
    mensal?: boolean | { de: boolean; para: boolean };
    copiou_de?: string | null;
  };
};

export async function lerHistoricoConfiguracao(): Promise<MudancaConfiguracao[]> {
  const { data, error } = await supabase.rpc('historico_configuracao_homologacao');
  if (error) throw error;
  return (data ?? []) as MudancaConfiguracao[];
}

export type MinhaHomologacao = {
  empresa_id: string;
  razao_social: string;
  cnpj: string;
  situacao: SituacaoHomologacao;
  liberado: boolean;
  tipos: string[];
  dados: DadosF31;
  motivo: string | null;
  enviada_em: string | null;
  documentos: DocumentoHomologacao[];
};

// Qualificação do F.31, preenchida pelo Suprimentos.
export const ITENS_QUALIFICACAO: { chave: string; grupo: string; texto: string }[] = [
  { chave: 'documentos', grupo: '1. Habilitação (estrutura física e documental)', texto: '1.1 Apresentação de documentos' },
  { chave: 'missao', grupo: '3. Capacidade técnica (produtiva)', texto: '3.1 Missão, visão e valores: consciência ambiental e social' },
  { chave: 'certificacao', grupo: '3. Capacidade técnica (produtiva)', texto: '3.2 Certificação em programa setorial da qualidade' },
  { chave: 'qualidade', grupo: '3. Capacidade técnica (produtiva)', texto: '3.3 Qualidade dos serviços (testes, ensaios ou parecer sobre amostras)' },
  { chave: 'visita', grupo: '3. Capacidade técnica (produtiva)', texto: '3.4 Parecer da visita técnica (caso feita)' },
];
export type RespostaQualificacao = 'sim' | 'nao' | 'na';

function erroDaFuncao(error: unknown): Promise<never> {
  return (async () => {
    if (error instanceof FunctionsHttpError) {
      const detalhe = await error.context.json().catch(() => null);
      throw new Error(detalhe?.erro ?? 'Não foi possível concluir.');
    }
    throw error;
  })();
}

// ---------------------------------------------------------------- Tipos de documento

let tiposCache: TipoHomologacao[] | null = null;
export async function lerTiposHomologacao(novo = false): Promise<TipoHomologacao[]> {
  if (tiposCache && !novo) return tiposCache;
  const { data, error } = await supabase.from('homologacao_tipos').select('*').order('ordem');
  if (error) throw error;
  tiposCache = (data ?? []) as TipoHomologacao[];
  return tiposCache;
}

// Documento atual de cada tipo: o mais recente que não foi substituído.
export function documentoAtual(docs: DocumentoHomologacao[], tipo: string): DocumentoHomologacao | null {
  return docs.filter((d) => d.tipo === tipo).sort((a, b) => b.enviado_em.localeCompare(a.enviado_em))[0] ?? null;
}

// ---------------------------------------------------------------- Fornecedor

export async function lerMinhaHomologacao(): Promise<MinhaHomologacao[]> {
  const { data, error } = await supabase.rpc('minha_homologacao');
  if (error) throw error;
  return (data ?? []) as MinhaHomologacao[];
}

export async function salvarHomologacao(empresaId: string, dados: DadosF31) {
  const { error } = await supabase.rpc('salvar_homologacao', { p_empresa: empresaId, p_dados: dados });
  if (error) throw error;
}

export async function enviarDocumentoHomologacao(empresaId: string, tipo: string, dataEmissao: string, arquivos: File[]) {
  const id = crypto.randomUUID();
  const enviados: ArquivoHomologacao[] = [];
  for (let i = 0; i < arquivos.length; i++) {
    const arquivo = arquivos[i];
    const caminho = `${empresaId}/h/${id}/${i + 1}-${nomeSeguro(arquivo.name)}`;
    const contentType = tipoDoArquivo(arquivo);
    const { error } = await supabase.storage.from('documentos').upload(caminho, arquivo, { contentType, upsert: false });
    if (error) throw new Error(`Não foi possível enviar ${arquivo.name}. Confira a internet e tente de novo.`);
    enviados.push({ caminho, nome: arquivo.name, tamanho: arquivo.size, tipo: contentType });
  }
  const { error } = await supabase.rpc('enviar_documento_homologacao', {
    p_empresa: empresaId, p_tipo: tipo, p_data_emissao: dataEmissao, p_arquivos: enviados,
  });
  if (error) {
    await supabase.storage.from('documentos').remove(enviados.map((a) => a.caminho)).catch(() => undefined);
    throw error;
  }
}

export async function enviarHomologacao(empresaId: string) {
  const { error } = await supabase.rpc('enviar_homologacao', { p_empresa: empresaId });
  if (error) throw error;
}

// ---------------------------------------------------------------- Suprimentos

export type ItemHomologacao = {
  empresa_id: string;
  razao_social: string;
  cnpj: string;
  situacao: SituacaoHomologacao;
  email: string | null;
  convidada_em: string;
  enviada_em: string | null;
  decidida_em: string | null;
  tipos: string[];
  liberado_em: string | null;
  codigo_bp: string | null;
  tem_acesso: boolean;
  contratos: number;
  docs_em_analise: number;
  docs_devolvidos: number;
  obras_previstas: string[];
};

export async function lerListaHomologacoes(): Promise<ItemHomologacao[]> {
  const { data, error } = await supabase.rpc('lista_homologacoes');
  if (error) throw error;
  return (data ?? []) as ItemHomologacao[];
}

export type ContratoFornecedor = {
  id: string;
  numero: string;
  codigo_bp: string;
  inicio: string;
  termino: string;
  arquivo: string;
  arquivo_nome: string;
  situacao: 'ativo' | 'encerrado';
  obras: { id: string; nome: string }[];
};

export type DetalheHomologacao = {
  empresa_id: string;
  razao_social: string;
  cnpj: string;
  situacao: SituacaoHomologacao;
  codigo_bp: string | null;
  tipos: string[];
  liberado_em: string | null;
  email: string | null;
  dados: DadosF31 | null;
  qualificacao: Record<string, RespostaQualificacao> | null;
  comentarios: string | null;
  responsavel: string | null;
  motivo: string | null;
  convidada_em: string | null;
  enviada_em: string | null;
  decidida_em: string | null;
  decidida_por: string | null;
  obras_previstas: { id: string; nome: string }[];
  documentos: DocumentoHomologacao[];
  contratos: ContratoFornecedor[];
  obras_ativas: { id: string; nome: string; numero_contrato: string | null }[];
};

export async function lerDetalheHomologacao(empresaId: string): Promise<DetalheHomologacao> {
  const { data, error } = await supabase.rpc('detalhe_homologacao', { p_empresa: empresaId });
  if (error) throw error;
  if (!data) throw new Error('Fornecedor não encontrado');
  return data as DetalheHomologacao;
}

// Acesso ao portal de cada empresa (login do fornecedor). Um login pode cuidar de várias empresas.
export async function lerAcessosPorEmpresa(): Promise<{ lista: Acesso[]; porEmpresa: Map<string, Acesso> }> {
  const lista = await lerAcessosFornecedores();
  const porEmpresa = new Map<string, Acesso>();
  lista.forEach((a) => a.empresas.forEach((e) => porEmpresa.set(e.id, a)));
  return { lista, porEmpresa };
}

// Liga ou tira a empresa de um login que já existe (mesma ação do administrativo em Acessos > Editar).
export async function vincularEmpresaAoAcesso(acesso: Acesso, empresaId: string) {
  return editarAcesso({ usuario_id: acesso.id, nome: acesso.nome, email: acesso.email, empresas: [...new Set([...acesso.empresas.map((e) => e.id), empresaId])], obras: [] });
}
export async function tirarEmpresaDoAcesso(acesso: Acesso, empresaId: string) {
  return editarAcesso({ usuario_id: acesso.id, nome: acesso.nome, email: acesso.email, empresas: acesso.empresas.map((e) => e.id).filter((id) => id !== empresaId), obras: [] });
}

export async function cadastrarFornecedor(dados: {
  razao: string;
  cnpj: string;
  email: string;
  contato: string;
  obras: string[];
  tipos: string[];
  acessoExistente?: Acesso | null;
}): Promise<{ empresaId: string; aviso: string | null }> {
  const { data, error } = await supabase.rpc('cadastrar_fornecedor_homologacao', {
    p_razao: dados.razao, p_cnpj: dados.cnpj, p_email: dados.email, p_contato: dados.contato || null, p_obras: dados.obras, p_tipos: dados.tipos,
  });
  if (error) throw error;
  const empresaId = data as string;
  // E-mail que já é login de fornecedor: a empresa nova entra nesse acesso.
  if (dados.acessoExistente) {
    try {
      await vincularEmpresaAoAcesso(dados.acessoExistente, empresaId);
    } catch (e) {
      return { empresaId, aviso: `O fornecedor foi cadastrado, mas não entrou no acesso ${dados.acessoExistente.email}: ${(e as Error).message}` };
    }
    const { error: e4 } = await supabase.rpc('enviar_convite_homologacao', { p_empresa: empresaId });
    if (e4) return { empresaId, aviso: `O fornecedor foi cadastrado, mas o convite não entrou na fila: ${e4.message}` };
    return { empresaId, aviso: null };
  }
  // Cria o login do fornecedor (primeiro acesso por código) e coloca o convite da homologação na fila.
  const { error: e2 } = await supabase.functions.invoke('gerenciar-acesso', {
    body: { acao: 'criar', nome: dados.razao, email: dados.email, perfil: 'fornecedor', empresas: [empresaId], obras: [], enviar: false, destino: enderecoDoSite },
  });
  if (e2) {
    try {
      await erroDaFuncao(e2);
    } catch (e) {
      return { empresaId, aviso: `O fornecedor foi cadastrado, mas o acesso não foi criado: ${(e as Error).message}` };
    }
  }
  const { error: e3 } = await supabase.rpc('enviar_convite_homologacao', { p_empresa: empresaId });
  if (e3) return { empresaId, aviso: `O fornecedor foi cadastrado, mas o convite não entrou na fila: ${e3.message}` };
  return { empresaId, aviso: null };
}

export async function reenviarConvite(empresaId: string) {
  const { error } = await supabase.rpc('enviar_convite_homologacao', { p_empresa: empresaId });
  if (error) throw error;
}

export async function analisarDocumentoHomologacao(id: string, aprovar: boolean, motivo?: string) {
  const { error } = await supabase.rpc('analisar_documento_homologacao', { p_documento: id, p_aprovar: aprovar, p_motivo: motivo ?? null });
  if (error) throw error;
}

export async function devolverHomologacao(empresaId: string, observacao: string) {
  const { error } = await supabase.rpc('devolver_homologacao', { p_empresa: empresaId, p_observacao: observacao || null });
  if (error) throw error;
}

export async function homologarFornecedor(empresaId: string, qualificacao: Record<string, RespostaQualificacao>, comentarios: string, responsavel: string) {
  const { error } = await supabase.rpc('homologar_fornecedor', {
    p_empresa: empresaId, p_qualificacao: qualificacao, p_comentarios: comentarios || null, p_responsavel: responsavel,
  });
  if (error) throw error;
}

export async function reprovarHomologacao(empresaId: string, motivo: string) {
  const { error } = await supabase.rpc('reprovar_homologacao', { p_empresa: empresaId, p_motivo: motivo });
  if (error) throw error;
}

export async function registrarContrato(dados: {
  empresaId: string;
  contratoId: string | null;
  numero: string;
  bp: string;
  inicio: string;
  termino: string;
  obras: string[];
  arquivo: File | null;
  arquivoAtual: { caminho: string; nome: string } | null;
}) {
  let caminho = dados.arquivoAtual?.caminho ?? null;
  let nome = dados.arquivoAtual?.nome ?? null;
  let subiu: string | null = null;
  if (dados.arquivo) {
    if (tipoDoArquivo(dados.arquivo) !== 'application/pdf') throw new Error('Anexe o contrato assinado em PDF.');
    if (dados.arquivo.size > 10 * 1024 * 1024) throw new Error('O contrato passa de 10 MB.');
    caminho = `${dados.empresaId}/contratos/${crypto.randomUUID()}/${nomeSeguro(dados.arquivo.name)}`;
    nome = dados.arquivo.name;
    const { error } = await supabase.storage.from('documentos').upload(caminho, dados.arquivo, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error('Não foi possível enviar o contrato. Confira a internet e tente de novo.');
    subiu = caminho;
  }
  const { error } = await supabase.rpc('registrar_contrato', {
    p_empresa: dados.empresaId, p_numero: dados.numero, p_bp: dados.bp, p_inicio: dados.inicio, p_termino: dados.termino,
    p_arquivo: caminho, p_arquivo_nome: nome, p_obras: dados.obras, p_contrato: dados.contratoId,
  });
  if (error) {
    if (subiu) await supabase.storage.from('documentos').remove([subiu]).catch(() => undefined);
    throw error;
  }
}

export async function encerrarContrato(id: string, motivo: string) {
  const { error } = await supabase.rpc('encerrar_contrato', { p_contrato: id, p_motivo: motivo });
  if (error) throw error;
}

export type FornecedorARegularizar = {
  empresa_id: string;
  razao_social: string;
  cnpj: string;
  homologacao: SituacaoHomologacao;
  sem_bp: boolean;
  obras_sem_contrato: string[];
  contratos_vencendo: { id: string; numero: string; termino: string }[];
  certidoes: { tipo: string; vencimento: string }[];
};

export async function lerARegularizar(): Promise<FornecedorARegularizar[]> {
  const { data, error } = await supabase.rpc('fornecedores_a_regularizar');
  if (error) throw error;
  return (data ?? []) as FornecedorARegularizar[];
}

export type ContadoresSuprimentos = { homologacao: number; pedidos: number; contrato: number };
export async function lerContadoresSuprimentos(): Promise<ContadoresSuprimentos> {
  const { data, error } = await supabase.rpc('contadores_suprimentos');
  if (error) throw error;
  return (data ?? { homologacao: 0, pedidos: 0, contrato: 0 }) as ContadoresSuprimentos;
}

export async function abrirArquivoHomologacao(caminho: string) {
  const janela = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(caminho, 300);
  if (error) {
    janela?.close();
    throw error;
  }
  if (janela) janela.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

// ---------------------------------------------------------------- Administrativo

export type FornecedorParaLiberar = { empresa_id: string; razao_social: string; cnpj: string; homologada_em: string; obras: string[]; email: string | null };

export async function lerParaLiberar(): Promise<FornecedorParaLiberar[]> {
  const { data, error } = await supabase.rpc('fornecedores_para_liberar');
  if (error) throw error;
  return (data ?? []) as FornecedorParaLiberar[];
}

export async function liberarPortal(empresaId: string) {
  const { error } = await supabase.rpc('liberar_portal_fornecedor', { p_empresa: empresaId });
  if (error) throw error;
}

export function formatarCnpj(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export type ObraSimples = { id: string; nome: string };
export async function lerObrasAtivas(): Promise<ObraSimples[]> {
  const { data, error } = await supabase.from('obras').select('id, nome').eq('ativa', true).neq('situacao', 'encerrada').order('nome');
  if (error) throw error;
  return (data ?? []) as ObraSimples[];
}

// ---------------------------------------------------------------- Cadastro do fornecedor (Suprimentos)

export type SituacaoDocPortal = 'vigente' | 'a_vencer' | 'vencido' | 'nao_enviado' | 'devolvido' | 'em_analise' | 'dispensado';
export type FornecedorCadastro = {
  empresa_id: string;
  razao_social: string;
  cnpj: string;
  ativa: boolean;
  homologacao: SituacaoHomologacao;
  codigo_bp: string | null;
  tipos: string[];
  exige_colaboradores: boolean;
  exige_mensal: boolean;
  situacao: SituacaoFornecedor;
  situacao_motivo: string | null;
  situacao_em: string | null;
  situacao_por: string | null;
  historico_situacao?: { em: string; de: SituacaoFornecedor; para: SituacaoFornecedor; motivo: string | null; quem: string | null }[] | null;
  liberado_em: string | null;
  email_acesso: string | null;
  emails_contato: string | null;
  dados: DadosF31;
  subcontratada: boolean;
  obras: string[];
  contratos_ativos: number;
  proximo_termino: string | null;
  documentos: { nome: string; situacao: SituacaoDocPortal; vencimento: string | null; impeditivo: boolean }[];
  certidoes: { nome: string; vencimento: string }[];
  colaboradores: { em_obra: number; liberados: number; com_vencido: number; com_vencendo: number };
};

// Situação do fornecedor com a Emais (diferente da homologação): ativo, inativo ou bloqueado.
export type SituacaoFornecedor = 'ativo' | 'inativo' | 'bloqueado';
export const NOMES_SITUACAO_FORNECEDOR: Record<SituacaoFornecedor, string> = { ativo: 'Ativo', inativo: 'Inativo', bloqueado: 'Bloqueado' };
export const SELO_SITUACAO_FORNECEDOR: Record<SituacaoFornecedor, string> = { ativo: 'selo-ok', inativo: 'selo-encerrado', bloqueado: 'selo-bloqueado' };

export async function mudarSituacaoFornecedor(empresaId: string, situacao: SituacaoFornecedor, motivo: string) {
  const { error } = await supabase.rpc('mudar_situacao_fornecedor', { p_empresa: empresaId, p_situacao: situacao, p_motivo: motivo || null });
  if (error) throw error;
}

export async function lerFornecedoresCadastro(empresaId?: string): Promise<FornecedorCadastro[]> {
  const { data, error } = await supabase.rpc('fornecedores_cadastro', empresaId ? { p_empresa: empresaId } : {});
  if (error) throw error;
  return (data ?? []) as FornecedorCadastro[];
}

export async function salvarCadastroFornecedor(empresaId: string, razao: string, cnpj: string, emails: string, dados: Partial<DadosF31>) {
  const { error } = await supabase.rpc('salvar_cadastro_fornecedor', { p_empresa: empresaId, p_razao: razao, p_cnpj: cnpj, p_emails: emails, p_dados: dados });
  if (error) throw error;
}

// O e-mail de acesso é o login do fornecedor: muda pela função do servidor, que acerta o login e o cadastro juntos.
export async function trocarEmailAcesso(empresaId: string, email: string) {
  const { error } = await supabase.functions.invoke('gerenciar-acesso', { body: { acao: 'email_fornecedor', empresa_id: empresaId, email } });
  if (error) await erroDaFuncao(error);
}

// Resumo dos documentos da empresa no portal, para a lista e o detalhe.
export function resumoDocsFornecedor(f: FornecedorCadastro) {
  const vencidos = f.documentos.filter((d) => d.situacao === 'vencido');
  const vencendo = f.documentos.filter((d) => d.situacao === 'a_vencer');
  const faltando = f.documentos.filter((d) => (d.situacao === 'nao_enviado' || d.situacao === 'devolvido') && d.impeditivo);
  return { vencidos, vencendo, faltando, certidoesVencidas: f.certidoes.filter((c) => c.vencimento < new Date().toISOString().slice(0, 10)) };
}

// ---------------------------------------------------------------- Convite pelo Outlook

export type ConviteFila = {
  id: string;
  para: string | null;
  assunto: string;
  corpo: string;
  situacao_envio: 'aguardando' | 'enviando' | 'enviado' | 'erro' | 'sem_email';
  enviado_em: string | null;
  envio_para: string | null;
  criado_em: string;
};

// Último convite da homologação na fila de e-mails (o texto já vem pronto, com o e-mail do fornecedor).
export async function lerConvite(empresaId: string): Promise<ConviteFila | null> {
  const { data, error } = await supabase
    .from('envios_fila')
    .select('id, para, assunto, corpo, situacao_envio, enviado_em, envio_para, criado_em')
    .eq('empresa_id', empresaId)
    .eq('tipo', 'convite_homologacao')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ConviteFila | null) ?? null;
}

// Mandou pelo Outlook: o envio automático não manda de novo.
export async function marcarEnviadoOutlook(envioId: string) {
  const { error } = await supabase.rpc('marcar_envio_manual', { p_envio: envioId });
  if (error) throw error;
}

// Fornecedor em homologação que ficou sem acesso: o Suprimentos cria o login com o e-mail certo.
export async function criarAcessoFornecedor(empresaId: string, nome: string, email: string) {
  const { error } = await supabase.functions.invoke('gerenciar-acesso', {
    body: { acao: 'criar', nome, email, perfil: 'fornecedor', empresas: [empresaId], obras: [], enviar: false, destino: enderecoDoSite },
  });
  if (error) await erroDaFuncao(error);
}
