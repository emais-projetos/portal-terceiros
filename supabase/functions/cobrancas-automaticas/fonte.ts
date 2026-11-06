// Cobranças e avisos automáticos: o n8n chama esta função e só envia os e-mails.
//
// As regras (calendário da medição, vencimentos e integração) e os textos são os mesmos da aba Cobranças
// do portal (site/src/lib/cobrancas.ts). Este arquivo é empacotado com eles em index.ts pelo script
// empacotar.mjs; edite aqui e empacote de novo, nunca o index.ts.
//
// Acesso: cabeçalho x-chave-n8n igual ao segredo CHAVE_N8N da função.
// Ações (POST, JSON):
//   { "acao": "fila", "data"?: "AAAA-MM-DD" }      e-mails do dia (data de São Paulo; "data" simula outro dia)
//   { "acao": "registrar", "item": {...}, "situacao": "enviada" | "erro", "erro"?: "..." }
//   { "acao": "resumo", "data"?: "AAAA-MM-DD" }     resumo do dia para o RH
//   { "acao": "marcar_existentes", "confirmar": "sim" }  marca a fila atual como já cobrada (ao ligar para todos)
import { supabase } from './servidor-supabase.ts';
import { montarFila, type Cobranca } from '../../../site/src/lib/cobrancas.ts';

