import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { data, diasAte } from '../../lib/formato';
import { lerMeusAlojamentos, lerMinhasNcs, type AlojamentoFornecedor, type NcFornecedor } from '../../lib/seguranca';
import { SeloClassificacao } from '../seguranca/comum';

function useAlojamentosFornecedor() {
  const [dados, setDados] = useState<{ alojamentos: AlojamentoFornecedor[]; ncs: NcFornecedor[] } | null>(null);
  useEffect(() => {
    Promise.all([lerMeusAlojamentos(), lerMinhasNcs()])
      .then(([alojamentos, ncs]) => setDados({ alojamentos, ncs }))
      .catch(() => setDados({ alojamentos: [], ncs: [] }));
  }, []);
  return dados;
}

const abertaNc = (n: NcFornecedor) => n.situacao === 'aberta' || n.situacao === 'reaberta';

// Tela inicial do fornecedor: alojamentos sob responsabilidade da empresa e o que está pendente.
export function ResumoAlojamentos() {
  const dados = useAlojamentosFornecedor();
  if (!dados || dados.alojamentos.length === 0) return null;
  const abertas = dados.ncs.filter(abertaNc);
  const vencidas = abertas.filter((n) => diasAte(n.prazo) < 0).length;

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Alojamentos sob sua responsabilidade</h2>
        <Link to="/alojamentos" className="link-forte">Ver alojamentos ›</Link>
      </div>
      {abertas.length > 0 && (
        <div className="faixa-retido faixa-alojamento" role="alert">
          <div>
            <span>
              <strong>
                {abertas.length} {abertas.length === 1 ? 'item a regularizar' : 'itens a regularizar'} nos alojamentos
                {vencidas ? ` (${vencidas} com prazo vencido)` : ''}
              </strong>
              Responda cada item pelo portal, com foto do que foi feito. A Segurança do Trabalho da Emais avalia a resposta.
            </span>
          </div>
          <Link className="botao" to="/alojamentos">Responder</Link>
        </div>
      )}
      <ul className="lista-inspecoes">
        {dados.alojamentos.map((a) => {
          const ultima = a.vistorias[0];
          const pend = abertas.filter((n) => n.vistoria?.alojamento?.nome === a.nome).length;
          const conteudo = (
            <>
              <span className="inspecao-data">
                {ultima ? data(ultima.data_vistoria) : '-'}
                <small>{ultima ? 'última vistoria' : 'sem vistoria'}</small>
              </span>
              <span className="inspecao-local">
                <strong>{a.nome}</strong>
                <small>{a.obra.nome}</small>
                {pend > 0 && <small className="texto-alerta">{pend} {pend === 1 ? 'item a regularizar' : 'itens a regularizar'}</small>}
              </span>
              <span className="inspecao-situacao">
                {ultima && <SeloClassificacao v={ultima} />}
                {ultima?.pontuacao != null && <small className="sub"> {Math.round(ultima.pontuacao * 100)}%</small>}
              </span>
            </>
          );
          return (
            <li key={a.id}>
              {ultima ? (
                <Link to={`/alojamentos/vistoria/${ultima.id}`} className="inspecao-linha">
                  {conteudo}
                  <span className="inspecao-abrir" aria-hidden="true">Abrir ›</span>
                </Link>
              ) : (
                <div className="inspecao-linha">{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// "O que falta": itens de alojamento a regularizar, com prazo.
export function PendenciasAlojamento() {
  const dados = useAlojamentosFornecedor();
  if (!dados) return null;
  const abertas = dados.ncs.filter(abertaNc).sort((a, b) => a.prazo.localeCompare(b.prazo));
  if (!abertas.length) return null;
  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Alojamentos: itens a regularizar <span className="contador">{abertas.length}</span></h2>
        <Link className="botao botao-pequeno" to="/alojamentos">Responder</Link>
      </div>
      <ul className="lista-ncs">
        {abertas.map((n) => {
          const dias = diasAte(n.prazo);
          return (
            <li key={n.id}>
              <div className="vistoria-item-linha">
                <span>
                  <strong>{n.vistoria?.alojamento?.nome ?? 'Alojamento'}</strong>
                  <small className="sub"> {n.vistoria?.obra?.nome}</small>
                </span>
                <span className={`selo ${dias < 0 ? 'selo-erro' : 'selo-teste'}`}>
                  {dias < 0 ? `vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'}` : dias === 0 ? 'vence hoje' : `prazo ${data(n.prazo)}`}
                </span>
              </div>
              <p className="nc-descricao">{n.descricao}</p>
              {n.recomendacao && <p className="sub">O que fazer: {n.recomendacao}</p>}
              {n.situacao === 'reaberta' && n.motivo_reabertura && <p className="sub texto-erro">Não aceito: {n.motivo_reabertura}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
