// Cria acessos ao portal, coloca o convite na fila do envio automático e gera o link de primeiro acesso
// (ou de nova senha) para quem preferir mandar pelo Outlook. O administrativo chama; o Suprimentos só cria o acesso
// do fornecedor novo que ele cadastrou para a homologação (o convite da homologação sai pelo banco).
// Nenhum e-mail sai daqui: o convite fica em convites_acesso e o n8n envia (função cobrancas-automaticas).
//
// Ações:
//   { acao: 'criar', nome, email, perfil: 'fornecedor'|'tst'|'engenharia'|'suprimentos'|'admin', empresas?: uuid[], obras?: uuid[], enviar?: boolean, destino }
//   { acao: 'enviar', usuario_id, destino }   convite pelo envio automático
//   { acao: 'link', usuario_id, destino }     link para mandar à mão
//   { acao: 'editar', usuario_id, nome, email, empresas?: uuid[], obras?: uuid[], destino }
//   { acao: 'email_fornecedor', empresa_id, email }  troca o login do fornecedor (administrativo e Suprimentos)
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Endereços aceitos para o retorno do link. O Supabase também confere a lista de Redirect URLs.
const DESTINOS_ACEITOS = [
  'https://emais-projetos.github.io/portal-terceiros/',
  'http://localhost:5173/portal-terceiros/',
  'http://localhost:4173/portal-terceiros/',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cabecalhos, 'Content-Type': 'application/json' },
  });
}

function erro(status: number, mensagem: string) {
  return resposta(status, { erro: mensagem });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });
  if (req.method !== 'POST') return erro(405, 'Use POST');

  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Quem está chamando precisa ser administrativo ativo.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return erro(401, 'Faça login para continuar');
  const { data: quem, error: erroQuem } = await servico.auth.getUser(token);
  if (erroQuem || !quem?.user) return erro(401, 'Sessão inválida. Entre de novo no portal.');
  const { data: chamador } = await servico
    .from('usuarios')
    .select('id, perfil, ativo')
    .eq('id', quem.user.id)
    .maybeSingle();
  if (!chamador || !chamador.ativo || !['admin', 'suprimentos'].includes(chamador.perfil)) {
    return erro(403, 'Apenas o administrativo cria e libera acessos');
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return erro(400, 'Pedido inválido');
  }

  // Troca do e-mail de acesso (login) do fornecedor: administrativo e Suprimentos.
  if (corpo.acao === 'email_fornecedor') return trocarEmailFornecedor(servico, chamador.id, corpo);

  // Suprimentos: fora a troca de e-mail, só cria o acesso do fornecedor em homologação (empresa ainda sem portal liberado).
  if (chamador.perfil === 'suprimentos') {
    const empresas = Array.isArray(corpo.empresas) ? corpo.empresas.map(String) : [];
    if (corpo.acao !== 'criar' || corpo.perfil !== 'fornecedor' || empresas.length !== 1 || corpo.enviar === true) {
      return erro(403, 'O Suprimentos só cria o acesso do fornecedor em homologação');
    }
    const { data: emp } = await servico.from('empresas').select('id, homologacao, portal_liberado_em').in('id', empresas);
    const ok = (emp ?? []).length === 1 && emp.every((x: { homologacao: string; portal_liberado_em: string | null }) =>
      !x.portal_liberado_em && ['convidada', 'devolvida'].includes(x.homologacao));
    if (!ok) return erro(403, 'O Suprimentos só cria o acesso do fornecedor em homologação');
  }

  const destinoBase = String(corpo.destino ?? '');
  if (!DESTINOS_ACEITOS.includes(destinoBase)) return erro(400, 'Endereço de retorno não autorizado');
  const redirectTo = `${destinoBase}nova-senha`;

  if (corpo.acao === 'criar') return criar(servico, chamador.id, corpo, redirectTo);
  if (corpo.acao === 'link') return gerarLink(servico, chamador.id, corpo, redirectTo);
  if (corpo.acao === 'enviar') return enviarConvite(servico, chamador.id, corpo);
  if (corpo.acao === 'editar') return editar(servico, chamador.id, corpo);
  return erro(400, 'Ação desconhecida');
});

// deno-lint-ignore no-explicit-any
type Cliente = any;