declare const Deno: { env: { get(nome: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

type Item = {
  chave: string;
  tipo: Cobranca['tipo'];
  titulo: string;
  para: string;
  para_original: string;
  assunto: string;
  corpo: string;
  empresa_ids: string[];
  obra_id: string | null;
  registros: Cobranca['registros'];
  medicoes: string[];
  teste: boolean;
};

const cabecalhos = { 'Content-Type': 'application/json' };
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: cabecalhos });

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function parametros() {
  const { data, error } = await supabase
    .from('parametros')
    .select('chave, valor')
    .in('chave', ['cobranca_automatica_empresas', 'cobranca_automatica_teste_para', 'cobranca_automatica_pausada']);
  if (error) throw error;
  const p = new Map((data ?? []).map((x) => [x.chave as string, ((x.valor as string) ?? '').trim()]));
  const lista = (p.get('cobranca_automatica_empresas') ?? '').toLowerCase();
  return {
    todas: lista === 'todas',
    cnpjs: lista === 'todas' ? [] : lista.split(/[,;\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 14),
    testePara: p.get('cobranca_automatica_teste_para') ?? '',
    pausada: (p.get('cobranca_automatica_pausada') ?? '').toLowerCase() === 'sim',
  };
}

// Empresas de cada cobrança: as dos registros e, no aviso de retenção à obra, as empresas que atuam na obra.
async function empresasDasCobrancas(cobrancas: Cobranca[]): Promise<Map<string, string[]>> {
  const obras = [...new Set(cobrancas.filter((c) => !c.registros.some((r) => r.empresa_id) && c.obraId).map((c) => c.obraId as string))];
  const porObra = new Map<string, string[]>();
  if (obras.length) {
    const { data, error } = await supabase.from('empresas_obras').select('obra_id, empresa_id').in('obra_id', obras).eq('ativo', true);
    if (error) throw error;
    (data ?? []).forEach((x) => porObra.set(x.obra_id as string, [...(porObra.get(x.obra_id as string) ?? []), x.empresa_id as string]));
  }
  return new Map(
    cobrancas.map((c) => {
      const dosRegistros = c.registros.map((r) => r.empresa_id).filter((x): x is string => !!x);
      const ids = dosRegistros.length ? dosRegistros : c.obraId ? porObra.get(c.obraId) ?? [] : [];
      return [c.chave, [...new Set(ids)]];
    }),
  );
}

async function fila(dataRef: string) {
  const cfg = await parametros();
  const base = { data: dataRef, pausada: cfg.pausada, modo_teste: !!cfg.testePara, teste_para: cfg.testePara || null };
  if (cfg.pausada) return { ...base, itens: [], sem_destinatario: [], fora_da_lista: 0 };

  const { cobrancas } = await montarFila('', dataRef);
  const empresas = await empresasDasCobrancas(cobrancas);

  let liberadas: Set<string> | null = null;
  if (!cfg.todas) {
    liberadas = new Set();
    if (cfg.cnpjs.length) {
      const { data, error } = await supabase.from('empresas').select('id').in('cnpj', cfg.cnpjs);
      if (error) throw error;
      (data ?? []).forEach((e) => liberadas!.add(e.id as string));
    }
  }

  const itens: Item[] = [];
  const semDestinatario: { titulo: string; tipo: string }[] = [];
  let fora = 0;
  for (const c of cobrancas) {
    const ids = empresas.get(c.chave) ?? [];
    // Com só algumas empresas liberadas e sem endereço de teste, o aviso de retenção à engenharia não sai:
    // ele lista todas as empresas da obra, inclusive as que ainda não estão no envio automático.
    const avisoDeObraParcial = liberadas && !cfg.testePara && c.tipo === 'retencao_obra';
    if (avisoDeObraParcial || (liberadas && !ids.some((id) => liberadas!.has(id)))) {
      fora += 1;
      continue;
    }
    const original = c.para.trim();
    if (!original.includes('@')) {
      semDestinatario.push({ titulo: c.titulo, tipo: c.tipo });
      continue;
    }
    const teste = !!cfg.testePara;
    itens.push({
      chave: c.chave,
      tipo: c.tipo,
      titulo: c.titulo,
      para: teste ? cfg.testePara : original,
      para_original: original,
      assunto: teste ? `[TESTE · para ${original}] ${c.assunto}` : c.assunto,
      corpo: c.corpo,
      empresa_ids: ids,
      obra_id: c.obraId,
      registros: c.registros,
      medicoes: c.medicoes,
      teste,
    });
  }
  return { ...base, itens, sem_destinatario: semDestinatario, fora_da_lista: fora };
}

async function registrar(item: Item, situacao: 'enviada' | 'erro', erro?: string) {
  const { error } = await supabase.from('cobrancas_envios').insert({
    chave: item.chave,
    tipo: item.tipo,
    titulo: item.titulo,
    empresa_ids: item.empresa_ids,
    obra_id: item.obra_id,
    para: item.para,
    para_original: item.para_original,
    assunto: item.assunto,
    corpo: item.corpo,
    situacao,
    erro: situacao === 'erro' ? (erro ?? 'Erro no envio') : null,
    teste: item.teste,
  });
  if (error) throw error;
  // Em teste nada é marcado como cobrado: a cobrança real continua na fila.
  if (situacao !== 'enviada' || item.teste) return;
  const linhas = item.registros.map((r) => ({ ...r, situacao: 'enviada', destinatarios: item.para, assunto: item.assunto, corpo: item.corpo, canal: 'n8n' }));
  const { error: e2 } = await supabase.from('cobrancas').upsert(linhas, { onConflict: 'tipo,referencia', ignoreDuplicates: true });
  if (e2) throw e2;
  if (item.medicoes.length) {
    const { error: e3 } = await supabase.from('medicoes').update({ ultima_cobranca_em: new Date().toISOString() }).in('id', item.medicoes);
    if (e3) throw e3;
  }
}

async function resumo(dataRef: string) {
  const inicio = new Date(`${dataRef}T00:00:00-03:00`).toISOString();
  const fim = new Date(`${dataRef}T23:59:59-03:00`).toISOString();
  const { data, error } = await supabase
    .from('cobrancas_envios')
    .select('titulo, tipo, para_original, assunto, situacao, erro, teste')
    .gte('enviado_em', inicio)
    .lte('enviado_em', fim)
    .order('enviado_em');
  if (error) throw error;
  const envios = data ?? [];
  const pendentes = await fila(dataRef);
  const ok = envios.filter((e) => e.situacao === 'enviada');
  const falhas = envios.filter((e) => e.situacao === 'erro');
  const [a, m, d] = dataRef.split('-');
  const linhas = [
    'Olá,',
    '',
    `Resumo das cobranças automáticas de ${d}/${m}/${a}${pendentes.modo_teste ? ' (modo de teste)' : ''}:`,
    '',
    `- Enviadas: ${ok.length}`,
    `- Com erro: ${falhas.length}`,
    `- Sem e-mail cadastrado (não enviadas): ${pendentes.sem_destinatario.length}`,
    ...(pendentes.pausada ? ['- O envio automático está pausado.'] : []),
    '',
    ...(ok.length ? ['Enviadas:', ...ok.map((e) => `- ${e.titulo}: ${e.assunto}`), ''] : []),
    ...(falhas.length ? ['Com erro (o portal tenta de novo no próximo envio):', ...falhas.map((e) => `- ${e.titulo}: ${e.erro}`), ''] : []),
    ...(pendentes.sem_destinatario.length
      ? ['Sem e-mail cadastrado (cadastre no portal para a cobrança sair):', ...pendentes.sem_destinatario.map((s) => `- ${s.titulo}`), '']
      : []),
    'Gente e Gestão | Grupo Emais',
  ];
  return {
    tem_conteudo: envios.length > 0 || pendentes.sem_destinatario.length > 0,
    assunto: `Cobranças automáticas de ${d}/${m}: ${ok.length} enviadas${falhas.length ? `, ${falhas.length} com erro` : ''}`,
    corpo: linhas.join('\n'),
  };
}

// Ao ligar para todos: a fila de hoje entra como já cobrada, para não disparar o atraso acumulado de uma vez.
async function marcarExistentes(dataRef: string) {
  const { cobrancas } = await montarFila('', dataRef);
  const linhas = cobrancas.flatMap((c) =>
    c.registros.map((r) => ({ ...r, situacao: 'dispensada', destinatarios: c.para, assunto: c.assunto, canal: 'carga' })),
  );
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('cobrancas').upsert(linhas.slice(i, i + 500), { onConflict: 'tipo,referencia', ignoreDuplicates: true });
    if (error) throw error;
  }
  return { marcadas: cobrancas.length };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'Use POST' });
  const chave = Deno.env.get('CHAVE_N8N');
  if (!chave || req.headers.get('x-chave-n8n') !== chave) return resposta(401, { erro: 'Chave inválida' });

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: 'Pedido inválido' });
  }
  const dataRef = typeof corpo.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(corpo.data) ? corpo.data : hojeSaoPaulo();

  try {
    if (corpo.acao === 'fila') return resposta(200, await fila(dataRef));
    if (corpo.acao === 'registrar') {
      const situacao = corpo.situacao === 'erro' ? 'erro' : 'enviada';
      await registrar(corpo.item as Item, situacao, typeof corpo.erro === 'string' ? corpo.erro : undefined);
      return resposta(200, { ok: true });
    }
    if (corpo.acao === 'resumo') return resposta(200, await resumo(dataRef));
    if (corpo.acao === 'marcar_existentes') {
      if (corpo.confirmar !== 'sim') return resposta(400, { erro: 'Envie "confirmar": "sim"' });
      return resposta(200, await marcarExistentes(dataRef));
    }
    return resposta(400, { erro: 'Ação desconhecida' });
  } catch (e) {
    return resposta(500, { erro: (e as { message?: string }).message ?? String(e) });
  }
});
