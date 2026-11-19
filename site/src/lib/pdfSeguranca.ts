import type { jsPDF as JsPDF } from 'jspdf';
import { data as dataBr } from './formato';
import { NOMES_CAMA, NOMES_STATUS_VISTORIA, competencia, itemDosOcupantes, linksDosArquivos, type Ficha, type ItemVistoria, type Pessoa, type Termo, type Vistoria } from './seguranca';
import { TERMO } from './termoAlojamento';

// PDF da vistoria de alojamento e da ficha mensal da máquina, com fotos e assinaturas.
// É o registro que fica depois que as fotos saem do portal (30 dias após a conclusão).

type Imagem = { url: string; w: number; h: number; formato: 'JPEG' | 'PNG' };

async function carregar(url: string): Promise<Imagem | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const dataUrl = await new Promise<string>((ok, falha) => {
      const l = new FileReader();
      l.onload = () => ok(l.result as string);
      l.onerror = () => falha(l.error);
      l.readAsDataURL(blob);
    });
    const dim = await new Promise<{ w: number; h: number }>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = falha;
      i.src = dataUrl;
    });
    return { url: dataUrl, ...dim, formato: blob.type.includes('png') ? 'PNG' : 'JPEG' };
  } catch {
    return null;
  }
}

async function carregarTodas(caminhos: string[]): Promise<Record<string, Imagem>> {
  const links = await linksDosArquivos(caminhos);
  const saida: Record<string, Imagem> = {};
  await Promise.all(
    Object.entries(links).map(async ([c, u]) => {
      const img = await carregar(u);
      if (img) saida[c] = img;
    }),
  );
  return saida;
}

const VERDE: [number, number, number] = [29, 91, 51];
const VERMELHO: [number, number, number] = [168, 50, 31];
const CINZA: [number, number, number] = [79, 101, 116];
const TINTA: [number, number, number] = [47, 72, 88];
const PETROLEO: [number, number, number] = [30, 117, 106];

function encaixar(img: Imagem, larg: number, alt: number) {
  const k = Math.min(larg / img.w, alt / img.h);
  return { w: img.w * k, h: img.h * k };
}

function nomeArquivo(partes: string[]) {
  return partes
    .join('_')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class Folha {
  doc: JsPDF;
  y = 0;
  readonly m = 14;
  constructor(doc: JsPDF) {
    this.doc = doc;
  }
  get larg() {
    return this.doc.internal.pageSize.getWidth();
  }
  get alt() {
    return this.doc.internal.pageSize.getHeight();
  }
  get util() {
    return this.larg - this.m * 2;
  }
  // Garante espaço; se não couber, nova página.
  caber(h: number) {
    if (this.y + h > this.alt - 16) {
      this.doc.addPage();
      this.y = this.m;
    }
  }
  texto(t: string, x: number, larg: number, tam = 9.5, estilo: 'normal' | 'bold' = 'normal', cor = TINTA) {
    this.doc.setFont('helvetica', estilo);
    this.doc.setFontSize(tam);
    this.doc.setTextColor(...cor);
    const linhas = this.doc.splitTextToSize(limpo(t), larg) as string[];
    const lh = tam * 0.42;
    linhas.forEach((l) => {
      this.caber(lh);
      this.doc.text(l, x, this.y + lh * 0.8);
      this.y += lh;
    });
  }
  rodape(titulo: string) {
    const total = this.doc.getNumberOfPages();
    const agora = new Date();
    const quando = `${dataBr(agora.toISOString())} ${agora.toTimeString().slice(0, 5)}`;
    for (let p = 1; p <= total; p++) {
      this.doc.setPage(p);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...CINZA);
      this.doc.text(`${titulo}. Portal de Terceiros Emais, gerado em ${quando}`, this.m, this.alt - 8);
      this.doc.text(`Página ${p} de ${total}`, this.larg - this.m, this.alt - 8, { align: 'right' });
    }
  }
}

