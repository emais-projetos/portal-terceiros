import { useEffect, useState } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { NOMES_SITUACAO_NC, avaliarNc, lerNcsDaVistoria, linksDosArquivos, notificarFornecedor, type NcCompleta, type Vistoria } from '../../lib/seguranca';
import { Fotos } from './comum';

export function seloNc(situacao: NcCompleta['situacao'] | 'sem') {
  if (situacao === 'sem') return <span className="selo selo-fila">não notificado</span>;
  const cor = situacao === 'regularizada' ? 'selo-ok' : situacao === 'respondida' ? 'selo-teste' : 'selo-erro';
  return <span className={`selo ${cor}`}>{NOMES_SITUACAO_NC[situacao]}</span>;
}

// Itens "não" da vistoria concluída: notificar o fornecedor responsável e avaliar o que ele respondeu.
export function NcsVistoria({
  v, empresaId, empresaNome, podeEditar, aoMensagem,
}: {
  v: Vistoria;
  empresaId: string | null;
  empresaNome: string;
  podeEditar: boolean;
  aoMensagem: (tipo: 'ok' | 'erro', texto: string) => void;
}) {
  const [ncs, setNcs] = useState<NcCompleta[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [notificando, setNotificando] = useState(false);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [recusando, setRecusando] = useState<NcCompleta | null>(null);
  const [motivo, setMotivo] = useState('');

  async function carregar() {
    const l = await lerNcsDaVistoria(v.id);
    setNcs(l);
    setLinks(await linksDosArquivos(l.flatMap((n) => n.resposta_fotos ?? [])));
  }

  useEffect(() => {
    carregar().catch((e) => aoMensagem('erro', mensagemDeErro(e as Error)));
  }, [v.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const naos = v.itens.map((it, i) => ({ it, i })).filter((x) => x.it.status === 'nao');
  if (!naos.length) return null;
  const porItem = new Map((ncs ?? []).map((n) => [n.item, n]));
  const pendentes = naos.filter((x) => !porItem.has(x.i));

  async function notificar() {
    setEnviando(true);
    try {
      const qtd = await notificarFornecedor(v.id, [...marcados]);
      setNotificando(false);
      await carregar();
      aoMensagem('ok', `${qtd} ${qtd === 1 ? 'item enviado' : 'itens enviados'} para ${empresaNome}. O fornecedor recebe o e-mail e responde pelo portal.`);
    } catch (e) {
      aoMensagem('erro', mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  async function avaliar(n: NcCompleta, aprovar: boolean, m: string | null) {
    try {
      await avaliarNc(n.id, aprovar, m);
      setRecusando(null);
      await carregar();
      aoMensagem('ok', aprovar ? 'Regularização aceita.' : 'Regularização não aceita. O fornecedor recebe o motivo por e-mail.');
    } catch (e) {
      aoMensagem('erro', mensagemDeErro(e as Error));
    }
  }

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Itens a regularizar</h2>
        {empresaId && podeEditar && pendentes.length > 0 && (
          <button
            type="button"
            className="botao botao-pequeno"
            onClick={() => {
              setMarcados(new Set(pendentes.map((x) => x.i)));
              setNotificando(true);
            }}
          >
            Notificar o fornecedor ({pendentes.length})
          </button>
        )}
      </div>
      {!empresaId && <p className="dica">Alojamento da Emais: os itens ficam com a própria equipe da obra, sem notificação a fornecedor.</p>}
      <ul className="lista-ncs">
        {naos.map(({ it, i }) => {
          const n = porItem.get(i);
          const vencido = n && (n.situacao === 'aberta' || n.situacao === 'reaberta') && diasAte(n.prazo) < 0;
          return (
            <li key={i}>
              <div className="vistoria-item-linha">
                <span>
                  <strong>{i + 1}.</strong> {it.texto}
                </span>
                {seloNc(n?.situacao ?? 'sem')}
              </div>
              <p className="sub">
                {(n?.recomendacao ?? it.recomendacao) || 'Sem recomendação'}
                {(n?.prazo ?? it.prazo) ? `. Prazo: ${data(n?.prazo ?? it.prazo)}` : ''}
                {vencido ? ' (vencido)' : ''}
              </p>
              {n?.motivo_reabertura && n.situacao === 'reaberta' && <p className="sub texto-erro">Não aceito: {n.motivo_reabertura}</p>}
              {n?.resposta && (
                <div className="resposta-fornecedor">
                  <span className="sub">Resposta do fornecedor em {data(n.respondida_em)}</span>
                  <p>{n.resposta}</p>
                  <Fotos caminhos={n.resposta_fotos ?? []} links={links} />
                </div>
              )}
              {n?.situacao === 'respondida' && podeEditar && (
                <div className="linha-botoes">
                  <button type="button" className="botao botao-pequeno" onClick={() => avaliar(n, true, null)}>Aceitar regularização</button>
                  <button
                    type="button"
                    className="botao botao-secundario botao-pequeno"
                    onClick={() => {
                      setMotivo('');
                      setRecusando(n);
                    }}
                  >
                    Não aceitar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialogo aberto={notificando} titulo={`Notificar ${empresaNome}`} aoFechar={() => setNotificando(false)}>
        <div className="formulario formulario-largo">
          <p className="dica">O fornecedor recebe um e-mail com os itens marcados e responde cada um pelo portal, com foto do que foi feito.</p>
          <ul className="lista-marcar">
            {pendentes.map(({ it, i }) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={marcados.has(i)}
                    onChange={() =>
                      setMarcados((s) => {
                        const c = new Set(s);
                        if (c.has(i)) c.delete(i);
                        else c.add(i);
                        return c;
                      })
                    }
                  />
                  <span>
                    {it.texto}
                    <small className="sub">{it.recomendacao || 'Sem recomendação'}{it.prazo ? `. Prazo: ${data(it.prazo)}` : ''}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="linha-botoes">
            <button type="button" className="botao" disabled={!marcados.size || enviando} onClick={notificar}>
              {enviando ? 'Enviando' : `Notificar ${marcados.size} ${marcados.size === 1 ? 'item' : 'itens'}`}
            </button>
            <button type="button" className="botao botao-discreto" onClick={() => setNotificando(false)}>Cancelar</button>
          </div>
        </div>
      </Dialogo>

      <Dialogo aberto={!!recusando} titulo="Não aceitar a regularização" aoFechar={() => setRecusando(null)}>
        <div className="formulario formulario-largo">
          <label className="campo">
            <span>O que ainda falta fazer</span>
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <div className="linha-botoes">
            <button type="button" className="botao" disabled={motivo.trim().length < 5} onClick={() => avaliar(recusando!, false, motivo.trim())}>Devolver ao fornecedor</button>
            <button type="button" className="botao botao-discreto" onClick={() => setRecusando(null)}>Cancelar</button>
          </div>
        </div>
      </Dialogo>
    </section>
  );
}
