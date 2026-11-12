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
//   { "acao": "liberacoes" }                         avisos de liberação e convites de acesso que o administrativo mandou enviar
//   { "acao": "registrar_liberacao", "item": {...}, "situacao": "enviada" | "erro", "erro"?: "..." }
// Os convites de acesso vêm na mesma lista dos avisos de liberação (campo "tipo"), para o fluxo do n8n
// que já existe enviar os dois sem mudança.
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

// ---------------------------------------------------------------- Aviso de liberação

type ItemLiberacao = {
  tipo?: 'aviso_liberacao' | 'convite_acesso';
  id: string;
  obra_id: string;
  titulo: string;
  para: string;
  para_original: string;
  assunto: string;
  corpo: string;
  empresa_ids: string[];
  teste: boolean;
};

// Avisos na fila. Quem ficou "enviando" por mais de 30 minutos (o n8n caiu no meio) volta para a fila.
async function liberacoes() {
  const cfg = await parametros();
  const base = { pausada: cfg.pausada, modo_teste: !!cfg.testePara, teste_para: cfg.testePara || null };
  if (cfg.pausada) return { ...base, itens: [] };
  const avisos = await avisosDeLiberacao(cfg);
  const convites = await convitesDeAcesso(cfg);
  return { ...base, itens: [...avisos, ...convites] };
}

async function avisosDeLiberacao(cfg: Awaited<ReturnType<typeof parametros>>): Promise<ItemLiberacao[]> {
  const limite = new Date(Date.now() - 30 * 60000).toISOString();
  const { data, error } = await supabase
    .from('avisos_liberacao')
    .select('id, obra_id, alocacoes, destinatarios, assunto, corpo')
    .or(`situacao_envio.eq.aguardando,and(situacao_envio.eq.enviando,envio_iniciado_em.lt."${limite}")`)
    .order('envio_pedido_em')
    .limit(25);
  if (error) throw error;
  const avisos = data ?? [];
  if (!avisos.length) return [];

  const ids = avisos.map((a) => a.id as string);
  const { error: e1 } = await supabase.from('avisos_liberacao').update({ situacao_envio: 'enviando', envio_iniciado_em: new Date().toISOString() }).in('id', ids);
  if (e1) throw e1;

  const obras = [...new Set(avisos.map((a) => a.obra_id as string))];
  const { data: os, error: e2 } = await supabase.from('obras').select('id, nome').in('id', obras);
  if (e2) throw e2;
  const nomeObra = new Map((os ?? []).map((o) => [o.id as string, o.nome as string]));
  const alocs = [...new Set(avisos.flatMap((a) => a.alocacoes as string[]))];
  const { data: al, error: e3 } = await supabase.from('v_alocacoes_resumo').select('alocacao_id, empresa_id').in('alocacao_id', alocs);
  if (e3) throw e3;
  const empresaDa = new Map((al ?? []).map((x) => [x.alocacao_id as string, x.empresa_id as string]));

  const teste = !!cfg.testePara;
  const itens: ItemLiberacao[] = avisos.map((a) => {
    const original = ((a.destinatarios as string | null) ?? '').trim();
    return {
      tipo: 'aviso_liberacao' as const,
      id: a.id as string,
      obra_id: a.obra_id as string,
      titulo: nomeObra.get(a.obra_id as string) ?? '',
      para: teste ? cfg.testePara : original,
      para_original: original,
      assunto: teste ? `[TESTE · para ${original}] ${a.assunto}` : (a.assunto as string),
      corpo: a.corpo as string,
      empresa_ids: [...new Set((a.alocacoes as string[]).map((x) => empresaDa.get(x)).filter((x): x is string => !!x))],
      teste,
    };
  });
  return itens;
}

// ---------------------------------------------------------------- Convite de acesso

const PORTAL = 'https://emais-projetos.github.io/portal-terceiros/';

