import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { formatarCnpj } from '../lib/consultas';
import { mesCurto, rotuloMedicao, type StatusMedicao } from '../lib/medicao';

// Grade de medição empresa × mês, como na planilha de controle.
// Usada no administrativo (Medição, Histórico por empresa) e no Painel da obra.

export type ItemGrade = {
  id: string;
  empresa_id: string;
  empresa: string;
  cnpj: string;
  obra: string | null;
  competencia: string;
  status: StatusMedicao;
  retida: boolean;
  pendentes: number;
  dispensada?: boolean;
  motivo_dispensa?: string | null;
};

type Estado = 'aprovada' | 'dispensada' | 'em_analise' | 'pendente' | 'retida';

function estadoDe(m: ItemGrade): Estado {
  if (m.dispensada) return 'dispensada';
  if (m.status === 'aprovada') return 'aprovada';
  if (m.status === 'em_analise') return 'em_analise';
  return m.retida ? 'retida' : 'pendente';
}

const ROTULO: Record<Estado, string> = { aprovada: 'OK', dispensada: 'Disp.', em_analise: 'Conferir', pendente: 'Pendente', retida: 'Retida' };
const LEGENDA: Record<Estado, string> = {
  aprovada: 'Aprovada',
  dispensada: 'Dispensada pela Emais (ex.: sem atuação na obra no mês)',
  em_analise: 'Enviada, aguardando conferência',
  pendente: 'Com pendência, dentro do prazo ou da tolerância (dia 30)',
  retida: 'Retida: não aprovada depois do dia 30 ou da data combinada',
};

type Linha = { empresa_id: string; empresa: string; cnpj: string; porMes: Map<string, ItemGrade[]>; total: number; aprovadas: number; retidas: number };

type Props = {
  itens: ItemGrade[];
  // Filtros extras à esquerda dos padrões (o administrativo põe o de obra).
  filtrosExtras?: ReactNode;
  // Célula clicável: o administrativo abre a medição, o painel leva ao mês.
  celula: (m: ItemGrade, conteudo: ReactNode, props: { className: string; title: string; 'aria-label': string }) => ReactNode;
  textoAjuda?: string;
};

export function GradeMedicao({ itens, filtrosExtras, celula, textoAjuda }: Props) {
  const [busca, setBusca] = useState('');
  const [soPendencia, setSoPendencia] = useState(false);
  const [ordem, setOrdem] = useState<'nome' | 'retidas'>('nome');

  const meses = useMemo(() => [...new Set(itens.map((m) => m.competencia))].sort(), [itens]);

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const porEmpresa = new Map<string, Linha>();
    itens.forEach((m) => {
      const l = porEmpresa.get(m.empresa_id) ?? { empresa_id: m.empresa_id, empresa: m.empresa, cnpj: m.cnpj, porMes: new Map(), total: 0, aprovadas: 0, retidas: 0 };
      l.porMes.set(m.competencia, [...(l.porMes.get(m.competencia) ?? []), m]);
      l.total += 1;
      if (m.status === 'aprovada') l.aprovadas += 1;
      if (m.retida) l.retidas += 1;
      porEmpresa.set(m.empresa_id, l);
    });
    return [...porEmpresa.values()]
      .filter((l) => !t || l.empresa.toLowerCase().includes(t) || l.cnpj.includes(t.replace(/\D/g, '') || '§'))
      .filter((l) => !soPendencia || l.aprovadas < l.total)
      .sort((a, b) => (ordem === 'retidas' ? b.retidas - a.retidas : 0) || a.empresa.localeCompare(b.empresa, 'pt-BR'));
  }, [itens, busca, soPendencia, ordem]);

  const totaisMes = meses.map((c) => {
    const l = linhas.flatMap((x) => x.porMes.get(c) ?? []);
    return { c, total: l.length, aprovadas: l.filter((m) => m.status === 'aprovada').length };
  });

  return (
    <>
      <div className="filtros">
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Empresa ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        {filtrosExtras}
        <label className="campo">
          <span>Ordem</span>
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as 'nome' | 'retidas')}>
            <option value="nome">Nome da empresa</option>
            <option value="retidas">Mais meses retidos primeiro</option>
          </select>
        </label>
        <label className="opcao opcao-filtro">
          <input type="checkbox" checked={soPendencia} onChange={(e) => setSoPendencia(e.target.checked)} />
          <span>Só empresas com algum mês não aprovado</span>
        </label>
      </div>

      <ul className="legenda">
        {(Object.keys(LEGENDA) as Estado[]).map((e) => (
          <li key={e}>
            <span className={`celula celula-${e}`}>{ROTULO[e]}</span> {LEGENDA[e]}
          </li>
        ))}
        <li>
          <span className="celula celula-vazia" /> Sem medição no mês
        </li>
      </ul>

      <p className="dica">
        {linhas.length} {linhas.length === 1 ? 'empresa' : 'empresas'}. {textoAjuda}
      </p>

      <div className="tabela-rolagem">
        <table className="tabela tabela-compacta tabela-historico">
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              {meses.map((c) => (
                <th key={c} scope="col">{mesCurto(c)}</th>
              ))}
              <th scope="col" className="num">Aprovadas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr>
                <td colSpan={meses.length + 2} className="vazio-linha">Nenhuma empresa no filtro.</td>
              </tr>
            )}
            {linhas.map((l) => (
              <tr key={l.empresa_id}>
                <th scope="row">
                  {l.empresa}
                  <small className="sub">{formatarCnpj(l.cnpj)}</small>
                </th>
                {meses.map((c) => {
                  const doMes = (l.porMes.get(c) ?? []).sort((a, b) => (a.obra ?? '').localeCompare(b.obra ?? '', 'pt-BR'));
                  return (
                    <td key={c}>
                      {doMes.length === 0 ? (
                        <span className="celula celula-vazia" aria-label="Sem medição" />
                      ) : (
                        <span className="celulas">
                          {doMes.map((m) => {
                            const e = estadoDe(m);
                            const descricao = `${m.obra ?? 'Planilha, sem obra'}: ${rotuloMedicao(m)}${m.dispensada && m.motivo_dispensa ? ` (${m.motivo_dispensa})` : ''}${m.retida ? ', retida' : ''}${m.status !== 'aprovada' && m.pendentes ? `, ${m.pendentes} itens pendentes` : ''}`;
                            return <Fragment key={m.id}>{celula(m, ROTULO[e], { className: `celula celula-${e}`, title: descricao, 'aria-label': `${mesCurto(c)}, ${descricao}` })}</Fragment>;
                          })}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="num">
                  {l.aprovadas} de {l.total}
                </td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row">Aprovadas no mês</th>
                {totaisMes.map((t) => (
                  <td key={t.c}>
                    {t.total ? `${Math.round((100 * t.aprovadas) / t.total)}%` : ''}
                    {t.total > 0 && <small className="sub">{t.aprovadas} de {t.total}</small>}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