async function criar(servico: Cliente, adminId: string, corpo: Record<string, unknown>, redirectTo: string) {
  const nome = String(corpo.nome ?? '').trim();
  const email = String(corpo.email ?? '').trim().toLowerCase();
  const perfil = String(corpo.perfil ?? '');
  const empresas = Array.isArray(corpo.empresas) ? corpo.empresas.map(String) : [];
  const obras = Array.isArray(corpo.obras) ? corpo.obras.map(String) : [];

  if (nome.length < 2) return erro(400, 'Informe o nome');
  if (!EMAIL.test(email)) return erro(400, 'E-mail inválido');
  if (!['fornecedor', 'tst', 'engenharia', 'suprimentos', 'admin'].includes(perfil)) return erro(400, 'Perfil inválido');
  if (perfil === 'fornecedor' && empresas.length === 0) return erro(400, 'Escolha pelo menos uma empresa');
  if ((perfil === 'tst' || perfil === 'engenharia') && obras.length === 0) return erro(400, 'Escolha pelo menos uma obra');
  if ([...empresas, ...obras].some((id) => !UUID.test(id))) return erro(400, 'Empresa ou obra inválida');

  const { data: jaExiste } = await servico.from('usuarios').select('id').eq('email', email).maybeSingle();
  if (jaExiste) return erro(409, 'Já existe um acesso com este e-mail. Use "Enviar acesso" na lista.');

  if (perfil === 'fornecedor') {
    // Regra do portal: um acesso por empresa.
    const { data: ocupadas } = await servico
      .from('usuarios_empresas')
      .select('empresa_id, empresas(razao_social), usuarios(email)')
      .in('empresa_id', empresas);
    if (ocupadas && ocupadas.length > 0) {
      const lista = ocupadas
        .map((o: { empresas?: { razao_social?: string }; usuarios?: { email?: string } }) =>
          `${o.empresas?.razao_social} (${o.usuarios?.email})`)
        .join('; ');
      return erro(409, `Estas empresas já têm acesso: ${lista}`);
    }
  }

  // Cria o login sem senha e gera o link de primeiro acesso, sem enviar e-mail.
  const { data: convite, error: erroConvite } = await servico.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo, data: { nome } },
  });
  if (erroConvite || !convite?.user) {
    return erro(400, `Não foi possível criar o login: ${erroConvite?.message ?? 'erro desconhecido'}`);
  }
  const usuarioId = convite.user.id;

  const desfazer = async (mensagem: string) => {
    await servico.auth.admin.deleteUser(usuarioId);
    return erro(400, mensagem);
  };

  const { error: erroUsuario } = await servico.from('usuarios').insert({ id: usuarioId, nome, email, perfil });
  if (erroUsuario) return desfazer(`Não foi possível gravar o acesso: ${erroUsuario.message}`);

  if (perfil === 'fornecedor') {
    const { error } = await servico
      .from('usuarios_empresas')
      .insert(empresas.map((empresa_id) => ({ usuario_id: usuarioId, empresa_id })));
    if (error) return desfazer(`Não foi possível ligar as empresas: ${error.message}`);
    await servico.from('empresas').update({ email_acesso: email }).in('id', empresas);
    // Fornecedor em homologação: o convite passa a ir para este e-mail.
    const { data: homs } = await servico.from('homologacoes').select('empresa_id, dados').in('empresa_id', empresas);
    for (const h of homs ?? []) {
      if (h.dados && typeof h.dados === 'object') {
        await servico.from('homologacoes').update({ dados: { ...h.dados, email } }).eq('empresa_id', h.empresa_id);
      }
    }
  }
  // TST e engenharia ficam ligados às obras na mesma tabela; o perfil decide o que cada um pode fazer.
  if (perfil === 'tst' || perfil === 'engenharia') {
    const { error } = await servico
      .from('tst_obras')
      .insert(obras.map((obra_id) => ({ usuario_id: usuarioId, obra_id })));
    if (error) return desfazer(`Não foi possível ligar as obras: ${error.message}`);
  }

  await servico.from('eventos').insert({
    tabela: 'usuarios',
    registro_id: usuarioId,
    acao: 'acesso_criado',
    detalhe: { perfil, email, empresas, obras },
    usuario_id: adminId,
  });

  let fila: { id: string } | null = null;
  if (corpo.enviar === true) {
    const r = await enfileirar(servico, adminId, { id: usuarioId, email }, 'primeiro_acesso');
    if ('erro' in r) return resposta(200, { usuario_id: usuarioId, nome, email, perfil, link: convite.properties.action_link, primeiro_acesso: true, convite_erro: r.erro });
    fila = r;
  }

  return resposta(200, {
    usuario_id: usuarioId, nome, email, perfil, link: convite.properties.action_link, primeiro_acesso: true, convite_id: fila?.id ?? null,
  });
}

