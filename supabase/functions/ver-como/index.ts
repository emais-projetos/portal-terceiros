// "Ver como": o administrativo master abre o portal como outro usuário, somente para olhar.
// A sessão criada aqui fica registrada em public.visualizacoes; o banco recusa toda gravação feita por ela
// (trava zz_bloquear_visualizacao em todas as tabelas e regras nos arquivos), mesmo depois de encerrada.
//
// Ações (sempre com o token de quem chama):
//   { acao: 'listar' }               master: usuários que dá para ver (ativos, não administrativos, que já entraram no portal)
//   { acao: 'iniciar', usuario_id }  master: devolve a sessão (access_token e refresh_token) do usuário escolhido
//   { acao: 'encerrar' }             sessão de visualização: encerra e revoga essa sessão
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cabecalhos, 'Content-Type': 'application/json' } });
}
const erro = (status: number, mensagem: string) => resposta(status, { erro: mensagem });

// Lê o id da sessão de dentro do token (o Supabase já conferiu a assinatura em getUser).
function sessaoDoToken(token: string): string | null {
  try {
    const parte = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const dados = JSON.parse(atob(parte + '='.repeat((4 - (parte.length % 4)) % 4)));
    return typeof dados.session_id === 'string' && UUID.test(dados.session_id) ? dados.session_id : null;
  } catch {
    return null;
  }
}

async function evento(servico: SupabaseClient, usuarioId: string, registro: string, acao: string, detalhe: Record<string, unknown>) {
  await servico.from('eventos').insert({ tabela: 'usuarios', registro_id: registro, acao, detalhe, usuario_id: usuarioId });
}

