// Modo demonstração do "Ver como": as telas de cada perfil com dados fictícios, que existem só no navegador.
// Quando está ligado, as consultas ao banco são respondidas aqui (nada vai ao servidor, a não ser o login)
// e toda tentativa de gravar volta com "Modo demonstração: nada é gravado".
// As tabelas de configuração (tipos de documento, itens da medição, regras, formulário da homologação) são cópias
// do cadastro real, sem dado de pessoa; empresas, obras e colaboradores são inventados.
import referencia from './demoReferencia.json';

export type ModoDemo = 'fornecedor' | 'homologacao' | 'tst' | 'engenharia' | 'suprimentos';
export const NOMES_DEMO: Record<ModoDemo, string> = {
  fornecedor: 'Fornecedor',
  homologacao: 'Fornecedor em homologação',
  tst: 'TST da obra',
  engenharia: 'Engenharia da obra',
  suprimentos: 'Suprimentos',
};

const CHAVE = 'portal-demonstracao';
export const MENSAGEM_DEMO = 'Modo demonstração: nada é gravado';

export function lerModoDemo(): ModoDemo | null {
  try {
    const v = window.sessionStorage.getItem(CHAVE);
    return v && v in NOMES_DEMO ? (v as ModoDemo) : null;
  } catch {
    return null;
  }
}
export function ligarDemo(modo: ModoDemo) {
  window.sessionStorage.setItem(CHAVE, modo);
}
export function desligarDemo() {
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // sem armazenamento: nada a desligar
  }
}

// ------------------------------------------------------------------ Datas relativas a hoje

const DIA = 86400000;
const hoje = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dias = (n: number) => iso(new Date(hoje.getTime() + n * DIA));
const quando = (n: number) => new Date(hoje.getTime() + n * DIA).toISOString();
const mes = (n: number) => iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + n, 1)));

// ------------------------------------------------------------------ Cadastro fictício

const O1 = 'd0000000-0000-4000-8000-000000000001';
const O2 = 'd0000000-0000-4000-8000-000000000002';
const obras = [
  { id: O1, nome: 'RESIDENCIAL EXEMPLO', ativa: true, situacao: 'ativa', emails_engenharia: null },
  { id: O2, nome: 'LOTEAMENTO DEMONSTRAÇÃO', ativa: true, situacao: 'ativa', emails_engenharia: null },
];
const nomeObra = (id: string) => obras.find((o) => o.id === id)?.nome ?? '';

const E1 = 'd1000000-0000-4000-8000-000000000001';
const E2 = 'd1000000-0000-4000-8000-000000000002';
const E3 = 'd1000000-0000-4000-8000-000000000003';
const E4 = 'd1000000-0000-4000-8000-000000000004';
const empresas = [
  { id: E1, razao_social: 'ELÉTRICA EXEMPLO LTDA', cnpj: '11111111000191', obras: [O1, O2], homologacao: 'homologada', codigo_bp: '100001', portal_liberado_em: quando(-200), tipos: ['mao_de_obra'] },
  { id: E2, razao_social: 'PINTURAS MODELO LTDA', cnpj: '22222222000182', obras: [O1], homologacao: 'anterior', codigo_bp: '100002', portal_liberado_em: quando(-300), tipos: ['mao_de_obra'] },
  { id: E3, razao_social: 'TERRAPLENAGEM AMOSTRA LTDA', cnpj: '33333333000173', obras: [O2], homologacao: 'anterior', codigo_bp: null, portal_liberado_em: quando(-150), tipos: ['locacao_com_operador'] },
  { id: E4, razao_social: 'HIDRÁULICA NOVA LTDA', cnpj: '44444444000164', obras: [] as string[], homologacao: 'enviada', codigo_bp: null, portal_liberado_em: null, tipos: ['mao_de_obra'] },
].map((e) => ({ ...e, exige_colaboradores: true, exige_mensal: true, categorias: e.id === E3 ? ['terraplenagem', 'locacao_maquinas'] : e.id === E2 ? ['pintura'] : e.id === E1 ? ['instalacoes_eletricas', 'rede_eletrica'] : ['instalacoes_hidraulicas'] }));

// Categorias de serviço como na migração 068.
const categoriasServico = [
  'Terraplenagem', 'Pavimentação', 'Drenagem', 'Redes de água e esgoto', 'Rede elétrica e iluminação pública', 'Instalações elétricas',
  'Instalações hidráulicas', 'Alvenaria e estrutura', 'Concreto, fôrmas e armação', 'Muros e cercamento', 'Pintura', 'Paisagismo',
  'Sinalização viária', 'Topografia', 'Sondagem e geotecnia', 'Projetos de engenharia', 'Laudos e consultoria',
  'Locação de máquinas e equipamentos', 'Transporte e frete', 'Materiais de construção', 'Limpeza e conservação', 'Segurança patrimonial e portaria',
].map((nome, i) => ({
  codigo: ['terraplenagem', 'pavimentacao', 'drenagem', 'agua_esgoto', 'rede_eletrica', 'instalacoes_eletricas', 'instalacoes_hidraulicas',
    'alvenaria_estrutura', 'concreto_formas', 'muros_cercamento', 'pintura', 'paisagismo', 'sinalizacao', 'topografia', 'sondagem', 'projetos',
    'laudos_consultoria', 'locacao_maquinas', 'transporte', 'materiais', 'limpeza', 'seguranca_portaria'][i],
  nome, ordem: i + 1, ativo: true,
}));

// Tipos de fornecedor como na migração 065.
const tiposFornecedor = ([
  ['mao_de_obra', 'Mão de obra na obra', 'Empreiteiro ou prestador com equipe trabalhando na obra.', true, true],
  ['locacao_com_operador', 'Locação de equipamento com operador', 'Máquina ou equipamento que vem com operador. Só os operadores entram no portal.', true, true],
  ['servico_tecnico', 'Serviço técnico', 'Projeto, laudo, sondagem, topografia, consultoria. Cadastra quem vai à obra.', true, false],
  ['locacao_sem_operador', 'Locação sem operador', 'Equipamento, andaime, container ou ferramenta sem operador da empresa.', false, false],
  ['material', 'Material', 'Fornecimento de material ou produto, sem equipe na obra.', false, false],
] as [string, string, string, boolean, boolean][]).map(([codigo, nome, descricao, colaboradores, mensal], i) => ({ codigo, nome, descricao, colaboradores, mensal, ordem: i + 1, personalizado: false, ativo: true }));
const empresa = (id: string) => empresas.find((e) => e.id === id)!;

