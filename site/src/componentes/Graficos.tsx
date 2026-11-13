import { useEffect, useRef, useState, type ReactNode } from 'react';

// Gráficos simples em SVG, numa cor só (a série é dita pelo título do gráfico).
// Linhas de grade finas, colunas de até 24px com ponta arredondada, valor no topo só da última coluna
// e o resto no passar do mouse. Cada gráfico leva uma tabela escondida para leitor de tela.

const COR = '#1E756A';
const GRADE = '#e3e9f1';
const TINTA = '#2f4858';
const SUAVE = '#4f6574';

function useLargura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.max(260, e.contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largura];
}

export type Ponto = { rotulo: string; valor: number | null; dica?: string };

function tetoLimpo(v: number): number {
  if (v <= 0) return 1;
  const pot = 10 ** Math.floor(Math.log10(v));
  const n = v / pot;
  const passo = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return passo * pot;
}

export function Colunas({
  titulo, dados, formatar, meta, rotuloMeta, maximo, vazio = '', nota,
}: {
  titulo: string;
  nota?: ReactNode;
  dados: Ponto[];
  formatar: (v: number) => string;
  meta?: number;
  rotuloMeta?: string;
  maximo?: number;
  vazio?: string;
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const altura = 190;
  const m = { topo: 22, dir: 12, base: 26, esq: 38 };
  const area = { l: largura - m.esq - m.dir, a: altura - m.topo - m.base };
  const maiorValor = Math.max(0, ...dados.map((d) => d.valor ?? 0), meta ?? 0);
  const teto = maximo ?? tetoLimpo(maiorValor * 1.1);
  const y = (v: number) => m.topo + area.a - (v / teto) * area.a;
  const banda = area.l / Math.max(1, dados.length);
  const larguraColuna = Math.min(24, banda * 0.55);
  const ticks = [0, teto / 2, teto];
  const ultimoComValor = dados.map((d) => d.valor !== null).lastIndexOf(true);

  return (
    <figure className="grafico" ref={ref}>
      <figcaption className="grafico-titulo">
        <span>{titulo}</span>
        {meta !== undefined && (
          <span className="grafico-meta">
            <i aria-hidden="true" /> {rotuloMeta ?? `meta ${formatar(meta)}`}
          </span>
        )}
      </figcaption>
      <svg width={largura} height={altura} role="img" aria-label={titulo}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.esq} x2={largura - m.dir} y1={y(t)} y2={y(t)} stroke={GRADE} strokeWidth={1} />
            <text x={m.esq - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={SUAVE}>{formatar(t)}</text>
          </g>
        ))}
        {meta !== undefined && (
          <g>
            <line x1={m.esq} x2={largura - m.dir} y1={y(meta)} y2={y(meta)} stroke={TINTA} strokeWidth={1.5} strokeDasharray="5 4" />
          </g>
        )}
        {dados.map((d, i) => {
          const cx = m.esq + banda * i + banda / 2;
          const x = cx - larguraColuna / 2;
          const base = y(0);
          const temValor = d.valor !== null;
          const topo = temValor ? y(d.valor!) : base;
          const h = base - topo;
          const r = Math.min(4, h / 2, larguraColuna / 2);
          return (
            <g key={d.rotulo} onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)}>
              <rect x={cx - banda / 2} y={m.topo} width={banda} height={area.a} fill={foco === i ? '#f5f8fe' : 'transparent'} />
              {temValor && h > 0 && (
                <path
                  d={`M${x},${base} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + larguraColuna - r} Q${x + larguraColuna},${topo} ${x + larguraColuna},${topo + r} V${base} Z`}
                  fill={COR}
                />
              )}
              {!temValor && vazio && (
                <text x={cx} y={base - 6} textAnchor="middle" fontSize={10} fill={SUAVE}>{vazio}</text>
              )}
              {temValor && (i === ultimoComValor || foco === i) && (
                <text x={cx} y={topo - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={TINTA}>{formatar(d.valor!)}</text>
              )}
              <text x={cx} y={altura - 8} textAnchor="middle" fontSize={11} fill={SUAVE}>{d.rotulo}</text>
            </g>
          );
        })}
      </svg>
      {nota && <p className="grafico-nota">{nota}</p>}
      {foco !== null && dados[foco].dica && (
        <div className="grafico-dica" style={{ left: Math.min(largura - 200, Math.max(0, m.esq + banda * foco + banda / 2 - 100)) }}>
          <strong>{dados[foco].rotulo}</strong>
          <span>{dados[foco].dica}</span>
        </div>
      )}
      <div className="sr">
      <table>
        <caption>{titulo}</caption>
        <tbody>
          {dados.map((d) => (
            <tr key={d.rotulo}>
              <th scope="row">{d.rotulo}</th>
              <td>{d.valor === null ? 'sem dado' : formatar(d.valor)}</td>
              <td>{d.dica}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

// Barras horizontais com o valor na ponta. Boas para ranking de itens e documentos.
export function Barras({ titulo, dados, formatar, detalhe }: { titulo: string; dados: { rotulo: string; valor: number; dica?: string }[]; formatar: (v: number) => string; detalhe?: ReactNode }) {
  const maior = Math.max(1, ...dados.map((d) => d.valor));
  return (
    <figure className="grafico">
      <figcaption className="grafico-titulo">{titulo}</figcaption>
      {detalhe}
      {dados.length === 0 ? (
        <p className="dica">Nada a mostrar no filtro escolhido.</p>
      ) : (
        <ul className="barras">
          {dados.map((d) => (
            <li key={d.rotulo} title={d.dica}>
              <span className="barras-rotulo">{d.rotulo}</span>
              <span className="barras-trilho">
                <span className="barras-barra" style={{ width: `${Math.max(1.5, (100 * d.valor) / maior)}%` }} />
                <span className="barras-valor">{formatar(d.valor)}</span>
              </span>
              {d.dica && <span className="sr">{d.dica}</span>}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export function Cartao({ rotulo, valor, apoio, alerta }: { rotulo: string; valor: string; apoio?: ReactNode; alerta?: boolean }) {
  return (
    <div className={`cartao${alerta ? ' cartao-alerta' : ''}`}>
      <span className="cartao-rotulo">{rotulo}</span>
      <strong className="cartao-valor">{valor}</strong>
      {apoio && <span className="cartao-apoio">{apoio}</span>}
    </div>
  );
}
