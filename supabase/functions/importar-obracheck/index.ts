// Importação única do ObraCheck (artefato + Supabase separado) para a Segurança da obra do portal.
// Lê as fichas de máquina e as vistorias de alojamento do ObraCheck, sobe fotos e assinaturas para a pasta
// privada "seguranca" e grava tudo nas tabelas seg_*. Pode rodar mais de uma vez: o que já veio é pulado
// (origem_chave = chave do registro no ObraCheck).
//
// Chamada: POST com o cabeçalho x-chave-importacao (segredo IMPORTACAO_OBRACHECK) e o corpo:
//   { "obras": { "<obra no ObraCheck>": "<id da obra no portal>" },
//     "empresas": { "<empresa no ObraCheck>": "<id da empresa no portal>" | null },   (null ou ausente = Emais)
//     "simular": true | false, "parte": "maquinas" | "alojamentos", "inicio": 0, "quantidade": 10 }
// Com "simular": true só confere o de-para e conta o que seria importado, sem gravar nada.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const portal = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const OBRACHECK_URL = 'https://ivggmzmlxsxtobpunutq.supabase.co';
const DIAS_FOTOS = 30;

type Mapa = Record<string, string | null>;
type Pedido = { obras: Mapa; empresas: Mapa; simular?: boolean; parte: 'maquinas' | 'alojamentos'; inicio?: number; quantidade?: number };

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

const chaveTexto = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