type SitDoc = 'vigente' | 'a_vencer' | 'vencido' | 'nao_enviado' | 'devolvido' | 'em_analise';
const DOCS_COLABORADOR = ['rg_cpf', 'ctps', 'ficha_registro', 'esocial', 'aso', 'os', 'epi', 'nr06', 'nr18', 'nr35'];
const DOCS_EMPRESA = ['cartao_cnpj', 'seguro_vida', 'pgr', 'pcmso', 'ltcat'];

type Pessoa = {
  id: string; nome: string; funcao: string; empresa: string; obra: string;
  status: 'liberado' | 'pendente_fornecedor' | 'em_analise' | 'aprovado_admin';
  docs: Partial<Record<string, SitDoc>>; integracao: number | null;
};
const pessoa = (n: number, nome: string, funcao: string, emp: string, obra: string, status: Pessoa['status'], docs: Pessoa['docs'] = {}, integracao: number | null = -60): Pessoa => ({
  id: `d2000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, nome, funcao, empresa: emp, obra, status, docs, integracao,
});
const pessoas: Pessoa[] = [
  pessoa(1, 'ANDRÉ EXEMPLO SOUZA', 'ELETRICISTA', E1, O1, 'liberado'),
  pessoa(2, 'BRUNO DEMONSTRAÇÃO LIMA', 'AJUDANTE DE ELETRICISTA', E1, O1, 'pendente_fornecedor', { aso: 'vencido', nr35: 'nao_enviado' }, null),
  pessoa(3, 'CARLOS MODELO PEREIRA', 'ELETRICISTA', E1, O2, 'em_analise', { aso: 'em_analise', nr18: 'em_analise', epi: 'em_analise' }, null),
  pessoa(4, 'DIEGO AMOSTRA ROCHA', 'ENCARREGADO DE ELÉTRICA', E1, O2, 'liberado', { nr18: 'a_vencer' }, -330),
  pessoa(5, 'EDUARDO EXEMPLO DIAS', 'PINTOR', E2, O1, 'liberado'),
  pessoa(6, 'FÁBIO MODELO ALVES', 'PINTOR', E2, O1, 'aprovado_admin', {}, null),
  pessoa(7, 'GUSTAVO DEMONSTRAÇÃO REIS', 'OPERADOR DE MÁQUINA', E3, O2, 'liberado', { nr12: 'vigente' }),
  pessoa(8, 'HENRIQUE AMOSTRA COSTA', 'MOTORISTA', E3, O2, 'pendente_fornecedor', { aso: 'devolvido' }, null),
];
const alocacaoId = (p: Pessoa) => p.id.replace('d2', 'd3');

type Tipo = { codigo: string; nome: string; grupo: string; area: string; impeditivo: boolean; validade_dias: number | null };
const tipos = new Map<string, Tipo>((referencia.tipos_documento as unknown as Tipo[]).map((t) => [t.codigo, t]));
const nomeTipo = (c: string) => tipos.get(c)?.nome ?? c;

function vencimentoDe(s: SitDoc, indice: number): string | null {
  if (s === 'vencido') return dias(-12);
  if (s === 'a_vencer') return dias(18);
  if (s === 'nao_enviado' || s === 'devolvido' || s === 'em_analise') return null;
  return dias(120 + indice * 9);
}

function pendenciasDe(p: Pessoa) {
  const docsEmpresa = DOCS_EMPRESA.map((c) => ({ c, s: (p.empresa === E3 && c === 'seguro_vida' ? 'a_vencer' : 'vigente') as SitDoc }));
  const docsColab = DOCS_COLABORADOR.map((c) => ({ c, s: (p.docs[c] ?? 'vigente') as SitDoc }));
  const integ: SitDoc = p.integracao === null ? 'nao_enviado' : p.integracao < -300 ? 'a_vencer' : 'vigente';
  return [...docsEmpresa, ...docsColab, { c: 'integracao', s: integ }].map(({ c, s }, i) => {
    const t = tipos.get(c);
    const venc = c === 'integracao' && p.integracao !== null ? dias(p.integracao + 365) : vencimentoDe(s, i);
    return {
      alocacao_id: alocacaoId(p), obra_id: p.obra, colaborador_id: p.id, empresa_id: p.empresa,
      tipo_codigo: c, documento: nomeTipo(c), grupo: t?.grupo ?? 'colaborador', area: t?.area ?? 'adm', impeditivo: t?.impeditivo ?? true,
      vencimento: venc, dias_para_vencer: venc ? Math.round((new Date(venc).getTime() - hoje.getTime()) / DIA) : null,
      status_envio_aberto: s === 'em_analise' ? 'em_analise' : s === 'devolvido' ? 'devolvido' : null,
      motivo_devolucao: s === 'devolvido' ? 'Documento ilegível, envie de novo' : null,
      situacao: s,
    };
  });
}
const vPendencias = pessoas.flatMap(pendenciasDe);

const vAlocacoes = pessoas.map((p) => {
  const pend = vPendencias.filter((x) => x.alocacao_id === alocacaoId(p));
  const abertas = pend.filter((x) => ['nao_enviado', 'devolvido', 'vencido'].includes(x.situacao));
  return {
    alocacao_id: alocacaoId(p), status: p.status, obra_id: p.obra, obra: nomeObra(p.obra), colaborador_id: p.id, colaborador: p.nome,
    funcao: p.funcao, empresa_id: p.empresa, empresa: empresa(p.empresa).razao_social, inicio_conferencia: quando(-20),
    aprovado_admin_em: ['liberado', 'aprovado_admin'].includes(p.status) ? quando(-15) : null,
    validado_tst_em: p.status === 'liberado' ? quando(-14) : null,
    data_integracao: p.integracao === null ? null : dias(p.integracao), vencimento_integracao: p.integracao === null ? null : dias(p.integracao + 365),
    impeditivos_pendentes: abertas.filter((x) => x.impeditivo).length, pendentes_adm: abertas.filter((x) => x.area !== 'sst').length,
    pendentes_sst: abertas.filter((x) => x.area === 'sst').length, devolvidos: pend.filter((x) => x.situacao === 'devolvido').length,
    em_analise: pend.filter((x) => x.situacao === 'em_analise').length, a_vencer: pend.filter((x) => x.situacao === 'a_vencer').length,
    bloqueado: false, bloqueio_motivo: null, pendencia_prazo: null,
  };
});

const colaboradores = pessoas.map((p, i) => ({
  id: p.id, empresa_id: p.empresa, nome: p.nome, cpf: `0000000000${i}`.slice(-11), funcao_id: null, funcao_texto: p.funcao, funcoes: { nome: p.funcao },
  situacao: 'ativo', pendencia_cadastro: null, data_admissao: dias(-400 + i * 30), data_nascimento: `199${i}-0${(i % 9) + 1}-15`,
  data_desligamento: null, rescisao_exigida: false, bloqueado: false, bloqueio_motivo: null, bloqueado_em: null, origem: 'portal',
}));

// Medição dos últimos meses, por empresa e obra.
const tiposMedicao = referencia.tipos_medicao as unknown as { codigo: string; ativo: boolean }[];
type MedDemo = { id: string; empresa: string; obra: string; comp: string; status: 'aprovada' | 'em_analise' | 'pendente_fornecedor' | 'aberta' };
const meds: MedDemo[] = [];
let nMed = 0;
for (const e of [E1, E2, E3])
  for (const o of empresa(e).obras)
    [-3, -2, -1].forEach((m) => {
      nMed += 1;
      const status = m < -1 ? 'aprovada' : e === E1 && o === O1 ? 'em_analise' : e === E3 ? 'pendente_fornecedor' : 'aprovada';
      meds.push({ id: `d4000000-0000-4000-8000-0000000000${String(nMed).padStart(2, '0')}`, empresa: e, obra: o, comp: mes(m), status });
    });
const prazoDaComp = (c: string) => iso(new Date(Date.UTC(Number(c.slice(0, 4)), Number(c.slice(5, 7)), 25)));
const toleranciaDaComp = (c: string) => iso(new Date(Date.UTC(Number(c.slice(0, 4)), Number(c.slice(5, 7)), 30)));
function itensDe(m: MedDemo) {
  return tiposMedicao.filter((t) => t.ativo).map((t, i) => {
    const status = m.status === 'aprovada' ? (t.codigo === 'rescisao' || t.codigo === 'adiantamento' ? 'nao_aplica' : 'aprovado')
      : m.status === 'em_analise' ? (i % 4 === 0 ? 'em_analise' : 'aprovado')
      : i % 3 === 0 ? 'devolvido' : i % 3 === 1 ? 'nao_enviado' : 'aprovado';
    return {
      id: `${m.id.slice(0, 30)}${String(i).padStart(6, '0')}`, medicao_id: m.id, tipo_codigo: t.codigo, status, versao: status === 'nao_enviado' ? 0 : 1,
      justificativa: null, motivo_devolucao: status === 'devolvido' ? 'Arquivo do mês errado, envie o do mês certo' : null,
      enviado_em: status === 'nao_enviado' || status === 'nao_aplica' ? null : quando(-10), analisado_em: status === 'aprovado' ? quando(-5) : null,
      medicoes_arquivos: [],
    };
  });
}
const medicoesItens = meds.flatMap(itensDe);
const vMedicoes = meds.map((m) => {
  const itens = medicoesItens.filter((i) => i.medicao_id === m.id);
  const e = empresa(m.empresa);
  return {
    id: m.id, empresa_id: e.id, empresa: e.razao_social, cnpj: e.cnpj, email_cobranca: null, obra_id: m.obra, obra: nomeObra(m.obra), competencia: m.comp,
    prazo: prazoDaComp(m.comp), status: m.status, primeiro_envio_em: m.status === 'aberta' ? null : quando(-12), enviada_em: m.status === 'aberta' ? null : quando(-12),
    conferente: m.status === 'aprovada' ? 'Exemplo' : null, ultima_analise_em: m.status === 'aprovada' ? quando(-5) : null, ultima_cobranca_em: null, observacao: null,
    origem: 'portal', qtd_colaboradores: pessoas.filter((p) => p.empresa === e.id && p.obra === m.obra).length, entregue_no_prazo: m.status === 'aprovada',
    retida: false, em_atraso: m.status === 'pendente_fornecedor', tolerancia: toleranciaDaComp(m.comp), prazo_combinado: null, prazo_combinado_obs: null,
    itens_pendentes: itens.filter((i) => i.status === 'nao_enviado' || i.status === 'devolvido').length,
    itens_em_analise: itens.filter((i) => i.status === 'em_analise').length, itens_devolvidos: itens.filter((i) => i.status === 'devolvido').length,
    colaboradores_pendentes: 0, dispensada_em: null, motivo_dispensa: null, dispensada_por: null,
  };
});

function painelObra(obraId: string) {
  return {
    obra: nomeObra(obraId),
    colaboradores: pessoas.filter((p) => p.obra === obraId).map((p) => {
      const pend = vPendencias.filter((x) => x.alocacao_id === alocacaoId(p));
      const a = vAlocacoes.find((x) => x.alocacao_id === alocacaoId(p))!;
      return {
        alocacao_id: a.alocacao_id, colaborador: p.nome, funcao: p.funcao, empresa_id: p.empresa, empresa: a.empresa, status: p.status,
        data_integracao: a.data_integracao, vencimento_integracao: a.vencimento_integracao, liberado_em: a.validado_tst_em, bloqueado: false, bloqueio_motivo: null,
        fornecedor_bloqueado: a.empresa_id === E3, fornecedor_bloqueio_motivo: a.empresa_id === E3 ? 'Documento de seguro adulterado na medição' : null,
        pendencias: pend.filter((x) => ['nao_enviado', 'devolvido', 'vencido', 'em_analise'].includes(x.situacao))
          .map((x) => ({ documento: x.documento, grupo: x.grupo, situacao: x.situacao, vencimento: x.vencimento })),
        a_vencer: pend.filter((x) => x.situacao === 'a_vencer').map((x) => ({ documento: x.documento, grupo: x.grupo, vencimento: x.vencimento! })),
      };
    }),
    medicoes: vMedicoes.filter((m) => m.obra_id === obraId).map((m) => ({
      id: m.id, empresa_id: m.empresa_id, empresa: m.empresa, cnpj: m.cnpj, obra: m.obra, origem: 'portal', competencia: m.competencia, prazo: m.prazo,
      tolerancia: m.tolerancia, status: m.status, retida: false, em_atraso: m.em_atraso, prazo_combinado: null, primeiro_envio_em: m.primeiro_envio_em,
      ultima_analise_em: m.ultima_analise_em, dispensada: false, motivo_dispensa: null,
      itens_pendentes: medicoesItens.filter((i) => i.medicao_id === m.id && (i.status === 'nao_enviado' || i.status === 'devolvido')).map((i) => i.tipo_codigo),
    })),
    integracoes: [
      { id: 'd5000000-0000-4000-8000-000000000001', data: dias(3), horario: '07:30', local: 'Canteiro', responsavel: 'TST Exemplo', concluida_em: null, participantes: 2, presentes: 0 },
    ],
  };
}

const empresasComObras = empresas.filter((e) => e.portal_liberado_em).map((e) => ({
  ...e, ativa: true, origem: 'portal', email_acesso: `contato@${e.razao_social.split(' ')[0].toLowerCase()}.exemplo`, email_contato: null,
  empresas_obras: e.obras.map((o) => ({ obra_id: o, subcontratada: false, ativo: true, empresa_principal_id: null, obras: { nome: nomeObra(o), ativa: true } })),
  contratos_fornecedor: [],
}));

const docsEmpresa = empresas.flatMap((e) => DOCS_EMPRESA.map((c, i) => ({
  empresa_id: e.id, colaborador_id: null, tipo_codigo: c, vencimento: e.id === E3 && c === 'seguro_vida' ? dias(18) : dias(150 + i * 20),
  situacao: e.id === E3 && c === 'seguro_vida' ? 'a_vencer' : 'vigente',
})));

// ------------------------------------------------------------------ Homologação (fornecedor novo e Suprimentos)

const dadosHomologacao = {
  razao_social: 'HIDRÁULICA NOVA LTDA', ramo: 'Instalações hidráulicas', endereco: 'Rua Exemplo', numero: '100', bairro: 'Centro', cep: '15000-000',
  cidade: 'São José do Rio Preto', estado: 'SP', telefone: '(17) 0000-0000', contato: 'Responsável Exemplo', email_empresa: 'contato@hidraulica.exemplo',
  banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6', email: 'contato@hidraulica.exemplo',
  referencias: [{ empresa: 'Construtora Exemplo', contato: 'Fulano', telefone: '(17) 0000-0001', email: '', endereco: '', cidade: 'São José do Rio Preto', estado: 'SP' }],
};
const docsHomologacao = [
  { id: 'd6000000-0000-4000-8000-000000000001', tipo: 'contrato_social', data_emissao: dias(-60), vencimento: null, status: 'aprovado', motivo: null, arquivos: [{ caminho: 'demo', nome: 'contrato_social.pdf' }], enviado_em: quando(-6), analisado_por: 'Suprimentos Exemplo', analisado_em: dias(-4) },
  { id: 'd6000000-0000-4000-8000-000000000002', tipo: 'cartao_cnpj', data_emissao: dias(-10), vencimento: dias(170), status: 'em_analise', motivo: null, arquivos: [{ caminho: 'demo', nome: 'cartao_cnpj.pdf' }], enviado_em: quando(-6) },
  { id: 'd6000000-0000-4000-8000-000000000003', tipo: 'crf_fgts', data_emissao: dias(-40), vencimento: dias(-10), status: 'devolvido', motivo: 'Certidão vencida, envie a atual', arquivos: [{ caminho: 'demo', nome: 'crf.pdf' }], enviado_em: quando(-6) },
];
const minhaHomologacao = [{ empresa_id: E4, razao_social: 'HIDRÁULICA NOVA LTDA', cnpj: '44444444000164', situacao: 'devolvida', liberado: false, tipos: ['mao_de_obra'], categorias: ['instalacoes_hidraulicas'], dados: dadosHomologacao, motivo: 'Confira o CRF do FGTS.', enviada_em: dias(-6), documentos: docsHomologacao }];
const listaHomologacoes = [
  { empresa_id: E4, razao_social: 'HIDRÁULICA NOVA LTDA', cnpj: '44444444000164', situacao: 'enviada', email: 'contato@hidraulica.exemplo', convidada_em: dias(-12), enviada_em: dias(-6), decidida_em: null, tipos: ['mao_de_obra'], liberado_em: null, codigo_bp: null, tem_acesso: true, contratos: 0, docs_em_analise: 1, docs_devolvidos: 1, obras_previstas: ['RESIDENCIAL EXEMPLO'] },
];
const detalheHomologacao = {
  empresa_id: E4, razao_social: 'HIDRÁULICA NOVA LTDA', cnpj: '44444444000164', situacao: 'enviada', codigo_bp: null, tipos: ['mao_de_obra'], categorias: ['instalacoes_hidraulicas'], liberado_em: null, email: 'contato@hidraulica.exemplo',
  dados: dadosHomologacao, qualificacao: null, comentarios: null, responsavel: null, motivo: null, convidada_em: dias(-12), enviada_em: dias(-6), decidida_em: null,
  decidida_por: null, obras_previstas: [{ id: O1, nome: 'RESIDENCIAL EXEMPLO' }], documentos: docsHomologacao, contratos: [], obras_ativas: obras.map((o) => ({ id: o.id, nome: o.nome })),
};
const dadosCadastro = {
  nome_fantasia: 'Exemplo', ramo: 'Instalações', praca: 'Noroeste paulista', inscricao_estadual: '123456789110', endereco: 'Rua Exemplo', numero: '120', bairro: 'Centro',
  cep: '15000-000', cidade: 'São José do Rio Preto', estado: 'SP', contato: 'Responsável Exemplo', telefone: '(17) 0000-0000', email_empresa: 'contato@empresa.exemplo',
  banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6',
};
const fornecedoresCadastro = empresasComObras.map((e) => ({
  empresa_id: e.id, razao_social: e.razao_social, cnpj: e.cnpj, ativa: true, homologacao: e.homologacao, codigo_bp: e.codigo_bp, liberado_em: e.portal_liberado_em,
  tipos: e.tipos, categorias: e.categorias, exige_colaboradores: e.exige_colaboradores, exige_mensal: e.exige_mensal,
  situacao: e.id === E3 ? 'bloqueado' : 'ativo', situacao_motivo: e.id === E3 ? 'Documento de seguro adulterado na medição' : null,
  situacao_em: e.id === E3 ? dias(-3) : null, situacao_por: e.id === E3 ? 'Suprimentos Exemplo' : null,
  email_acesso: e.email_acesso, emails_contato: e.id === E1 ? 'financeiro@eletrica.exemplo' : null, dados: dadosCadastro,
  receita: e.id === E4 ? null : { situacao: 'ATIVA', consultada_em: quando(-1), aviso: null, situacao_desde: '03/11/2015', abertura: '03/11/2015', cnae: '4321-5/00 Instalação e manutenção elétrica' },
  subcontratada: false, obras: e.obras.map(nomeObra), contratos_ativos: e.codigo_bp ? 1 : 0, proximo_termino: e.codigo_bp ? dias(90) : null,
  documentos: docsEmpresa.filter((d) => d.empresa_id === e.id).map((d) => ({ nome: nomeTipo(d.tipo_codigo), situacao: d.situacao, vencimento: d.vencimento, impeditivo: true })),
  certidoes: [], colaboradores: {
    em_obra: pessoas.filter((p) => p.empresa === e.id).length, liberados: pessoas.filter((p) => p.empresa === e.id && p.status === 'liberado').length,
    com_vencido: pessoas.filter((p) => p.empresa === e.id && Object.values(p.docs).includes('vencido')).length,
    com_vencendo: pessoas.filter((p) => p.empresa === e.id && Object.values(p.docs).includes('a_vencer')).length,
  },
}));

// Ficha de quem já está no portal (homologado ou anterior): documentos aprovados, contrato e histórico fictícios.
type TipoHomDemo = { codigo: string; ativo: boolean; obrigatorio: boolean; validade_dias: number | null; tipos_fornecedor?: string[] };
function detalheDe(id: unknown) {
  const e = empresasComObras.find((x) => x.id === id);
  if (!e || e.id === E4) return detalheHomologacao;
  const homologada = e.homologacao === 'homologada';
  const tiposHom = (referencia.homologacao_tipos as unknown as TipoHomDemo[]).filter((t) => t.ativo && (t.tipos_fornecedor ?? []).some((x) => e.tipos.includes(x)));
  const vencendo = tiposHom.find((t) => t.obrigatorio && t.validade_dias)?.codigo;
  const documentos = homologada
    ? tiposHom.filter((t) => t.obrigatorio).map((t, i) => ({
        id: `d6100000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, tipo: t.codigo, data_emissao: dias(-240 + i), status: 'aprovado', motivo: null,
        vencimento: t.validade_dias ? (t.codigo === vencendo ? dias(9) : dias(60 + i * 10)) : null, arquivos: [{ caminho: 'demo', nome: `${t.codigo}.pdf` }],
        enviado_em: quando(-242), analisado_por: 'Suprimentos Exemplo', analisado_em: dias(-235),
      }))
    : [];
  const contratos = e.codigo_bp
    ? [{ id: `d6200000-0000-4000-8000-0000000000${e.id.slice(-2)}`, numero: `0${e.id.slice(-1)}5/2026`, codigo_bp: e.codigo_bp, inicio: dias(-200), termino: dias(e.id === E1 ? 25 : 160),
        arquivo: 'demo', arquivo_nome: 'contrato.pdf', situacao: 'ativo', obras: e.obras.map((o) => ({ id: o, nome: nomeObra(o) })) }]
    : [];
  return {
    empresa_id: e.id, razao_social: e.razao_social, cnpj: e.cnpj, situacao: e.homologacao, codigo_bp: e.codigo_bp, tipos: e.tipos, categorias: e.categorias,
    liberado_em: e.portal_liberado_em, email: e.email_acesso, dados: dadosCadastro, qualificacao: homologada ? { documentos: 'sim', missao: 'sim', certificacao: 'na' } : null,
    comentarios: null, responsavel: homologada ? 'Responsável Exemplo' : null, motivo: null, convidada_em: homologada ? dias(-250) : null, enviada_em: homologada ? dias(-240) : null,
    decidida_em: homologada ? dias(-230) : null, decidida_por: homologada ? 'Suprimentos Exemplo' : null, obras_previstas: [], documentos, contratos,
    obras_ativas: e.obras.map((o) => ({ id: o, nome: nomeObra(o), numero_contrato: contratos[0]?.numero ?? null })),
  };
}
function historicoDe(id: unknown) {
  const e = empresasComObras.find((x) => x.id === id);
  if (!e) return [];
  const ev = (n: number, acao: string, detalhe: Record<string, unknown> = {}, tabela = 'empresas') => ({ em: quando(n), acao, tabela, detalhe, quem: 'Suprimentos Exemplo' });
  if (e.id === E4) return [ev(-6, 'homologacao_enviada', {}), ev(-12, 'convite_homologacao', { para: 'contato@hidraulica.exemplo' }), ev(-12, 'homologacao_cadastrada', {})];
  const lista = [
    ev(-5, 'cadastro_alterado', { campos: ['telefone', 'email_empresa'] }),
    ...(e.id === E3 ? [ev(-3, 'situacao_fornecedor_alterada', { de: 'ativo', para: 'bloqueado', motivo: 'Documento de seguro adulterado na medição' })] : []),
    ...(e.codigo_bp ? [ev(-200, 'contrato_registrado', { numero: `0${e.id.slice(-1)}5/2026` }, 'contratos_fornecedor')] : []),
    ...(e.homologacao === 'homologada'
      ? [ev(-200, 'portal_liberado'), ev(-230, 'homologada', { responsavel: 'Responsável Exemplo' }), ev(-240, 'homologacao_enviada'), ev(-250, 'convite_homologacao', { para: e.email_acesso })]
      : []),
  ];
  return lista.sort((a, b) => b.em.localeCompare(a.em));
}

