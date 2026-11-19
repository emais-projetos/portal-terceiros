import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CampoFotos } from '../../componentes/CampoFotos';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { lerPendenciasEmais, linksDosArquivos, responderNc, type PendenciaEmais } from '../../lib/seguranca';
import { Fotos } from './comum';
import { seloNc } from './NcsVistoria';

const aberta = (n: PendenciaEmais) => n.situacao === 'aberta' || n.situacao === 'reaberta';

// Pendências da Emais (estrutura do alojamento da Emais e áreas comuns): a engenharia da obra conserta e responde
// com foto; o TST confere na vistoria e aceita ou devolve. Os dois acompanham esta mesma lista.
export function PendenciasEmais({ obraId, ehTst, aoMensagem }: { obraId: string; ehTst: boolean; aoMensagem: (tipo: 'ok' | 'erro', texto: string) => void }) {
  const [lista, setLista] = useState<PendenciaEmais[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  async function carregar() {
    const l = await lerPendenciasEmais(obraId);
    setLista(l);
    setLinks(await linksDosArquivos(l.flatMap((n) => [...(n.fotos_problema ?? []), ...(n.resposta_fotos ?? [])])).catch(() => ({})));
  }

  useEffect(() => {
    setLista(null);
    carregar().catch((e) => aoMensagem('erro', mensagemDeErro(e as Error)));
  }, [obraId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lista || lista.length === 0) return null;
  const abertas = lista.filter(aberta);
  const vencidas = abertas.filter((n) => diasAte(n.prazo) < 0).length;
  const emAvaliacao = lista.filter((n) => n.situacao === 'respondida');
  const feitas = lista.filter((n) => n.situacao === 'regularizada');

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">
          Pendências da Emais nos alojamentos {abertas.length > 0 && <span className="contador">{abertas.length}</span>}
        </h2>
        {vencidas > 0 && <span className="selo selo-erro">{vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}</span>}
      </div>
      <p className="dica">
        Estrutura do alojamento da Emais e áreas comuns. A engenharia da obra conserta e responde com foto; o TST confere e aceita ou devolve.
      </p>
      {abertas.length > 0 ? (
        <ul className="lista-ncs">
          {abertas.map((n) => (
            <Responder
              key={n.id}
              n={n}
              links={links}
              ehTst={ehTst}
              aoResponder={async () => {
                await carregar();
                aoMensagem('ok', ehTst ? 'Resposta registrada. Aceite ou devolva na vistoria.' : 'Resposta enviada. O TST confere e aceita ou devolve.');
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="vazio">Nenhuma pendência aberta.</p>
      )}
      {emAvaliacao.length > 0 && (
        <>
          <h3 className="detalhe-subtitulo">Aguardando o TST conferir</h3>
          <ul className="lista-ncs">
            {emAvaliacao.map((n) => (
              <li key={n.id}>
                <Cabecalho n={n} links={links} ehTst={ehTst} />
                <div className="resposta-fornecedor">
                  <span className="sub">Resposta em {data(n.respondida_em)}</span>
                  <p>{n.resposta}</p>
                  <Fotos caminhos={n.resposta_fotos ?? []} links={links} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {feitas.length > 0 && (
        <details className="detalhe-dobravel">
          <summary>Corrigidas nos últimos 60 dias ({feitas.length})</summary>
          <ul className="lista-ncs">
            {feitas.map((n) => (
              <li key={n.id}>
                <Cabecalho n={n} links={links} ehTst={ehTst} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Cabecalho({ n, links, ehTst }: { n: PendenciaEmais; links: Record<string, string>; ehTst: boolean }) {
  const dias = diasAte(n.prazo);
  return (
    <>
      <div className="vistoria-item-linha">
        <span>
          <strong>{n.alojamento}{n.quarto ? `, ${n.quarto}` : ''}</strong>
          <small className="sub"> vistoria de {data(n.data_vistoria)}</small>
        </span>
        {seloNc(n.situacao, true)}
      </div>
      <p className="nc-descricao">{n.descricao}</p>
      {n.recomendacao && <p className="sub">O que fazer: {n.recomendacao}</p>}
      <p className={`sub${aberta(n) && dias < 0 ? ' texto-erro' : ''}`}>
        Prazo: {data(n.prazo)}
        {aberta(n) ? (dias < 0 ? ` (vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'})` : dias === 0 ? ' (vence hoje)' : ` (faltam ${dias} ${dias === 1 ? 'dia' : 'dias'})`) : ''}
      </p>
      {n.situacao === 'reaberta' && n.motivo_reabertura && <p className="aviso aviso-erro">Não aceito: {n.motivo_reabertura}</p>}
      {n.fotos_problema?.length > 0 && (
        <>
          <span className="sub">Fotos do problema</span>
          <Fotos caminhos={n.fotos_problema} links={links} />
        </>
      )}
      {ehTst && (
        <p className="sub">
          <Link to={`/seguranca/vistoria/${n.vistoria_id}`}>Abrir a vistoria</Link>
        </p>
      )}
    </>
  );
}

function Responder({ n, links: linksBase, ehTst, aoResponder }: { n: PendenciaEmais; links: Record<string, string>; ehTst: boolean; aoResponder: () => Promise<void> }) {
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
      <Cabecalho n={n} links={linksBase} ehTst={ehTst} />
      <div className="responder-nc">
        <label className="campo">
          <span>O que foi feito</span>
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva o conserto" />
        </label>
        <div className="campo">
          <span>Fotos do conserto (até 5)</span>
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
