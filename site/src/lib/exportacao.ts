import { supabase } from './supabase';

// Exportação mensal (Acessos > Exportar): todas as tabelas em CSV e os arquivos guardados no portal, num ZIP só.
// Serve de cópia de segurança enquanto o portal está no plano gratuito do Supabase.

export type Exportacao = { feita_em: string; feita_por: string | null; tabelas: number; linhas: number; arquivos: number; bytes: number };
export type ProgressoExportacao = { etapa: 'tabelas' | 'arquivos' | 'zip'; feito: number; total: number; detalhe?: string };

// Tabelas conhecidas; as novas que a API mostrar entram sozinhas. Visões (v_*) ficam de fora: são calculadas a
// partir das tabelas.
const TABELAS = [
  'alocacoes', 'analises_conclusoes', 'arquivos', 'avisos_liberacao', 'cobrancas', 'cobrancas_envios', 'colaboradores', 'colaboradores_bloqueios',
  'colaboradores_documentos_extras', 'contratos_fornecedor', 'contratos_obras', 'conversas', 'convites_acesso', 'documentos', 'empresas', 'empresas_obras',
  'envios_fila', 'eventos', 'exportacoes', 'homologacao_documentos', 'homologacao_tipos', 'homologacoes',
  'funcoes', 'funcoes_documentos', 'integracoes', 'integracoes_participantes', 'liberacoes_pendencia', 'medicoes', 'medicoes_arquivos',
  'medicoes_colaboradores', 'medicoes_itens', 'mensagens', 'modelos_documento', 'modelos_email', 'modelos_email_revisoes',
  'obras', 'parametros', 'parametros_historico', 'pedidos_obra', 'seg_alojamentos', 'seg_fichas_maquina', 'seg_locadoras',
  'seg_maquinas', 'seg_modelos', 'seg_modelos_revisoes', 'seg_nao_conformidades', 'seg_termos_alojamento', 'seg_vistorias',
  'tipos_documento', 'tipos_documento_historico', 'tipos_medicao', 'tst_obras', 'usuarios', 'usuarios_empresas',
];
const BUCKETS = ['documentos', 'seguranca', 'integracoes'];

export async function lerUltimaExportacao(): Promise<(Exportacao & { nome: string | null }) | null> {
  const { data, error } = await supabase.from('exportacoes').select('feita_em, feita_por, tabelas, linhas, arquivos, bytes').order('feita_em', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const e = data as Exportacao;
  let nome: string | null = null;
  if (e.feita_por) {
    const { data: u } = await supabase.from('usuarios').select('nome').eq('id', e.feita_por).maybeSingle();
    nome = (u?.nome as string | undefined) ?? null;
  }
  return { ...e, nome };
}

async function tabelasDaApi(): Promise<string[]> {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: chave, Authorization: `Bearer ${s.session?.access_token ?? chave}`, Accept: 'application/openapi+json' } });
    if (!r.ok) return [];
    const j = (await r.json()) as { definitions?: Record<string, unknown> };
    return Object.keys(j.definitions ?? {});
  } catch {
    return [];
  }
}

async function lerTabela(nome: string): Promise<Record<string, unknown>[]> {
  const linhas: Record<string, unknown>[] = [];
  const passo = 1000;
  let ordem: string | null = 'id';
  for (let i = 0; ; i += passo) {
    let q = supabase.from(nome).select('*').range(i, i + passo - 1);
    if (ordem) q = q.order(ordem);
    const { data, error } = await q;
    if (error && ordem && i === 0) {
      // Tabela sem coluna id (ex.: parametros, tst_obras): lê sem ordenar.
      ordem = null;
      i -= passo;
      continue;
    }
    if (error) throw new Error(`Não foi possível ler ${nome}: ${error.message}`);
    linhas.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < passo) break;
  }
  return linhas;
}

// CSV para abrir no Excel em português: separador ponto e vírgula, UTF-8 com BOM, campos entre aspas quando preciso.
function csv(linhas: Record<string, unknown>[]): string {
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const celula = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // CPF, CNPJ e códigos só de números: o Excel tiraria o zero da frente.
    if (typeof v === 'string' && /^\d+$/.test(t) && (t.startsWith('0') || t.length >= 11)) return `="${t}"`;
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(';'))].join('\r\n');
}