async function ultimosAcessos(servico: SupabaseClient): Promise<Map<string, string | null>> {
  const m = new Map<string, string | null>();
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await servico.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) throw error;
    data.users.forEach((u) => m.set(u.id, u.last_sign_in_at ?? null));
    if (data.users.length < 1000) break;
  }
  return m;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });
  if (req.method !== 'POST') return erro(405, 'Use POST');

  const url = Deno.env.get('SUPABASE_URL')!;
  const servico = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return erro(401, 'Faça login para continuar');
  const { data: quem, error: erroQuem } = await servico.auth.getUser(token);
  if (erroQuem || !quem?.user) return erro(401, 'Sessão inválida. Entre de novo no portal.');
  const sessao = sessaoDoToken(token);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return erro(400, 'Pedido inválido');
  }

  // Encerrar: vale para a própria sessão de visualização.
  if (corpo.acao === 'encerrar') {
    if (!sessao) return erro(400, 'Sessão sem identificação');
    const { data: v } = await servico.from('visualizacoes').select('id, master_id, alvo_id, encerrada_em').eq('sessao_id', sessao).maybeSingle();
    if (!v) return erro(403, 'Esta sessão não é de visualização');
    if (!v.encerrada_em) {
      await servico.from('visualizacoes').update({ encerrada_em: new Date().toISOString() }).eq('id', v.id);
      await evento(servico, v.master_id, v.alvo_id, 'ver_como_fim', { sessao_id: sessao });
    }
    await servico.auth.admin.signOut(token, 'local');
    return resposta(200, { ok: true });
  }

  // As outras ações são do master, fora de uma visualização.
  const { data: master } = await servico.from('usuarios').select('id, nome, perfil, ativo, master').eq('id', quem.user.id).maybeSingle();
  if (!master || !master.ativo || !master.master || master.perfil !== 'admin') return erro(403, 'Apenas o acesso master usa o Ver como');
  if (sessao) {
    const { data: ja } = await servico.from('visualizacoes').select('id').eq('sessao_id', sessao).maybeSingle();
    if (ja) return erro(403, 'Volte para o seu acesso antes de abrir outra visualização');
  }

  if (corpo.acao === 'listar') {
    const [{ data: usuarios, error: e1 }, { data: vinculos }, { data: obras }, acessos] = await Promise.all([
      servico.from('usuarios').select('id, nome, email, perfil').eq('ativo', true).neq('perfil', 'admin').order('nome'),
      servico.from('usuarios_empresas').select('usuario_id, empresas(razao_social, homologacao, portal_liberado_em)'),
      servico.from('tst_obras').select('usuario_id, obras(nome)'),
      ultimosAcessos(servico),
    ]);
    if (e1) return erro(500, e1.message);
    type Emp = { razao_social: string; homologacao: string; portal_liberado_em: string | null };
    const empresas = new Map<string, Emp[]>();
    (vinculos ?? []).forEach((v: { usuario_id: string; empresas: Emp | null }) => {
      if (v.empresas) empresas.set(v.usuario_id, [...(empresas.get(v.usuario_id) ?? []), v.empresas]);
    });
    const obrasDe = new Map<string, string[]>();
    (obras ?? []).forEach((o: { usuario_id: string; obras: { nome: string } | null }) => {
      if (o.obras) obrasDe.set(o.usuario_id, [...(obrasDe.get(o.usuario_id) ?? []), o.obras.nome]);
    });
    const lista = (usuarios ?? []).map((u: { id: string; nome: string; email: string; perfil: string }) => {
      const emps = empresas.get(u.id) ?? [];
      return {
        ...u,
        ultimo_acesso: acessos.get(u.id) ?? null,
        empresas: emps.map((e) => e.razao_social),
        em_homologacao: u.perfil === 'fornecedor' && emps.length > 0 && emps.every((e) => !e.portal_liberado_em),
        obras: obrasDe.get(u.id) ?? [],
      };
    });
    return resposta(200, { usuarios: lista });
  }

  if (corpo.acao === 'iniciar') {
    const alvoId = String(corpo.usuario_id ?? '');
    if (!UUID.test(alvoId)) return erro(400, 'Escolha o usuário');
    const { data: alvo } = await servico.from('usuarios').select('id, nome, email, perfil, ativo').eq('id', alvoId).maybeSingle();
    if (!alvo || !alvo.ativo) return erro(404, 'Usuário não encontrado ou desativado');
    if (alvo.perfil === 'admin') return erro(403, 'O Ver como não abre acessos do administrativo');
    const { data: conta } = await servico.auth.admin.getUserById(alvo.id);
    if (!conta?.user?.last_sign_in_at) return erro(409, 'Esta pessoa ainda não entrou no portal. Use o modo demonstração.');

    const { data: link, error: e2 } = await servico.auth.admin.generateLink({ type: 'magiclink', email: conta.user.email ?? alvo.email });
    if (e2 || !link?.properties?.hashed_token) return erro(500, 'Não foi possível abrir a visualização');
    const anonimo = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: nova, error: e3 } = await anonimo.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token });
    if (e3 || !nova?.session) return erro(500, 'Não foi possível abrir a visualização');
    const novaSessao = sessaoDoToken(nova.session.access_token);
    if (!novaSessao) {
      await servico.auth.admin.signOut(nova.session.access_token, 'local');
      return erro(500, 'Não foi possível abrir a visualização');
    }
    // Registra antes de devolver: sem o registro, a sessão não sai daqui (assim nunca grava nada).
    const { error: e4 } = await servico.from('visualizacoes').insert({ sessao_id: novaSessao, master_id: master.id, alvo_id: alvo.id });
    if (e4) {
      await servico.auth.admin.signOut(nova.session.access_token, 'local');
      return erro(500, 'Não foi possível registrar a visualização');
    }
    await evento(servico, master.id, alvo.id, 'ver_como_inicio', { sessao_id: novaSessao, master: master.nome, perfil: alvo.perfil });
    return resposta(200, {
      access_token: nova.session.access_token,
      refresh_token: nova.session.refresh_token,
      usuario: { id: alvo.id, nome: alvo.nome, perfil: alvo.perfil },
    });
  }

  return erro(400, 'Ação desconhecida');
});