const blocoVazio = { conformidade: null, vistorias: 0, ultima: null, meses: [], mais_nao: [] };

// ------------------------------------------------------------------ Respostas

type Linha = Record<string, unknown>;
const TABELAS: Record<string, (modo: ModoDemo) => Linha[]> = {
  obras: () => obras,
  empresas: (m) => (m === 'fornecedor' ? empresasComObras.filter((e) => e.id === E1) : m === 'homologacao' ? [] : empresasComObras),
  empresas_obras: (m) => empresasComObras.filter((e) => m !== 'fornecedor' || e.id === E1).flatMap((e) => e.empresas_obras.map((eo) => ({ ...eo, empresa_id: e.id, empresas: { razao_social: e.razao_social } }))),
  v_alocacoes_resumo: (m) => vAlocacoes.filter((a) => m !== 'fornecedor' || a.empresa_id === E1),
  v_pendencias: (m) => vPendencias.filter((a) => m !== 'fornecedor' || a.empresa_id === E1),
  colaboradores: (m) => colaboradores.filter((c) => m !== 'fornecedor' || c.empresa_id === E1),
  v_documentos_atuais: (m) => docsEmpresa.filter((d) => m !== 'fornecedor' || d.empresa_id === E1),
  v_medicoes: (m) => vMedicoes.filter((x) => m !== 'fornecedor' || x.empresa_id === E1),
  medicoes_itens: () => medicoesItens,
  tipos_documento: () => referencia.tipos_documento as unknown as Linha[],
  tipos_medicao: () => referencia.tipos_medicao as unknown as Linha[],
  parametros: () => referencia.parametros as unknown as Linha[],
  homologacao_tipos: () => referencia.homologacao_tipos as unknown as Linha[],
  tipos_fornecedor: () => tiposFornecedor,
  categorias_servico: () => categoriasServico,
  homologacao_campos: () => referencia.homologacao_campos as unknown as Linha[],
  seg_modelos: () => referencia.seg_modelos as unknown as Linha[],
  funcoes: () => [...new Set(pessoas.map((p) => p.funcao))].map((nome, i) => ({ id: `d7000000-0000-4000-8000-0000000000${i}0`, nome })),
  usuarios: () => [],
  pedidos_obra: () => [{
    id: 'd6300000-0000-4000-8000-000000000001', empresa_id: E2, obra_id: O2, numero_contrato: null, observacao: 'Equipe disponível a partir de dezembro', situacao: 'pendente',
    pedido_em: quando(-2), analisado_em: null, motivo_recusa: null, empresas: { razao_social: 'PINTURAS MODELO LTDA', cnpj: '22222222000182' }, obras: { nome: nomeObra(O2) },
    usuarios: { nome: 'Fornecedor Exemplo', email: 'contato@pinturas.exemplo' },
  }],
};