async function listarArquivos(bucket: string, pasta = '', nivel = 0): Promise<string[]> {
  if (nivel > 6) return [];
  const caminhos: string[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(pasta, { limit: 1000, offset: desde });
    if (error) throw new Error(`Não foi possível listar ${bucket}: ${error.message}`);
    for (const item of data ?? []) {
      const caminho = pasta ? `${pasta}/${item.name}` : item.name;
      if (item.id) caminhos.push(caminho);
      else caminhos.push(...(await listarArquivos(bucket, caminho, nivel + 1)));
    }
    if (!data || data.length < 1000) break;
  }
  return caminhos;
}

const hojeNome = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

export async function exportarTudo(quem: string, aoProgredir: (p: ProgressoExportacao) => void): Promise<Exportacao> {
  const { zipSync, strToU8 } = await import('fflate');
  const conteudo: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};

  const descobertas = (await tabelasDaApi()).filter((t) => !t.startsWith('v_'));
  const tabelas = [...new Set([...TABELAS, ...descobertas])].sort();
  let linhas = 0;
  const lidas: string[] = [];
  for (const [i, t] of tabelas.entries()) {
    aoProgredir({ etapa: 'tabelas', feito: i, total: tabelas.length, detalhe: t });
    let dados: Record<string, unknown>[];
    try {
      dados = await lerTabela(t);
    } catch {
      continue; // tabela que não existe mais ou sem leitura para o administrativo
    }
    linhas += dados.length;
    lidas.push(`${t}: ${dados.length} linhas`);
    conteudo[`tabelas/${t}.csv`] = [strToU8(csv(dados)), { level: 6 }];
    conteudo[`dados/${t}.json`] = [strToU8(JSON.stringify(dados)), { level: 6 }];
  }

  const arquivos: { bucket: string; caminho: string }[] = [];
  for (const b of BUCKETS) {
    try {
      (await listarArquivos(b)).forEach((caminho) => arquivos.push({ bucket: b, caminho }));
    } catch {
      // bucket sem leitura: segue com os outros
    }
  }
  let bytes = 0;
  let baixados = 0;
  const falhas: string[] = [];
  for (const [i, a] of arquivos.entries()) {
    aoProgredir({ etapa: 'arquivos', feito: i, total: arquivos.length, detalhe: a.caminho.split('/').pop() });
    const { data, error } = await supabase.storage.from(a.bucket).download(a.caminho);
    if (error || !data) {
      falhas.push(`${a.bucket}/${a.caminho}`);
      continue;
    }
    const u8 = new Uint8Array(await data.arrayBuffer());
    bytes += u8.length;
    baixados += 1;
    conteudo[`arquivos/${a.bucket}/${a.caminho}`] = [u8, { level: 0 }];
  }

  const leia = [
    'Portal de Terceiros - exportação completa',
    `Gerada em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${quem}.`,
    '',
    'tabelas/: uma planilha CSV por tabela do banco (separador ponto e vírgula, abre no Excel). CPF e CNPJ saem como texto, com o zero da frente.',
    'dados/: as mesmas tabelas em JSON, exatamente como estão no banco, para restaurar num banco novo se for preciso.',
    'arquivos/: os arquivos guardados no portal, na mesma pasta em que estão no armazenamento:',
    '  documentos (documentos e medição), seguranca (fotos e assinaturas das vistorias), integracoes (assinaturas e listas de presença).',
    'Os arquivos já apagados pelo prazo de guarda não estão aqui: a cópia deles é a do SharePoint.',
    '',
    'Contém CPF, documentos e assinaturas dos colaboradores. Guarde em pasta de acesso restrito.',
    '',
    `Tabelas (${lidas.length}):`,
    ...lidas.map((l) => `  ${l}`),
    '',
    `Arquivos: ${baixados}${falhas.length ? `. Não baixados (${falhas.length}): ${falhas.join(', ')}` : ''}`,
  ].join('\r\n');
  conteudo['LEIA-ME.txt'] = [strToU8('﻿' + leia), { level: 6 }];

  aoProgredir({ etapa: 'zip', feito: 0, total: 1 });
  const zip = zipSync(conteudo);
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${hojeNome()}_portal-terceiros_exportacao.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);

  const r = { feita_em: new Date().toISOString(), feita_por: null, tabelas: lidas.length, linhas, arquivos: baixados, bytes: zip.length };
  const { error } = await supabase.rpc('registrar_exportacao', { p_tabelas: r.tabelas, p_linhas: r.linhas, p_arquivos: r.arquivos, p_bytes: r.bytes });
  if (error) throw error;
  return r;
}
