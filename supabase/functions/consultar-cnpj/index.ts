// Consulta do CNPJ na Receita para o Suprimentos e o administrativo (Novo fornecedor e cadastro).
// Pede ao fluxo "Portal de Terceiros - Consulta CNPJ na Receita" do n8n (BrasilAPI + CNPJ.ws), guarda a última consulta
// em consultas_receita (preenche o F.31 do fornecedor novo) e devolve o resultado.
//
// POST { cnpj }  ->  200 { resultado, consultada_em, cache, ja_cadastrado }  |  400 | 401 | 403 | 502 { erro }
//
// O webhook confere o cabeçalho x-chave-n8n (segredo CHAVE_N8N, credencial CHAVE_N8N_PORTAL_TERCEIROS no n8n).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Webhook do fluxo do n8n. Não é segredo: sem o cabeçalho x-chave-n8n o n8n recusa (403).
const N8N_CNPJ_URL = 'https://fferreira.app.n8n.cloud/webhook/terceiros-cnpj-297df17259b7';
// Consulta repetida do mesmo CNPJ em pouco tempo usa a guardada (a CNPJ.ws aceita 3 consultas por minuto).
const CACHE_MINUTOS = 10;

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cabecalhos, 'Content-Type': 'application/json' } });
const erro = (status: number, mensagem: string) => resposta(status, { erro: mensagem });

function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = base.split('').reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  return `${d1}${dv(c.slice(0, 12) + d1)}` === c.slice(12);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });
  if (req.method !== 'POST') return erro(405, 'Use POST');

  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return erro(401, 'Faça login para continuar');
  const { data: quem, error: erroQuem } = await servico.auth.getUser(token);
  if (erroQuem || !quem?.user) return erro(401, 'Sessão inválida. Entre de novo no portal.');
  const { data: chamador } = await servico.from('usuarios').select('id, perfil, ativo').eq('id', quem.user.id).maybeSingle();
  if (!chamador || !chamador.ativo || !['admin', 'suprimentos'].includes(chamador.perfil)) {
    return erro(403, 'Apenas o Suprimentos e o administrativo consultam a Receita');
  }
  // "Ver como": consulta, mas não guarda.
  const sessaoId = (() => {
    try {
      const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).session_id as string | undefined;
    } catch {
      return undefined;
    }
  })();
  let visualizacao = false;
  if (sessaoId && /^[0-9a-f-]{36}$/i.test(sessaoId)) {
    const { data: vis } = await servico.from('visualizacoes').select('id').eq('sessao_id', sessaoId).maybeSingle();
    visualizacao = !!vis;
  }

  let cnpj = '';
  try {
    cnpj = String((await req.json())?.cnpj ?? '').replace(/\D/g, '');
  } catch { /* corpo inválido */ }
  if (!cnpjValido(cnpj)) return erro(400, 'Confira o CNPJ: são 14 números e os dígitos finais não batem.');

  const { data: existente } = await servico.from('empresas').select('id, razao_social').eq('cnpj', cnpj).maybeSingle();
  const ja_cadastrado = existente ? { empresa_id: existente.id, razao_social: existente.razao_social } : null;

  const { data: guardada } = await servico.from('consultas_receita').select('resultado, consultada_em').eq('cnpj', cnpj).maybeSingle();
  if (guardada && Date.now() - new Date(guardada.consultada_em).getTime() < CACHE_MINUTOS * 60_000) {
    return resposta(200, { resultado: guardada.resultado, consultada_em: guardada.consultada_em, cache: true, ja_cadastrado });
  }

  const r = await fetch(Deno.env.get('N8N_CNPJ_URL') || N8N_CNPJ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-chave-n8n': Deno.env.get('CHAVE_N8N') ?? '' },
    body: JSON.stringify({ cnpj }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  let resultado: Record<string, unknown> | null = null;
  if (r?.ok) {
    try {
      resultado = await r.json();
    } catch { /* resposta inválida */ }
  }
  const consulta = (resultado?.consulta ?? {}) as Record<string, string>;
  const respondeu = Object.values(consulta).some((v) => /\bok$/.test(String(v)));
  if (!resultado || !resultado.preenche_no_portal || !respondeu) {
    // Sem resposta nova: devolve a guardada, se houver, avisando a data.
    if (guardada) return resposta(200, { resultado: guardada.resultado, consultada_em: guardada.consultada_em, cache: true, antiga: true, ja_cadastrado });
    return erro(502, 'A Receita não respondeu agora. Pode cadastrar normalmente e consultar de novo depois.');
  }

  const consultada_em = new Date().toISOString();
  if (!visualizacao) {
    const situacao = String(resultado.situacao_receita ?? '').toUpperCase();
    await servico.from('consultas_receita').upsert({
      cnpj,
      situacao: /^[A-Z]+$/.test(situacao) ? situacao : null,
      resultado,
      consultada_em,
      consultada_por: chamador.id,
    });
  }
  return resposta(200, { resultado, consultada_em, cache: false, ja_cadastrado });
});
