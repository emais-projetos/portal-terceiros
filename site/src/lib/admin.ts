import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, enderecoDoSite } from './supabase';
import type { StatusAlocacao } from './consultas';
import type { Perfil } from './sessao';
import type { SituacaoPendencia } from './formato';

const TAMANHO_PAGINA = 1000;

// Lê todas as linhas de uma consulta, em páginas de 1.000 (limite padrão da API do Supabase).
async function lerTudo<T>(montar: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await montar(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return todas;
}

// ---------------------------------------------------------------- Acessos

export type Acesso = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  criado_em: string;
  empresas: { id: string; razao_social: string }[];
  obras: { id: string; nome: string }[];
  ultimo_login: string | null;
  convite: ConviteAcesso | null;
};

export type ConviteAcesso = {
  id: string;
  usuario_id: string;
  tipo: 'primeiro_acesso' | 'nova_senha';
  para: string;
  pedido_em: string;
  situacao_envio: 'aguardando' | 'enviando' | 'enviado' | 'erro' | 'cancelado';
  enviado_em: string | null;
  envio_erro: string | null;
  envio_teste: boolean;
  envio_para: string | null;
  expira_em: string | null;
  usado_em: string | null;
};

export async function lerAcessos(): Promise<Acesso[]> {
  const [{ data, error }, { data: logins, error: e2 }, { data: convites, error: e3 }] = await Promise.all([
    supabase
      .from('usuarios')
      .select('id, nome, email, perfil, ativo, criado_em, usuarios_empresas(empresas(id, razao_social)), tst_obras(obras(id, nome))')
      .order('nome'),
    supabase.rpc('acessos_ultimo_login'),
    supabase
      .from('convites_acesso')
      .select('id, usuario_id, tipo, para, pedido_em, situacao_envio, enviado_em, envio_erro, envio_teste, envio_para, expira_em, usado_em')
      .neq('situacao_envio', 'cancelado')
      .order('pedido_em', { ascending: false }),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  if (e3) throw e3;
  const ultimoLogin = new Map(((logins ?? []) as { usuario_id: string; ultimo_login: string | null }[]).map((l) => [l.usuario_id, l.ultimo_login]));
  // Só o convite mais recente de cada pessoa.
  const convite = new Map<string, ConviteAcesso>();
  ((convites ?? []) as ConviteAcesso[]).forEach((c) => {
    if (!convite.has(c.usuario_id)) convite.set(c.usuario_id, c);
  });
  type Bruto = Omit<Acesso, 'empresas' | 'obras'> & {
    usuarios_empresas: { empresas: { id: string; razao_social: string } | null }[];
    tst_obras: { obras: { id: string; nome: string } | null }[];
  };
  return ((data ?? []) as unknown as Bruto[]).map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    ativo: u.ativo,
    criado_em: u.criado_em,
    empresas: u.usuarios_empresas.map((x) => x.empresas).filter((x): x is { id: string; razao_social: string } => !!x),
    obras: u.tst_obras.map((x) => x.obras).filter((x): x is { id: string; nome: string } => !!x),
    ultimo_login: ultimoLogin.get(u.id) ?? null,
    convite: convite.get(u.id) ?? null,
  }));
}

// Modo de teste e pausa do envio automático (Acessos > Regras), para avisar antes de enviar.
export async function lerEnvioAutomatico(): Promise<{ testePara: string; pausado: boolean }> {
  const { data, error } = await supabase
    .from('parametros')
    .select('chave, valor')
    .in('chave', ['cobranca_automatica_teste_para', 'cobranca_automatica_pausada']);
  if (error) throw error;
  const p = new Map((data ?? []).map((x) => [x.chave as string, ((x.valor as string) ?? '').trim()]));
  return { testePara: p.get('cobranca_automatica_teste_para') ?? '', pausado: (p.get('cobranca_automatica_pausada') ?? '').toLowerCase() === 'sim' };
}

// obras: onde a empresa atua hoje (empresas_obras ativas).
export type EmpresaOpcao = { id: string; razao_social: string; cnpj: string; temAcesso: boolean; obras: string[] };

