// Primeiro acesso e troca de senha: gera o código de acesso e pede ao n8n para enviar o e-mail na hora.
// Pública (a pessoa ainda não tem senha). Responde sempre do mesmo jeito, para não revelar quem tem acesso.
//
// POST { email }  ->  200 { ok: true }  |  429 { erro } (pedido repetido)  |  502 { erro } (o e-mail não saiu)
//
// O fluxo "Portal de Terceiros - Código de acesso" do n8n recebe { para, assunto, corpo, html } no webhook
// (endereço abaixo, ou o segredo N8N_CODIGO_URL se existir) e confere o cabeçalho x-chave-n8n, o mesmo segredo CHAVE_N8N que o n8n
// já usa para falar com a função cobrancas-automaticas (credencial CHAVE_N8N_PORTAL_TERCEIROS).
// A pessoa confirma o código na tela com supabase.auth.verifyOtp (type 'email') e cria a senha.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const PORTAL = 'https://emais-projetos.github.io/portal-terceiros/';
// Webhook do fluxo do n8n. Não é segredo: sem o cabeçalho x-chave-n8n o n8n recusa (403).
const N8N_CODIGO_URL = 'https://fferreira.app.n8n.cloud/webhook/terceiros-codigo-adc779038bea';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERVALO_SEGUNDOS = 60;
const MAXIMO_POR_HORA = 5;
const CODIGO_OCULTO = '[código ocultado no registro]';

const MODELO_PADRAO = {
  assunto: 'Seu código de acesso ao Portal de Terceiros da Emais',
  corpo:
    'Olá, {primeiro_nome},\n\nSeu código de acesso ao Portal de Terceiros do Grupo Emais é:\n\n{codigo}\n\n' +
    'Digite o código na tela do portal para criar a sua senha. Ele vale por pouco tempo e só pode ser usado uma vez. ' +
    'Se vencer, peça outro na mesma tela.\n\nSe você não pediu este código, ignore este e-mail. Sua senha continua a mesma.\n\n' +
    'Depois, entre sempre por {endereco_portal} com o e-mail {email}.\n\nAtenciosamente,\n{assinatura}',
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cabecalhos, 'Content-Type': 'application/json' } });

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'a']);
const SUFIXOS = /\s*(-\s*)?\b(LTDA|ME|EPP|EIRELI|S\/?A|LIMITADA)\.?\s*$/i;

