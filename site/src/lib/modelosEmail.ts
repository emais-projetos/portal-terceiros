import { supabase } from './supabase';

// Textos das cobranças, editáveis em Acessos > E-mails (tabela modelos_email).
// Os campos entre chaves são preenchidos na hora de montar o e-mail.

export type TipoModelo =
  | 'lembrete_medicao'
  | 'notificacao_medicao'
  | 'cobranca_medicao'
  | 'retencao_obra'
  | 'vencimento_primeiro'
  | 'vencimento_segundo'
  | 'vencimento_vencido'
  | 'integracao_documentos'
  | 'aviso_liberacao'
  | 'convite_acesso'
  | 'nova_senha_acesso';

export type Modelo = {
  tipo: TipoModelo;
  nome: string;
  quando: string;
  para: string;
  campos: string[];
  assunto: string;
  corpo: string;
  ativo: boolean;
  ordem: number;
  revisao: number;
  observacao: string | null;
  atualizado_por: string | null;
  atualizado_em: string;
};

export type Revisao = { revisao: number; assunto: string; corpo: string; ativo: boolean; observacao: string | null; salvo_em: string; quem: string };

const CAMPOS_MODELO = 'tipo, nome, quando, para, campos, assunto, corpo, ativo, ordem, revisao, observacao, atualizado_por, atualizado_em';

export async function lerModelos(): Promise<Modelo[]> {
  const { data, error } = await supabase.from('modelos_email').select(CAMPOS_MODELO).order('ordem');
  if (error) throw error;
  return (data ?? []) as Modelo[];
}

export async function lerRevisoes(tipo: TipoModelo): Promise<Revisao[]> {
  const { data, error } = await supabase
    .from('modelos_email_revisoes')
    .select('revisao, assunto, corpo, ativo, observacao, salvo_por, salvo_em')
    .eq('tipo', tipo)
    .order('revisao', { ascending: false });
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r) => r.salvo_por as string | null).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: u, error: e2 } = await supabase.from('usuarios').select('id, nome').in('id', ids);
    if (e2) throw e2;
    (u ?? []).forEach((x) => nomes.set(x.id as string, x.nome as string));
  }
  return (data ?? []).map((r) => ({
    revisao: r.revisao as number,
    assunto: r.assunto as string,
    corpo: r.corpo as string,
    ativo: r.ativo as boolean,
    observacao: r.observacao as string | null,
    salvo_em: r.salvo_em as string,
    quem: nomes.get(r.salvo_por as string) ?? 'Texto inicial do portal',
  }));
}

export async function salvarModelo(tipo: TipoModelo, m: { assunto: string; corpo: string; ativo: boolean; observacao: string }) {
  const { error } = await supabase
    .from('modelos_email')
    .update({ assunto: m.assunto.trim(), corpo: m.corpo.replace(/\s+$/, ''), ativo: m.ativo, observacao: m.observacao.trim() || null })
    .eq('tipo', tipo);
  if (error) throw error;
}

