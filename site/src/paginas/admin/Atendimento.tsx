import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem as Aviso } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { Conversa } from '../../componentes/Conversa';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { data } from '../../lib/formato';
import { nomesPerfil, type Perfil } from '../../lib/sessao';
import {
  acompanharMensagens, enviarMensagem, lerConversas, lerMensagens, lerPedidosObra, marcarLida, resolverConversa, responderPedidoObra,
  type ConversaAdmin, type Mensagem, type PedidoObra,
} from '../../lib/ajuda';

// Atendimento: conversas da Ajuda (fornecedor, TST e engenharia) e pedidos de acesso a outra obra.

const ABAS = [
  ['conversas', 'Conversas'],
  ['pedidos', 'Pedidos de obra'],
] as const;
type Aba = (typeof ABAS)[number][0];

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Atendimento() {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'conversas';
  const [pendentes, setPendentes] = useState<number | null>(null);

  useEffect(() => {
    lerPedidosObra()
      .then((l) => setPendentes(l.filter((p) => p.situacao === 'pendente').length))
      .catch(() => setPendentes(null));
  }, [aba]);

  return (
    <Pagina
      titulo="Atendimento"
      apoio="Dúvidas enviadas pela Ajuda e pedidos de fornecedores para atuar em outra obra."
      abas={
        <nav className="abas abas-botoes" aria-label="Atendimento">
          {ABAS.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'conversas' ? {} : { aba: a })}>
              {nome}
              {a === 'pedidos' && !!pendentes && <span className="contador">{pendentes}</span>}
            </button>
          ))}
        </nav>
      }
    >
      {aba === 'conversas' ? <Conversas /> : <Pedidos aoMudar={setPendentes} />}
    </Pagina>
  );
}