// Coloca o convite na fila. Convites anteriores da mesma pessoa deixam de valer.
async function enfileirar(servico: Cliente, adminId: string, usuario: { id: string; email: string }, tipo: 'primeiro_acesso' | 'nova_senha') {
  const modelo = tipo === 'primeiro_acesso' ? 'convite_acesso' : 'nova_senha_acesso';
  const { data: m } = await servico.from('modelos_email').select('ativo').eq('tipo', modelo).maybeSingle();
  if (!m?.ativo) return { erro: 'O envio automático deste e-mail está desligado em Acessos > E-mails. Use "Gerar link" e mande pelo Outlook.' };

  const agora = new Date().toISOString();
  await servico.from('convites_acesso').update({ situacao_envio: 'cancelado', substituido_em: agora })
    .eq('usuario_id', usuario.id).in('situacao_envio', ['aguardando', 'enviando', 'erro']);
  await servico.from('convites_acesso').update({ substituido_em: agora })
    .eq('usuario_id', usuario.id).eq('situacao_envio', 'enviado').is('substituido_em', null);

  const { data, error } = await servico.from('convites_acesso')
    .insert({ usuario_id: usuario.id, tipo, para: usuario.email, pedido_por: adminId })
    .select('id, tipo, para, pedido_em, situacao_envio')
    .single();
  if (error) return { erro: `Não foi possível colocar o convite na fila: ${error.message}` };
  await servico.from('eventos').insert({
    tabela: 'usuarios', registro_id: usuario.id, acao: 'convite_pedido', detalhe: { tipo, para: usuario.email }, usuario_id: adminId,
  });
  return data as { id: string; tipo: string; para: string; pedido_em: string; situacao_envio: string };
}

async function enviarConvite(servico: Cliente, adminId: string, corpo: Record<string, unknown>) {
  const usuarioId = String(corpo.usuario_id ?? '');
  if (!UUID.test(usuarioId)) return erro(400, 'Acesso inválido');
  const { data: usuario } = await servico.from('usuarios').select('id, nome, email, ativo').eq('id', usuarioId).maybeSingle();
  if (!usuario) return erro(404, 'Acesso não encontrado');
  if (!usuario.ativo) return erro(400, 'Este acesso está desativado. Reative antes de enviar.');
  const { data: login } = await servico.auth.admin.getUserById(usuarioId);
  const tipo = login?.user?.last_sign_in_at ? 'nova_senha' : 'primeiro_acesso';
  const r = await enfileirar(servico, adminId, usuario, tipo);
  if ('erro' in r) return erro(400, r.erro as string);
  return resposta(200, { usuario_id: usuarioId, nome: usuario.nome, email: usuario.email, convite: r });
}

async function gerarLink(servico: Cliente, adminId: string, corpo: Record<string, unknown>, redirectTo: string) {
  const usuarioId = String(corpo.usuario_id ?? '');
  if (!UUID.test(usuarioId)) return erro(400, 'Acesso inválido');

  const { data: usuario } = await servico.from('usuarios').select('id, nome, email, perfil, ativo').eq('id', usuarioId).maybeSingle();
  if (!usuario) return erro(404, 'Acesso não encontrado');
  if (!usuario.ativo) return erro(400, 'Este acesso está desativado. Reative antes de gerar o link.');

  const { data: login } = await servico.auth.admin.getUserById(usuarioId);
  const nuncaEntrou = !login?.user?.last_sign_in_at;

  // Quem nunca entrou recebe de novo o convite; quem já entrou recebe o link de nova senha.
  let resultado = nuncaEntrou
    ? await servico.auth.admin.generateLink({ type: 'invite', email: usuario.email, options: { redirectTo } })
    : await servico.auth.admin.generateLink({ type: 'recovery', email: usuario.email, options: { redirectTo } });
  if (resultado.error && nuncaEntrou) {
    resultado = await servico.auth.admin.generateLink({ type: 'recovery', email: usuario.email, options: { redirectTo } });
  }
  if (resultado.error || !resultado.data?.properties?.action_link) {
    return erro(400, `Não foi possível gerar o link: ${resultado.error?.message ?? 'erro desconhecido'}`);
  }

  await servico.from('eventos').insert({
    tabela: 'usuarios',
    registro_id: usuarioId,
    acao: 'link_gerado',
    detalhe: { tipo: nuncaEntrou ? 'primeiro_acesso' : 'nova_senha' },
    usuario_id: adminId,
  });

  return resposta(200, {
    usuario_id: usuarioId,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    link: resultado.data.properties.action_link,
    primeiro_acesso: nuncaEntrou,
  });
}