const RPCS: Record<string, (modo: ModoDemo, args: Record<string, unknown>) => unknown> = {
  painel_obras: (m) => obras.filter((o) => m !== 'fornecedor' || empresa(E1).obras.includes(o.id)).map((o) => ({ id: o.id, nome: o.nome, situacao: 'ativa' })),
  painel_obra: (m, a) => {
    const p = painelObra(String(a.p_obra));
    if (m !== 'fornecedor') return p;
    return { ...p, colaboradores: p.colaboradores.filter((c) => c.empresa_id === E1), medicoes: p.medicoes.filter((x) => x.empresa_id === E1) };
  },
  minha_homologacao: (m) => {
    if (m === 'homologacao') return minhaHomologacao;
    if (m !== 'fornecedor') return [];
    const x = detalheDe(E1);
    return [{ empresa_id: E1, razao_social: x.razao_social, cnpj: x.cnpj, situacao: 'homologada', liberado: true, tipos: x.tipos, categorias: x.categorias, dados: x.dados, motivo: null, enviada_em: x.enviada_em, documentos: x.documentos }];
  },
  lista_homologacoes: () => listaHomologacoes,
  detalhe_homologacao: (_m, a) => detalheDe(a.p_empresa),
  fornecedores_cadastro: (_m, a) => (a.p_empresa ? fornecedoresCadastro.filter((f) => f.empresa_id === a.p_empresa) : fornecedoresCadastro),
  historico_fornecedor: (_m, a) => historicoDe(a.p_empresa),
  fornecedores_a_regularizar: () => [
    { empresa_id: E3, razao_social: 'TERRAPLENAGEM AMOSTRA LTDA', cnpj: '33333333000173', homologacao: 'anterior', sem_bp: true, obras_sem_contrato: ['LOTEAMENTO DEMONSTRAÇÃO'], contratos_vencendo: [], certidoes: [] },
  ],
  fornecedores_para_liberar: () => [],
  contadores_suprimentos: () => ({ homologacao: 1, pedidos: 1, contrato: 1 }),
  historico_configuracao_homologacao: () => [],
  funil_homologacao: () => {
    // Doze fornecedores fictícios espalhados pelas etapas.
    const d = (n: number) => dias(n);
    const ev = (acao: string, n: number, texto: string | null = null) => ({ acao, em: d(n), texto });
    const base = (i: number, nome: string, situacao: string, convite: number, extra: Record<string, unknown> = {}) => ({
      empresa_id: `00000000-0000-4000-8000-0000000009${String(i).padStart(2, '0')}`, razao_social: nome, situacao, tipos: ['mao_de_obra'], situacao_fornecedor: 'ativo',
      convidada_em: d(convite), atualizado_em: d(convite), enviada_em: null, decidida_em: null, homologada_em: null, liberado_em: null,
      primeiro_documento_em: null, eventos: [], documentos_devolvidos: [], ...extra,
    });
    return [
      base(1, 'ALFA TERRAPLENAGEM LTDA', 'homologada', -120, { homologada_em: d(-95), liberado_em: d(-80), enviada_em: d(-100), eventos: [ev('homologacao_enviada', -100), ev('homologada', -95), ev('portal_liberado', -80)] }),
      base(2, 'BETA PAVIMENTOS LTDA', 'homologada', -90, { homologada_em: d(-60), liberado_em: d(-52), eventos: [ev('homologacao_enviada', -82), ev('homologacao_devolvida', -78, 'CND estadual vencida'), ev('homologacao_enviada', -70), ev('homologada', -60), ev('portal_liberado', -52)], documentos_devolvidos: [{ documento: 'CND da Receita Estadual', motivo: 'Vencida', em: d(-78) }] }),
      base(3, 'GAMA ELÉTRICA LTDA', 'homologada', -60, { homologada_em: d(-40), eventos: [ev('homologacao_enviada', -48), ev('homologada', -40)] }),
      base(4, 'DELTA HIDRÁULICA LTDA', 'enviada', -30, { enviada_em: d(-12), primeiro_documento_em: d(-25), eventos: [ev('homologacao_enviada', -12)] }),
      base(5, 'ÉPSILON PINTURAS LTDA', 'enviada', -20, { enviada_em: d(-3), primeiro_documento_em: d(-15), eventos: [ev('homologacao_enviada', -3)] }),
      base(6, 'ZETA LOCAÇÕES LTDA', 'devolvida', -45, { tipos: ['locacao_com_operador'], decidida_em: d(-20), eventos: [ev('homologacao_enviada', -25), ev('homologacao_devolvida', -20, 'Faltou o laudo da máquina e a CRF do FGTS está vencida')], documentos_devolvidos: [{ documento: 'CRF: certidão de regularidade do FGTS', motivo: 'Vencida', em: d(-20) }, { documento: 'Documentos da máquina ou equipamento', motivo: 'Sem laudo', em: d(-20) }] }),
      base(7, 'ETA SONDAGENS LTDA', 'convidada', -40, { tipos: ['servico_tecnico'] }),
      base(8, 'TETA MATERIAIS LTDA', 'convidada', -6, { tipos: ['material'] }),
      base(9, 'IOTA CERCAMENTOS LTDA', 'convidada', -35, { atualizado_em: d(-28), primeiro_documento_em: d(-30) }),
      base(10, 'CAPA DRENAGEM LTDA', 'convidada', -10, { atualizado_em: d(-2), primeiro_documento_em: d(-8) }),
      base(11, 'LAMBDA TOPOGRAFIA LTDA', 'reprovada', -70, { tipos: ['servico_tecnico'], decidida_em: d(-50), eventos: [ev('homologacao_enviada', -55), ev('homologacao_reprovada', -50, 'CNPJ com pendências na Receita')] }),
      base(12, 'MI ALVENARIA LTDA', 'homologada', -50, { homologada_em: d(-18), eventos: [ev('homologacao_enviada', -40), ev('homologacao_devolvida', -35, 'CRF do FGTS vencida'), ev('homologacao_enviada', -25), ev('homologada', -18)], documentos_devolvidos: [{ documento: 'CRF: certidão de regularidade do FGTS', motivo: 'Vencida', em: d(-35) }] }),
    ];
  },
  lista_categorias_servico: () =>
    [...categoriasServico].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((c) => ({ ...c, fornecedores: empresas.filter((e) => e.categorias.includes(c.codigo)).length })),
  lista_tipos_fornecedor: () =>
    tiposFornecedor.map((t) => {
      const docs = (referencia.homologacao_tipos as { ativo: boolean; obrigatorio: boolean; tipos_fornecedor?: string[] }[]).filter((d) => d.ativo && d.tipos_fornecedor?.includes(t.codigo));
      return { ...t, fornecedores: empresas.filter((e) => e.tipos.includes(t.codigo)).length, documentos: docs.length, obrigatorios: docs.filter((d) => d.obrigatorio).length };
    }),
  acessos_fornecedores: () => [
    { id: 'd8000000-0000-4000-8000-000000000001', nome: 'Escritório Contábil Exemplo', email: 'contato@contabil.exemplo', perfil: 'fornecedor', ativo: true, criado_em: quando(-120),
      empresas: [{ id: E1, razao_social: 'ELÉTRICA EXEMPLO LTDA' }, { id: E2, razao_social: 'PINTURAS MODELO LTDA' }], obras: [], ultimo_login: quando(-2), convite: null },
    { id: 'd8000000-0000-4000-8000-000000000002', nome: 'Terraplenagem Amostra', email: 'contato@terraplenagem.exemplo', perfil: 'fornecedor', ativo: true, criado_em: quando(-60),
      empresas: [{ id: E3, razao_social: 'TERRAPLENAGEM AMOSTRA LTDA' }], obras: [], ultimo_login: null, convite: null },
  ],
  seg_resumo_obra: () => ({ metas: { alojamento: 90, canteiro: 90 }, alojamento: { ...blocoVazio, por_alojamento: [], alojamentos_ativos: 0 }, canteiro: blocoVazio, maquinas: { conformidade: null, dias: 0, nao_conformes: 0, mais_nc: [] }, acoes: [] }),
  seg_resumo_fornecedor: () => ({ meta: 90, periodo: blocoVazio, alojamentos: [], acoes: [] }),
};

