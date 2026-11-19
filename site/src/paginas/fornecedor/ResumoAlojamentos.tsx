import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { data, diasAte } from '../../lib/formato';
import { classificar } from '../../lib/indicadoresSeguranca';
import { lerResumoFornecedor, type AcaoFornecedor, type ResumoFornecedor } from '../../lib/seguranca';
import { inicioPeriodo } from '../seguranca/PainelConformidade';

function useResumoFornecedor() {
  const [r, setR] = useState<ResumoFornecedor | null>(null);
  useEffect(() => {
    lerResumoFornecedor(inicioPeriodo(6))
      .then((x) => setR(x && Array.isArray(x.acoes) && Array.isArray(x.alojamentos) ? x : null))
      .catch(() => setR(null));
  }, []);
  return r;
}

const aberta = (n: AcaoFornecedor) => n.situacao === 'aberta' || n.situacao === 'reaberta';

// Tela inicial do fornecedor: conformidade de cada alojamento da empresa e as correções pendentes.
export function ResumoAlojamentos() {
  const r = useResumoFornecedor();
  if (!r || r.alojamentos.length === 0) return null;
  const abertas = r.acoes.filter(aberta);
  const vencidas = abertas.filter((n) => diasAte(n.prazo) < 0).length;

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Alojamentos sob sua responsabilidade</h2>
        <Link to="/alojamentos" className="link-forte">Ver conformidade ›</Link>
      </div>
      {abertas.length > 0 && (
        <div className="faixa-retido faixa-alojamento" role="alert">
          <div>
            <span>
              <strong>
                {abertas.length} {abertas.length === 1 ? 'item a corrigir' : 'itens a corrigir'} nos alojamentos
                {vencidas ? ` (${vencidas} com prazo vencido)` : ''}
              </strong>
              Responda cada item pelo portal, com foto do que foi feito. A Segurança do Trabalho da Emais avalia a resposta.
            </span>
          </div>
          <Link className="botao" to="/alojamentos">Responder</Link>
        </div>
      )}
      <ul className="lista-inspecoes">
        {r.alojamentos.map((a) => {
          const pend = abertas.filter((n) => n.alojamento === a.nome && n.obra === a.obra).length;
          const abaixo = a.pct !== null && a.pct < r.meta;
          return (
            <li key={a.id}>
              <div className="inspecao-linha">
                <span className="inspecao-data">
                  {a.data ? data(a.data) : '-'}
                  <small>{a.data ? 'última vistoria' : 'sem vistoria'}</small>
                </span>
                <span className="inspecao-local">
                  <strong>{a.nome}</strong>
                  <small>{a.obra}</small>
                  {pend > 0 && <small className="texto-alerta">{pend} {pend === 1 ? 'item a corrigir' : 'itens a corrigir'}</small>}
                </span>
                <span className="inspecao-situacao">
                  {a.pct !== null && (
                    <>
                      <span className={`selo ${abaixo ? 'selo-erro' : 'selo-ok'}`}>{classificar(a.pct)}</span>
                      <small className={`sub${abaixo ? ' texto-erro' : ''}`}> {Math.round(a.pct)}%</small>
                    </>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// "O que falta": itens de alojamento a corrigir, com prazo.
export function PendenciasAlojamento() {
  const r = useResumoFornecedor();
  if (!r) return null;
  const abertas = r.acoes.filter(aberta).sort((a, b) => a.prazo.localeCompare(b.prazo));
  if (!abertas.length) return null;
  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Alojamentos: itens a corrigir <span className="contador">{abertas.length}</span></h2>
        <Link className="botao botao-pequeno" to="/alojamentos">Responder</Link>
      </div>
      <ul className="lista-ncs">
        {abertas.map((n) => {
          const dias = diasAte(n.prazo);
          return (
            <li key={n.id}>
              <div className="vistoria-item-linha">
                <span>
                  <strong>{n.alojamento}{n.quarto ? `, ${n.quarto}` : ''}</strong>
                  <small className="sub"> {n.obra}</small>
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
