import { data, hojeIso } from './formato';
import { mesPorExtenso } from './medicao';
import { pagamentoDe, situacaoIntegracao, type ColaboradorObra, type MedicaoObra, type PendenciaDoc } from './painelObra';

// Faróis do painel de obras: uma leitura simples, por empresa em cada obra, de três frentes.
//   Verde: em dia. Amarelo: pendência que ainda não bloqueia. Vermelho: bloqueio.
// Bloqueio é só o que a regra trata como impeditivo: pagamento retido (medição não aprovada depois do
// dia 30 ou da data combinada) e colaborador liberado trabalhando com documento obrigatório faltando
// ou vencido. Integração nunca fica vermelha.

export type Cor = 'verde' | 'amarelo' | 'vermelho' | 'cinza';

// Integração: só conta quem foi liberado pelo portal. Os liberados antes disso vieram da planilha,
// que quase nunca tinha a data de integração.
export const INICIO_INTEGRACAO_PORTAL = '2026-09-01';

export type Acao = 'pendencias' | 'documentos_empresa' | 'medicao' | 'colaboradores' | 'validar';

export type Tarefa = { cor: Cor; titulo: string; detalhe: string; acao: Acao; rotulo: string; medicaoId?: string };

export type Frente = { cor: Cor; itens: string[] };

export type FarolEmpresa = {
  empresaId: string;
  empresa: string;
  geral: Cor;
  manchete: string;
  doc: Frente;
  int: Frente;
  med: Frente;
  tarefas: Tarefa[];
  aguardandoTst: number;
  retidas: string[]; // competências com pagamento retido
};