export async function lerEmpresas(): Promise<EmpresaOpcao[]> {
  const [{ data: empresas, error: e1 }, { data: vinculos, error: e2 }, { data: atuacao, error: e3 }] = await Promise.all([
    supabase.from('empresas').select('id, razao_social, cnpj').order('razao_social'),
    supabase.from('usuarios_empresas').select('empresa_id'),
    supabase.from('empresas_obras').select('empresa_id, obra_id').eq('ativo', true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  const ocupadas = new Set((vinculos ?? []).map((v) => v.empresa_id as string));
  const obrasDa = new Map<string, string[]>();
  (atuacao ?? []).forEach((x) => obrasDa.set(x.empresa_id as string, [...(obrasDa.get(x.empresa_id as string) ?? []), x.obra_id as string]));
  return (empresas ?? []).map((e) => ({ ...e, temAcesso: ocupadas.has(e.id), obras: obrasDa.get(e.id) ?? [] }));
}

// Liga as empresas às obras onde vão atuar. Só acrescenta: o que já existe fica como está (e volta a valer se estava desligado).
export async function ligarEmpresasObras(empresas: string[], obras: string[]) {
  const linhas = empresas.flatMap((empresa_id) => obras.map((obra_id) => ({ empresa_id, obra_id, ativo: true })));
  if (!linhas.length) return;
  const { error } = await supabase.from('empresas_obras').upsert(linhas, { onConflict: 'empresa_id,obra_id' });
  if (error) throw error;
}

export type Obra = { id: string; nome: string };

export async function lerObras(): Promise<Obra[]> {
  const { data, error } = await supabase.from('obras').select('id, nome').eq('ativa', true).order('nome');
  if (error) throw error;
  return data ?? [];
}

export type LinkAcesso = {
  usuario_id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  link: string;
  primeiro_acesso: boolean;
  convite_id?: string | null;
  convite_erro?: string;
};

async function chamarFuncaoAcesso(corpo: Record<string, unknown>): Promise<LinkAcesso> {
  const { data, error } = await supabase.functions.invoke('gerenciar-acesso', {
    body: { ...corpo, destino: enderecoDoSite },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detalhe = await error.context.json().catch(() => null);
      throw new Error(detalhe?.erro ?? 'Não foi possível concluir.');
    }
    throw error;
  }
  return data as LinkAcesso;
}

export function criarAcesso(dados: { nome: string; email: string; perfil: Perfil; empresas: string[]; obras: string[]; enviar: boolean }) {
  return chamarFuncaoAcesso({ acao: 'criar', ...dados });
}

export async function editarAcesso(dados: { usuario_id: string; nome: string; email: string; empresas: string[]; obras: string[] }) {
  return (await chamarFuncaoAcesso({ acao: 'editar', ...dados })) as unknown as { trocou_email: boolean; email: string; nome: string };
}

// Empresa nova (fornecedor que ainda não estava na base), com as obras onde vai trabalhar.
export async function cadastrarEmpresa(dados: {
  razao_social: string;
  cnpj: string;
  email_contato: string | null;
  obras: string[];
  subcontratada: boolean;
  empresa_principal_id: string | null;
}): Promise<EmpresaOpcao> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('empresas').insert({ id, razao_social: dados.razao_social, cnpj: dados.cnpj, email_contato: dados.email_contato });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Este CNPJ já está cadastrado. Procure a empresa na lista.');
    throw error;
  }
  if (dados.obras.length) {
    const { error: e2 } = await supabase.from('empresas_obras').insert(
      dados.obras.map((obra_id) => ({
        empresa_id: id,
        obra_id,
        subcontratada: dados.subcontratada,
        empresa_principal_id: dados.subcontratada ? dados.empresa_principal_id : null,
      })),
    );
    if (e2) throw e2;
  }
  return { id, razao_social: dados.razao_social, cnpj: dados.cnpj, temAcesso: false, obras: dados.obras };
}

export function gerarLinkAcesso(usuarioId: string) {
  return chamarFuncaoAcesso({ acao: 'link', usuario_id: usuarioId });
}

// Convite pelo envio automático: entra na fila e o n8n manda o e-mail.
export async function enviarAcesso(usuarioId: string) {
  return (await chamarFuncaoAcesso({ acao: 'enviar', usuario_id: usuarioId })) as unknown as { nome: string; email: string; convite: ConviteAcesso };
}

// Página /acesso (pública): confere e usa o convite do e-mail.
export type SituacaoConvite = {
  situacao: 'valido' | 'ok' | 'usado' | 'vencido' | 'substituido' | 'desativado' | 'invalido';
  tipo?: 'primeiro_acesso' | 'nova_senha';
  primeiro_nome?: string;
  email?: string;
  link?: string;
};

export async function consultarConvite(codigo: string, usar: boolean): Promise<SituacaoConvite> {
  const { data, error } = await supabase.functions.invoke('resgatar-convite', {
    body: { acao: usar ? 'usar' : 'ver', codigo, destino: enderecoDoSite },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detalhe = await error.context.json().catch(() => null);
      throw new Error(detalhe?.erro ?? 'Não foi possível concluir.');
    }
    throw error;
  }
  return data as SituacaoConvite;
}

export async function alterarAtivo(usuarioId: string, ativo: boolean) {
  const { error } = await supabase.from('usuarios').update({ ativo }).eq('id', usuarioId);
  if (error) throw error;
}

// ---------------------------------------------------------------- Análise de documentos

export type DocumentoEmAnalise = {
  id: string;
  tipo_codigo: string;
  colaborador_id: string | null;
  data_emissao: string | null;
  data_vencimento_informada: string | null;
  dispensado: boolean;
  dados: Record<string, unknown>;
  enviado_em: string;
  aceite_lgpd_em: string | null;
  tipos_documento: {
    nome: string;
    grupo: 'empresa' | 'colaborador' | 'obra';
    area: string;
    regra: 'emissao_mais_prazo' | 'vigencia_informada' | 'sem_vencimento';
    validade_dias: number | null;
    impeditivo: boolean;
  };
  empresas: { razao_social: string; cnpj: string };
  colaboradores: { nome: string; cpf: string | null } | null;
  arquivos: {
    id: string;
    caminho: string;
    nome_original: string;
    tamanho_bytes: number | null;
    tipo_mime: string | null;
    baixado_em: string | null;
    apagado_em: string | null;
  }[];
};

// "Outro documento": o nome que aparece é o que o fornecedor escreveu ao incluir (ex.: "Outro documento: treinamento de escavadeira").
export async function lerFilaAnalise(): Promise<DocumentoEmAnalise[]> {
  const docs = await lerFilaAnaliseBruta();
  const outros = [...new Set(docs.filter((d) => d.tipo_codigo === 'outro_documento' && d.colaborador_id).map((d) => d.colaborador_id as string))];
  if (!outros.length) return docs;
  const { data, error } = await supabase
    .from('colaboradores_documentos_extras')
    .select('colaborador_id, motivo')
    .eq('tipo_codigo', 'outro_documento')
    .in('colaborador_id', outros);
  if (error) throw error;
  const descricao = new Map((data ?? []).map((x) => [x.colaborador_id as string, ((x.motivo as string) ?? '').trim()]));
  return docs.map((d) => {
    const texto = d.tipo_codigo === 'outro_documento' && d.colaborador_id ? descricao.get(d.colaborador_id) : '';
    return texto ? { ...d, tipos_documento: { ...d.tipos_documento, nome: `${d.tipos_documento.nome}: ${texto}` } } : d;
  });
}

async function lerFilaAnaliseBruta(): Promise<DocumentoEmAnalise[]> {
  return lerTudo<DocumentoEmAnalise>((inicio, fim) =>
    supabase
      .from('documentos')
      .select(
        'id, tipo_codigo, colaborador_id, data_emissao, data_vencimento_informada, dispensado, dados, enviado_em, aceite_lgpd_em, ' +
          'tipos_documento(nome, grupo, area, regra, validade_dias, impeditivo), empresas(razao_social, cnpj), ' +
          'colaboradores(nome, cpf), arquivos(id, caminho, nome_original, tamanho_bytes, tipo_mime, baixado_em, apagado_em)',
      )
      .eq('status', 'em_analise')
      .order('enviado_em')
      .range(inicio, fim) as unknown as PromiseLike<{ data: DocumentoEmAnalise[] | null; error: unknown }>,
  );
}

export async function contarEmAnalise(): Promise<number> {
  const { count, error } = await supabase
    .from('documentos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'em_analise');
  if (error) throw error;
  return count ?? 0;
}

export function vencimentoDoDocumento(d: Pick<DocumentoEmAnalise, 'data_emissao' | 'data_vencimento_informada' | 'dispensado' | 'tipos_documento'>): string | null {
  if (d.dispensado) return null;
  const t = d.tipos_documento;
  if (t.regra === 'emissao_mais_prazo' && d.data_emissao && t.validade_dias) {
    const [a, m, dia] = d.data_emissao.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, dia + t.validade_dias)).toISOString().slice(0, 10);
  }
  // Sem vencimento: só vence se o administrativo informou a vigência na análise (ex.: outro documento).
  return d.data_vencimento_informada;
}