async function logo(): Promise<Imagem | null> {
  return carregar(`${import.meta.env.BASE_URL}logo-emais.png`);
}

function cabecalho(f: Folha, marca: Imagem | null, titulo: string, subtitulo: string) {
  const { doc, m } = f;
  if (marca) {
    const t = encaixar(marca, 34, 12);
    doc.addImage(marca.url, marca.formato, m, m, t.w, t.h);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...TINTA);
  doc.text(titulo, f.larg - m, m + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...CINZA);
  doc.text(subtitulo, f.larg - m, m + 10, { align: 'right' });
  doc.setDrawColor(...PETROLEO);
  doc.setLineWidth(0.6);
  doc.line(m, m + 15, f.larg - m, m + 15);
  f.y = m + 20;
}

function quadroDados(f: Folha, campos: [string, string][], colunas = 3) {
  const { doc, m } = f;
  const larg = f.util / colunas;
  const linhasDe = (v: string) => (doc.splitTextToSize(limpo(v || '-'), larg - 6) as string[]).slice(0, 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const alturas: number[] = [];
  for (let i = 0; i < campos.length; i += colunas) {
    alturas.push(Math.max(...campos.slice(i, i + colunas).map(([, v]) => linhasDe(v).length)) * 4 + 7);
  }
  const h = alturas.reduce((a, b) => a + b, 0) + 4;
  f.caber(h);
  doc.setFillColor(245, 248, 254);
  doc.roundedRect(m, f.y, f.util, h, 2, 2, 'F');
  let y = f.y + 6;
  alturas.forEach((alt, linha) => {
    campos.slice(linha * colunas, linha * colunas + colunas).forEach(([rotulo, valor], k) => {
      const x = m + 4 + k * larg;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...CINZA);
      doc.text(rotulo.toUpperCase(), x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...TINTA);
      linhasDe(valor).forEach((l, i) => doc.text(l, x, y + 4.5 + i * 4));
    });
    y += alt;
  });
  f.y += h + 6;
}

// A fonte padrão do PDF não tem alguns símbolos; troca pelo equivalente.
function limpo(t: string) {
  return t.replace(/²/g, '2').replace(/³/g, '3').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-');
}

function fotos(f: Folha, caminhos: string[], imgs: Record<string, Imagem>, x: number, larg: number) {
  const lista = caminhos.map((c) => imgs[c]).filter(Boolean) as Imagem[];
  if (!lista.length) return;
  const porLinha = 3;
  const gap = 3;
  const w = (larg - gap * (porLinha - 1)) / porLinha;
  const h = w * 0.75;
  for (let i = 0; i < lista.length; i += porLinha) {
    f.caber(h + gap);
    lista.slice(i, i + porLinha).forEach((img, k) => {
      const t = encaixar(img, w, h);
      const px = x + k * (w + gap) + (w - t.w) / 2;
      f.doc.addImage(img.url, img.formato, px, f.y + (h - t.h) / 2, t.w, t.h);
    });
    f.y += h + gap;
  }
}

function assinaturas(f: Folha, titulo: string, pessoas: Pessoa[], imgs: Record<string, Imagem>) {
  if (!pessoas.length) return;
  f.caber(14 + 29); // título junto com a primeira linha de assinaturas
  f.y += 2;
  f.texto(titulo, f.m, f.util, 10.5, 'bold');
  f.y += 2;
  const colunas = 2;
  const w = f.util / colunas;
  for (let i = 0; i < pessoas.length; i += colunas) {
    f.caber(29);
    pessoas.slice(i, i + colunas).forEach((p, k) => {
      const x = f.m + k * w;
      const img = p.assinatura ? imgs[p.assinatura] : null;
      if (img) {
        const t = encaixar(img, w - 16, 14);
        f.doc.addImage(img.url, img.formato, x + 2, f.y + 14 - t.h, t.w, t.h);
      }
      f.doc.setDrawColor(...CINZA);
      f.doc.setLineWidth(0.2);
      f.doc.line(x + 2, f.y + 15, x + w - 10, f.y + 15);
      f.doc.setFont('helvetica', 'normal');
      f.doc.setFontSize(8.5);
      f.doc.setTextColor(...TINTA);
      f.doc.text(p.nome || 'Sem nome', x + 2, f.y + 19);
      if (p.cargo) {
        f.doc.setFontSize(7.5);
        f.doc.setTextColor(...CINZA);
        (f.doc.splitTextToSize(limpo(p.cargo), w - 12) as string[]).slice(0, 2).forEach((l, k) => f.doc.text(l, x + 2, f.y + 22.5 + k * 3.3));
      }
    });
    f.y += 29;
  }
}