function Conversas() {
  const [params, setParams] = useSearchParams();
  const aberta = params.get('c');
  const [conversas, setConversas] = useState<ConversaAdmin[] | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setConversas(await lerConversas());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Mensagem nova de qualquer conversa: atualiza a lista e, se for a aberta, a conversa.
  useEffect(
    () =>
      acompanharMensagens((m) => {
        carregar();
        if (m.conversa_id === aberta) {
          setMensagens((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
          marcarLida(aberta).catch(() => undefined);
        }
      }),
    [aberta, carregar],
  );

  useEffect(() => {
    if (!aberta) return;
    setMensagens([]);
    lerMensagens(aberta)
      .then(setMensagens)
      .catch((e) => setErro(mensagemDeErro(e)));
    marcarLida(aberta)
      .then(carregar)
      .catch(() => undefined);
  }, [aberta, carregar]);

  const lista = useMemo(
    () => (conversas ?? []).filter((c) => mostrarResolvidas || c.situacao === 'aberta' || c.id === aberta),
    [conversas, mostrarResolvidas, aberta],
  );
  const atual = conversas?.find((c) => c.id === aberta) ?? null;

  function abrir(id: string | null) {
    const p = new URLSearchParams(params);
    if (id) p.set('c', id);
    else p.delete('c');
    setParams(p, { replace: true });
  }

  if (!conversas && !erro) return <Carregando />;

  return (
    <>
      {erro && <Aviso tipo="erro" aoFechar={() => setErro(null)}>{erro}</Aviso>}
      <div className="atendimento">
        <aside className="atendimento-lista" aria-label="Conversas">
          <label className="opcao opcao-filtro">
            <input type="checkbox" checked={mostrarResolvidas} onChange={(e) => setMostrarResolvidas(e.target.checked)} />
            <span>Mostrar resolvidas</span>
          </label>
          {lista.length === 0 && <p className="vazio">Nenhuma conversa {mostrarResolvidas ? '' : 'aberta '}por enquanto.</p>}
          <ul>
            {lista.map((c) => (
              <li key={c.id}>
                <button type="button" className={`atendimento-item${c.id === aberta ? ' ativo' : ''}`} onClick={() => abrir(c.id)}>
                  <span className="atendimento-nome">
                    {c.nome}
                    {c.naoLidas > 0 && <span className="contador">{c.naoLidas}</span>}
                  </span>
                  <small className="sub">
                    {nomesPerfil[c.perfil as Perfil] ?? c.perfil}
                    {c.empresas.length ? `, ${c.empresas.length === 1 ? c.empresas[0] : `${c.empresas.length} empresas`}` : ''}
                    {c.obras.length ? `, ${c.obras.join(', ')}` : ''}
                  </small>
                  {c.ultima && (
                    <small className="atendimento-previa">
                      {c.ultima.da_emais ? 'Emais: ' : ''}
                      {c.ultima.texto}
                    </small>
                  )}
                  <small className="sub">
                    {c.ultima_mensagem_em ? hora(c.ultima_mensagem_em) : ''}
                    {c.situacao === 'resolvida' ? ', resolvida' : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="atendimento-conversa">
          {!atual ? (
            <p className="vazio">Escolha uma conversa à esquerda.</p>
          ) : (
            <>
              <header className="atendimento-cabecalho">
                <div>
                  <strong>{atual.nome}</strong>
                  <small className="sub">
                    {atual.email}, {nomesPerfil[atual.perfil as Perfil] ?? atual.perfil}
                  </small>
                  {atual.empresas.length > 0 && <small className="sub">{atual.empresas.join(', ')}</small>}
                </div>
                <div className="linha-botoes">
                  <button
                    type="button"
                    className="botao botao-secundario botao-pequeno"
                    onClick={() =>
                      resolverConversa(atual.id, atual.situacao === 'aberta')
                        .then(() => Promise.all([carregar(), lerMensagens(atual.id).then(setMensagens)]))
                        .catch((e) => setErro(mensagemDeErro(e)))
                    }
                  >
                    {atual.situacao === 'aberta' ? 'Marcar como resolvida' : 'Reabrir'}
                  </button>
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => abrir(null)}>
                    Fechar
                  </button>
                </div>
              </header>
              <Conversa
                mensagens={mensagens}
                meuLado="emais"
                nomeOutroLado={atual.nome}
                vazio="Sem mensagens."
                aoEnviar={async (t) => {
                  setErro(null);
                  try {
                    await enviarMensagem(t, atual.id);
                    setMensagens(await lerMensagens(atual.id));
                    carregar();
                  } catch (e) {
                    setErro(mensagemDeErro(e as Error));
                    throw e;
                  }
                }}
              />
              <small className="sub">Se a pessoa não ler em alguns minutos, a resposta vai também para {atual.email} (Acessos &gt; Regras &gt; Ajuda).</small>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Pedidos({ aoMudar }: { aoMudar: (pendentes: number) => void }) {
  const [pedidos, setPedidos] = useState<PedidoObra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [recusar, setRecusar] = useState<PedidoObra | null>(null);

  const carregar = useCallback(async () => {
    try {
      const l = await lerPedidosObra();
      setPedidos(l);
      aoMudar(l.filter((p) => p.situacao === 'pendente').length);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [aoMudar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function responder(p: PedidoObra, aprovar: boolean, motivo?: string) {
    setErro(null);
    setOcupado(p.id);
    try {
      await responderPedidoObra(p.id, aprovar, motivo);
      setOk(
        aprovar
          ? `${p.empresas?.razao_social} liberada na obra ${p.obras?.nome}. O fornecedor recebeu o aviso na Ajuda.`
          : `Pedido recusado. O fornecedor recebeu o motivo na Ajuda.`,
      );
      setRecusar(null);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  if (!pedidos && !erro) return <Carregando />;
  const abertos = (pedidos ?? []).filter((p) => p.situacao === 'pendente');
  const respondidos = (pedidos ?? []).filter((p) => p.situacao !== 'pendente');

  return (
    <>
      {erro && <Aviso tipo="erro" aoFechar={() => setErro(null)}>{erro}</Aviso>}
      {ok && <Aviso tipo="ok" aoFechar={() => setOk(null)}>{ok}</Aviso>}
      <section className="bloco">
        <h2 className="bloco-titulo">Aguardando resposta <span className="sub">{abertos.length}</span></h2>
        {abertos.length === 0 ? (
          <p className="vazio">Nenhum pedido aguardando.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">Obra pedida</th>
                  <th scope="col">Contrato e observação</th>
                  <th scope="col">Pedido</th>
                  <th scope="col"><span className="sr">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {abertos.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      {p.empresas?.razao_social}
                      <small className="sub">{formatarCnpj(p.empresas?.cnpj ?? '')}</small>
                    </th>
                    <td>{p.obras?.nome}</td>
                    <td className="quebra">
                      {p.numero_contrato ? `Contrato ${p.numero_contrato}` : <span className="sub">Sem contrato informado</span>}
                      {p.observacao && <small className="sub">{p.observacao}</small>}
                    </td>
                    <td>
                      {hora(p.pedido_em)}
                      {p.usuarios && <small className="sub">{p.usuarios.nome}</small>}
                    </td>
                    <td className="acoes">
                      <button type="button" className="botao botao-pequeno" disabled={ocupado === p.id} onClick={() => responder(p, true)}>
                        Aprovar
                      </button>
                      <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado === p.id} onClick={() => setRecusar(p)}>
                        Recusar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {respondidos.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Respondidos</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">Obra</th>
                  <th scope="col">Resposta</th>
                </tr>
              </thead>
              <tbody>
                {respondidos.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{p.empresas?.razao_social}</th>
                    <td>{p.obras?.nome}</td>
                    <td className="quebra">
                      <span className={`selo ${p.situacao === 'aprovado' ? 'selo-liberado' : 'selo-pendente_fornecedor'}`}>{p.situacao === 'aprovado' ? 'Aprovado' : 'Recusado'}</span>
                      <small className="sub">
                        {p.analisado_em ? data(p.analisado_em) : ''}
                        {p.motivo_recusa ? `: ${p.motivo_recusa}` : ''}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Recusa pedido={recusar} ocupado={!!ocupado} aoFechar={() => setRecusar(null)} aoRecusar={(m) => recusar && responder(recusar, false, m)} />
    </>
  );
}

function Recusa({ pedido, ocupado, aoFechar, aoRecusar }: { pedido: PedidoObra | null; ocupado: boolean; aoFechar: () => void; aoRecusar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => setMotivo(''), [pedido]);
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length >= 3) aoRecusar(motivo.trim());
  }
  return (
    <Dialogo aberto={!!pedido} titulo={pedido ? `Recusar: ${pedido.obras?.nome}` : ''} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar}>
        <p className="apoio">O motivo vai para o fornecedor na Ajuda.</p>
        <label className="campo">
          <span>Motivo</span>
          <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={motivo.trim().length < 3 || ocupado}>Recusar pedido</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