// Corrige nome e e-mail do acesso e troca as empresas (fornecedor) ou as obras (TST e engenharia).
// O perfil não muda por aqui: para trocar de perfil, desative e crie outro acesso.
async function editar(servico: Cliente, adminId: string, corpo: Record<string, unknown>) {
  const usuarioId = String(corpo.usuario_id ?? '');
  const nome = String(corpo.nome ?? '').trim();
  const email = String(corpo.email ?? '').trim().toLowerCase();
  const empresas = Array.isArray(corpo.empresas) ? [...new Set(corpo.empresas.map(String))] : [];
  const obras = Array.isArray(corpo.obras) ? [...new Set(corpo.obras.map(String))] : [];

  if (!UUID.test(usuarioId)) return erro(400, 'Acesso inválido');
  if (nome.length < 2) return erro(400, 'Informe o nome');
  if (!EMAIL.test(email)) return erro(400, 'E-mail inválido');
  if ([...empresas, ...obras].some((id) => !UUID.test(id))) return erro(400, 'Empresa ou obra inválida');

  const { data: usuario } = await servico.from('usuarios').select('id, nome, email, perfil').eq('id', usuarioId).maybeSingle();
  if (!usuario) return erro(404, 'Acesso não encontrado');
  const perfil = usuario.perfil as string;
  if (perfil === 'fornecedor' && empresas.length === 0) return erro(400, 'Escolha pelo menos uma empresa');
  if ((perfil === 'tst' || perfil === 'engenharia') && obras.length === 0) return erro(400, 'Escolha pelo menos uma obra');

  const trocouEmail = email !== usuario.email;
  if (trocouEmail) {
    const { data: outro } = await servico.from('usuarios').select('id').eq('email', email).neq('id', usuarioId).maybeSingle();
    if (outro) return erro(409, 'Já existe outro acesso com este e-mail');
  }

  // Empresas: cada uma tem um único acesso.
  let empresasAntes: string[] = [];
  if (perfil === 'fornecedor') {
    const { data: atuais } = await servico.from('usuarios_empresas').select('empresa_id').eq('usuario_id', usuarioId);
    empresasAntes = (atuais ?? []).map((x: { empresa_id: string }) => x.empresa_id);
    const { data: ocupadas } = await servico
      .from('usuarios_empresas')
      .select('empresa_id, empresas(razao_social), usuarios(email)')
      .in('empresa_id', empresas)
      .neq('usuario_id', usuarioId);
    if (ocupadas && ocupadas.length > 0) {
      const lista = ocupadas
        .map((o: { empresas?: { razao_social?: string }; usuarios?: { email?: string } }) => `${o.empresas?.razao_social} (${o.usuarios?.email})`)
        .join('; ');
      return erro(409, `Estas empresas já têm outro acesso: ${lista}`);
    }
  }

  // O e-mail do login muda primeiro: se o Supabase recusar, nada mais é alterado.
  if (trocouEmail || nome !== usuario.nome) {
    const { error: e } = await servico.auth.admin.updateUserById(usuarioId, {
      ...(trocouEmail ? { email, email_confirm: true } : {}),
      user_metadata: { nome },
    });
    if (e) return erro(400, `Não foi possível alterar o login: ${e.message}`);
  }

  const { error: eu } = await servico.from('usuarios').update({ nome, email }).eq('id', usuarioId);
  if (eu) return erro(400, `Não foi possível gravar o acesso: ${eu.message}`);

  let obrasAntes: string[] = [];
  if (perfil === 'fornecedor') {
    const sair = empresasAntes.filter((id) => !empresas.includes(id));
    const entrar = empresas.filter((id) => !empresasAntes.includes(id));
    if (sair.length) {
      const { error } = await servico.from('usuarios_empresas').delete().eq('usuario_id', usuarioId).in('empresa_id', sair);
      if (error) return erro(400, `Não foi possível tirar as empresas: ${error.message}`);
      await servico.from('empresas').update({ email_acesso: null }).in('id', sair);
    }
    if (entrar.length) {
      const { error } = await servico.from('usuarios_empresas').insert(entrar.map((empresa_id) => ({ usuario_id: usuarioId, empresa_id })));
      if (error) return erro(400, `Não foi possível ligar as empresas: ${error.message}`);
    }
    await servico.from('empresas').update({ email_acesso: email }).in('id', empresas);
  }
  if (perfil === 'tst' || perfil === 'engenharia') {
    const { data: atuais } = await servico.from('tst_obras').select('obra_id').eq('usuario_id', usuarioId);
    obrasAntes = (atuais ?? []).map((x: { obra_id: string }) => x.obra_id);
    const sair = obrasAntes.filter((id) => !obras.includes(id));
    const entrar = obras.filter((id) => !obrasAntes.includes(id));
    if (sair.length) {
      const { error } = await servico.from('tst_obras').delete().eq('usuario_id', usuarioId).in('obra_id', sair);
      if (error) return erro(400, `Não foi possível tirar as obras: ${error.message}`);
    }
    if (entrar.length) {
      const { error } = await servico.from('tst_obras').insert(entrar.map((obra_id) => ({ usuario_id: usuarioId, obra_id })));
      if (error) return erro(400, `Não foi possível ligar as obras: ${error.message}`);
    }
  }

  await servico.from('eventos').insert({
    tabela: 'usuarios',
    registro_id: usuarioId,
    acao: 'acesso_editado',
    detalhe: {
      nome: nome !== usuario.nome ? { de: usuario.nome, para: nome } : undefined,
      email: trocouEmail ? { de: usuario.email, para: email } : undefined,
      empresas: perfil === 'fornecedor' ? { de: empresasAntes, para: empresas } : undefined,
      obras: perfil === 'tst' || perfil === 'engenharia' ? { de: obrasAntes, para: obras } : undefined,
    },
    usuario_id: adminId,
  });

  return resposta(200, { usuario_id: usuarioId, nome, email, perfil, trocou_email: trocouEmail });
}