async function lerObraCheck(tabela: string, inicio: number, quantidade: number) {
  const chave = Deno.env.get('OBRACHECK_ANON')!;
  const r = await fetch(`${OBRACHECK_URL}/rest/v1/${tabela}?select=*&order=record_key&offset=${inicio}&limit=${quantidade}`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  if (!r.ok) throw new Error(`ObraCheck ${tabela}: HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>[];
}

async function contarObraCheck(tabela: string) {
  const chave = Deno.env.get('OBRACHECK_ANON')!;
  const r = await fetch(`${OBRACHECK_URL}/rest/v1/${tabela}?select=record_key`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, Prefer: 'count=exact', Range: '0-0' },
  });
  return Number((r.headers.get('content-range') ?? '/0').split('/')[1]) || 0;
}

// "data:image/jpeg;base64,..." -> arquivo na pasta seguranca. Devolve o caminho (ou null se não for imagem).
async function subirImagem(dataUrl: unknown, caminhoSemExtensao: string, simular: boolean): Promise<string | null> {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  const caminho = `${caminhoSemExtensao}.${ext}`;
  if (simular) return caminho;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const { error } = await portal.storage.from('seguranca').upload(caminho, bytes, { contentType: m[1], upsert: true });
  if (error) throw new Error(`Upload ${caminho}: ${error.message}`);
  return caminho;
}

function idDaObra(obras: Mapa, nome: unknown, faltando: Set<string>) {
  const id = Object.entries(obras).find(([k]) => chaveTexto(k) === chaveTexto(String(nome ?? '')))?.[1];
  if (!id) faltando.add(String(nome ?? '(vazio)'));
  return id ?? null;
}
function idDaEmpresa(empresas: Mapa, nome: unknown, faltando: Set<string>) {
  const texto = chaveTexto(String(nome ?? ''));
  if (!texto || texto === 'emais') return null;
  const achado = Object.entries(empresas).find(([k]) => chaveTexto(k) === texto);
  if (!achado) faltando.add(String(nome));
  return achado?.[1] ?? null;
}

// Mesma regra da planilha NR-18 (e de app.seg_nota no banco).
function nota(itens: { status: string | null }[]) {
  const sim = itens.filter((i) => i.status === 'sim').length;
  const aplicaveis = itens.filter((i) => i.status === 'sim' || i.status === 'nao').length;
  if (!aplicaveis) return { pontuacao: null, classificacao: null };
  const f = sim / aplicaveis;
  return {
    pontuacao: Math.round(f * 10000) / 10000,
    classificacao: f <= 0.3 ? 'Péssimo' : f <= 0.5 ? 'Ruim' : f <= 0.7 ? 'Regular' : f < 1 ? 'Bom' : 'Ótimo',
  };
}

async function jaImportados(tabela: string, chaves: string[]) {
  if (!chaves.length) return new Set<string>();
  const { data, error } = await portal.from(tabela).select('origem_chave').in('origem_chave', chaves);
  if (error) throw error;
  return new Set((data ?? []).map((x: { origem_chave: string }) => x.origem_chave));
}

async function importarMaquinas(p: Pedido) {
  const simular = !!p.simular;
  const linhas = await lerObraCheck('obracheck_records', p.inicio ?? 0, p.quantidade ?? 10);
  const feitas = await jaImportados('seg_fichas_maquina', linhas.map((l) => String(l.record_key)));
  const obrasFaltando = new Set<string>();
  const empresasFaltando = new Set<string>();
  const { data: modelos } = await portal.from('seg_modelos').select('codigo').eq('grupo', 'maquina');
  const existe = new Set((modelos ?? []).map((m: { codigo: string }) => m.codigo));
  let importadas = 0;
  let puladas = 0;
  let fotos = 0;

  for (const l of linhas) {
    const chave = String(l.record_key);
    if (feitas.has(chave)) { puladas++; continue; }
    const d = l.data as Record<string, any>;
    const obraId = idDaObra(p.obras, d.obra ?? l.obra, obrasFaltando);
    const empresaId = idDaEmpresa(p.empresas, d.empresa, empresasFaltando);
    const modelo = `maquina:${d.maquinaTipoKey ?? l.maquina_tipo_key}`;
    if (!existe.has(modelo)) throw new Error(`Tipo de máquina desconhecido: ${modelo}`);
    if (!obraId) continue;
    const identificacao = String(d.maquinaId ?? '').trim() || 'Sem identificação';
    if (simular) { importadas++; continue; }

    // Máquina (uma por obra + tipo + identificação).
    let { data: maq } = await portal.from('seg_maquinas').select('id')
      .eq('obra_id', obraId).eq('modelo_codigo', modelo).ilike('identificacao', identificacao).maybeSingle();
    if (!maq) {
      const r = await portal.from('seg_maquinas').insert({ obra_id: obraId, modelo_codigo: modelo, identificacao, empresa_id: empresaId }).select('id').single();
      if (r.error) throw r.error;
      maq = r.data;
    } else if (empresaId) {
      await portal.from('seg_maquinas').update({ empresa_id: empresaId }).eq('id', maq.id);
    }

    const fichaId = crypto.randomUUID();
    const dias: Record<string, unknown> = {};
    for (const [dia, v] of Object.entries((d.dias ?? {}) as Record<string, any>)) {
      if (!v || typeof v !== 'object') continue;
      const caminhos: string[] = [];
      for (const [n, f] of (v.fotos ?? []).entries()) {
        const c = await subirImagem(f, `ficha/${fichaId}/${dia}/foto-${n + 1}`, false);
        if (c) { caminhos.push(c); fotos++; }
      }
      dias[dia.padStart(2, '0')] = {
        statuses: v.statuses ?? [],
        operador: v.operador ?? '',
        observacao: v.observacao ?? '',
        fotos: caminhos,
        assinatura: await subirImagem(v.assinatura, `ficha/${fichaId}/${dia}/assinatura`, false),
        atualizado_em: v.atualizadoEm ?? null,
      };
    }
    let fechamento: Record<string, unknown> | null = null;
    if (d.fechamento && typeof d.fechamento === 'object') {
      fechamento = {
        operador_nome: d.fechamento.operadorNome ?? '',
        operador_assinatura: await subirImagem(d.fechamento.operadorAssinatura, `ficha/${fichaId}/fechamento-operador`, false),
        tst_nome: d.fechamento.tstNome ?? '',
        tst_assinatura: await subirImagem(d.fechamento.tstAssinatura, `ficha/${fichaId}/fechamento-tst`, false),
        data_obracheck: d.fechamento.data ?? null,
      };
    }
    const r = await portal.from('seg_fichas_maquina').insert({
      id: fichaId, maquina_id: maq!.id, competencia: `${d.mesAno}-01`, itens: d.itens ?? [], dias, fechamento,
      fechada_em: fechamento ? new Date().toISOString() : null, origem: 'obracheck', origem_chave: chave,
    });
    if (r.error) throw new Error(`Ficha ${chave}: ${r.error.message}`);
    importadas++;
  }
  return { parte: 'maquinas', lidas: linhas.length, importadas, puladas, fotos, obras_sem_de_para: [...obrasFaltando], empresas_sem_de_para: [...empresasFaltando] };
}

async function importarAlojamentos(p: Pedido) {
  const simular = !!p.simular;
  const linhas = await lerObraCheck('alojamento_checklists', p.inicio ?? 0, p.quantidade ?? 3);
  const feitas = await jaImportados('seg_vistorias', linhas.map((l) => String(l.record_key)));
  const obrasFaltando = new Set<string>();
  const empresasFaltando = new Set<string>();
  const { data: modelo } = await portal.from('seg_modelos').select('itens').eq('codigo', 'alojamento').single();
  const textos = (modelo?.itens ?? []) as string[];
  let importadas = 0;
  let puladas = 0;
  let fotos = 0;

  for (const l of linhas) {
    const chave = String(l.record_key);
    if (feitas.has(chave)) { puladas++; continue; }
    const d = l.data as Record<string, any>;
    const obraId = idDaObra(p.obras, d.obra ?? l.obra, obrasFaltando);
    const empresaId = idDaEmpresa(p.empresas, d.empresa ?? l.empresa, empresasFaltando);
    if (!obraId) continue;
    if (simular) { importadas++; continue; }

    const nome = String(d.alojamento ?? l.alojamento ?? '').trim() || 'Alojamento';
    let { data: aloj } = await portal.from('seg_alojamentos').select('id, empresa_id').eq('obra_id', obraId).ilike('nome', nome).maybeSingle();
    if (!aloj) {
      const r = await portal.from('seg_alojamentos').insert({ obra_id: obraId, nome, endereco: d.endereco || null, empresa_id: empresaId })
        .select('id, empresa_id').single();
      if (r.error) throw r.error;
      aloj = r.data;
    } else if (empresaId && !aloj.empresa_id) {
      await portal.from('seg_alojamentos').update({ empresa_id: empresaId }).eq('id', aloj.id);
    }

    const vistoriaId = crypto.randomUUID();
    const itens = [];
    for (const [n, it] of ((d.itens ?? []) as any[]).entries()) {
      const caminhos: string[] = [];
      for (const [k, f] of (it?.fotos ?? []).entries()) {
        const c = await subirImagem(f, `vistoria/${vistoriaId}/${n}/foto-${k + 1}`, false);
        if (c) { caminhos.push(c); fotos++; }
      }
      itens.push({
        texto: textos[n] ?? `Item ${n + 1}`,
        status: it?.status ?? null,
        recomendacao: it?.recomendacao ?? '',
        prazo: it?.prazo || null,
        fotos: caminhos,
      });
    }
    const pessoas = async (lista: any[], pasta: string) => {
      const saida = [];
      for (const [k, x] of (lista ?? []).entries()) {
        if (!x || typeof x !== 'object') continue;
        saida.push({
          colaborador_id: null,
          nome: x.nome ?? '',
          ...(x.cargo !== undefined ? { cargo: x.cargo } : {}),
          assinatura: await subirImagem(x.assinatura, `vistoria/${vistoriaId}/${pasta}-${k + 1}`, false),
        });
      }
      return saida;
    };
    const completa = itens.length > 0 && itens.every((i) => i.status);
    const n = nota(itens);
    const agora = new Date();
    const r = await portal.from('seg_vistorias').insert({
      id: vistoriaId, modelo_codigo: 'alojamento', obra_id: obraId, alojamento_id: aloj!.id,
      data_vistoria: d.dataVistoria ?? l.data_vistoria, horario: d.horario || null,
      qtd_funcionarios: Number(d.quantidadeFuncionarios) || null, itens,
      funcionarios: await pessoas(d.funcionarios, 'morador'), envolvidos: await pessoas(d.envolvidos, 'envolvido'),
      pontuacao: n.pontuacao, classificacao: n.classificacao,
      situacao: completa ? 'concluida' : 'rascunho',
      concluida_em: completa ? `${d.dataVistoria ?? l.data_vistoria}T12:00:00-03:00` : null,
      fotos_expiram_em: completa ? new Date(agora.getTime() + DIAS_FOTOS * 864e5).toISOString() : null,
      origem: 'obracheck', origem_chave: chave,
    });
    if (r.error) throw new Error(`Vistoria ${chave}: ${r.error.message}`);
    importadas++;
  }
  return { parte: 'alojamentos', lidas: linhas.length, importadas, puladas, fotos, obras_sem_de_para: [...obrasFaltando], empresas_sem_de_para: [...empresasFaltando] };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'Use POST' });
  const segredo = Deno.env.get('IMPORTACAO_OBRACHECK');
  if (!segredo || req.headers.get('x-chave-importacao') !== segredo) return resposta(401, { erro: 'Não autorizado' });
  let p: Pedido;
  try {
    p = await req.json();
  } catch {
    return resposta(400, { erro: 'Corpo inválido' });
  }
  try {
    const total = await contarObraCheck(p.parte === 'alojamentos' ? 'alojamento_checklists' : 'obracheck_records');
    const r = p.parte === 'alojamentos' ? await importarAlojamentos(p) : await importarMaquinas(p);
    return resposta(200, { ...r, total_no_obracheck: total, simulacao: !!p.simular });
  } catch (e) {
    return resposta(500, { erro: (e as Error).message });
  }
});
