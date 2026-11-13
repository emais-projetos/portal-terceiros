import { supabase } from './supabase';

// Ajuda (chat com a Emais), número do contrato de cada obra e pedido de acesso a outra obra.

export type Mensagem = {
  id: string;
  conversa_id: string;
  autor_id: string | null;
  da_emais: boolean;
  automatica: boolean;
  texto: string;
  criado_em: string;
};

export type Conversa = {
  id: string;
  usuario_id: string;
  situacao: 'aberta' | 'resolvida';
  ultima_mensagem_em: string | null;
  lida_emais_em: string | null;
  lida_usuario_em: string | null;
};

const CAMPOS_MENSAGEM = 'id, conversa_id, autor_id, da_emais, automatica, texto, criado_em';
const CAMPOS_CONVERSA = 'id, usuario_id, situacao, ultima_mensagem_em, lida_emais_em, lida_usuario_em';

// ---------------------------------------------------------------- Quem usa o portal (fornecedor, TST, engenharia)

export async function lerMinhaConversa(usuarioId: string): Promise<{ conversa: Conversa | null; mensagens: Mensagem[] }> {
  const { data: c, error } = await supabase.from('conversas').select(CAMPOS_CONVERSA).eq('usuario_id', usuarioId).maybeSingle();
  if (error) throw error;
  if (!c) return { conversa: null, mensagens: [] };
  return { conversa: c as Conversa, mensagens: await lerMensagens(c.id as string) };
}

export async function lerMensagens(conversaId: string): Promise<Mensagem[]> {
  const { data, error } = await supabase.from('mensagens').select(CAMPOS_MENSAGEM).eq('conversa_id', conversaId).order('criado_em').limit(500);
  if (error) throw error;
  return (data ?? []) as Mensagem[];
}

export async function enviarMensagem(texto: string, conversaId?: string) {
  const { error } = await supabase.rpc('enviar_mensagem', { p_texto: texto, p_conversa: conversaId ?? null });
  if (error) throw error;
}

export async function marcarLida(conversaId?: string) {
  const { error } = await supabase.rpc('marcar_conversa_lida', { p_conversa: conversaId ?? null });
  if (error) throw error;
}

