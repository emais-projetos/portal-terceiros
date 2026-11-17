import type { jsPDF as JsPDF } from 'jspdf';

// Lista de presença da integração no layout do documento controlado
// "DECLARAÇÃO DE RECEBIMENTO DE TREINAMENTO" (Segurança do Trabalho).
// Medidas em mm, tiradas do documento original em A4 retrato. Uma folha (ou mais) por empresa,
// com as linhas de assinatura do modelo; "PAGINA: x de y" conta as folhas da empresa.

export type ModeloLista = {
  titulo: string;
  setor: string;
  data_revisao: string;
  revisao: string;
  conteudo: {
    contratante: string;
    titulo_corpo: string;
    declaracao: string[];
    titulo_conteudo: string;
    conteudo_esquerda: string[];
    conteudo_direita: string[];
    carga_horaria: string;
    rotulo_instrutor: string;
    funcao_instrutor: string;
    linhas_por_pagina: number;
  };
};

export type DadosLista = {
  obra: string;
  data: string; // AAAA-MM-DD
  instrutor: string;
  empresas: { empresa: string; participantes: Linha[] }[];
};

type Linha = { nome: string; funcao: string | null; assinatura?: string | null };

type Trecho = { t: string; b: boolean; i: boolean };

// "texto **negrito** _itálico_" -> trechos com estilo
function trechos(texto: string): Trecho[] {
  const saida: Trecho[] = [];
  let b = false;
  let i = false;
  let atual = '';
  for (let k = 0; k < texto.length; k++) {
    if (texto.startsWith('**', k)) {
      if (atual) saida.push({ t: atual, b, i });
      atual = '';
      b = !b;
      k += 1;
    } else if (texto[k] === '_' && (k === 0 || /[\s(]/.test(texto[k - 1]) || i)) {
      if (atual) saida.push({ t: atual, b, i });
      atual = '';
      i = !i;
    } else atual += texto[k];
  }
  if (atual) saida.push({ t: atual, b, i });
  return saida;
}

type Palavra = { t: string; b: boolean; i: boolean; w: number; espacoAntes: boolean };

function estilo(doc: JsPDF, p: { b: boolean; i: boolean }) {
  doc.setFont('helvetica', p.b && p.i ? 'bolditalic' : p.b ? 'bold' : p.i ? 'italic' : 'normal');
}

function palavras(doc: JsPDF, texto: string): Palavra[] {
  const lista: Palavra[] = [];
  let espaco = false;
  for (const tr of trechos(texto)) {
    const partes = tr.t.split(/(\s+)/);
    for (const parte of partes) {
      if (parte === '') continue;
      if (/^\s+$/.test(parte)) {
        espaco = true;
        continue;
      }
      estilo(doc, tr);
      const w = doc.getTextWidth(parte);
      // Trecho colado ao anterior sem espaço (ex.: "**10-**Segurança") continua a mesma palavra visual.
      lista.push({ t: parte, b: tr.b, i: tr.i, w, espacoAntes: espaco });
      espaco = false;
    }
  }
  if (lista.length) lista[0].espacoAntes = false;
  return lista;
}

// Escreve um parágrafo justificado com trechos em negrito/itálico. Devolve a linha de base seguinte.
function paragrafo(
  doc: JsPDF,
  texto: string,
  o: { x: number; y: number; largura: number; quebraEm?: number; tamanho: number; entrelinha: number; recuoPrimeira?: number; recuoDemais?: number; justificar?: boolean },
): number {
  doc.setFontSize(o.tamanho);
  const ps = palavras(doc, texto);
  estilo(doc, { b: false, i: false });
  const espaco = doc.getTextWidth(' ');
  const linhas: Palavra[][] = [];
  let linha: Palavra[] = [];
  let usado = 0;
  const limite = (n: number) => o.largura - (n === 0 ? o.recuoPrimeira ?? 0 : o.recuoDemais ?? 0);
  const limiteQuebra = (n: number) => (o.quebraEm ?? o.largura) - (n === 0 ? o.recuoPrimeira ?? 0 : o.recuoDemais ?? 0);
  ps.forEach((p) => {
    const extra = linha.length && p.espacoAntes ? espaco : 0;
    if (linha.length && usado + extra + p.w > limiteQuebra(linhas.length) + 0.01) {
      linhas.push(linha);
      linha = [];
      usado = 0;
    }
    usado += (linha.length && p.espacoAntes ? espaco : 0) + p.w;
    linha.push(p);
  });
  if (linha.length) linhas.push(linha);

  let y = o.y;
  linhas.forEach((l, n) => {
    const x0 = o.x + (n === 0 ? o.recuoPrimeira ?? 0 : o.recuoDemais ?? 0);
    const larguraLinha = limite(n);
    const lacunas = l.filter((p, k) => k > 0 && p.espacoAntes).length;
    const ocupado = l.reduce((s, p, k) => s + p.w + (k > 0 && p.espacoAntes ? espaco : 0), 0);
    const ultima = n === linhas.length - 1;
    const sobra = o.justificar !== false && !ultima && lacunas > 0 ? (larguraLinha - ocupado) / lacunas : 0;
    let x = x0;
    l.forEach((p, k) => {
      if (k > 0 && p.espacoAntes) x += espaco + sobra;
      estilo(doc, p);
      doc.text(p.t, x, y);
      x += p.w;
    });
    y += o.entrelinha;
  });
  estilo(doc, { b: false, i: false });
  return y;
}

// Texto numa célula, reduzindo a fonte se não couber.
function caber(doc: JsPDF, texto: string, largura: number, tamanho: number): number {
  let t = tamanho;
  doc.setFontSize(t);
  while (t > 6 && doc.getTextWidth(texto) > largura) {
    t -= 0.5;
    doc.setFontSize(t);
  }
  return t;
}

function dataCurta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

const L = { esq: 14.3, dir: 196.0 };

function folha(
  doc: JsPDF,
  modelo: ModeloLista,
  logo: string | null,
  dados: DadosLista,
  empresa: string,
  linhas: Linha[],
  pagina: number,
  total: number,
) {
  const c = modelo.conteudo;
  doc.setDrawColor(0);
  doc.setTextColor(0);
  doc.setLineWidth(0.2);

  // Cabeçalho
  doc.rect(L.esq, 11.1, L.dir - L.esq, 24.2);
  doc.line(49.9, 11.1, 49.9, 35.3);
  doc.line(159.1, 11.1, 159.1, 35.3);
  doc.setFillColor(231, 230, 230);
  doc.rect(159.1, 22.2, 15.9, 13.1, 'F');
  doc.line(159.1, 22.2, L.dir, 22.2);
  doc.line(159.1, 26.6, L.dir, 26.6);
  doc.line(159.1, 30.9, L.dir, 30.9);
  doc.line(175.0, 22.2, 175.0, 35.3);
  doc.rect(159.1, 22.2, L.dir - 159.1, 13.1);
  if (logo) doc.addImage(logo, 'PNG', 15.8, 18.0, 32.8, 10.3, 'logo-emais', 'FAST');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(modelo.titulo, 104.5, 25.1, { align: 'center' });
  doc.setFontSize(8);
  const setor = doc.splitTextToSize(modelo.setor, 34) as string[];
  setor.forEach((s, k) => doc.text(s, 177.55, 15.8 + k * 3.4 - (setor.length - 2) * 1.7, { align: 'center' }));
  doc.text('DATA:', 173.9, 25.3, { align: 'right' });
  doc.text('REV.:', 173.9, 29.7, { align: 'right' });
  doc.text('PAGINA:', 173.9, 34.1, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(modelo.data_revisao, 185.5, 25.3, { align: 'center' });
  doc.text(modelo.revisao, 185.5, 29.7, { align: 'center' });
  doc.text(`${pagina} de ${total}`, 185.5, 34.1, { align: 'center' });

  // Declaração
  doc.rect(L.esq, 39.7, L.dir - L.esq, 210.1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(c.titulo_corpo, 105.2, 47.0, { align: 'center' });
  const contratante = c.contratante.replace('{OBRA}', dados.obra.toUpperCase());
  let y = 52.6;
  c.declaracao.forEach((p) => {
    y = paragrafo(doc, p.replace('{CONTRATANTE}', contratante), { x: 15.6, y, largura: 178.6, tamanho: 10, entrelinha: 5.29, recuoPrimeira: 5.9 });
  });
  doc.line(L.esq, 101.1, L.dir, 101.1);

  // Conteúdo programático
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(c.titulo_conteudo, 15.6, 106.5);
  doc.line(94.2, 107.4, 94.2, 188.2);
  y = 117.7;
  c.conteudo_esquerda.forEach((p) => {
    y = paragrafo(doc, p, { x: 15.6, y, largura: 76.5, tamanho: 9, entrelinha: 3.65, recuoDemais: 4.2 }) + 1.06;
  });
  y = 114.3;
  c.conteudo_direita.forEach((p) => {
    // A largura útil da coluna é um pouco menor que a área do texto: é o que faz as quebras de linha
    // caírem nos mesmos lugares do documento original (o Arial do Word é levemente mais largo).
    y = paragrafo(doc, p, { x: 96.8, y, largura: 96.7, quebraEm: 95.4, tamanho: 9, entrelinha: 3.65, recuoDemais: p.startsWith('**') ? 4.1 : 3.2 }) + 1.06;
  });

  // Empresa, data, carga horária e tabela de assinaturas
  doc.line(L.esq, 188.2, L.dir, 188.2);
  doc.line(L.esq, 196.0, L.dir, 196.0);
  doc.line(L.esq, 202.0, L.dir, 202.0);
  doc.line(95.8, 196.0, 95.8, 249.8);
  doc.line(145.9, 202.0, 145.9, 249.8);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('EMPRESA', 15.6, 193.5);
  const wEmpresa = doc.getTextWidth('EMPRESA');
  doc.setFont('helvetica', 'normal');
  const t = caber(doc, `:  ${empresa}`, L.dir - 16 - wEmpresa - 2, 10);
  doc.setFontSize(t);
  doc.text(`:  ${empresa}`, 15.6 + wEmpresa, 193.5);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`DATA: ${dataCurta(dados.data)}`, 15.6, 200.4);
  doc.text(`CARGA HORÁRIA: ${c.carga_horaria}`, 145.9, 200.4, { align: 'center' });
  doc.setFontSize(9);
  doc.text('NOME DO FUNCIONÁRIO:', 55.05, 206.1, { align: 'center' });
  doc.text('FUNÇÃO', 120.85, 206.1, { align: 'center' });
  doc.text('ASSINATURA', 170.95, 206.1, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  const porPagina = Math.max(1, c.linhas_por_pagina);
  const alturaLinha = (249.8 - 207.8) / porPagina;
  for (let k = 0; k < porPagina; k++) {
    const topo = 207.8 + k * alturaLinha;
    doc.line(L.esq, topo, L.dir, topo);
    const l = linhas[k];
    if (!l) continue;
    const nome = l.nome.toUpperCase();
    doc.setFontSize(caber(doc, nome, 78.5, 9));
    doc.text(nome, 15.6, topo + 4.4);
    const funcao = (l.funcao ?? '').toUpperCase();
    doc.setFontSize(caber(doc, funcao, 47.5, 9));
    doc.text(funcao, 97.2, topo + 4.4);
    // Assinatura feita na tela: cabe na célula mantendo a proporção.
    if (l.assinatura) {
      try {
        const p = doc.getImageProperties(l.assinatura);
        const maxL = 196.0 - 145.9 - 2;
        const maxA = alturaLinha - 0.8;
        const escala = Math.min(maxL / p.width, maxA / p.height);
        const w = p.width * escala;
        const h = p.height * escala;
        doc.addImage(l.assinatura, 'PNG', 145.9 + 1 + (maxL - w) / 2, topo + 0.4 + (maxA - h) / 2, w, h);
      } catch {
        // imagem inválida: a linha fica em branco para assinar no papel
      }
    }
  }

  // Instrutor
  doc.setLineWidth(0.3);
  doc.line(64.9, 262.5, 152.4, 262.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${c.rotulo_instrutor}: ${dados.instrutor}`, 105.1, 266.6, { align: 'center' });
  doc.text(c.funcao_instrutor, 105.1, 271.0, { align: 'center' });
  doc.setFont('helvetica', 'normal');
}

export function gerarListaPresenca(JsPDFClasse: typeof JsPDF, modelo: ModeloLista, logo: string | null, dados: DadosLista): JsPDF {
  const doc = new JsPDFClasse({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const porPagina = Math.max(1, modelo.conteudo.linhas_por_pagina);
  let primeira = true;
  dados.empresas.forEach((e) => {
    const blocos: Linha[][] = [];
    for (let k = 0; k < Math.max(1, e.participantes.length); k += porPagina) blocos.push(e.participantes.slice(k, k + porPagina));
    blocos.forEach((bloco, n) => {
      if (!primeira) doc.addPage();
      primeira = false;
      folha(doc, modelo, logo, dados, e.empresa, bloco, n + 1, blocos.length);
    });
  });
  return doc;
}