// Mesmo jeito dos outros e-mails: 'A SSB CONSTRUTORA LTDA' -> 'A SSB Construtora'; pessoa -> primeiro nome.
function saudacao(nome: string, perfil: string): string {
  let t = nome.trim();
  if (perfil === 'fornecedor') {
    t = t.replace(/^[\d.\/\s-]+/, '');
    for (let i = 0; i < 2; i++) t = t.replace(SUFIXOS, '').trim();
  } else {
    t = t.split(/\s+/).find((p) => /[A-Za-zÀ-ÿ]{2}/.test(p)) ?? t;
  }
  return t
    .split(/\s+/)
    .map((p, i) => {
      const so = p.replace(/[^A-Za-zÀ-ÿ]/g, '');
      if (!so) return p;
      if (/[.&/]/.test(p) || (so.length <= 4 && !/[AEIOUÁÉÍÓÚÂÊÔÃÕ]/i.test(so))) return p.toUpperCase();
      const baixo = p.toLowerCase();
      if (i > 0 && MINUSCULAS.has(baixo)) return baixo;
      return baixo.charAt(0).toUpperCase() + baixo.slice(1);
    })
    .join(' ');
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Versão HTML do mesmo texto, com o código grande e em destaque.
function emHtml(corpo: string, codigo: string): string {
  const linhas = corpo.split('\n').map((l) =>
    l.trim() === codigo
      ? `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#006666;margin:16px 0">${codigo}</p>`
      : escapar(l) + '<br>',
  );
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2b28">${linhas.join('\n')}</div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST' });
  let email = '';
  try {
    email = String((await req.json())?.email ?? '').trim().toLowerCase();
  } catch { /* corpo inválido */ }
  if (!EMAIL.test(email) || email.length > 200) return responder(400, { erro: 'Confira o e-mail digitado.' });

  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Frequência: um código por minuto e até 5 por hora para cada e-mail (vale para qualquer e-mail, com ou sem acesso,
  // para a resposta não revelar quem está cadastrado).
  const agora = Date.now();
  const { data: anterior, error: erroLeitura } = await servico.from('codigos_acesso_envios').select('*').eq('email', email).maybeSingle();
  if (erroLeitura) return responder(500, { erro: 'Não foi possível enviar o código agora. Tente de novo em instantes.' });
  if (anterior && agora - new Date(anterior.ultimo_em).getTime() < INTERVALO_SEGUNDOS * 1000) {
    return responder(429, { erro: 'Aguarde um minuto para pedir outro código. Use o último que chegou.' });
  }
  const janelaNova = !anterior || agora - new Date(anterior.janela_inicio).getTime() > 3600 * 1000;
  if (!janelaNova && anterior.qtd_na_janela >= MAXIMO_POR_HORA) {
    return responder(429, { erro: 'Já enviamos vários códigos para este e-mail. Aguarde uma hora ou fale com o Gente e Gestão da Emais.' });
  }
  const controle = {
    email,
    ultimo_em: new Date(agora).toISOString(),
    janela_inicio: janelaNova ? new Date(agora).toISOString() : anterior.janela_inicio,
    qtd_na_janela: janelaNova ? 1 : anterior.qtd_na_janela + 1,
  };
  await servico.from('codigos_acesso_envios').upsert(controle);
  const liberarDeNovo = () =>
    anterior ? servico.from('codigos_acesso_envios').update({ ultimo_em: anterior.ultimo_em, janela_inicio: anterior.janela_inicio, qtd_na_janela: anterior.qtd_na_janela }).eq('email', email)
      : servico.from('codigos_acesso_envios').delete().eq('email', email);

  // Só acesso ativo recebe código. Login é só o e-mail do acesso (os e-mails a mais da empresa não entram).
  const { data: usuario } = await servico.from('usuarios').select('id, nome, email, perfil, ativo').eq('email', email).maybeSingle();
  if (!usuario?.ativo) return responder(200, { ok: true });

  // Acesso criado pelo convite ainda não confirmado: confirma antes, senão o Supabase não gera o código de entrada.
  // Quem prova a posse do e-mail é o código, que só chega na caixa da pessoa.
  const { data: conta } = await servico.auth.admin.getUserById(usuario.id);
  if (conta?.user && !conta.user.email_confirmed_at) {
    await servico.auth.admin.updateUserById(usuario.id, { email_confirm: true });
  }
  const { data: link, error: erroLink } = await servico.auth.admin.generateLink({ type: 'magiclink', email: usuario.email });
  const codigo = link?.properties?.email_otp;
  if (erroLink || !codigo) {
    await liberarDeNovo();
    return responder(500, { erro: 'Não foi possível gerar o código. Tente de novo em instantes.' });
  }

  const [{ data: modelo }, { data: ps }, { data: ue }] = await Promise.all([
    servico.from('modelos_email').select('assunto, corpo').eq('tipo', 'codigo_acesso').maybeSingle(),
    servico.from('parametros').select('chave, valor').in('chave', ['cobranca_setor', 'cobranca_contato']),
    servico.from('usuarios_empresas').select('empresa_id').eq('usuario_id', usuario.id),
  ]);
  const param = new Map((ps ?? []).map((x) => [x.chave as string, String(x.valor ?? '').trim()]));
  const valores: Record<string, string> = {
    '{primeiro_nome}': saudacao(String(usuario.nome ?? ''), String(usuario.perfil)),
    '{codigo}': codigo,
    '{email}': usuario.email,
    '{endereco_portal}': PORTAL,
    '{assinatura}': [`${param.get('cobranca_setor') || 'Gente e Gestão'} | Grupo Emais`, param.get('cobranca_contato')].filter(Boolean).join('\n'),
  };
  const m = modelo ?? MODELO_PADRAO;
  const trocar = (t: string) => t.replace(/\{[a-z_]+\}/g, (x) => (x in valores ? valores[x] : x));
  let corpo = trocar(m.corpo).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // O código não pode faltar, mesmo que tenham tirado o campo do texto.
  if (!corpo.split('\n').some((l) => l.trim() === codigo)) corpo = `${corpo}\n\nSeu código:\n\n${codigo}`;
  const assunto = trocar(m.assunto).replace(/\s+/g, ' ').trim();

  const r = await fetch(Deno.env.get('N8N_CODIGO_URL') || N8N_CODIGO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-chave-n8n': Deno.env.get('CHAVE_N8N') ?? '' },
    body: JSON.stringify({ para: usuario.email, assunto, corpo, html: emHtml(corpo, codigo) }),
    signal: AbortSignal.timeout(20000),
  }).catch((e) => ({ ok: false, status: 0, statusText: String(e) }) as Response);

  // Registro do envio (aba de envios), sem o código.
  await servico.from('cobrancas_envios').insert({
    chave: `codigo|${usuario.id}|${agora}`,
    tipo: 'codigo_acesso',
    titulo: usuario.nome,
    empresa_ids: (ue ?? []).map((x) => x.empresa_id),
    obra_id: null,
    para: usuario.email,
    para_original: usuario.email,
    assunto,
    corpo: corpo.split('\n').map((l) => (l.trim() === codigo ? CODIGO_OCULTO : l)).join('\n'),
    situacao: r.ok ? 'enviada' : 'erro',
    erro: r.ok ? null : `n8n respondeu ${r.status || 'sem resposta'}`,
    teste: false,
  });

  if (!r.ok) {
    await liberarDeNovo();
    return responder(502, { erro: 'O e-mail com o código não saiu agora. Tente de novo em alguns minutos.' });
  }
  return responder(200, { ok: true });
});