// Avisa a cada mensagem nova (as regras do banco já limitam o que cada um recebe).
export function acompanharMensagens(aoChegar: (m: Mensagem) => void, conversaId?: string) {
  const canal = supabase
    .channel(`mensagens-${conversaId ?? 'todas'}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mensagens', ...(conversaId ? { filter: `conversa_id=eq.${conversaId}` } : {}) },
      (p) => aoChegar(p.new as Mensagem),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(canal);
  };
}

export const naoLidas = (mensagens: Mensagem[], lidaEm: string | null, daEmais: boolean) =>
  mensagens.filter((m) => m.da_emais === daEmais && (!lidaEm || m.criado_em > lidaEm)).length;

// ---------------------------------------------------------------- Administrativo

export type ConversaAdmin = Conversa & {
  nome: string;
  email: string;
  perfil: string;
  empresas: string[];
  obras: string[];
  ultima: Mensagem | null;
  naoLidas: number;
};

export async function lerConversas(): Promise<ConversaAdmin[]> {
  const { data: cs, error } = await supabase
    .from('conversas')
    .select(`${CAMPOS_CONVERSA}, usuarios(nome, email, perfil, usuarios_empresas(empresas(razao_social)), tst_obras(obras(nome)))`)
    .not('ultima_mensagem_em', 'is', null)
    .order('ultima_mensagem_em', { ascending: false });
  if (error) throw error;
  const lista = (cs ?? []) as unknown as (Conversa & {
    usuarios: {
      nome: string;
      email: string;
      perfil: string;
      usuarios_empresas: { empresas: { razao_social: string } | null }[];
      tst_obras: { obras: { nome: string } | null }[];
    } | null;
  })[];
  if (!lista.length) return [];
  // Mensagens recentes das conversas, para a prévia e o contador de não lidas.
  const { data: ms, error: e2 } = await supabase
    .from('mensagens')
    .select(CAMPOS_MENSAGEM)
    .in('conversa_id', lista.map((c) => c.id))
    .order('criado_em', { ascending: false })
    .limit(2000);
  if (e2) throw e2;
  const porConversa = new Map<string, Mensagem[]>();
  ((ms ?? []) as Mensagem[]).forEach((m) => porConversa.set(m.conversa_id, [...(porConversa.get(m.conversa_id) ?? []), m]));
  return lista.map((c) => {
    const msgs = porConversa.get(c.id) ?? [];
    return {
      id: c.id,
      usuario_id: c.usuario_id,
      situacao: c.situacao,
      ultima_mensagem_em: c.ultima_mensagem_em,
      lida_emais_em: c.lida_emais_em,
      lida_usuario_em: c.lida_usuario_em,
      nome: c.usuarios?.nome ?? '',
      email: c.usuarios?.email ?? '',
      perfil: c.usuarios?.perfil ?? '',
      empresas: (c.usuarios?.usuarios_empresas ?? []).map((x) => x.empresas?.razao_social).filter((x): x is string => !!x),
      obras: (c.usuarios?.tst_obras ?? []).map((x) => x.obras?.nome).filter((x): x is string => !!x),
      ultima: msgs[0] ?? null,
      naoLidas: naoLidas(msgs, c.lida_emais_em, false),
    };
  });
}

export async function resolverConversa(conversaId: string, resolvida: boolean) {
  const { error } = await supabase.rpc('resolver_conversa', { p_conversa: conversaId, p_resolvida: resolvida });
  if (error) throw error;
}

// Conversas com mensagem não lida pela Emais + pedidos de obra esperando resposta (contador do menu).
export async function contarAtendimento(): Promise<number> {
  const [conversas, pedidos] = await Promise.all([lerConversas(), supabase.from('pedidos_obra').select('id', { count: 'exact', head: true }).eq('situacao', 'pendente')]);
  if (pedidos.error) throw pedidos.error;
  return conversas.filter((c) => c.naoLidas > 0).length + (pedidos.count ?? 0);
}

// ---------------------------------------------------------------- Contrato e pedido de obra

export type PedidoObra = {
  id: string;
  empresa_id: string;
  obra_id: string;
  numero_contrato: string | null;
  observacao: string | null;
  situacao: 'pendente' | 'aprovado' | 'recusado';
  pedido_em: string;
  analisado_em: string | null;
  motivo_recusa: string | null;
  empresas: { razao_social: string; cnpj: string } | null;
  obras: { nome: string } | null;
  usuarios: { nome: string; email: string } | null;
};

export async function lerPedidosObra(): Promise<PedidoObra[]> {
  const { data, error } = await supabase
    .from('pedidos_obra')
    .select(
      'id, empresa_id, obra_id, numero_contrato, observacao, situacao, pedido_em, analisado_em, motivo_recusa, empresas(razao_social, cnpj), obras(nome), usuarios!pedidos_obra_pedido_por_fkey(nome, email)',
    )
    .order('pedido_em', { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as PedidoObra[];
}

export async function pedirObra(empresaId: string, obraId: string, contrato: string, observacao: string) {
  const { error } = await supabase.rpc('pedir_obra', { p_empresa: empresaId, p_obra: obraId, p_contrato: contrato, p_observacao: observacao });
  if (error) throw error;
}

export async function responderPedidoObra(pedidoId: string, aprovar: boolean, motivo?: string) {
  const { error } = await supabase.rpc('responder_pedido_obra', { p_pedido: pedidoId, p_aprovar: aprovar, p_motivo: motivo ?? null });
  if (error) throw error;
}

export async function informarContrato(empresaId: string, obraId: string, numero: string) {
  const { error } = await supabase.rpc('informar_contrato', { p_empresa: empresaId, p_obra: obraId, p_numero: numero });
  if (error) throw error;
}

// Contratos das obras de cada empresa do fornecedor.
export async function lerContratos(): Promise<Map<string, string | null>> {
  const { data, error } = await supabase.from('empresas_obras').select('empresa_id, obra_id, numero_contrato').eq('ativo', true);
  if (error) throw error;
  return new Map((data ?? []).map((x) => [`${x.empresa_id}|${x.obra_id}`, (x.numero_contrato as string | null) ?? null]));
}

// Só as obras que recebem empresas novas (em encerramento não entra ninguém).
export async function lerObrasAtivas(): Promise<{ id: string; nome: string }[]> {
  const { data, error } = await supabase.from('obras').select('id, nome').eq('situacao', 'ativa').order('nome');
  if (error) throw error;
  return (data ?? []) as { id: string; nome: string }[];
}
