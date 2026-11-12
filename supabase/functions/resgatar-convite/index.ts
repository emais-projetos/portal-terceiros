// Página /acesso do portal: confere o convite do e-mail e leva a pessoa para criar a senha.
// Pública (a pessoa ainda não tem senha). Quem prova o acesso é o código do convite, que só existe no e-mail.
//
// Ações (POST, JSON):
//   { acao: 'ver', codigo }               mostra para quem é o convite, sem gastá-lo
//   { acao: 'usar', codigo, destino }     gasta o convite e devolve o link do Supabase para criar a senha
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DESTINOS_ACEITOS = [
  'https://emais-projetos.github.io/portal-terceiros/',
  'http://localhost:5173/portal-terceiros/',
  'http://localhost:4173/portal-terceiros/',
];

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cabecalhos, 'Content-Type': 'application/json' } });
}

async function resumoHash(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Esconde parte do e-mail na tela: jo***@emais.com
function emailParcial(email: string): string {
  const [nome, dominio] = email.split('@');
  return `${nome.slice(0, 2)}${'*'.repeat(Math.max(3, nome.length - 2))}@${dominio}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });
  if (req.method !== 'POST') return resposta(405, { erro: 'Use POST' });

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: 'Pedido inválido' });
  }
  const codigo = String(corpo.codigo ?? '');
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(codigo)) return resposta(200, { situacao: 'invalido' });

  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: convite, error: erroBusca } = await servico
    .from('convites_acesso')
    .select('id, usuario_id, tipo, expira_em, usado_em, substituido_em, situacao_envio, usuarios!convites_acesso_usuario_id_fkey(nome, email, ativo, perfil)')
    .eq('token_hash', await resumoHash(codigo))
    .maybeSingle();
  if (erroBusca) return resposta(500, { erro: 'Não foi possível conferir o link agora. Tente de novo em alguns minutos.' });
  if (!convite) return resposta(200, { situacao: 'invalido' });

  const u = convite.usuarios as unknown as { nome: string; email: string; ativo: boolean; perfil: string } | null;
  // Acesso de fornecedor costuma ter o nome da empresa: a tela não cumprimenta pelo nome.
  const primeiro = u && u.perfil !== 'fornecedor' ? (u.nome.trim().split(/\s+/).find((p) => /[A-Za-zÀ-ÿ]{2}/.test(p)) ?? '') : '';
  const base = {
    tipo: convite.tipo,
    primeiro_nome: primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : '',
    email: u ? emailParcial(u.email) : '',
  };
  let situacao = 'valido';
  if (!u || !u.ativo) situacao = 'desativado';
  else if (convite.usado_em) situacao = 'usado';
  else if (convite.substituido_em || convite.situacao_envio === 'cancelado') situacao = 'substituido';
  else if (!convite.expira_em || new Date(convite.expira_em as string) < new Date()) situacao = 'vencido';
  if (situacao !== 'valido' || corpo.acao !== 'usar') return resposta(200, { ...base, situacao });

  const destino = String(corpo.destino ?? '');
  if (!DESTINOS_ACEITOS.includes(destino)) return resposta(400, { erro: 'Endereço de retorno não autorizado' });
  const redirectTo = `${destino}nova-senha`;

  // Gasta o convite antes de gerar o link: dois cliques ao mesmo tempo não geram dois links.
  const { data: marcado } = await servico
    .from('convites_acesso')
    .update({ usado_em: new Date().toISOString() })
    .eq('id', convite.id)
    .is('usado_em', null)
    .select('id')
    .maybeSingle();
  if (!marcado) return resposta(200, { ...base, situacao: 'usado' });

  const { data: login } = await servico.auth.admin.getUserById(convite.usuario_id);
  const nuncaEntrou = !login?.user?.last_sign_in_at;
  let resultado = nuncaEntrou
    ? await servico.auth.admin.generateLink({ type: 'invite', email: u!.email, options: { redirectTo } })
    : await servico.auth.admin.generateLink({ type: 'recovery', email: u!.email, options: { redirectTo } });
  if (resultado.error && nuncaEntrou) {
    resultado = await servico.auth.admin.generateLink({ type: 'recovery', email: u!.email, options: { redirectTo } });
  }
  if (resultado.error || !resultado.data?.properties?.action_link) {
    // Não deu: o convite volta a valer para tentar de novo.
    await servico.from('convites_acesso').update({ usado_em: null }).eq('id', convite.id);
    return resposta(500, { erro: 'Não foi possível abrir a criação da senha agora. Tente de novo em alguns minutos.' });
  }

  await servico.from('eventos').insert({
    tabela: 'usuarios',
    registro_id: convite.usuario_id,
    acao: 'convite_usado',
    detalhe: { convite_id: convite.id, tipo: convite.tipo },
    usuario_id: convite.usuario_id,
  });
  return resposta(200, { ...base, situacao: 'ok', link: resultado.data.properties.action_link });
});