// Situação do morador que não assinou na tela (ausente ou registro eletrônico), com a empresa.
function comSituacao(pessoas: Pessoa[]): Pessoa[] {
  return pessoas.map((p) => {
    const sit = p.ausente ? 'Ausente na hora da vistoria' : p.nao_assina ? `Não sabe assinar: registro eletrônico ${p.codigo ?? '(gerado na conclusão)'}` : '';
    return { ...p, cargo: [p.empresa, sit].filter(Boolean).join('. ') || p.cargo };
  });
}

function quemCorrige(it: ItemVistoria, moradores: Pessoa[]): string {
  if (!it.quarto || !itemDosOcupantes(it.texto)) return 'Emais';
  const e = [...new Set(moradores.filter((p) => p.quarto === it.quarto && p.empresa).map((p) => p.empresa as string))];
  return e.length ? e.join(', ') : 'Emais';
}

export async function baixarPdfVistoria(v: Vistoria, ctx: { obra: string; alojamento: string; endereco: string | null; responsavel: string; canteiro?: boolean; checklist?: string; naObra?: boolean }) {
  const caminhos = [...v.itens.flatMap((i) => i.fotos ?? []), ...v.funcionarios.map((p) => p.assinatura ?? ''), ...v.envolvidos.map((p) => p.assinatura ?? '')];
  const [{ jsPDF }, marca, imgs] = await Promise.all([import('jspdf'), logo(), v.fotos_excluidas_em ? Promise.resolve({}) : carregarTodas(caminhos)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const f = new Folha(doc);
  cabecalho(f, marca, ctx.canteiro ? 'Vistoria do canteiro' : 'Vistoria de alojamento', `${ctx.checklist || 'Checklist'}${v.modelo_versao ? `, versão ${v.modelo_versao}` : ''}`);

  const aplicaveis = v.itens.filter((i) => i.status === 'sim' || i.status === 'nao').length;
  const conformes = v.itens.filter((i) => i.status === 'sim').length;
  quadroDados(f, [
    ['Obra', ctx.obra],
    [ctx.canteiro ? 'Local' : 'Alojamento', ctx.alojamento],
    ['Responsável', ctx.responsavel],
    ['Data da vistoria', `${dataBr(v.data_vistoria)}${v.horario ? `, ${v.horario}` : ''}`],
    ...(ctx.canteiro ? [] : ([['Moradores', v.qtd_funcionarios != null ? String(v.qtd_funcionarios) : '-']] as [string, string][])),
    ['Resultado', v.situacao === 'concluida' ? `${v.classificacao ?? '-'} (${conformes} de ${aplicaveis} itens em ordem)` : 'Em andamento (não concluída)'],
    ...(ctx.endereco ? ([['Endereço', ctx.endereco]] as [string, string][]) : []),
  ]);
  if (v.fotos_excluidas_em) {
    f.texto(`As fotos desta vistoria foram excluídas do portal em ${dataBr(v.fotos_excluidas_em)}.`, f.m, f.util, 8.5, 'normal', CINZA);
    f.y += 3;
  }

  const desenharItem = (it: ItemVistoria, n: number, corrige?: string) => {
    f.caber(16);
    const topo = f.y;
    const status = it.status ? NOMES_STATUS_VISTORIA[it.status] : 'Sem resposta';
    const cor = it.status === 'sim' ? VERDE : it.status === 'nao' ? VERMELHO : CINZA;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    const wStatus = doc.getTextWidth(status) + 6;
    doc.setTextColor(...cor);
    doc.text(status, f.larg - f.m - 3, topo + 4, { align: 'right' });
    doc.setDrawColor(...cor);
    doc.setLineWidth(0.3);
    doc.roundedRect(f.larg - f.m - wStatus, topo, wStatus, 5.6, 1.2, 1.2, 'S');
    f.texto(`${n + 1}. ${it.texto}`, f.m, f.util - wStatus - 6, 9.5, 'normal');
    f.y = Math.max(f.y, topo + 6.5);
    if (it.recomendacao || it.prazo) {
      const partes = [it.recomendacao ? `Recomendação: ${it.recomendacao}` : '', it.prazo ? `Prazo: ${dataBr(it.prazo)}` : '', it.status === 'nao' && corrige ? `Corrige: ${corrige}` : ''].filter(Boolean);
      f.texto(partes.join('. '), f.m + 4, f.util - 8, 8.5, 'normal', it.status === 'nao' ? VERMELHO : CINZA);
    }
    if (it.fotos?.length) {
      f.y += 1.5;
      fotos(f, it.fotos, imgs, f.m + 4, f.util - 8);
    }
    f.y += 2;
    doc.setDrawColor(213, 222, 234);
    doc.setLineWidth(0.15);
    doc.line(f.m, f.y, f.larg - f.m, f.y);
    f.y += 3;
  };

  const secao = (titulo: string, sub: string) => {
    f.caber(18);
    f.y += 2;
    f.texto(titulo, f.m, f.util, 12, 'bold', PETROLEO);
    if (sub) f.texto(sub, f.m, f.util, 8.5, 'normal', CINZA);
    f.y += 2;
  };

  if (ctx.naObra) {
    v.quartos.forEach((q) => {
      const itens = v.itens.filter((it) => it.quarto === q.nome && !it.auto_na);
      const sim = itens.filter((i) => i.status === 'sim').length;
      const aplic = itens.filter((i) => i.status === 'sim' || i.status === 'nao').length;
      secao(q.nome, `${q.cama ? NOMES_CAMA[q.cama] : 'Tipo de cama não informado'}. ${aplic ? `${sim} de ${aplic} itens em ordem` : 'Sem itens aplicáveis'}.`);
      itens.forEach((it, k) => desenharItem(it, k, quemCorrige(it, v.funcionarios)));
      assinaturas(f, `Moradores do ${q.nome}`, comSituacao(v.funcionarios.filter((p) => p.quarto === q.nome)), imgs);
    });
    secao('Áreas comuns', `Banheiros, chuveiros e refeição. ${v.funcionarios.length} moradores nos quartos vistoriados.`);
    v.itens.filter((it) => !it.quarto).forEach((it, k) => desenharItem(it, k, 'Emais'));
  } else {
    v.itens.forEach((it, n) => desenharItem(it, n));
  }

  if (!ctx.canteiro && !ctx.naObra) assinaturas(f, 'Moradores', comSituacao(v.funcionarios), imgs);
  assinaturas(f, 'Acompanharam a vistoria', v.envolvidos, imgs);
  f.rodape(`Vistoria ${ctx.alojamento}, ${dataBr(v.data_vistoria)}`);
  doc.save(`${nomeArquivo([v.data_vistoria.replace(/-/g, ''), ctx.canteiro ? 'Vistoria canteiro' : 'Vistoria alojamento', ctx.canteiro ? '' : ctx.alojamento, ctx.obra].filter(Boolean))}.pdf`);
}

const SIGLA = { ok: 'C', nc: 'NC', na: 'NA' } as const;

export async function baixarPdfFicha(fi: Ficha, ctx: { obra: string; maquina: string; identificacao: string; responsavel: string }) {
  const dias = Object.keys(fi.dias).sort();
  const caminhos = [
    ...dias.flatMap((d) => [...(fi.dias[d].fotos ?? []), fi.dias[d].assinatura ?? '']),
    fi.fechamento?.operador_assinatura ?? '',
    fi.fechamento?.tst_assinatura ?? '',
  ];
  const [{ jsPDF }, { autoTable }, marca, imgs] = await Promise.all([import('jspdf'), import('jspdf-autotable'), logo(), carregarTodas(caminhos)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const f = new Folha(doc);
  cabecalho(f, marca, `Checklist mensal: ${ctx.maquina}`, `Inspeção diária de máquinas e equipamentos, ${competencia(fi.competencia)}${fi.modelo_versao ? `, versão ${fi.modelo_versao}` : ''}`);
  quadroDados(
    f,
    [
      ['Obra', ctx.obra],
      ['Máquina', `${ctx.maquina} ${ctx.identificacao}`],
      ['Responsável', ctx.responsavel],
      ['Mês', competencia(fi.competencia)],
      ['Dias com checklist', String(dias.length)],
      ['Fechamento', fi.fechada_em && fi.fechamento ? `Fechada em ${dataBr(fi.fechada_em)}` : 'Ficha aberta'],
    ],
    3,
  );

  const [a, mes] = fi.competencia.split('-').map(Number);
  const ultimo = new Date(a, mes, 0).getDate();
  const colunas = Array.from({ length: ultimo }, (_, i) => String(i + 1).padStart(2, '0'));
  autoTable(doc, {
    startY: f.y,
    margin: { left: f.m, right: f.m },
    head: [['Item', ...colunas.map((c) => String(Number(c)))]],
    body: fi.itens.map((item, i) => [limpo(item), ...colunas.map((c) => (fi.dias[c]?.statuses[i] ? SIGLA[fi.dias[c].statuses[i]!] : ''))]),
    styles: { fontSize: 6.5, cellPadding: 0.8, halign: 'center', valign: 'middle', lineColor: [213, 222, 234], lineWidth: 0.1, textColor: TINTA },
    headStyles: { fillColor: PETROLEO, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'left', cellWidth: 72 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.cell.raw === 'NC') {
        d.cell.styles.textColor = VERMELHO;
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = [251, 234, 230];
      }
    },
  });
  f.y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? f.y) + 3;
  f.texto('C = conforme, NC = não conforme, NA = não se aplica', f.m, f.util, 7.5, 'normal', CINZA);
  f.y += 4;

  if (dias.length) {
    autoTable(doc, {
      startY: f.y,
      margin: { left: f.m, right: f.m },
      head: [['Dia', 'Operador', 'Não conformidades e observações', 'Assinatura do operador']],
      body: dias.map((d) => {
        const dia = fi.dias[d];
        const nc = dia.statuses.map((s, i) => (s === 'nc' ? fi.itens[i] : null)).filter(Boolean).join('; ');
        return [String(Number(d)), dia.operador, limpo([nc ? `Não conforme: ${nc}` : '', dia.observacao].filter(Boolean).join('. ')), ''];
      }),
      styles: { fontSize: 8, cellPadding: 1.4, valign: 'middle', lineColor: [213, 222, 234], lineWidth: 0.1, textColor: TINTA, minCellHeight: 8 },
      headStyles: { fillColor: PETROLEO, textColor: 255 },
      columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 45 }, 3: { cellWidth: 45 } },
      didDrawCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 3) return;
        const c = fi.dias[dias[d.row.index]]?.assinatura;
        const img = c ? imgs[c] : null;
        if (!img) return;
        const t = encaixar(img, d.cell.width - 4, d.cell.height - 2);
        doc.addImage(img.url, img.formato, d.cell.x + 2, d.cell.y + (d.cell.height - t.h) / 2, t.w, t.h);
      },
    });
    f.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  const comFotos = dias.filter((d) => fi.dias[d].fotos?.length);
  if (comFotos.length) {
    f.caber(12);
    f.texto('Fotos', f.m, f.util, 10.5, 'bold');
    f.y += 2;
    comFotos.forEach((d) => {
      f.caber(10);
      f.texto(`Dia ${Number(d)}`, f.m, f.util, 8.5, 'bold', CINZA);
      f.y += 1;
      fotos(f, fi.dias[d].fotos, imgs, f.m, Math.min(f.util, 180));
      f.y += 2;
    });
  }

  if (fi.fechamento) {
    assinaturas(f, 'Fechamento do mês', [
      { nome: fi.fechamento.operador_nome, cargo: 'Operador', assinatura: fi.fechamento.operador_assinatura ?? null },
      { nome: fi.fechamento.tst_nome, cargo: 'Técnico de Segurança do Trabalho', assinatura: fi.fechamento.tst_assinatura ?? null },
    ], imgs);
  }
  f.rodape(`Checklist ${ctx.maquina} ${ctx.identificacao}, ${competencia(fi.competencia)}`);
  doc.save(`${nomeArquivo([fi.competencia.slice(0, 7).replace('-', ''), 'Checklist', ctx.maquina, ctx.identificacao, ctx.obra])}.pdf`);
}

