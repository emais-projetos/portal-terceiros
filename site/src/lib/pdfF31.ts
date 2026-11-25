import { data as dataBr } from './formato';
import { ITENS_QUALIFICACAO, formatarCnpj, type DetalheHomologacao, type TipoHomologacao, documentoAtual } from './homologacao';

// F.31 Homologação de fornecedores (SGQ) gerado a partir do que o fornecedor preencheu e do parecer do Suprimentos.

const TINTA: [number, number, number] = [47, 72, 88];
const VERDE: [number, number, number] = [24, 182, 140];
const GELO: [number, number, number] = [224, 233, 252];

async function logo(): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}logo-emais.png`);
    if (!r.ok) return null;
    const blob = await r.blob();
    const url = await new Promise<string>((ok, falha) => {
      const l = new FileReader();
      l.onload = () => ok(l.result as string);
      l.onerror = () => falha(l.error);
      l.readAsDataURL(blob);
    });
    const dim = await new Promise<{ w: number; h: number }>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = falha;
      i.src = url;
    });
    return { url, ...dim };
  } catch {
    return null;
  }
}

const RESPOSTA: Record<string, string> = { sim: 'Sim', nao: 'Não', na: 'NA' };

export async function baixarF31(d: DetalheHomologacao, tipos: TipoHomologacao[]) {
  const [{ jsPDF }, { autoTable }, marca] = await Promise.all([import('jspdf'), import('jspdf-autotable'), logo()]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const m = 14;
  const larg = doc.internal.pageSize.getWidth();
  if (marca) {
    const k = Math.min(34 / marca.w, 12 / marca.h);
    doc.addImage(marca.url, 'PNG', m, m, marca.w * k, marca.h * k);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TINTA);
  doc.text('F.31 Homologação de fornecedores', larg - m, m + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Fornecedor de serviços', larg - m, m + 10, { align: 'right' });
  let y = m + 18;
  const dados = d.dados ?? {};
  const fim = () => ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 4;
  const estilo = {
    styles: { fontSize: 8, cellPadding: 1.4, textColor: TINTA, lineColor: [213, 222, 234] as [number, number, number], lineWidth: 0.1 },
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: 'bold' as const },
    margin: { left: m, right: m },
  };
  const pares = (titulo: string, linhas: [string, string | null | undefined][]) => {
    autoTable(doc, {
      ...estilo,
      startY: y,
      head: [[{ content: titulo, colSpan: 4 }]],
      body: linhas.reduce<string[][]>((acc, [r, v], i) => {
        if (i % 2 === 0) acc.push([r, v || '-']);
        else acc[acc.length - 1].push(r, v || '-');
        return acc;
      }, []),
      columnStyles: { 0: { fontStyle: 'bold', fillColor: GELO, cellWidth: 32 }, 2: { fontStyle: 'bold', fillColor: GELO, cellWidth: 32 } },
    });
    y = fim();
  };
  pares('Dados da empresa', [
    ['Razão social', dados.razao_social ?? d.razao_social],
    ['Nome fantasia', dados.nome_fantasia],
    ['CNPJ', formatarCnpj(d.cnpj)],
    ['Ramo de atividade', dados.ramo],
    ['Endereço', [dados.endereco, dados.numero, dados.complemento].filter(Boolean).join(', ')],
    ['Bairro', dados.bairro],
    ['Cidade/UF', [dados.cidade, dados.estado].filter(Boolean).join('/')],
    ['CEP', dados.cep],
    ['Telefone', dados.telefone],
    ['Celular', dados.celular],
    ['Contato', dados.contato],
    ['E-mail', dados.email_empresa],
    ['Praça de atuação', dados.praca],
    ['Código BP (SAP)', d.codigo_bp],
  ]);
  pares('Dados fiscais e bancários', [
    ['Inscrição estadual', dados.inscricao_estadual],
    ['Inscrição municipal', dados.inscricao_municipal],
    ['Banco', dados.banco],
    ['Agência', dados.agencia],
    ['Conta', dados.conta],
    ['', ''],
  ]);
  const refs = (dados.referencias ?? []).filter((r) => r.empresa);
  autoTable(doc, {
    ...estilo,
    startY: y,
    head: [['Referências comerciais', 'Contato', 'Telefone', 'E-mail', 'Cidade/UF']],
    body: refs.length ? refs.map((r) => [r.empresa, r.contato || '-', r.telefone || '-', r.email || '-', [r.cidade, r.estado].filter(Boolean).join('/') || '-']) : [['Nenhuma informada', '', '', '', '']],
  });
  y = fim();
  autoTable(doc, {
    ...estilo,
    startY: y,
    head: [['Documento', 'Emissão', 'Validade', 'Situação']],
    body: tipos.map((t) => {
      const doc0 = documentoAtual(d.documentos, t.codigo);
      const aprovado = d.documentos.find((x) => x.tipo === t.codigo && x.status === 'aprovado') ?? doc0;
      return [
        t.nome + (t.obrigatorio ? '' : ' (se houver)'),
        aprovado?.data_emissao ? dataBr(aprovado.data_emissao) : '-',
        aprovado?.vencimento ? dataBr(aprovado.vencimento) : '-',
        !aprovado ? 'Não apresentado' : aprovado.status === 'aprovado' ? 'Aprovado' : aprovado.status === 'devolvido' ? 'Devolvido' : 'Em análise',
      ];
    }),
    columnStyles: { 1: { cellWidth: 22 }, 2: { cellWidth: 22 }, 3: { cellWidth: 28 } },
  });
  y = fim();
  const q = d.qualificacao ?? {};
  autoTable(doc, {
    ...estilo,
    startY: y,
    head: [['Qualificação', 'Resposta']],
    body: ITENS_QUALIFICACAO.map((i) => [i.texto, RESPOSTA[q[i.chave] ?? ''] ?? '-']),
    columnStyles: { 1: { cellWidth: 24, halign: 'center' } },
  });
  y = fim();
  pares('Parecer do Suprimentos', [
    ['Situação', d.situacao === 'homologada' ? 'Homologado' : d.situacao === 'reprovada' ? 'Reprovado' : 'Em análise'],
    ['Data', d.decidida_em ? dataBr(d.decidida_em) : null],
    ['Aprovado por', d.responsavel],
    ['Registrado por', d.decidida_por],
  ]);
  if (d.comentarios || d.motivo) {
    autoTable(doc, { ...estilo, startY: y, head: [['Comentários']], body: [[d.comentarios || d.motivo || '']] });
    y = fim();
  }
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Gerado pelo Portal de Terceiros em ${dataBr(new Date().toISOString())}`, m, doc.internal.pageSize.getHeight() - 8);
    doc.text(`${p}/${paginas}`, larg - m, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }
  const nome = `F31_${(dados.razao_social ?? d.razao_social).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;
  doc.save(nome);
}
