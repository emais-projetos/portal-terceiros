import { useEffect, useState } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { NOMES_SITUACAO_NC, avaliarNc, lerNcsDaVistoria, linksDosArquivos, notificarFornecedor, type Fornecedor, type NcCompleta, type Vistoria } from '../../lib/seguranca';
import { responsavelItemQuarto } from './VistoriaQuartos';
import { Fotos } from './comum';

export function seloNc(situacao: NcCompleta['situacao'] | 'sem', emais = false) {
  if (situacao === 'sem') return <span className="selo selo-fila">não enviado</span>;
  const cor = situacao === 'regularizada' ? 'selo-ok' : situacao === 'respondida' ? 'selo-teste' : 'selo-erro';
  const texto = emais && (situacao === 'aberta' || situacao === 'reaberta') ? NOMES_SITUACAO_NC[situacao].replace('o fornecedor', 'a engenharia') : NOMES_SITUACAO_NC[situacao];
  return <span className={`selo ${cor}`}>{texto}</span>;
}

const EMAIS = 'Emais (engenharia da obra)';

// Itens "não" da vistoria concluída: enviar para quem corrige (fornecedor, empresas do quarto ou a engenharia, quando é
// da Emais) e avaliar o que foi respondido.
export function NcsVistoria({
  v, naObra = false, empresaId, empresaNome, fornecedores = [], podeEditar, aoMensagem,
}: {
  v: Vistoria;
  naObra?: boolean;
  empresaId: string | null;
  empresaNome: string;
  fornecedores?: Fornecedor[];
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
  const doItem = (i: number) => (ncs ?? []).filter((n) => n.item === i);
  const pendentes = naos.filter((x) => doItem(x.i).length === 0);
  const destino = (i: number) => {
    const it = v.itens[i];
    if (naObra) return responsavelItemQuarto(it, v.funcionarios);
    return empresaId ? empresaNome : EMAIS;
  };
  const nomeEmpresa = (id: string | null) =>
    !id ? EMAIS : fornecedores.find((f) => f.id === id)?.nome ?? v.funcionarios.find((p) => p.empresa_id === id)?.empresa ?? 'Fornecedor';

  async function notificar() {
    setEnviando(true);
    try {
      const qtd = await notificarFornecedor(v.id, [...marcados]);
      setNotificando(false);
      await carregar();
      aoMensagem('ok', `${qtd} ${qtd === 1 ? 'item enviado' : 'itens enviados'}. Fornecedor responde no portal, em Alojamentos; o que é da Emais aparece para a engenharia da obra em Segurança da obra.`);
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
      aoMensagem('ok', aprovar ? 'Regularização aceita.' : 'Regularização não aceita. O item volta para quem respondeu, com o motivo.');
    } catch (e) {
      aoMensagem('erro', mensagemDeErro(e as Error));
    }
  }

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Itens a regularizar</h2>
        {podeEditar && pendentes.length > 0 && (
          <button
            type="button"
            className="botao botao-pequeno"
            onClick={() => {
              setMarcados(new Set(pendentes.map((x) => x.i)));
              setNotificando(true);
            }}
          >
            Enviar itens a corrigir ({pendentes.length})
          </button>
        )}
      </div>
      {pendentes.length > 0 && <p className="dica">Os itens da Emais vão para a engenharia da obra, que responde com foto do conserto. Você aceita ou devolve.</p>}
      <ul className="lista-ncs">
        {naos.map(({ it, i }) => {
          const lista = doItem(i);
          return (
            <li key={i}>
              <div className="vistoria-item-linha">
                <span>
                  {it.quarto && <strong>{it.quarto}: </strong>}
                  {it.texto}
                </span>
                {lista.length === 0 && seloNc('sem')}
              </div>
              <p className="sub">
                {it.recomendacao || 'Sem recomendação'}
                {it.prazo ? `. Prazo: ${data(it.prazo)}` : ''}
                {lista.length === 0 ? `. Vai para: ${destino(i)}` : ''}
              </p>
              {lista.map((n) => {
                const vencido = (n.situacao === 'aberta' || n.situacao === 'reaberta') && diasAte(n.prazo) < 0;
                return (
                  <div key={n.id} className="nc-destino">
                    <div className="vistoria-item-linha">
                      <span className="sub">
                        {nomeEmpresa(n.empresa_id)}. Prazo: {data(n.prazo)}{vencido ? ' (vencido)' : ''}
                      </span>
                      {seloNc(n.situacao, !n.empresa_id)}
                    </div>
                    {n.motivo_reabertura && n.situacao === 'reaberta' && <p className="sub texto-erro">Não aceito: {n.motivo_reabertura}</p>}
                    {n.resposta && (
                      <div className="resposta-fornecedor">
                        <span className="sub">Resposta em {data(n.respondida_em)}</span>
                        <p>{n.resposta}</p>
                        <Fotos caminhos={n.resposta_fotos ?? []} links={links} />
                      </div>
                    )}
                    {n.situacao === 'respondida' && podeEditar && (
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
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>

      <Dialogo aberto={notificando} titulo="Enviar itens a corrigir" aoFechar={() => setNotificando(false)}>
        <div className="formulario formulario-largo">
          <p className="dica">Fornecedor vê o item no portal (menu Alojamentos); o que é da Emais aparece para a engenharia da obra. Cada um responde com foto do que foi feito.</p>
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
                    {it.quarto ? `${it.quarto}: ` : ''}{it.texto}
                    <small className="sub">Vai para: {destino(i)}. {it.recomendacao || 'Sem recomendação'}{it.prazo ? `. Prazo: ${data(it.prazo)}` : ''}</small>
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
            <button type="button" className="botao" disabled={motivo.trim().length < 5} onClick={() => avaliar(recusando!, false, motivo.trim())}>Devolver</button>
            <button type="button" className="botao botao-discreto" onClick={() => setRecusando(null)}>Cancelar</button>
          </div>
        </div>
      </Dialogo>
    </section>
  );
}
