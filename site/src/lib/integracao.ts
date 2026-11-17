import { supabase } from './supabase';
import { gerarListaPresenca, type ModeloLista } from './listaPresenca';

export type Integracao = {
  id: string;
  obra_id: string;
  data: string;
  horario: string | null;
  local: string | null;
  responsavel: string;
  criado_em: string;
  concluida_em: string | null;
  cancelada_em: string | null;
  lista_pdf: string | null;
  integracoes_participantes: Participante[];
};

export type Participante = {
  alocacao_id: string;
  presente: boolean | null;
  assinatura: string | null;
  assinado_em: string | null;
  nao_assina: boolean;
  codigo_assinatura: string | null;
};

export async function lerIntegracoes(obraId: string): Promise<Integracao[]> {
  const { data: linhas, error } = await supabase
    .from('integracoes')
    .select('id, obra_id, data, horario, local, responsavel, criado_em, concluida_em, cancelada_em, lista_pdf, integracoes_participantes(alocacao_id, presente, assinatura, assinado_em, nao_assina, codigo_assinatura)')
    .eq('obra_id', obraId)
    .is('cancelada_em', null)
    .order('data', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (linhas ?? []) as Integracao[];
}

export async function criarIntegracao(dados: {
  obraId: string;
  data: string;
  horario: string;
  local: string;
  responsavel: string;
  alocacoes: string[];
}): Promise<Integracao> {
  const { data: i, error } = await supabase.rpc('criar_integracao', {
    p_obra: dados.obraId,
    p_data: dados.data,
    p_horario: dados.horario,
    p_local: dados.local,
    p_responsavel: dados.responsavel,
    p_alocacoes: dados.alocacoes,
  });
  if (error) throw error;
  return {
    ...(i as Omit<Integracao, 'integracoes_participantes'>),
    integracoes_participantes: dados.alocacoes.map((alocacao_id) => ({ alocacao_id, presente: null, assinatura: null, assinado_em: null, nao_assina: false, codigo_assinatura: null })),
  };
}

export async function concluirIntegracao(id: string, presentes: string[]): Promise<number> {
  const { data: qtd, error } = await supabase.rpc('concluir_integracao', { p_integracao: id, p_presentes: presentes });
  if (error) throw error;
  return qtd as number;
}

// Assinatura na tela (tablet/celular): o PNG vai para o bucket "integracoes" e o caminho fica no participante.
// Recorta o quadro na área desenhada (com margem), para a assinatura ocupar a célula da lista em PDF.
async function recortar(png: Blob): Promise<Blob> {
  try {
    const img = await createImageBitmap(png);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (data[(y * c.width + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return png;
    const m = 12;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m);
    const r = document.createElement('canvas');
    r.width = x1 - x0 + 1;
    r.height = y1 - y0 + 1;
    r.getContext('2d')!.drawImage(c, x0, y0, r.width, r.height, 0, 0, r.width, r.height);
    return await new Promise<Blob>((ok) => r.toBlob((b) => ok(b ?? png), 'image/png'));
  } catch {
    return png;
  }
}

export async function assinarIntegracao(integracaoId: string, alocacaoId: string, original: Blob): Promise<string> {
  const png = await recortar(original);
  const caminho = `${integracaoId}/${alocacaoId}-${Date.now()}.png`;
  const { error: e1 } = await supabase.storage.from('integracoes').upload(caminho, png, { contentType: 'image/png', upsert: false });
  if (e1) throw new Error(`Não foi possível gravar a assinatura: ${e1.message}`);
  const { error } = await supabase.rpc('assinar_integracao', { p_integracao: integracaoId, p_alocacao: alocacaoId, p_caminho: caminho });
  if (error) throw error;
  return caminho;
}

// Não sabe assinar: o portal gera um registro eletrônico (data, hora, código, quem registrou). Devolve o código.
export async function registrarSemAssinatura(integracaoId: string, alocacaoId: string, registrar: boolean): Promise<string | null> {
  const { data, error } = await supabase.rpc('registrar_sem_assinatura', { p_integracao: integracaoId, p_alocacao: alocacaoId, p_registrar: registrar });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function apagarAssinatura(integracaoId: string, alocacaoId: string) {
  const { error } = await supabase.rpc('assinar_integracao', { p_integracao: integracaoId, p_alocacao: alocacaoId, p_caminho: null });
  if (error) throw error;
}

// Links temporários (1 hora) das assinaturas, para mostrar na tela.
export async function linksAssinaturas(caminhos: string[]): Promise<Record<string, string>> {
  if (!caminhos.length) return {};
  const { data, error } = await supabase.storage.from('integracoes').createSignedUrls(caminhos, 3600);
  if (error) throw error;
  const r: Record<string, string> = {};
  (data ?? []).forEach((x) => { if (x.signedUrl && x.path) r[x.path] = x.signedUrl; });
  return r;
}

async function comoDataUrl(blob: Blob): Promise<string> {
  return await new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(leitor.result as string);
    leitor.onerror = () => falha(new Error('Não foi possível ler a assinatura.'));
    leitor.readAsDataURL(blob);
  });
}

async function assinaturasEmDataUrl(caminhos: string[]): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  await Promise.all(
    caminhos.map(async (c) => {
      const { data, error } = await supabase.storage.from('integracoes').download(c);
      if (!error && data) r[c] = await comoDataUrl(data);
    }),
  );
  return r;
}

export async function cancelarIntegracao(id: string) {
  const { error } = await supabase.rpc('cancelar_integracao', { p_integracao: id });
  if (error) throw error;
}

export type ParticipanteLista = { alocacao_id: string; nome: string; empresa: string; funcao: string | null; presente?: boolean | null };

// Documento controlado "Declaração de recebimento de treinamento": texto, revisão e data vêm do banco.
export async function lerModeloLista(): Promise<ModeloLista> {
  const { data: m, error } = await supabase
    .from('modelos_documento')
    .select('titulo, setor, data_revisao, revisao, conteudo')
    .eq('codigo', 'lista_presenca_integracao')
    .single();
  if (error) throw new Error('Não foi possível carregar o modelo da lista de presença. Tente de novo.');
  return m as ModeloLista;
}

async function lerLogo(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}logo-emais.png`);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((ok) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(leitor.result as string);
      leitor.onerror = () => ok(null);
      leitor.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

// Assinaturas e registros eletrônicos da turma, lidos do banco na hora de gerar o PDF.
async function lerEvidencias(integracaoId: string): Promise<Map<string, Participante>> {
  const { data, error } = await supabase
    .from('integracoes_participantes')
    .select('alocacao_id, presente, assinatura, assinado_em, nao_assina, codigo_assinatura')
    .eq('integracao_id', integracaoId);
  if (error) throw error;
  return new Map(((data ?? []) as Participante[]).map((p) => [p.alocacao_id, p]));
}

async function gerarPdf(i: Pick<Integracao, 'id' | 'data' | 'responsavel' | 'concluida_em'>, obra: string, participantes: ParticipanteLista[]) {
  const evid = await lerEvidencias(i.id);
  const caminhos = [...evid.values()].map((p) => p.assinatura).filter((c): c is string => !!c);
  const [{ jsPDF }, modelo, logo, imagens] = await Promise.all([import('jspdf'), lerModeloLista(), lerLogo(), assinaturasEmDataUrl(caminhos)]);
  const lista = (i.concluida_em ? participantes.filter((p) => p.presente) : participantes).map((p) => ({ ...p, e: evid.get(p.alocacao_id) }));
  const porEmpresa = new Map<string, typeof lista>();
  lista.forEach((p) => porEmpresa.set(p.empresa, [...(porEmpresa.get(p.empresa) ?? []), p]));
  const empresas = [...porEmpresa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([empresa, ps]) => ({
      empresa,
      participantes: ps
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .map((p) => ({
          nome: p.nome,
          funcao: p.funcao,
          assinatura: p.e?.assinatura ? imagens[p.e.assinatura] ?? null : null,
          semAssinatura: p.e?.nao_assina && p.e.codigo_assinatura ? { codigo: p.e.codigo_assinatura, quando: dataHora(p.e.assinado_em!) } : null,
        })),
    }));
  if (empresas.length === 0) throw new Error('A turma não tem participantes para a lista.');
  const evidencias = lista
    .filter((p) => p.e?.codigo_assinatura && p.e.assinado_em)
    .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((p) => ({
      nome: p.nome,
      empresa: p.empresa,
      forma: p.e!.nao_assina ? 'Registro eletrônico' : 'Assinatura na tela',
      quando: dataHora(p.e!.assinado_em!),
      codigo: p.e!.codigo_assinatura!,
    }));
  return gerarListaPresenca(jsPDF, modelo, logo, { obra, data: i.data, instrutor: i.responsavel, empresas, evidencias });
}

const nomeArquivo = (dataIso: string, obra: string) =>
  `${dataIso.replace(/-/g, '')}_Lista de presenca integracao_${obra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim()}.pdf`;

// Uma folha por empresa (o documento tem o campo EMPRESA). Depois da integração concluída, só os presentes,
// com a assinatura (ou o registro eletrônico) de cada um e a folha de evidências no fim.
export async function baixarListaPresenca(i: Pick<Integracao, 'id' | 'data' | 'responsavel' | 'concluida_em'>, obra: string, participantes: ParticipanteLista[]) {
  (await gerarPdf(i, obra, participantes)).save(nomeArquivo(i.data, obra));
}

// Ao concluir: gera a lista com as assinaturas, guarda no portal (arquivo digital) e baixa uma cópia.
export async function guardarListaAssinada(i: Pick<Integracao, 'id' | 'data' | 'responsavel'>, obra: string, participantes: ParticipanteLista[]) {
  const doc = await gerarPdf({ ...i, concluida_em: new Date().toISOString() }, obra, participantes);
  const caminho = `${i.id}/lista-de-presenca-${Date.now()}.pdf`;
  const { error: e1 } = await supabase.storage.from('integracoes').upload(caminho, doc.output('blob'), { contentType: 'application/pdf', upsert: false });
  if (e1) throw new Error(`A presença foi registrada, mas a lista assinada não foi guardada: ${e1.message}`);
  const { error } = await supabase.rpc('salvar_lista_integracao', { p_integracao: i.id, p_caminho: caminho });
  if (error) throw error;
  doc.save(nomeArquivo(i.data, obra));
}

// Lista assinada guardada no portal.
export async function baixarListaGuardada(caminho: string, dataIso: string, obra: string) {
  const { data, error } = await supabase.storage.from('integracoes').download(caminho);
  if (error || !data) throw new Error('Não foi possível baixar a lista assinada.');
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo(dataIso, obra);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