export async function abrirArquivo(caminho: string) {
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(caminho, 300);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

type ArquivoDoc = DocumentoEmAnalise['arquivos'][number];

function limparParaNome(texto: string): string {
  return texto
    .replace(/[\\/]+/g, '-')
    .replace(/[:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dataCompacta(valor: string): string {
  const d = new Date(valor);
  if (valor.length === 10) return valor.replace(/-/g, '');
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10).replace(/-/g, '');
}

// Nome do arquivo para guardar no SharePoint: AAAAMMDD_documento_colaborador.
// A data é a emissão do documento; quando o tipo não tem emissão (RG, CTPS, seguro), vale a data do envio.
export function nomePadronizado(d: DocumentoEmAnalise, arquivo: ArquivoDoc, ordem: number, total: number): string {
  const dataArq = dataCompacta(d.data_emissao ?? d.enviado_em);
  const quem = d.colaboradores?.nome ?? d.empresas.razao_social;
  const extensao = arquivo.nome_original.includes('.') ? arquivo.nome_original.split('.').pop()!.toLowerCase() : 'pdf';
  const parte = total > 1 ? ` (${ordem} de ${total})` : '';
  return `${dataArq}_${limparParaNome(d.tipos_documento.nome)}_${limparParaNome(quem)}${parte}.${extensao}`;
}

export async function baixarArquivo(d: DocumentoEmAnalise, arquivo: ArquivoDoc) {
  const ativos = d.arquivos.filter((a) => !a.apagado_em);
  const nome = nomePadronizado(d, arquivo, ativos.indexOf(arquivo) + 1, ativos.length);
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(arquivo.caminho, 300, { download: nome });
  if (error) throw error;
  const { error: erroRegistro } = await supabase.rpc('registrar_download', { p_arquivos: [arquivo.id] });
  if (erroRegistro) throw erroRegistro;
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Baixa todos os arquivos dos documentos num ZIP, já com o nome padronizado.
// Com mais de uma empresa, cada empresa vira uma pasta dentro do ZIP.
export async function baixarTodos(docs: DocumentoEmAnalise[], nomeZip: string, aoProgredir?: (feitos: number, total: number) => void): Promise<number> {
  const { zipSync } = await import('fflate');
  const itens = docs.flatMap((d) => {
    const ativos = d.arquivos.filter((a) => !a.apagado_em);
    return ativos.map((a, i) => ({ d, a, nome: nomePadronizado(d, a, i + 1, ativos.length) }));
  });
  if (itens.length === 0) throw new Error('Nenhum arquivo para baixar.');
  const variasEmpresas = new Set(itens.map((x) => x.d.empresas.razao_social)).size > 1;
  const conteudo: Record<string, Uint8Array> = {};
  const usados = new Set<string>();

  let feitos = 0;
  for (const { d, a, nome } of itens) {
    const { data: blob, error } = await supabase.storage.from('documentos').download(a.caminho);
    if (error || !blob) throw new Error(`Não foi possível baixar ${a.nome_original}. Tente de novo.`);
    let caminho = variasEmpresas ? `${limparParaNome(d.empresas.razao_social)}/${nome}` : nome;
    // Mesmo nome duas vezes (ex.: dois envios no mesmo dia): acrescenta um número.
    for (let n = 2; usados.has(caminho); n++) caminho = caminho.replace(/(\.[^.]+)$/, ` ${n}$1`);
    usados.add(caminho);
    conteudo[caminho] = new Uint8Array(await blob.arrayBuffer());
    feitos += 1;
    aoProgredir?.(feitos, itens.length);
  }

  const zip = zipSync(conteudo, { level: 0 });
  const { error: erroRegistro } = await supabase.rpc('registrar_download', { p_arquivos: itens.map((x) => x.a.id) });
  if (erroRegistro) throw erroRegistro;

  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeZip;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return itens.length;
}

export function nomeDoZip(rotulo: string): string {
  const hoje = dataCompacta(new Date().toISOString());
  return `${hoje}_documentos_${limparParaNome(rotulo).replace(/\s+/g, '_')}.zip`;
}

export async function aprovarDocumento(id: string, vencimento?: string) {
  const { error } = await supabase.rpc('aprovar_documento', { p_documento: id, p_vencimento: vencimento || null });
  if (error) throw error;
}

export async function devolverDocumento(id: string, motivo: string) {
  const { error } = await supabase.rpc('devolver_documento', { p_documento: id, p_motivo: motivo });
  if (error) throw error;
}

// ---------------------------------------------------------------- Colaboradores e alocações

export type AlocacaoResumo = {
  alocacao_id: string;
  status: StatusAlocacao;
  obra_id: string;
  obra: string;
  colaborador_id: string;
  colaborador: string;
  funcao: string | null;
  empresa_id: string;
  empresa: string;
  inicio_conferencia: string | null;
  aprovado_admin_em: string | null;
  validado_tst_em: string | null;
  data_integracao: string | null;
  vencimento_integracao: string | null;
  impeditivos_pendentes: number;
  pendentes_adm: number;
  pendentes_sst: number;
  devolvidos: number;
  em_analise: number;
  a_vencer: number;
  bloqueado: boolean;
  bloqueio_motivo: string | null;
};

export async function lerAlocacoes(): Promise<AlocacaoResumo[]> {
  return lerTudo<AlocacaoResumo>((inicio, fim) =>
    supabase
      .from('v_alocacoes_resumo')
      .select(
        'alocacao_id, status, obra_id, obra, colaborador_id, colaborador, funcao, empresa_id, empresa, inicio_conferencia, ' +
          'aprovado_admin_em, validado_tst_em, data_integracao, vencimento_integracao, impeditivos_pendentes, pendentes_adm, ' +
          'pendentes_sst, devolvidos, em_analise, a_vencer, bloqueado, bloqueio_motivo',
      )
      .order('alocacao_id')
      .range(inicio, fim) as unknown as PromiseLike<{ data: AlocacaoResumo[] | null; error: unknown }>,
  );
}

export async function lerIdsComPendenciaCadastro(): Promise<Set<string>> {
  const { data, error } = await supabase.from('colaboradores').select('id').not('pendencia_cadastro', 'is', null);
  if (error) throw error;
  return new Set((data ?? []).map((c) => c.id as string));
}

export type Colaborador = {
  id: string;
  nome: string;
  cpf: string | null;
  funcao_texto: string | null;
  situacao: 'ativo' | 'demitido' | 'desistente';
  pendencia_cadastro: string | null;
  funcao_id: string | null;
  data_admissao: string | null;
  data_nascimento: string | null;
  funcoes: { nome: string } | null;
  empresa_id: string;
  data_desligamento: string | null;
  bloqueado: boolean;
  bloqueio_motivo: string | null;
  bloqueado_em: string | null;
};

export async function lerColaborador(id: string): Promise<Colaborador> {
  const { data, error } = await supabase
    .from('colaboradores')
    .select('id, nome, cpf, funcao_texto, situacao, pendencia_cadastro, funcao_id, data_admissao, data_nascimento, funcoes(nome), empresa_id, data_desligamento, bloqueado, bloqueio_motivo, bloqueado_em')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as Colaborador;
}

export async function salvarCadastro(
  id: string,
  dados: { nome: string; cpf: string | null; pendencia_cadastro: string | null; funcao_id?: string | null; data_admissao?: string | null; data_nascimento?: string | null },
) {
  const { error } = await supabase.from('colaboradores').update(dados).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Já existe outro colaborador desta empresa com este CPF.');
    throw error;
  }
}

// ---------------------------------------------------------------- Treinamentos (NR) por colaborador
// A função define as NRs obrigatórias. O administrativo pode abrir exceção para um colaborador:
// tornar obrigatória uma NR que a função não pede, ou tirar uma que a função pede. Sempre com motivo.

export type Excecao = { tipo_codigo: string; exige: boolean; motivo: string | null; incluido_em: string };

export type BaseTreinamentos = {
  tipos: { codigo: string; nome: string }[];
  porFuncao: Map<string, Set<string>>; // funcao_id -> NRs exigidas
  funcoes: { id: string; nome: string }[];
};

export async function lerBaseTreinamentos(): Promise<BaseTreinamentos> {
  const [{ data: tipos, error: e1 }, { data: fd, error: e2 }, { data: funcoes, error: e3 }] = await Promise.all([
    supabase.from('tipos_documento').select('codigo, nome').eq('depende_da_funcao', true).eq('ativo', true).order('ordem'),
    supabase.from('funcoes_documentos').select('funcao_id, tipo_codigo').limit(5000),
    supabase.from('funcoes').select('id, nome').order('nome'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  const porFuncao = new Map<string, Set<string>>();
  (fd ?? []).forEach((r: { funcao_id: string; tipo_codigo: string }) => {
    porFuncao.set(r.funcao_id, (porFuncao.get(r.funcao_id) ?? new Set()).add(r.tipo_codigo));
  });
  return { tipos: (tipos ?? []) as BaseTreinamentos['tipos'], porFuncao, funcoes: (funcoes ?? []) as BaseTreinamentos['funcoes'] };
}

export async function lerExcecoes(colaboradorId: string): Promise<Excecao[]> {
  const { data, error } = await supabase
    .from('colaboradores_documentos_extras')
    .select('tipo_codigo, exige, motivo, incluido_em')
    .eq('colaborador_id', colaboradorId);
  if (error) throw error;
  return (data ?? []) as Excecao[];
}

// Grava só o que difere da função; o que voltou a seguir a função perde a exceção.
// Exceção que já existia e não mudou fica como está (com o motivo e a data de antes).
export function excecoesNovas(exigidos: Set<string>, daFuncao: Set<string>, existentes: Excecao[], todos: string[]) {
  const atual = new Map(existentes.map((e) => [e.tipo_codigo, e.exige]));
  const gravar = todos.filter((c) => exigidos.has(c) !== daFuncao.has(c) && atual.get(c) !== exigidos.has(c));
  const apagar = todos.filter((c) => exigidos.has(c) === daFuncao.has(c) && atual.has(c));
  return { gravar, apagar };
}

export async function salvarTreinamentos(colaboradorId: string, exigidos: Set<string>, daFuncao: Set<string>, existentes: Excecao[], todos: string[], motivo: string) {
  const { gravar, apagar } = excecoesNovas(exigidos, daFuncao, existentes, todos);
  if (apagar.length) {
    const { error } = await supabase.from('colaboradores_documentos_extras').delete().eq('colaborador_id', colaboradorId).in('tipo_codigo', apagar);
    if (error) throw error;
  }
  if (gravar.length) {
    const { error } = await supabase
      .from('colaboradores_documentos_extras')
      .upsert(gravar.map((tipo_codigo) => ({ colaborador_id: colaboradorId, tipo_codigo, exige: exigidos.has(tipo_codigo), motivo })));
    if (error) throw error;
  }
}

export type Pendencia = {
  tipo_codigo: string;
  documento: string;
  grupo: 'empresa' | 'colaborador' | 'obra';
  area: string;
  impeditivo: boolean;
  vencimento: string | null;
  dias_para_vencer: number | null;
  status_envio_aberto: string | null;
  motivo_devolucao: string | null;
  situacao: SituacaoPendencia;
};

export async function lerPendencias(alocacaoId: string): Promise<Pendencia[]> {
  const { data, error } = await supabase
    .from('v_pendencias')
    .select('tipo_codigo, documento, grupo, area, impeditivo, vencimento, dias_para_vencer, status_envio_aberto, motivo_devolucao, situacao')
    .eq('alocacao_id', alocacaoId);
  if (error) throw error;
  return (data ?? []) as Pendencia[];
}

export async function aprovarAlocacao(id: string) {
  const { error } = await supabase.rpc('aprovar_alocacao', { p_alocacao: id });
  if (error) throw error;
}

export async function registrarIntegracao(id: string, dataIso: string) {
  const { error } = await supabase.rpc('registrar_integracao', { p_alocacao: id, p_data: dataIso });
  if (error) throw error;
}

// ---------------------------------------------------------------- Aviso de liberação

export type AvisoLiberacao = {
  id: string;
  obra_id: string;
  alocacoes: string[];
  destinatarios: string | null;
  assunto: string;
  corpo: string;
  gerado_em: string;
  marcado_enviado_em: string | null;
  situacao_envio: 'aguardando' | 'enviando' | 'enviado' | 'erro' | null;
  envio_pedido_em: string | null;
  enviado_em: string | null;
  envio_erro: string | null;
  envio_teste: boolean;
  envio_para: string | null;
};

export async function lerAvisos(obraId: string): Promise<AvisoLiberacao[]> {
  const { data, error } = await supabase
    .from('avisos_liberacao')
    .select('id, obra_id, alocacoes, destinatarios, assunto, corpo, gerado_em, marcado_enviado_em, situacao_envio, envio_pedido_em, enviado_em, envio_erro, envio_teste, envio_para')
    .eq('obra_id', obraId)
    .order('gerado_em', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AvisoLiberacao[];
}

export async function gerarAviso(obraId: string, alocacoes: string[], destinatarios: string): Promise<AvisoLiberacao> {
  const { data, error } = await supabase.rpc('gerar_aviso_liberacao', {
    p_obra: obraId,
    p_alocacoes: alocacoes,
    p_destinatarios: destinatarios,
  });
  if (error) throw error;
  return data as AvisoLiberacao;
}

// Gera o aviso e coloca na fila: o n8n envia em até 10 minutos.
export async function enviarAviso(obraId: string, alocacoes: string[], destinatarios: string): Promise<AvisoLiberacao> {
  const { data, error } = await supabase.rpc('enviar_aviso_liberacao', { p_obra: obraId, p_alocacoes: alocacoes, p_destinatarios: destinatarios });
  if (error) throw error;
  return data as AvisoLiberacao;
}

export async function reenviarAviso(id: string): Promise<AvisoLiberacao> {
  const { data, error } = await supabase.rpc('reenviar_aviso_liberacao', { p_aviso: id });
  if (error) throw error;
  return data as AvisoLiberacao;
}

export async function marcarAvisoEnviado(id: string) {
  const { error } = await supabase.from('avisos_liberacao').update({ marcado_enviado_em: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export function linkOutlook(para: string, assunto: string, corpo: string): string {
  const destino = para
    .split(/[;,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .join(';');
  return `mailto:${encodeURIComponent(destino).replace(/%3B/g, ';').replace(/%40/g, '@')}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

export async function copiarTexto(texto: string) {
  await navigator.clipboard.writeText(texto);
}

// ---------------------------------------------------------------- Validação do TST

export async function validarAlocacao(id: string) {
  const { error } = await supabase.rpc('validar_alocacao_tst', { p_alocacao: id });
  if (error) throw error;
}

export async function devolverAlocacaoTst(id: string, motivo: string) {
  const { error } = await supabase.rpc('devolver_alocacao_tst', { p_alocacao: id, p_motivo: motivo });
  if (error) throw error;
}

export async function contarAguardandoTst(): Promise<number> {
  const { count, error } = await supabase
    .from('alocacoes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'aprovado_admin');
  if (error) throw error;
  return count ?? 0;
}

// Última devolução do TST para o administrativo (o motivo fica no histórico de eventos).
export async function lerDevolucaoTst(alocacaoId: string): Promise<{ motivo: string; em: string } | null> {
  const { data, error } = await supabase
    .from('eventos')
    .select('detalhe, criado_em')
    .eq('tabela', 'alocacoes')
    .eq('registro_id', alocacaoId)
    .eq('acao', 'devolvida_tst')
    .order('criado_em', { ascending: false })
    .limit(1);
  if (error) throw error;
  const e = data?.[0];
  return e ? { motivo: String((e.detalhe as { motivo?: string })?.motivo ?? ''), em: e.criado_em as string } : null;
}

// ---------------------------------------------------------------- Ajustes de 06/11/2026

// Último envio (aprovado ou em análise) de um documento do colaborador, com os arquivos ainda guardados.
// O TST só enxerga os anexos das NRs.
export async function lerAnexos(colaboradorId: string, tipo: string): Promise<{ caminho: string; nome_original: string }[]> {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, status, enviado_em, arquivos(caminho, nome_original, apagado_em)')
    .eq('colaborador_id', colaboradorId)
    .eq('tipo_codigo', tipo)
    .in('status', ['aprovado', 'em_analise'])
    .order('enviado_em', { ascending: false })
    .limit(1);
  if (error) throw error;
  type Linha = { arquivos: { caminho: string; nome_original: string; apagado_em: string | null }[] };
  const doc = (data ?? [])[0] as unknown as Linha | undefined;
  return (doc?.arquivos ?? []).filter((a) => !a.apagado_em).map((a) => ({ caminho: a.caminho, nome_original: a.nome_original }));
}

export type ObraCadastro = { id: string; nome: string; ativa: boolean };

export async function lerObrasCadastro(): Promise<ObraCadastro[]> {
  const { data, error } = await supabase.from('obras').select('id, nome, ativa').order('nome');
  if (error) throw error;
  return (data ?? []) as ObraCadastro[];
}

export async function criarObra(nome: string): Promise<string> {
  const { data, error } = await supabase.from('obras').insert({ nome: nome.trim().toUpperCase() }).select('id').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Já existe uma obra com este nome.');
    throw error;
  }
  return data.id as string;
}

export async function renomearObra(id: string, nome: string) {
  const { error } = await supabase.from('obras').update({ nome: nome.trim().toUpperCase() }).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Já existe uma obra com este nome.');
    throw error;
  }
}

// Administrativo aloca em outra obra; se a empresa ainda não atua na obra, passa a atuar.
export async function alocarComoAdmin(colaboradorId: string, empresaId: string, obraId: string) {
  const { data: eo, error: e1 } = await supabase.from('empresas_obras').select('id, ativo').eq('empresa_id', empresaId).eq('obra_id', obraId).maybeSingle();
  if (e1) throw e1;
  if (!eo) {
    const { error } = await supabase.from('empresas_obras').insert({ empresa_id: empresaId, obra_id: obraId });
    if (error) throw error;
  } else if (!eo.ativo) {
    const { error } = await supabase.from('empresas_obras').update({ ativo: true }).eq('id', eo.id);
    if (error) throw error;
  }
  const { error } = await supabase.from('alocacoes').insert({ colaborador_id: colaboradorId, obra_id: obraId });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('O colaborador já está nesta obra.');
    throw error;
  }
}

export async function lerEmailEmpresa(empresaId: string): Promise<string> {
  const { data, error } = await supabase.from('empresas').select('email_contato, email_acesso').eq('id', empresaId).maybeSingle();
  if (error) throw error;
  return ((data?.email_contato as string | null) ?? (data?.email_acesso as string | null) ?? '').trim();
}

// E-mails das empresas (contato ou acesso), para pré-preencher avisos.
export async function lerEmailsEmpresas(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('empresas').select('id, email_contato, email_acesso').limit(5000);
  if (error) throw error;
  return new Map((data ?? []).map((e) => [e.id as string, ((e.email_contato as string | null) ?? (e.email_acesso as string | null) ?? '').trim()]));
}

// E-mails dos TSTs ativos de uma obra.
export async function lerEmailsTst(obraId: string): Promise<string[]> {
  const { data, error } = await supabase.from('tst_obras').select('usuarios(email, perfil, ativo)').eq('obra_id', obraId);
  if (error) throw error;
  type Linha = { usuarios: { email: string; perfil: string; ativo: boolean } | null };
  return ((data ?? []) as unknown as Linha[])
    .map((l) => l.usuarios)
    .filter((u): u is { email: string; perfil: string; ativo: boolean } => !!u && u.perfil === 'tst' && u.ativo)
    .map((u) => u.email);
}