// Funções que gravam: no modo demonstração, voltam com a mensagem.
const GRAVA = /^(enviar|aprovar|devolver|salvar|registrar|criar|dispensar|desfazer|marcar|incluir|remover|cadastrar|homologar|reprovar|pedir|responder|abrir|fechar|concluir|avaliar|assinar|juntar|mudar|corrigir|informar|configurar|validar|resolver|reenviar|gerar|alterar|processar|notificar|reabrir|liberar|encerrar|trocar|atualizar|excluir|apagar|solicitar|aceitar|definir|conferir|combinar|cancelar|bloquear|desligar)_/;

function aplicarFiltros(linhas: Linha[], params: URLSearchParams): Linha[] {
  let r = linhas;
  params.forEach((valor, coluna) => {
    if (['select', 'order', 'limit', 'offset', 'or', 'and', 'columns', 'on_conflict'].includes(coluna) || coluna.includes('.')) return;
    const nao = valor.startsWith('not.');
    const v = nao ? valor.slice(4) : valor;
    const [op, ...resto] = v.split('.');
    const alvo = resto.join('.');
    const teste = (x: unknown): boolean => {
      const s = x === null || x === undefined ? null : String(x);
      switch (op) {
        case 'eq': return s === alvo;
        case 'neq': return s !== alvo;
        case 'is': return alvo === 'null' ? s === null : s === alvo;
        case 'in': return alvo.replace(/^\(|\)$/g, '').split(',').map((z) => z.replace(/^"|"$/g, '')).includes(s ?? '');
        case 'gt': return s !== null && s > alvo;
        case 'gte': return s !== null && s >= alvo;
        case 'lt': return s !== null && s < alvo;
        case 'lte': return s !== null && s <= alvo;
        default: return true;
      }
    };
    r = r.filter((l) => !(coluna in l) || (nao ? !teste(l[coluna]) : teste(l[coluna])));
  });
  return r;
}

