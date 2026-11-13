// Teste de segurança no portal publicado, visto de fora, como um estranho na internet.
// Usa só a chave pública do site (a mesma que qualquer pessoa vê no navegador). Não grava nada.
//
//   node supabase/testes/testar_producao.mjs
//
// Confere: criação de conta fechada, tabelas e funções sem login, pasta de arquivos, link de convite,
// funções do n8n e de acessos, e se o site publicado não carrega nenhuma chave secreta.
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../../site/.env.production', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL;
const CHAVE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SITE = 'https://emais-projetos.github.io/portal-terceiros/';
if (!BASE || !CHAVE) throw new Error('Faltam VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY em site/.env.production');

const falhas = [];
let verificacoes = 0;
function ok(cond, teste, detalhe) {
  verificacoes++;
  if (!cond) falhas.push(`${teste}: ${detalhe}`);
}

async function chamar(caminho, { metodo = 'GET', corpo, cabecalhos = {}, comChave = true } = {}) {
  const r = await fetch(caminho.startsWith('http') ? caminho : BASE + caminho, {
    method: metodo,
    headers: {
      ...(comChave ? { apikey: CHAVE } : {}),
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...cabecalhos,
    },
    body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* não é JSON */ }
  return { status: r.status, texto, json };
}

const codigoAleatorio = () => randomBytes(32).toString('base64url');

// ------------------------------------------------------------------------------------------
// 1. Ninguém cria conta sozinho: só o administrativo cria acessos.
// ------------------------------------------------------------------------------------------
{
  const r = await chamar('/auth/v1/settings');
  ok(r.status === 200, 'Login', `não consegui ler a configuração (${r.status})`);
  if (r.json) {
    ok(r.json.disable_signup === true, 'Login', 'qualquer pessoa consegue criar uma conta no portal (cadastro aberto)');
    const externos = Object.entries(r.json.external ?? {}).filter(([k, v]) => v === true && k !== 'email').map(([k]) => k);
    ok(externos.length === 0, 'Login', `entrada por outros provedores ligada: ${externos.join(', ')}`);
  }
}

// ------------------------------------------------------------------------------------------
// 2. Sem login, nenhuma tabela ou view devolve dados.
// ------------------------------------------------------------------------------------------
const TABELAS = [
  'alocacoes', 'arquivos', 'avisos_liberacao', 'cobrancas', 'cobrancas_envios', 'colaboradores', 'colaboradores_bloqueios',
  'colaboradores_documentos_extras', 'conversas', 'convites_acesso', 'documentos', 'empresas', 'empresas_obras', 'eventos',
  'funcoes', 'funcoes_documentos', 'integracoes', 'integracoes_participantes', 'medicoes', 'medicoes_arquivos',
  'medicoes_colaboradores', 'medicoes_itens', 'mensagens', 'modelos_documento', 'modelos_email', 'modelos_email_revisoes',
  'obras', 'parametros', 'parametros_historico', 'pedidos_obra', 'tipos_documento', 'tipos_documento_historico',
  'tipos_medicao', 'tst_obras', 'usuarios', 'usuarios_empresas', 'v_alocacoes_resumo', 'v_documentos_atuais',
  'v_documentos_em_aberto', 'v_exigencias', 'v_medicoes', 'v_pendencias', 'v_rescisao',
];
{
  // Tabelas novas que a API mostrar entram no teste automaticamente.
  const raiz = await chamar('/rest/v1/');
  const descobertas = raiz.json?.paths ? Object.keys(raiz.json.paths).map((p) => p.replace(/^\//, '')).filter((p) => p && !p.startsWith('rpc/')) : [];
  for (const t of new Set([...TABELAS, ...descobertas])) {
    const r = await chamar(`/rest/v1/${t}?select=*&limit=1`);
    const vazou = r.status === 200 && Array.isArray(r.json) && r.json.length > 0;
    ok(!vazou, 'Sem login (tabelas)', `${t} devolveu dados`);
    ok(r.status === 200 || r.status === 401 || r.status === 403 || r.status === 404, 'Sem login (tabelas)', `${t} respondeu ${r.status}`);
  }
}

// ------------------------------------------------------------------------------------------
// 3. Sem login, nenhuma função do portal roda (o banco precisa recusar antes de executar).
// ------------------------------------------------------------------------------------------
const FUNCOES = {
  abrir_medicao: 'p_empresa uuid, p_obra uuid, p_competencia date',
  acessos_ultimo_login: '',
  alterar_tipo_documento: 'p_codigo text, p_validade_dias integer, p_impeditivo boolean, p_motivo text',
  aprovar_alocacao: 'p_alocacao uuid',
  aprovar_documento: 'p_documento uuid, p_vencimento date',
  avaliar_item_medicao: 'p_item uuid, p_aprovar boolean, p_motivo text',
  bloquear_colaborador: 'p_colaborador uuid, p_bloquear boolean, p_motivo text',
  cadastrar_subcontratada: 'p_principal uuid, p_cnpj text, p_razao_social text, p_email text, p_obras uuid[]',
  cancelar_integracao: 'p_integracao uuid',
  combinar_prazo_medicao: 'p_medicao uuid, p_data date, p_obs text',
  concluir_conferencia_medicao: 'p_medicao uuid',
  concluir_integracao: 'p_integracao uuid, p_presentes uuid[]',
  conferir_colaborador_medicao: 'p_linha uuid, p_conferencia jsonb, p_situacao situacao_colaborador_medicao',
  corrigir_colaborador: 'p_colaborador uuid, p_empresa uuid, p_nome text, p_cpf text, p_funcao_id uuid, p_funcao_texto text',
  criar_integracao: 'p_obra uuid, p_data date, p_horario text, p_local text, p_responsavel text, p_alocacoes uuid[]',
  definir_colaborador_medicao: 'p_medicao uuid, p_colaborador uuid, p_situacao situacao_colaborador_medicao, p_observacao text',
  desligar_colaborador: 'p_colaborador uuid, p_data date, p_desistente boolean',
  devolver_alocacao_tst: 'p_alocacao uuid, p_motivo text',
  devolver_documento: 'p_documento uuid, p_motivo text',
  enviar_aviso_liberacao: 'p_obra uuid, p_alocacoes uuid[], p_destinatarios text',
  enviar_documento: 'p_id uuid, p_tipo text, p_empresa uuid, p_colaborador uuid, p_data_emissao date, p_vencimento date, p_dispensado boolean, p_dados jsonb, p_arquivos jsonb, p_aceite_lgpd boolean',
  enviar_item_medicao: 'p_medicao uuid, p_tipo text, p_arquivos jsonb, p_nao_aplica boolean, p_justificativa text, p_aceite_lgpd boolean',
  enviar_medicao: 'p_medicao uuid',
  enviar_mensagem: 'p_texto text, p_conversa uuid',
  enviar_para_analise: 'p_alocacao uuid',
  gerar_aviso_liberacao: 'p_obra uuid, p_alocacoes uuid[], p_destinatarios text',
  incluir_documento_colaborador: 'p_colaborador uuid, p_tipo text, p_descricao text',
  informar_contrato: 'p_empresa uuid, p_obra uuid, p_numero text',
  marcar_conversa_lida: 'p_conversa uuid',
  painel_obra: 'p_obra uuid',
  painel_obras: '',
  pedir_obra: 'p_empresa uuid, p_obra uuid, p_contrato text, p_observacao text',
  reenviar_aviso_liberacao: 'p_aviso uuid',
  registrar_cobranca_medicao: 'p_medicoes uuid[]',
  registrar_download: 'p_arquivos uuid[]',
  registrar_download_medicao: 'p_arquivos uuid[]',
  registrar_integracao: 'p_alocacao uuid, p_data date',
  remover_colaborador_medicao: 'p_medicao uuid, p_colaborador uuid',
  resolver_conversa: 'p_conversa uuid, p_resolvida boolean',
  responder_pedido_obra: 'p_pedido uuid, p_aprovar boolean, p_motivo text',
  validar_alocacao_tst: 'p_alocacao uuid',
};
// Valores inofensivos: ids que não existem, datas antigas. Só serviriam para mostrar se a função roda sem login.
function valor(tipo) {
  if (tipo.endsWith('[]')) return [];
  if (tipo === 'uuid') return randomUUID();
  if (tipo === 'date') return '2000-01-01';
  if (tipo === 'boolean') return false;
  if (tipo === 'integer') return 0;
  if (tipo === 'jsonb') return {};
  if (tipo === 'situacao_colaborador_medicao') return 'trabalhou';
  return 'teste de segurança';
}
for (const [nome, args] of Object.entries(FUNCOES)) {
  const corpo = Object.fromEntries(args ? args.split(', ').map((a) => { const [n, ...t] = a.split(' '); return [n, valor(t.join(' '))]; }) : []);
  const r = await chamar(`/rest/v1/rpc/${nome}`, { metodo: 'POST', corpo });
  const recusada = (r.status === 401 || r.status === 403) && r.json?.code === '42501';
  ok(r.status !== 404, 'Sem login (funções)', `${nome}: a função não foi encontrada com esses parâmetros (atualize a lista do teste)`);
  if (r.status !== 404) ok(recusada, 'Sem login (funções)', `${nome} rodou sem login (${r.status} ${r.json?.code ?? ''} ${r.json?.message ?? ''})`.trim());
}

// ------------------------------------------------------------------------------------------
// 4. Arquivos: a pasta não é pública e não lista nada sem login.
// ------------------------------------------------------------------------------------------
{
  const lista = await chamar('/storage/v1/object/list/documentos', { metodo: 'POST', corpo: { prefix: '', limit: 5 } });
  ok(!(lista.status === 200 && Array.isArray(lista.json) && lista.json.length > 0), 'Arquivos', 'a pasta de documentos lista arquivos sem login');
  const publico = await chamar('/storage/v1/object/public/documentos/teste.pdf');
  ok(publico.status !== 200, 'Arquivos', 'a pasta de documentos abre arquivos por link público');
  const pastas = await chamar('/storage/v1/bucket');
  ok(!(pastas.status === 200 && Array.isArray(pastas.json) && pastas.json.some((b) => b.public)), 'Arquivos', 'existe pasta pública');
}

// ------------------------------------------------------------------------------------------
// 5. Link de convite: código inventado não vale, não gasta nada e não devolve link.
// ------------------------------------------------------------------------------------------
{
  const fn = '/functions/v1/resgatar-convite';
  for (const [rotulo, corpo] of [
    ['código inventado', { acao: 'ver', codigo: codigoAleatorio() }],
    ['código inventado ao usar', { acao: 'usar', codigo: codigoAleatorio(), destino: SITE }],
    ['código curto', { acao: 'usar', codigo: 'abc', destino: SITE }],
    ['código com caracteres estranhos', { acao: 'ver', codigo: "' or 1=1 --" + 'x'.repeat(30) }],
    ['retorno para outro site', { acao: 'usar', codigo: codigoAleatorio(), destino: 'https://site-falso.example/' }],
  ]) {
    const r = await chamar(fn, { metodo: 'POST', corpo });
    ok(r.status === 200 && r.json?.situacao === 'invalido', 'Convite', `${rotulo}: esperado "invalido", veio ${r.status} ${r.texto.slice(0, 120)}`);
    ok(!/link|action_link|token/i.test(JSON.stringify(r.json ?? {}).replace(/"situacao"/, '')), 'Convite', `${rotulo}: a resposta trouxe link ou token`);
  }
  const get = await chamar(fn);
  ok(get.status !== 200, 'Convite', `GET respondeu 200 (esperado recusar)`);
  const lixo = await chamar(fn, { metodo: 'POST', corpo: 'não é json' });
  ok(lixo.status === 400 || lixo.status === 401, 'Convite', `pedido malformado respondeu ${lixo.status}`);
}

// ------------------------------------------------------------------------------------------
// 6. Funções do servidor: o n8n só entra com a chave dele, e criar acesso exige login de admin.
// ------------------------------------------------------------------------------------------
{
  const n8n = '/functions/v1/cobrancas-automaticas';
  for (const [rotulo, cab] of [
    ['sem a chave do n8n', {}],
    ['com chave errada', { 'x-chave-n8n': codigoAleatorio() }],
    ['com a chave pública do site', { 'x-chave-n8n': CHAVE, Authorization: `Bearer ${CHAVE}` }],
  ]) {
    for (const acao of ['fila', 'liberacoes', 'resumo']) {
      const r = await chamar(n8n, { metodo: 'POST', corpo: { acao }, cabecalhos: cab });
      ok(r.status === 401 || r.status === 403, 'n8n', `${acao} ${rotulo}: respondeu ${r.status}`);
    }
  }
  const acessos = '/functions/v1/gerenciar-acesso';
  for (const [rotulo, cab] of [['sem login', {}], ['com a chave pública no lugar do login', { Authorization: `Bearer ${CHAVE}` }]]) {
    for (const corpo of [
      { acao: 'criar', nome: 'Teste Seguranca', email: 'teste-seguranca@example.com', perfil: 'admin', destino: SITE },
      { acao: 'enviar', usuario_id: randomUUID() },
    ]) {
      const r = await chamar(acessos, { metodo: 'POST', corpo, cabecalhos: cab });
      ok(r.status === 401 || r.status === 403, 'Acessos', `${corpo.acao} ${rotulo}: respondeu ${r.status}`);
    }
  }
}

// ------------------------------------------------------------------------------------------
// 7. Site publicado: nenhuma chave secreta no código que vai para o navegador.
// ------------------------------------------------------------------------------------------
{
  const pagina = await chamar(SITE, { comChave: false });
  ok(pagina.status === 200, 'Site', `não abriu (${pagina.status})`);
  const scripts = [...pagina.texto.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => new URL(m[1], SITE).href);
  ok(scripts.length > 0, 'Site', 'não achei os arquivos do site para conferir');
  for (const s of scripts) {
    const js = (await chamar(s, { comChave: false })).texto;
    ok(!/sb_secret_[A-Za-z0-9_-]{10,}/.test(js), 'Site', `${s} contém chave secreta (sb_secret_)`);
    ok(!/c2VydmljZV9yb2xl|"role"\s*:\s*"service_role"/.test(js), 'Site', `${s} contém chave service_role`);
    ok(!/CHAVE_N8N|x-chave-n8n/.test(js), 'Site', `${s} menciona a chave do n8n`);
  }
}

// ------------------------------------------------------------------------------------------
console.log(`Verificações: ${verificacoes}`);
if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  for (const f of falhas) console.log(` - ${f}`);
  process.exit(1);
}
console.log('Nenhuma falha encontrada.');
