import { useEffect, useState } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { CampoFotos } from '../../componentes/CampoFotos';
import { Barras, Cartao, Colunas } from '../../componentes/Graficos';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { classificar } from '../../lib/indicadoresSeguranca';
import { lerResumoFornecedor, linksDosArquivos, responderNc, type AcaoFornecedor, type ResumoFornecedor } from '../../lib/seguranca';
import { Fotos } from '../seguranca/comum';
import { seloNc } from '../seguranca/NcsVistoria';
import { SeletorPeriodo, inicioPeriodo, mesCurto, mesesDesde, porcento } from '../seguranca/PainelConformidade';

// Fornecedor: painel dos alojamentos da empresa (só conformidade e itens que mais falham) e as correções a responder.
// A vistoria completa fica com a Segurança do Trabalho da Emais.
export function AlojamentosFornecedor() {
  const [meses, setMeses] = useState(6);
  const desde = inicioPeriodo(meses);
  const [r, setR] = useState<ResumoFornecedor | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function carregar() {
    const x = await lerResumoFornecedor(desde);
    setR(x);
    setLinks(await linksDosArquivos(x.acoes.flatMap((n) => n.resposta_fotos ?? [])));
  }

  useEffect(() => {
    setR(null);
    carregar().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [desde]); // eslint-disable-line react-hooks/exhaustive-deps

  const acoes = r?.acoes ?? [];
  const abertas = acoes.filter((n) => n.situacao === 'aberta' || n.situacao === 'reaberta');
  const vencidas = abertas.filter((n) => diasAte(n.prazo) < 0).length;
  const emAvaliacao = acoes.filter((n) => n.situacao === 'respondida');
  const regularizadas = acoes.filter((n) => n.situacao === 'regularizada');
  const comNota = r?.alojamentos.filter((a) => a.pct !== null) ?? [];
  const abaixo = r ? comNota.filter((a) => (a.pct ?? 0) < r.meta).length : 0;

  return (
    <Pagina titulo="Alojamentos" apoio="Conformidade dos alojamentos sob responsabilidade da sua empresa e os itens que a Segurança do Trabalho pediu para corrigir.">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!r && !erro && <Carregando />}

      {r && (
        <>
          <section className="bloco">
            <h2 className="bloco-titulo">Itens a corrigir {abertas.length > 0 && <span className="contador">{abertas.length}</span>}</h2>
            {abertas.length === 0 ? (
              <p className="vazio">Nenhum item pendente. Quando a vistoria apontar algo para corrigir, ele aparece aqui, com o prazo.</p>
            ) : (
              <ul className="lista-ncs">
                {abertas.map((n) => (
                  <ItemParaResponder
                    key={n.id}
                    n={n}
                    aoResponder={async () => {
                      await carregar();
                      setOk('Resposta enviada. A Segurança do Trabalho avalia e, se precisar, devolve com o que falta.');
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {emAvaliacao.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">Aguardando avaliação da Segurança do Trabalho</h2>
              <ul className="lista-ncs">
                {emAvaliacao.map((n) => (
                  <li key={n.id}>
                    <CabecalhoNc n={n} />
                    <div className="resposta-fornecedor">
                      <span className="sub">Sua resposta em {data(n.respondida_em)}</span>
                      <p>{n.resposta}</p>
                      <Fotos caminhos={n.resposta_fotos ?? []} links={links} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="bloco">
            <h2 className="bloco-titulo">Conformidade</h2>
            <div className="filtros">
              <SeletorPeriodo meses={meses} aoMudar={setMeses} />
              <p className="dica">Conformidade = itens em ordem sobre os itens que se aplicam. Meta da Emais: {r.meta}%.</p>
            </div>
            <div className="cartoes">
              <Cartao
                rotulo="Conformidade no período"
                valor={r.periodo.conformidade === null ? 'Sem vistoria' : porcento(r.periodo.conformidade)}
                alerta={r.periodo.conformidade !== null && r.periodo.conformidade < r.meta}
                apoio={`Meta: ${r.meta}%. ${r.periodo.vistorias} ${r.periodo.vistorias === 1 ? 'vistoria' : 'vistorias'} no período.`}
              />
              <Cartao rotulo="Alojamentos abaixo da meta" valor={`${abaixo} de ${comNota.length}`} alerta={abaixo > 0} apoio="Pela última vistoria de cada alojamento." />
              <Cartao rotulo="Itens a corrigir" valor={String(abertas.length)} alerta={vencidas > 0} apoio={`${vencidas} com prazo vencido.`} />
            </div>
            <div className="duas-colunas graficos">
              <Colunas
                titulo="Conformidade por mês"
                dados={mesesDesde(desde).map((m) => {
                  const x = r.periodo.meses.find((y) => y.mes === m);
                  return { rotulo: mesCurto(m), valor: x?.pct ?? null, dica: x ? `${x.qtd} ${x.qtd === 1 ? 'vistoria' : 'vistorias'}` : 'Sem vistoria' };
                })}
                formatar={porcento}
                maximo={100}
                meta={r.meta}
                rotuloMeta={`meta ${r.meta}%`}
                vazio="-"
              />
              <Barras
                titulo="Por alojamento (última vistoria)"
                dados={comNota.map((a) => ({ rotulo: `${a.nome} (${a.obra})`, valor: a.pct ?? 0, dica: `${classificar(a.pct ?? 0)}, ${data(a.data)}` }))}
                formatar={porcento}
              />
              {r.periodo.mais_nao.length > 0 && (
                <Barras titulo="Itens que mais aparecem como não conformes" dados={r.periodo.mais_nao.map((p) => ({ rotulo: p.texto, valor: p.qtd }))} formatar={(v) => `${v}x`} />
              )}
            </div>
            {r.alojamentos.length === 0 && <p className="vazio">Nenhum alojamento ligado à sua empresa.</p>}
          </section>

          {regularizadas.length > 0 && (
            <details className="bloco detalhe-dobravel">
              <summary>Itens já corrigidos ({regularizadas.length})</summary>
              <ul className="lista-ncs">
                {regularizadas.map((n) => (
                  <li key={n.id}>
                    <CabecalhoNc n={n} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Pagina>
  );
}

function CabecalhoNc({ n }: { n: AcaoFornecedor }) {
  const aberta = n.situacao === 'aberta' || n.situacao === 'reaberta';
  const dias = diasAte(n.prazo);
  return (
    <>
      <div className="vistoria-item-linha">
        <span>
          <strong>{n.alojamento}</strong>
          <small className="sub"> {n.obra}</small>
        </span>
        {seloNc(n.situacao)}
      </div>
      <p className="nc-descricao">{n.descricao}</p>
      {n.recomendacao && <p className="sub">O que fazer: {n.recomendacao}</p>}
      <p className={`sub${aberta && dias < 0 ? ' texto-erro' : ''}`}>
        Prazo: {data(n.prazo)}
        {aberta ? (dias < 0 ? ` (vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'})` : dias === 0 ? ' (vence hoje)' : ` (faltam ${dias} ${dias === 1 ? 'dia' : 'dias'})`) : ''}
      </p>
      {n.situacao === 'reaberta' && n.motivo_reabertura && <p className="aviso aviso-erro">Não aceito: {n.motivo_reabertura}</p>}
    </>
  );
}

function ItemParaResponder({ n, aoResponder }: { n: AcaoFornecedor; aoResponder: () => Promise<void> }) {
  const [texto, setTexto] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      await responderNc(n.id, texto.trim(), fotos);
      await aoResponder();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <li>
      <CabecalhoNc n={n} />
      <div className="responder-nc">
        <label className="campo">
          <span>O que foi feito</span>
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva a correção" />
        </label>
        <div className="campo">
          <span>Fotos da correção (até 5)</span>
          <CampoFotos
            pasta={`nc/${n.id}`}
            fotos={fotos}
            links={links}
            aoMudar={(f, novos) => {
              setLinks((l) => ({ ...l, ...novos }));
              setFotos(f);
            }}
          />
        </div>
        {erro && <p className="texto-erro">{erro}</p>}
        <button type="button" className="botao" disabled={texto.trim().length < 5 || enviando} onClick={enviar}>
          {enviando ? 'Enviando' : 'Enviar resposta'}
        </button>
      </div>
    </li>
  );
}