// Troca os campos pelos valores. Bloco vazio (ex.: "empresas liberadas" sem nenhuma) não deixa linhas em branco sobrando.
export function aplicarModelo(m: { assunto: string; corpo: string }, valores: Record<string, string>): { assunto: string; corpo: string } {
  const trocar = (t: string) => t.replace(/\{[a-z_]+\}/g, (c) => (c in valores ? valores[c] : c));
  return {
    assunto: trocar(m.assunto).replace(/\s+/g, ' ').trim(),
    corpo: trocar(m.corpo)
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

// O que cada campo traz, com um exemplo para a prévia da tela.
export const CAMPOS: Record<string, { descricao: string; exemplo: string }> = {
  '{empresa}': { descricao: 'Nome da empresa', exemplo: 'Construtora Exemplo' },
  '{obra}': { descricao: 'Nome da obra', exemplo: 'Residencial Jardim' },
  '{mes}': { descricao: 'Mês da medição com o ano', exemplo: 'outubro/2026' },
  '{mes_nome}': { descricao: 'Só o nome do mês', exemplo: 'outubro' },
  '{prazo}': { descricao: 'Prazo de entrega da medição', exemplo: '25/11/2026' },
  '{prazo_curto}': { descricao: 'Prazo sem o ano', exemplo: '25/11' },
  '{tolerancia}': { descricao: 'Último dia da tolerância', exemplo: '30/11/2026' },
  '{tolerancia_curta}': { descricao: 'Tolerância sem o ano', exemplo: '30/11' },
  '{responder_ate}': { descricao: 'Próximo dia útil, para o fornecedor responder', exemplo: '27/11' },
  '{situacao_obras}': { descricao: 'Lista das obras e a situação de cada medição', exemplo: '- Obra Residencial Jardim: medição não iniciada\n- Obra Parque das Flores: iniciada, falta enviar para conferência' },
  '{o_que_falta}': { descricao: 'Lista do que falta em cada obra', exemplo: 'Obra Residencial Jardim\n- 2. Folha de ponto\n- 5. Guia do FGTS (devolvido: valor diferente da folha; corrija no portal)' },
  '{historico_atraso}': {
    descricao: 'Frase com o aviso anterior (ou a data combinada com o fornecedor)',
    exemplo: 'No dia 26/11/2026 avisamos que a medição de outubro/2026 estava em atraso, com prazo até 30/11/2026 para regularização no portal.',
  },
  '{prazo_regularizacao}': { descricao: 'Fim da tolerância (e "ou até a data combinada", quando houver)', exemplo: '30/11' },
  '{qtd_empresas}': { descricao: 'Quantas empresas reter', exemplo: '2 empresas' },
  '{empresas_reter}': { descricao: 'Lista das empresas a reter, com o motivo', exemplo: '- Construtora Exemplo: medição não enviada\n- Elétrica Modelo: documentos pendentes' },
  '{empresas_liberadas}': { descricao: 'Bloco "Liberadas para pagamento" (some quando não há nenhuma)', exemplo: 'Liberadas para pagamento:\n- Hidráulica Teste' },
  '{empresas_aguardando}': {
    descricao: 'Bloco das empresas com data combinada (some quando não há nenhuma)',
    exemplo: 'Aguardando data combinada com o fornecedor (ainda não reter):\n- Pinturas Amostra: envio combinado até 05/12',
  },
  '{data}': { descricao: 'Data do envio', exemplo: '09/11/2026' },
  '{qtd}': { descricao: 'Quantos colaboradores no aviso', exemplo: '2' },
  '{frase_liberados}': { descricao: '"O colaborador abaixo está liberado" ou "Os colaboradores abaixo estão liberados"', exemplo: 'Os colaboradores abaixo estão liberados' },
  '{liberados}': { descricao: 'Lista dos liberados: nome, função e empresa', exemplo: '- Maria de Souza, servente de obras (Construtora Exemplo)\n- João da Silva, ajudante (Construtora Exemplo)' },
  '{dias}': { descricao: 'Dias do aviso, conforme Regras', exemplo: '30' },
  '{documentos}': {
    descricao: 'Documentos por faixa (vencidos, segundo e primeiro aviso)',
    exemplo: 'Vencem em até 15 dias:\n- João da Silva: ASO, vence em 19/11/2026\n\nVencem em até 30 dias:\n- Documento da empresa: PGR, vence em 05/12/2026',
  },
  '{colaboradores}': { descricao: 'Colaboradores por obra, com os documentos que faltam', exemplo: 'Obra Residencial Jardim\n- Maria de Souza: ASO, NR-35, RG e CPF ou CNH (devolvido: documento ilegível; corrija no portal)' },
  '{nome}': { descricao: 'Nome de quem recebe o acesso', exemplo: 'Maria de Souza' },
  '{primeiro_nome}': { descricao: 'Primeiro nome; no acesso de fornecedor, o nome da empresa', exemplo: 'Maria' },
  '{motivo}': {
    descricao: 'Frase sobre o que a pessoa faz no portal, conforme o perfil',
    exemplo: 'É por ele que a Construtora Exemplo vai cadastrar os colaboradores e enviar a documentação para as obras da Emais.',
  },
  '{link}': { descricao: 'Link para criar a senha (sempre vai no e-mail, mesmo se sair do texto)', exemplo: 'https://emais-projetos.github.io/portal-terceiros/acesso?c=…' },
  '{validade}': { descricao: 'Por quanto tempo o link vale, conforme Regras', exemplo: '7 dias' },
  '{email}': { descricao: 'E-mail de acesso (o login)', exemplo: 'maria@construtoraexemplo.com.br' },
  '{endereco_portal}': { descricao: 'Endereço do portal', exemplo: 'https://emais-projetos.github.io/portal-terceiros/' },
  '{link_medicao}': { descricao: 'Link da medição no portal', exemplo: 'https://emais-projetos.github.io/portal-terceiros/medicao' },
  '{link_pendencias}': { descricao: 'Link das pendências no portal', exemplo: 'https://emais-projetos.github.io/portal-terceiros/pendencias' },
  '{assinatura}': { descricao: 'Nome de quem envia (no portal), setor e contato, conforme Regras', exemplo: 'Gente e Gestão | Grupo Emais\ngente10@emais.com' },
};

export function exemploDoModelo(m: { assunto: string; corpo: string }, dias?: number) {
  const valores = Object.fromEntries(Object.entries(CAMPOS).map(([c, v]) => [c, v.exemplo]));
  if (dias !== undefined) valores['{dias}'] = String(dias);
  return aplicarModelo(m, valores);
}