function json(status: number, corpo: unknown, extra: Record<string, string> = {}) {
  return new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}
const recusa = () => json(400, { message: MENSAGEM_DEMO, code: 'P0001', details: null, hint: null });

// fetch usado pelo cliente do Supabase: no modo demonstração, responde daqui.
export async function fetchComDemo(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const modo = lerModoDemo();
  const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (!modo || url.pathname.includes('/auth/v1/')) return fetch(entrada, init);
  // O próprio cadastro de quem está logado (lido pela sessão, com a coluna master) continua indo ao banco.
  if (url.pathname.endsWith('/rest/v1/usuarios') && (url.searchParams.get('select') ?? '').includes('master')) return fetch(entrada, init);
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
  const cab = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
  const caminho = url.pathname;

  // Consulta na Receita: resposta fictícia (CNPJ terminado em 91 aparece como baixado).
  if (caminho.endsWith('/functions/v1/consultar-cnpj')) {
    let cnpj = '';
    try {
      cnpj = String(JSON.parse(typeof init?.body === 'string' ? init.body : '{}').cnpj ?? '');
    } catch { /* corpo inválido */ }
    const baixada = cnpj.endsWith('91');
    return json(200, {
      consultada_em: new Date().toISOString(), cache: false,
      ja_cadastrado: empresas.find((e) => e.cnpj === cnpj) ? { empresa_id: empresas.find((e) => e.cnpj === cnpj)!.id, razao_social: empresas.find((e) => e.cnpj === cnpj)!.razao_social } : null,
      resultado: {
        cnpj, consulta: { brasilapi: '200 ok', cnpj_ws: '200 ok' },
        situacao_receita: baixada ? 'BAIXADA' : 'ATIVA', situacao_desde: baixada ? '10/02/2021' : '03/11/2015',
        aviso_para_o_suprimentos: baixada ? 'CNPJ BAIXADA na Receita desde 10/02/2021 (Extinção por Encerramento Liquidação Voluntária).' : 'Nenhum: CNPJ ativo.',
        preenche_no_portal: {
          razao_social: 'CONSTRUTORA DEMONSTRAÇÃO LTDA', nome_fantasia: 'Construtora Demo', ramo: 'Construção de Edifícios', cep: '14780-000',
          endereco: 'Avenida das Indústrias', numero: '1200', complemento: '', bairro: 'Distrito Industrial', cidade: 'Barretos', estado: 'SP',
          telefone: '(17) 3322-0000', email_empresa: '', inscricao_estadual: '123456789110',
        },
        campos_vazios: ['complemento', 'email_empresa'],
        so_para_consulta: { abertura: '03/11/2015', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'DEMAIS', simples: 'Não', mei: 'Não', cnae_principal: '4120-4/00 Construção de edifícios', cnaes_secundarios: [], quantidade_de_socios: 2 },
        divergencias_entre_fontes: [],
      },
    });
  }
  if (caminho.includes('/storage/v1/') || caminho.includes('/functions/v1/')) return recusa();
  const rpc = caminho.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/)?.[1];
  if (rpc) {
    if (GRAVA.test(rpc)) return recusa();
    let args: Record<string, unknown> = {};
    try {
      args = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    } catch {
      args = {};
    }
    const f = RPCS[rpc];
    return json(200, f ? f(modo, args) : []);
  }
  const tabela = caminho.match(/\/rest\/v1\/([a-z0-9_]+)/)?.[1];
  if (!tabela) return json(404, { message: 'Não encontrado' });
  if (metodo !== 'GET' && metodo !== 'HEAD') return recusa();
  const linhas = aplicarFiltros(TABELAS[tabela]?.(modo) ?? [], url.searchParams);
  const faixa = { 'Content-Range': linhas.length ? `0-${linhas.length - 1}/${linhas.length}` : '*/0' };
  if (metodo === 'HEAD') return new Response(null, { status: 200, headers: faixa });
  if ((cab.get('Accept') ?? '').includes('vnd.pgrst.object')) {
    if (linhas.length !== 1 && !linhas.length) return json(406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: 'The result contains 0 rows', hint: null });
    return json(200, linhas[0], faixa);
  }
  return json(200, linhas, faixa);
}

// Usuário de mentira para o menu e as telas do perfil escolhido.
export function usuarioDemo(modo: ModoDemo) {
  const perfil = modo === 'homologacao' ? 'fornecedor' : modo;
  const nomes: Record<ModoDemo, string> = {
    fornecedor: 'Fornecedor Exemplo', homologacao: 'Fornecedor Novo Exemplo', tst: 'TST Exemplo', engenharia: 'Engenharia Exemplo', suprimentos: 'Suprimentos Exemplo',
  };
  return { id: 'd9000000-0000-4000-8000-000000000001', nome: nomes[modo], email: 'demonstracao@exemplo', perfil, ativo: true, master: false } as const;
}