async function resumoHash(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function codigoAleatorio(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function motivoDoPerfil(perfil: string, empresas: string[]): string {
  if (perfil === 'fornecedor')
    return `É por ele que ${empresas.length === 1 ? `a ${empresas[0]}` : 'as suas empresas'} vai cadastrar os colaboradores e enviar a documentação para as obras da Emais.`;
  if (perfil === 'tst') return 'É por ele que você vai consultar os colaboradores das suas obras e dar a validação final da segurança do trabalho.';
  if (perfil === 'engenharia')
    return 'É por ele que você vai acompanhar, nas suas obras, a integração dos terceiros, a situação dos documentos e a medição de cada empresa, com quem está liberado para pagamento.';
  return 'É por ele que você vai conferir a documentação dos terceiros e liberar os colaboradores para as obras.';
}

// Link que vai no e-mail e como ele aparece no histórico de envios (sem o código).
const LINK_OCULTO = `${PORTAL}acesso?c=[código do convite]`;

// Convites na fila. O código é gerado agora; se o n8n buscar de novo (erro ou queda), sai um código novo.
async function convitesDeAcesso(cfg: Awaited<ReturnType<typeof parametros>>): Promise<ItemLiberacao[]> {
  const limite = new Date(Date.now() - 30 * 60000).toISOString();
  const { data, error } = await supabase
    .from('convites_acesso')
    .select('id, usuario_id, tipo, pedido_por')
    .or(`situacao_envio.eq.aguardando,and(situacao_envio.eq.enviando,envio_iniciado_em.lt."${limite}")`)
    .order('pedido_em')
    .limit(25);
  if (error) throw error;
  const convites = data ?? [];
  if (!convites.length) return [];

  const ids = [...new Set(convites.flatMap((c) => [c.usuario_id as string, c.pedido_por as string | null]).filter((x): x is string => !!x))];
  const [{ data: us, error: e1 }, { data: ue, error: e2 }, { data: ms, error: e3 }, { data: ps, error: e4 }] = await Promise.all([
    supabase.from('usuarios').select('id, nome, email, perfil, ativo').in('id', ids),
    supabase.from('usuarios_empresas').select('usuario_id, empresa_id, empresas(razao_social)').in('usuario_id', convites.map((c) => c.usuario_id as string)),
    supabase.from('modelos_email').select('tipo, assunto, corpo, ativo').in('tipo', ['convite_acesso', 'nova_senha_acesso']),
    supabase.from('parametros').select('chave, valor').in('chave', ['convite_validade_dias', 'cobranca_setor', 'cobranca_contato']),
  ]);
  if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;
  const usuario = new Map((us ?? []).map((u) => [u.id as string, u]));
  const modelo = new Map((ms ?? []).map((m) => [m.tipo as string, m]));
  const param = new Map((ps ?? []).map((x) => [x.chave as string, ((x.valor as string) ?? '').trim()]));
  const dias = Math.max(1, Number(param.get('convite_validade_dias')) || 7);
  const empresasDe = new Map<string, { ids: string[]; nomes: string[] }>();
  (ue ?? []).forEach((x) => {
    const atual = empresasDe.get(x.usuario_id as string) ?? { ids: [], nomes: [] };
    atual.ids.push(x.empresa_id as string);
    const nome = (x.empresas as unknown as { razao_social?: string } | null)?.razao_social;
    if (nome) atual.nomes.push(nome);
    empresasDe.set(x.usuario_id as string, atual);
  });

  const teste = !!cfg.testePara;
  const itens: ItemLiberacao[] = [];
  for (const c of convites) {
    const u = usuario.get(c.usuario_id as string);
    const m = modelo.get(c.tipo === 'primeiro_acesso' ? 'convite_acesso' : 'nova_senha_acesso');
    if (!u || !u.ativo || !m?.ativo) {
      const motivo = !u || !u.ativo ? 'Acesso desativado' : 'Envio automático deste e-mail desligado em Acessos > E-mails';
      await supabase.from('convites_acesso').update({ situacao_envio: 'erro', envio_erro: motivo }).eq('id', c.id);
      continue;
    }
    const codigo = codigoAleatorio();
    const expira = new Date(Date.now() + dias * 86400000).toISOString();
    const { error: e5 } = await supabase
      .from('convites_acesso')
      .update({ situacao_envio: 'enviando', envio_iniciado_em: new Date().toISOString(), token_hash: await resumoHash(codigo), expira_em: expira, para: u.email })
      .eq('id', c.id);
    if (e5) throw e5;

    const quem = c.pedido_por ? (usuario.get(c.pedido_por as string)?.nome as string | undefined) : undefined;
    const assinatura = [quem?.trim(), `${param.get('cobranca_setor') || 'Gente e Gestão'} | Grupo Emais`, param.get('cobranca_contato')].filter(Boolean).join('\n');
    const nome = (u.nome as string).trim();
    const valores: Record<string, string> = {
      '{nome}': nome,
      '{primeiro_nome}': nome.split(/\s+/)[0],
      '{motivo}': motivoDoPerfil(u.perfil as string, empresasDe.get(u.id as string)?.nomes ?? []),
      '{link}': `${PORTAL}acesso?c=${codigo}`,
      '{validade}': dias === 1 ? '1 dia' : `${dias} dias`,
      '{email}': u.email as string,
      '{endereco_portal}': PORTAL,
      '{assinatura}': assinatura,
    };
    const trocar = (t: string) => t.replace(/\{[a-z_]+\}/g, (x) => (x in valores ? valores[x] : x));
    let corpo = trocar(m.corpo as string).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // O link não pode faltar, mesmo que tenham tirado o campo do texto.
    if (!corpo.includes(valores['{link}'])) corpo += `\n\n${valores['{link}']}`;
    const assunto = trocar(m.assunto as string).replace(/\s+/g, ' ').trim();
    const original = u.email as string;
    itens.push({
      tipo: 'convite_acesso',
      id: c.id as string,
      obra_id: '',
      titulo: nome,
      para: teste ? cfg.testePara : original,
      para_original: original,
      assunto: teste ? `[TESTE · para ${original}] ${assunto}` : assunto,
      corpo,
      empresa_ids: empresasDe.get(u.id as string)?.ids ?? [],
      teste,
    });
  }
  return itens;
}

async function registrarConvite(item: ItemLiberacao, situacao: 'enviada' | 'erro', erro?: string) {
  const agora = new Date().toISOString();
  const { error } = await supabase.from('cobrancas_envios').insert({
    chave: `convite|${item.id}`,
    tipo: 'convite_acesso',
    titulo: item.titulo,
    empresa_ids: item.empresa_ids,
    obra_id: null,
    para: item.para,
    para_original: item.para_original,
    assunto: item.assunto,
    corpo: item.corpo.replace(/https:\/\/\S+\/acesso\?c=[A-Za-z0-9_-]+/g, LINK_OCULTO),
    situacao,
    erro: situacao === 'erro' ? (erro ?? 'Erro no envio') : null,
    teste: item.teste,
  });
  if (error) throw error;
  const mudanca: Record<string, unknown> =
    situacao === 'enviada'
      ? { situacao_envio: 'enviado', enviado_em: agora, envio_erro: null, envio_teste: item.teste, envio_para: item.para }
      : { situacao_envio: 'erro', envio_erro: erro ?? 'Erro no envio', token_hash: null };
  // Só mexe no convite que ainda está em envio (um convite novo pode ter substituído este).
  const { error: e2 } = await supabase.from('convites_acesso').update(mudanca).eq('id', item.id).eq('situacao_envio', 'enviando');
  if (e2) throw e2;
}

async function registrarLiberacao(item: ItemLiberacao, situacao: 'enviada' | 'erro', erro?: string) {
  if (item.tipo === 'convite_acesso') return registrarConvite(item, situacao, erro);
  const agora = new Date().toISOString();
  const { error } = await supabase.from('cobrancas_envios').insert({
    chave: `liberacao|${item.id}`,
    tipo: 'aviso_liberacao',
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
  const mudanca: Record<string, unknown> =
    situacao === 'enviada'
      ? { situacao_envio: 'enviado', enviado_em: agora, envio_erro: null, envio_teste: item.teste, envio_para: item.para }
      : { situacao_envio: 'erro', envio_erro: erro ?? 'Erro no envio' };
  const { error: e2 } = await supabase.from('avisos_liberacao').update(mudanca).eq('id', item.id);
  if (e2) throw e2;
  if (situacao === 'enviada' && !item.teste) {
    const { error: e3 } = await supabase.from('avisos_liberacao').update({ marcado_enviado_em: agora }).eq('id', item.id).is('marcado_enviado_em', null);
    if (e3) throw e3;
  }
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
    if (corpo.acao === 'liberacoes') return resposta(200, await liberacoes());
    if (corpo.acao === 'registrar_liberacao') {
      const situacao = corpo.situacao === 'erro' ? 'erro' : 'enviada';
      await registrarLiberacao(corpo.item as ItemLiberacao, situacao, typeof corpo.erro === 'string' ? corpo.erro : undefined);
      return resposta(200, { ok: true });
    }
    if (corpo.acao === 'marcar_existentes') {
      if (corpo.confirmar !== 'sim') return resposta(400, { erro: 'Envie "confirmar": "sim"' });
      return resposta(200, await marcarExistentes(dataRef));
    }
    return resposta(400, { erro: 'Ação desconhecida' });
  } catch (e) {
    return resposta(500, { erro: (e as { message?: string }).message ?? String(e) });
  }
});