const peso: Record<Cor, number> = { vermelho: 3, amarelo: 2, verde: 1, cinza: 0 };
export const pior = (...cores: Cor[]): Cor => cores.reduce((a, b) => (peso[b] > peso[a] ? b : a), 'cinza' as Cor);
export const ordemCor: Record<Cor, number> = { vermelho: 0, amarelo: 1, verde: 2, cinza: 3 };
export const rotuloCor: Record<Cor, string> = { vermelho: 'Bloqueio', amarelo: 'Com pendência', verde: 'Tudo certo', cinza: 'Não se aplica' };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const mesNome = (c: string) => {
  const t = mesPorExtenso(c).replace(' de ', '/');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export const listaMeses = (cs: string[], comAno = false) => {
  const n = cs.map((c) => mesPorExtenso(c).split(' ')[0]);
  const texto = n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
  const anos = [...new Set(cs.map((c) => c.slice(0, 4)))];
  // "março, abril e agosto de 2026"; com anos diferentes, cada mês leva o seu.
  if (!comAno) return texto;
  if (anos.length === 1) return `${texto} de ${anos[0]}`;
  const comCada = cs.map((c) => mesPorExtenso(c));
  return `${comCada.slice(0, -1).join(', ')} e ${comCada[comCada.length - 1]}`;
};
const somarMeses = (c: string, n: number) => {
  const [a, m] = c.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
};

// Competência que está sendo cobrada agora: o mês anterior ao atual.
export function competenciaAtual(hoje = hojeIso()): string {
  return somarMeses(`${hoje.slice(0, 7)}-01`, -1);
}

function agruparFaltas(colabs: ColaboradorObra[]): string {
  // "ASO (3), NR-35 (2 vencidas)": quantos colaboradores por documento.
  const porDoc = new Map<string, { faltando: number; vencido: number }>();
  for (const c of colabs) {
    for (const p of c.pendencias) {
      if (p.situacao === 'em_analise' || p.grupo === 'empresa') continue;
      const x = porDoc.get(p.documento) ?? { faltando: 0, vencido: 0 };
      if (p.situacao === 'vencido') x.vencido += 1;
      else x.faltando += 1;
      porDoc.set(p.documento, x);
    }
  }
  return [...porDoc.entries()]
    .sort((a, b) => b[1].faltando + b[1].vencido - (a[1].faltando + a[1].vencido))
    .map(([doc, x]) => {
      const partes = [x.faltando ? String(x.faltando) : '', x.vencido ? `${x.vencido} vencido${x.vencido > 1 ? 's' : ''}` : ''].filter(Boolean);
      return `${doc} (${partes.join(', ')})`;
    })
    .join(', ');
}

const travaColaborador = (c: ColaboradorObra) => c.pendencias.some((p) => p.situacao !== 'em_analise' && p.grupo !== 'empresa');

function documentos(colabs: ColaboradorObra[]) {
  const lib = colabs.filter((c) => c.status === 'liberado');
  const comFalta = lib.filter(travaColaborador);
  // Documentos da empresa aparecem uma vez só, não um por colaborador.
  const daEmpresa = new Map<string, PendenciaDoc>();
  colabs.forEach((c) => c.pendencias.filter((p) => p.grupo === 'empresa' && p.situacao !== 'em_analise').forEach((p) => daEmpresa.set(p.documento, p)));
  const empresaVence = new Map<string, string>();
  const colabVence: { doc: string; venc: string }[] = [];
  lib.forEach((c) =>
    c.a_vencer.forEach((a) => {
      if (a.grupo === 'empresa') {
        const atual = empresaVence.get(a.documento);
        if (!atual || a.vencimento < atual) empresaVence.set(a.documento, a.vencimento);
      } else colabVence.push({ doc: a.documento, venc: a.vencimento });
    }),
  );
  const colabVencendo = new Set(lib.filter((c) => c.a_vencer.some((a) => a.grupo !== 'empresa')).map((c) => c.alocacao_id)).size;
  const emAnalise = lib.filter((c) => c.pendencias.some((p) => p.situacao === 'em_analise')).length;
  const comFornecedor = colabs.filter((c) => c.status === 'em_cadastro' || c.status === 'pendente_fornecedor').length;
  const naEmais = colabs.filter((c) => c.status === 'em_analise').length;
  const noTst = colabs.filter((c) => c.status === 'aprovado_admin').length;

  const itens: string[] = [];
  const tarefas: Tarefa[] = [];
  // Bloqueado pela Emais: não entra na obra até ser desbloqueado.
  const bloqueados = colabs.filter((c) => c.bloqueado);
  if (bloqueados.length) {
    itens.push(`${plural(bloqueados.length, 'colaborador bloqueado', 'colaboradores bloqueados')} pela Emais: ${bloqueados.map((c) => `${c.colaborador}${c.bloqueio_motivo ? ` (${c.bloqueio_motivo})` : ''}`).join('; ')}.`);
    tarefas.push({
      cor: 'vermelho',
      titulo: `Regularizar ${plural(bloqueados.length, 'colaborador bloqueado', 'colaboradores bloqueados')}`,
      detalhe: `Bloqueado pela Emais: ${bloqueados.map((c) => `${c.colaborador}${c.bloqueio_motivo ? `, ${c.bloqueio_motivo}` : ''}`).join('; ')}. Não entra na obra até ser desbloqueado.`,
      acao: 'colaboradores',
      rotulo: 'Ver colaboradores',
    });
  }
  if (comFalta.length) {
    itens.push(`${plural(comFalta.length, 'liberado trabalhando', 'liberados trabalhando')} com documento obrigatório faltando ou vencido: ${agruparFaltas(comFalta)}.`);
    tarefas.push({
      cor: 'vermelho',
      titulo: `Enviar os documentos de ${plural(comFalta.length, 'colaborador liberado', 'colaboradores liberados')}`,
      detalhe: `Estão liberados e trabalhando sem o documento obrigatório: ${agruparFaltas(comFalta)}.`,
      acao: 'pendencias',
      rotulo: 'Enviar documentos',
    });
  }
  daEmpresa.forEach((p) => {
    itens.push(`${p.documento} da empresa ${p.situacao === 'vencido' ? `vencido${p.vencimento ? ` em ${data(p.vencimento)}` : ''}` : p.situacao === 'devolvido' ? 'devolvido, falta corrigir' : 'não enviado'}.`);
    tarefas.push({
      cor: lib.length ? 'vermelho' : 'amarelo',
      titulo: `${p.situacao === 'vencido' ? 'Renovar' : 'Enviar'} ${p.documento} da empresa`,
      detalhe: 'Documento da empresa: vale para todas as obras.',
      acao: 'documentos_empresa',
      rotulo: 'Enviar documento',
    });
  });
  if (!comFalta.length && lib.length) itens.push(`Documentos ${lib.length === 1 ? 'do liberado' : `dos ${lib.length} liberados`} em dia.`);
  if (colabVencendo) {
    const primeiro = colabVence.map((x) => x.venc).sort()[0];
    const docs = [...new Set(colabVence.map((x) => x.doc))].join(', ');
    itens.push(`${plural(colabVencendo, 'colaborador', 'colaboradores')} com documento vencendo em 30 dias (${docs}); o primeiro em ${data(primeiro)}.`);
    tarefas.push({
      cor: 'amarelo',
      titulo: `Renovar ${docs} de ${plural(colabVencendo, 'colaborador', 'colaboradores')}`,
      detalhe: `O primeiro vence em ${data(primeiro)}. Depois do vencimento o colaborador fica com documento vencido.`,
      acao: 'pendencias',
      rotulo: 'Ver o que vence',
    });
  }
  empresaVence.forEach((venc, doc) => {
    itens.push(`${doc} da empresa vence em ${data(venc)}.`);
    tarefas.push({ cor: 'amarelo', titulo: `Renovar ${doc} até ${data(venc)}`, detalhe: 'Documento da empresa: vale para todas as obras.', acao: 'documentos_empresa', rotulo: 'Enviar documento' });
  });
  if (emAnalise) itens.push(`${plural(emAnalise, 'liberado com renovação', 'liberados com renovação')} em análise na Emais.`);
  if (comFornecedor) {
    itens.push(`${plural(comFornecedor, 'colaborador aguardando', 'colaboradores aguardando')} liberação: o fornecedor ainda não enviou tudo.`);
    tarefas.push({
      cor: 'amarelo',
      titulo: `Completar ${plural(comFornecedor, 'colaborador aguardando', 'colaboradores aguardando')} liberação`,
      detalhe: 'Faltam documentos para enviar para análise da Emais.',
      acao: 'pendencias',
      rotulo: 'Ver o que falta',
    });
  }
  if (naEmais) itens.push(`${plural(naEmais, 'colaborador', 'colaboradores')} em análise na Emais.`);
  if (noTst) itens.push(`${plural(noTst, 'colaborador aprovado', 'colaboradores aprovados')} pela Emais, aguardando o TST.`);

  const vermelho = comFalta.length > 0 || bloqueados.length > 0 || (daEmpresa.size > 0 && lib.length > 0);
  const amarelo = daEmpresa.size > 0 || colabVencendo > 0 || empresaVence.size > 0 || comFornecedor + naEmais + noTst > 0;
  const cor: Cor = colabs.length === 0 ? 'cinza' : vermelho ? 'vermelho' : amarelo ? 'amarelo' : 'verde';
  return { frente: { cor, itens: itens.length ? itens : ['Nenhum colaborador na obra.'] }, tarefas, comFalta: comFalta.length, bloqueados: bloqueados.length, aguardando: comFornecedor + naEmais + noTst, noTst };
}

function integracao(colabs: ColaboradorObra[]) {
  const lib = colabs.filter((c) => c.status === 'liberado');
  if (!lib.length) return { frente: { cor: 'cinza' as Cor, itens: ['Ninguém liberado ainda.'] }, tarefas: [] as Tarefa[], pendentes: 0 };
  const semRegistro = lib.filter((c) => !c.data_integracao && (c.liberado_em ?? '') >= INICIO_INTEGRACAO_PORTAL);
  const antigos = lib.filter((c) => !c.data_integracao && (c.liberado_em ?? '') < INICIO_INTEGRACAO_PORTAL);
  const vencida = lib.filter((c) => c.data_integracao && situacaoIntegracao(c) === 'vencida');
  const vencendo = lib.filter((c) => c.data_integracao && situacaoIntegracao(c) === 'vencendo');
  const emDia = lib.filter((c) => situacaoIntegracao(c) === 'em_dia');
  const itens: string[] = [];
  const tarefas: Tarefa[] = [];
  if (semRegistro.length) itens.push(`${plural(semRegistro.length, 'liberado', 'liberados')} desde setembro sem integração registrada pelo TST.`);
  if (vencida.length) itens.push(`${plural(vencida.length, 'colaborador', 'colaboradores')} com integração vencida.`);
  if (vencendo.length) itens.push(`${plural(vencendo.length, 'colaborador', 'colaboradores')} com integração vencendo em 30 dias.`);
  if (emDia.length) itens.push(`${plural(emDia.length, 'liberado', 'liberados')} com integração em dia.`);
  if (antigos.length) itens.push(`${plural(antigos.length, 'liberado', 'liberados')} antes do portal sem data de integração na planilha (não conta no farol).`);
  const pendentes = semRegistro.length + vencida.length + vencendo.length;
  if (pendentes)
    tarefas.push({
      cor: 'amarelo',
      titulo: `${plural(pendentes, 'colaborador', 'colaboradores')} sem integração em dia`,
      detalhe: 'Combine a integração com o técnico de segurança da obra.',
      acao: 'colaboradores',
      rotulo: 'Ver colaboradores',
    });
  return { frente: { cor: (pendentes ? 'amarelo' : 'verde') as Cor, itens: itens.length ? itens : ['Integração em dia.'] }, tarefas, pendentes };
}

function medicao(medicoes: MedicaoObra[], temLiberado: boolean, hoje: string) {
  const atual = competenciaAtual(hoje);
  const retidasMap = new Map<string, MedicaoObra>();
  medicoes.filter((m) => m.retida).forEach((m) => {
    // Mais de um registro no mesmo mês (planilha e portal): vale o do portal.
    const ja = retidasMap.get(m.competencia);
    if (!ja || m.origem === 'portal') retidasMap.set(m.competencia, m);
  });
  const retidas = [...retidasMap.values()].sort((a, b) => b.competencia.localeCompare(a.competencia));
  const doAtual = medicoes.filter((m) => m.competencia === atual).sort((a) => (a.origem === 'portal' ? -1 : 1))[0] ?? null;
  if (!temLiberado && !medicoes.length) return { frente: { cor: 'cinza' as Cor, itens: ['Sem medição: ninguém liberado na obra.'] }, tarefas: [] as Tarefa[], retidas: [] as string[] };

  const itens: string[] = [];
  const tarefas: Tarefa[] = [];
  let cor: Cor = 'verde';
  if (retidas.length) {
    cor = 'vermelho';
    const [ultima, ...outras] = retidas;
    const limite = (m: MedicaoObra) => (m.prazo_combinado && m.prazo_combinado > m.tolerancia ? m.prazo_combinado : m.tolerancia);
    itens.push(`${mesNome(ultima.competencia)} retido: não aprovado até ${data(limite(ultima))}. O pagamento segue retido até a correção no portal.`);
    if (outras.length) itens.push(`Também retidos: ${listaMeses(outras.map((m) => m.competencia).sort())}.`);
    // Uma tarefa só: abre a medição retida mais recente; os outros meses vão no texto.
    tarefas.push({
      cor: 'vermelho',
      titulo: retidas.length === 1 ? `Corrigir a medição de ${mesPorExtenso(ultima.competencia)}` : `Corrigir as medições retidas (${listaMeses(retidas.map((m) => m.competencia).sort())})`,
      detalhe: `${mesNome(ultima.competencia)} não aprovado até ${data(limite(ultima))}. A falta da regularização poderá ocasionar o bloqueio do pagamento.${ultima.itens_pendentes.length && ultima.itens_pendentes.length < 12 ? ` Falta: ${ultima.itens_pendentes.join('; ')}.` : ''}`,
      acao: 'medicao',
      rotulo: retidas.length === 1 ? 'Abrir medição' : `Abrir ${mesPorExtenso(ultima.competencia).split(' ')[0]}`,
      medicaoId: ultima.id,
    });
  }
  if (!retidasMap.has(atual) && (temLiberado || doAtual)) {
    const pg = pagamentoDe(doAtual, atual, hoje);
    const nome = mesNome(atual);
    if (pg.acao === 'liberar') itens.push(`${nome} aprovado.`);
    else if (pg.acao === 'reter') {
      cor = 'vermelho';
      itens.push(`${nome} não enviado até ${data(doAtual?.tolerancia ?? '')}: pagamento retido.`);
      tarefas.push({ cor: 'vermelho', titulo: `Enviar a medição de ${mesPorExtenso(atual)}`, detalhe: 'Passou da tolerância. A falta da regularização poderá ocasionar o bloqueio do pagamento.', acao: 'medicao', rotulo: 'Abrir medição', medicaoId: doAtual?.id });
    } else if (doAtual?.status === 'pendente_fornecedor') {
      cor = pior(cor, 'amarelo');
      const falta = doAtual.itens_pendentes.length && doAtual.itens_pendentes.length < 12 ? ` Falta: ${doAtual.itens_pendentes.join('; ')}.` : '';
      itens.push(`${nome} devolvido com pendência.${falta} Aprovar até ${data(pg.ate ?? doAtual.tolerancia)} para não reter.`);
      tarefas.push({ cor: 'amarelo', titulo: `Corrigir a medição de ${mesPorExtenso(atual)}`, detalhe: `Devolvida com pendência.${falta}`, acao: 'medicao', rotulo: 'Abrir medição', medicaoId: doAtual.id });
    } else if (pg.motivo === 'Em conferência na Emais') {
      cor = pior(cor, 'amarelo');
      itens.push(`${nome} enviado, em conferência na Emais.`);
    } else if (pg.motivo.startsWith('Em atraso') || pg.motivo.startsWith('Data combinada')) {
      cor = pior(cor, 'amarelo');
      itens.push(`${nome} em atraso: precisa ser aprovado até ${data(pg.ate)} para não reter o pagamento.`);
      tarefas.push({ cor: 'amarelo', titulo: `Enviar a medição de ${mesPorExtenso(atual)} até ${data(pg.ate)}`, detalhe: 'Passou do dia 25. Depois da data, o pagamento fica retido.', acao: 'medicao', rotulo: 'Abrir medição', medicaoId: doAtual?.id });
    } else {
      itens.push(`${nome}: envio até ${data(pg.ate)} (no prazo).`);
    }
  }
  if (!itens.length) itens.push('Sem medição pendente.');
  return { frente: { cor, itens }, tarefas, retidas: retidas.map((m) => m.competencia) };
}

export function farolDaEmpresa(empresaId: string, empresa: string, colabs: ColaboradorObra[], medicoes: MedicaoObra[], hoje = hojeIso()): FarolEmpresa {
  const d = documentos(colabs);
  const i = integracao(colabs);
  const temLiberado = colabs.some((c) => c.status === 'liberado');
  const m = medicao(medicoes, temLiberado, hoje);
  const geral = pior(d.frente.cor, i.frente.cor, m.frente.cor);

  // Manchete: primeiro o que bloqueia, depois o que está pendente.
  const partes: string[] = [];
  if (m.frente.cor === 'vermelho') partes.push(m.retidas.length ? `Pagamento retido (${listaMeses([...m.retidas].sort())})` : 'Pagamento retido');
  if (d.bloqueados) partes.push(`${plural(d.bloqueados, 'colaborador bloqueado', 'colaboradores bloqueados')}`);
  if (d.comFalta) partes.push(`${plural(d.comFalta, 'liberado', 'liberados')} com documento faltando`);
  if (d.frente.cor === 'vermelho' && !d.comFalta && !d.bloqueados) partes.push('Documento da empresa faltando');
  if (!partes.length) {
    if (m.frente.cor === 'amarelo') partes.push('Medição do mês pendente');
    if (d.aguardando) partes.push(`${plural(d.aguardando, 'colaborador aguardando', 'colaboradores aguardando')} liberação`);
    else if (d.frente.cor === 'amarelo') partes.push('Documento vencendo em 30 dias');
    if (i.pendentes) partes.push(`integração não registrada de ${plural(i.pendentes, 'liberado', 'liberados')}`);
  }
  const manchete = partes.length ? partes.join(' e ').replace(/^./, (c) => c.toUpperCase()) : 'Documentos, integração e medição em dia';

  const tarefas = [...d.tarefas, ...m.tarefas, ...i.tarefas].sort((a, b) => ordemCor[a.cor] - ordemCor[b.cor]);
  return { empresaId, empresa, geral, manchete, doc: d.frente, int: i.frente, med: m.frente, tarefas, aguardandoTst: d.noTst, retidas: m.retidas };
}

// Todas as empresas de uma obra (as que têm colaborador e as que têm medição).
export function faroisDaObra(colabs: ColaboradorObra[], medicoes: MedicaoObra[], hoje = hojeIso()): FarolEmpresa[] {
  const empresas = new Map<string, string>();
  colabs.forEach((c) => empresas.set(c.empresa_id, c.empresa));
  // Empresa só com histórico de medição e ninguém na obra entra se tiver pagamento retido.
  medicoes.filter((m) => m.retida).forEach((m) => empresas.set(m.empresa_id, m.empresa));
  return [...empresas.entries()]
    .map(([id, nome]) => farolDaEmpresa(id, nome, colabs.filter((c) => c.empresa_id === id), medicoes.filter((m) => m.empresa_id === id), hoje))
    .sort((a, b) => ordemCor[a.geral] - ordemCor[b.geral] || a.empresa.localeCompare(b.empresa, 'pt-BR'));
}

export function contarCores(farois: { geral: Cor }[]) {
  const c: Record<Cor, number> = { vermelho: 0, amarelo: 0, verde: 0, cinza: 0 };
  farois.forEach((f) => (c[f.geral] += 1));
  return c;
}