export async function baixarPdfTermo(t: Termo, ctx: { obra: string; alojamento: string; empresa: string }) {
  const [{ jsPDF }, marca, imgs] = await Promise.all([import('jspdf'), logo(), carregarTodas([t.assinatura ?? '', t.representante_assinatura ?? ''].filter(Boolean))]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const f = new Folha(doc);
  cabecalho(f, marca, TERMO.titulo, `Versão ${t.versao}`);
  quadroDados(f, [
    ['Obra', ctx.obra],
    ['Alojamento', ctx.alojamento],
    ['Empresa', ctx.empresa],
    ['Colaborador', t.nome],
    ['Função', t.funcao ?? ''],
    ['Ingresso no alojamento', t.data_ingresso ? dataBr(t.data_ingresso) : ''],
  ]);
  f.texto(TERMO.introducao, f.m, f.util, 9.5);
  f.y += 3;
  TERMO.secoes.forEach((sec) => {
    f.caber(10);
    f.texto(sec.titulo, f.m, f.util, 10, 'bold');
    f.y += 1;
    sec.itens.forEach((it) => {
      f.caber(5);
      const topo = f.y;
      f.texto(it, f.m + 5, f.util - 5, 9);
      doc.setFillColor(...TINTA);
      doc.circle(f.m + 1.6, topo + 2.2, 0.6, 'F');
      f.y += 1;
    });
    f.y += 2;
  });
  f.texto('Penalidades', f.m, f.util, 10, 'bold');
  f.y += 1;
  f.texto(TERMO.penalidade, f.m, f.util, 9);
  f.y += 3;
  f.texto('Declaração', f.m, f.util, 10, 'bold');
  f.y += 1;
  f.texto(TERMO.declaracao, f.m, f.util, 9);
  f.y += 4;
  f.texto(`${t.local ? `${t.local}, ` : ''}${dataBr(t.data)}`, f.m, f.util, 9.5);
  f.y += 2;
  assinaturas(f, 'Assinaturas', [
    { nome: t.nome, cargo: 'Colaborador', assinatura: t.assinatura },
    { nome: t.representante_nome ?? '', cargo: `Responsável, ${ctx.empresa}`, assinatura: t.representante_assinatura },
  ], imgs);
  f.rodape(`Termo de uso do alojamento ${ctx.alojamento}, ${t.nome}`);
  doc.save(`${nomeArquivo([t.data.replace(/-/g, ''), 'Termo alojamento', t.nome, ctx.alojamento])}.pdf`);
}