// Troca o e-mail de acesso do fornecedor: login no Supabase, cadastro do usuário, e-mail de acesso das empresas dele
// e o e-mail do convite da homologação. A senha não muda.
async function trocarEmailFornecedor(servico: Cliente, quemId: string, corpo: Record<string, unknown>) {
  const empresaId = String(corpo.empresa_id ?? '');
  const email = String(corpo.email ?? '').trim().toLowerCase();
  if (!UUID.test(empresaId)) return erro(400, 'Fornecedor inválido');
  if (!EMAIL.test(email)) return erro(400, 'E-mail inválido');

  const { data: ligacoes } = await servico
    .from('usuarios_empresas')
    .select('usuario_id, usuarios!inner(id, email, perfil)')
    .eq('empresa_id', empresaId);
  const acesso = (ligacoes ?? []).find((l: { usuarios?: { perfil?: string } }) => l.usuarios?.perfil === 'fornecedor');
  if (!acesso) {
    return erro(400, 'Este fornecedor ainda não tem acesso ao portal. Coloque o e-mail em "Outros e-mails para avisos" ou peça ao administrativo para criar o acesso.');
  }
  const usuario = acesso.usuarios as { id: string; email: string };
  if (usuario.email === email) return resposta(200, { usuario_id: usuario.id, email, mudou: false });

  const { data: outro } = await servico.from('usuarios').select('id').eq('email', email).neq('id', usuario.id).maybeSingle();
  if (outro) return erro(409, 'Já existe outro acesso com este e-mail');

  const { error: e1 } = await servico.auth.admin.updateUserById(usuario.id, { email, email_confirm: true });
  if (e1) return erro(400, `Não foi possível alterar o login: ${e1.message}`);
  const { error: e2 } = await servico.from('usuarios').update({ email }).eq('id', usuario.id);
  if (e2) return erro(400, `Não foi possível gravar o e-mail: ${e2.message}`);

  const { data: suas } = await servico.from('usuarios_empresas').select('empresa_id').eq('usuario_id', usuario.id);
  const empresas = (suas ?? []).map((x: { empresa_id: string }) => x.empresa_id);
  await servico.from('empresas').update({ email_acesso: email }).in('id', empresas);
  const { data: homs } = await servico.from('homologacoes').select('empresa_id, dados').in('empresa_id', empresas);
  for (const h of homs ?? []) {
    if (h.dados && typeof h.dados === 'object' && 'email' in h.dados) {
      await servico.from('homologacoes').update({ dados: { ...h.dados, email } }).eq('empresa_id', h.empresa_id);
    }
  }

  await servico.from('eventos').insert({
    tabela: 'usuarios',
    registro_id: usuario.id,
    acao: 'acesso_editado',
    detalhe: { email: { de: usuario.email, para: email }, empresa_id: empresaId, origem: 'cadastro_fornecedor' },
    usuario_id: quemId,
  });
  return resposta(200, { usuario_id: usuario.id, email, mudou: true });
}
