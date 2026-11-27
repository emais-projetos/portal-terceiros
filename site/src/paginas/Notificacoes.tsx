import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../componentes/Pagina';
import { Carregando } from '../componentes/Carregando';
import { Dialogo } from '../componentes/Dialogo';
import { mensagemDeErro } from '../lib/supabase';
import { data, diasAte } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { responderPedidoObra } from '../lib/ajuda';
import { abrirArquivoHomologacao, analisarDocumentoHomologacao, liberarPortal } from '../lib/homologacao';
import { NOMES_TIPO, NOMES_VEZ, abrirAjuda, lerNotificacoes, type Notificacao, type TipoNotificacao } from '../lib/notificacoes';
import { PedirMotivo, RegistrarContrato, type PedidoContrato } from './suprimentos/Dialogos';
import { Conversas } from './admin/Atendimento';

// Notificações: o que espera alguém (liberações, pedidos de obra, Ajuda), para todos os perfis.
// Primeiro o que é com quem está logado; o resto fica em "Acompanhar".

const VISOES = [
  ['comigo', 'Comigo'],
  ['acompanhar', 'Acompanhar'],
  ['todas', 'Todas'],
  ['conversas', 'Conversas da Ajuda'],
] as const;
type Visao = (typeof VISOES)[number][0];

const CLASSE_TIPO: Record<TipoNotificacao, string> = {
  validar_sst: 'notif-sst',
  homologacao: 'notif-homologacao',
  registrar_contrato: 'notif-contrato',
  liberar_portal: 'notif-portal',
  pedido_obra: 'notif-pedido',
  ajuda: 'notif-ajuda',
};

function haQuanto(iso: string): string {
  const dias = -diasAte(iso.slice(0, 10));
  if (dias <= 0) return 'desde hoje';
  if (dias === 1) return 'desde ontem';
  return `há ${dias} dias`;
}

const linkFicha = (perfil: string | undefined, empresaId: string, ficha?: string) =>
  `${perfil === 'suprimentos' || perfil === 'admin' ? '/fornecedores' : '/'}?empresa=${empresaId}${ficha ? `&ficha=${ficha}` : ''}`;

export function Notificacoes() {
  const { usuario } = useSessao();
  const perfil = usuario?.perfil;
  const [params, setParams] = useSearchParams();
  // O administrativo responde a Ajuda aqui mesmo (Conversas da Ajuda); os outros perfis usam o botão Ajuda.
  const visoes = VISOES.filter(([v]) => v !== 'conversas' || perfil === 'admin');
  const visao = (visoes.some(([v]) => v === params.get('ver')) ? params.get('ver') : 'comigo') as Visao;
  const tipo = params.get('tipo') ?? '';
  const [lista, setLista] = useState<Notificacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [validar, setValidar] = useState<Notificacao | null>(null);
  const [recusar, setRecusar] = useState<Notificacao | null>(null);
  const [contrato, setContrato] = useState<PedidoContrato | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await lerNotificacoes());
      window.dispatchEvent(new Event('notificacoes-mudaram'));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      setLista([]);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const comigo = (lista ?? []).filter((n) => n.comigo);
  const acompanhar = (lista ?? []).filter((n) => !n.comigo);
  const daVisao = visao === 'comigo' ? comigo : visao === 'acompanhar' ? acompanhar : lista ?? [];
  const tipos = useMemo(() => [...new Set((lista ?? []).map((n) => n.tipo))], [lista]);
  const mostradas = daVisao.filter((n) => !tipo || n.tipo === tipo).sort((a, b) => a.desde.localeCompare(b.desde));

  function mudar(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  }

  async function fazer(chave: string, fn: () => Promise<unknown>, msg: string) {
    setErro(null);
    setOcupado(chave);
    try {
      await fn();
      setOk(msg);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  function acoes(n: Notificacao) {
    const ficha = n.empresa_id ? <Link className="botao botao-secundario botao-pequeno" to={linkFicha(perfil, n.empresa_id)}>Abrir ficha</Link> : null;
    if (!n.comigo) return n.tipo === 'ajuda' ? null : perfil === 'admin' || perfil === 'suprimentos' ? ficha : null;
    switch (n.tipo) {
      case 'validar_sst':
        return <button type="button" className="botao botao-pequeno" onClick={() => setValidar(n)}>Validar</button>;
      case 'liberar_portal':
        return (
          <>
            <button type="button" className="botao botao-pequeno" disabled={ocupado === n.chave} onClick={() => fazer(n.chave, () => liberarPortal(n.empresa_id!), `Portal liberado para ${n.empresa}. O e-mail de boas-vindas entrou na fila.`)}>
              {ocupado === n.chave ? 'Liberando' : 'Liberar portal'}
            </button>
            {ficha}
          </>
        );
      case 'registrar_contrato':
      case 'pedido_obra':
        return (
          <>
            <button
              type="button"
              className="botao botao-pequeno"
              onClick={() =>
                setContrato({
                  empresaId: n.empresa_id!, empresaNome: n.empresa ?? '', codigoBp: n.extra?.codigo_bp ?? null, contrato: null,
                  obrasIniciais: n.extra?.obra_id ? [n.extra.obra_id] : n.extra?.obras_ids ?? [], numeroInicial: n.extra?.numero_contrato ?? null,
                  titulo: n.obra ? `Contrato da obra ${n.obra}` : undefined,
                })
              }
            >
              Registrar contrato
            </button>
            {n.tipo === 'pedido_obra' && <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setRecusar(n)}>Recusar</button>}
            {n.tipo === 'registrar_contrato' && ficha}
          </>
        );
      case 'homologacao':
        return <Link className="botao botao-pequeno" to={`/homologacao?empresa=${n.empresa_id}&ficha=homologacao`}>Analisar</Link>;
      case 'ajuda':
        return perfil === 'admin' ? (
          <button type="button" className="botao botao-pequeno" onClick={() => setParams({ ver: 'conversas', c: n.ref ?? '' })}>Responder</button>
        ) : (
          <button type="button" className="botao botao-pequeno" onClick={abrirAjuda}>Abrir a Ajuda</button>
        );
    }
  }

  return (
    <Pagina
      titulo="Notificações"
      apoio={perfil === 'admin' ? 'Tudo o que está esperando alguém: liberações, pedidos de obra e a Ajuda. Em Conversas da Ajuda você responde quem escreveu.' : 'Tudo o que está esperando alguém: liberações, pedidos de obra e mensagens da Ajuda. Primeiro o que é com você.'}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!lista ? (
        <Carregando />
      ) : (
        <>
          <div className="filtros filtros-linha">
            <div className="chips" role="group" aria-label="Ver">
              {visoes.map(([v, nome]) => (
                <button key={v} type="button" className="chip" aria-pressed={visao === v} onClick={() => mudar('ver', v === 'comigo' ? '' : v)}>
                  {nome}
                  {v !== 'conversas' && <span className="chip-numero">{v === 'comigo' ? comigo.length : v === 'acompanhar' ? acompanhar.length : lista.length}</span>}
                </button>
              ))}
            </div>
            {tipos.length > 1 && visao !== 'conversas' && (
              <label className="campo campo-filtro">
                <span>Tipo</span>
                <select value={tipo} className={tipo ? 'filtro-ativo' : undefined} onChange={(e) => mudar('tipo', e.target.value)}>
                  <option value="">Todos</option>
                  {tipos.map((t) => <option key={t} value={t}>{NOMES_TIPO[t]}</option>)}
                </select>
              </label>
            )}
          </div>

          {visao === 'conversas' ? (
            <Conversas />
          ) : mostradas.length === 0 ? (
            <p className="vazio">
              {visao === 'comigo' ? 'Nada esperando por você agora.' : 'Nada por aqui.'}
              {visao === 'comigo' && acompanhar.length > 0 && <> Há {acompanhar.length} item(ns) com outras áreas em <button type="button" className="botao-link link-acao" onClick={() => mudar('ver', 'acompanhar')}>Acompanhar</button>.</>}
            </p>
          ) : (
            <ul className="notificacoes">
              {mostradas.map((n) => (
                <li key={n.chave} className={`notificacao ${CLASSE_TIPO[n.tipo]}${n.comigo ? ' notificacao-comigo' : ''}`}>
                  <div className="notificacao-corpo">
                    <span className="notificacao-tipo">{NOMES_TIPO[n.tipo]}</span>
                    <strong>{n.titulo}</strong>
                    {n.detalhe && <span className="notificacao-detalhe">{n.detalhe}</span>}
                    <span className="sub">
                      {[n.empresa && n.tipo !== 'ajuda' ? n.empresa : null, n.obra, haQuanto(n.desde)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="notificacao-lado">
                    <span className={`notificacao-vez${n.comigo ? ' vez-comigo' : ''}`}>{n.comigo ? 'Com você' : `Com: ${NOMES_VEZ[n.vez]}`}</span>
                    <span className="linha-botoes">{acoes(n)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ValidarSst
        n={validar}
        aoFechar={() => setValidar(null)}
        aoAprovar={async (n) => {
          await analisarDocumentoHomologacao(n.ref!, true);
          setValidar(null);
          setOk(`${n.extra?.documento ?? 'Documento'} de ${n.empresa} validado. O Suprimentos já pode seguir com a homologação.`);
          await carregar();
        }}
        aoDevolver={async (n, motivo) => {
          await analisarDocumentoHomologacao(n.ref!, false, motivo);
          setValidar(null);
          setOk(`${n.extra?.documento ?? 'Documento'} devolvido para ${n.empresa} corrigir.`);
          await carregar();
        }}
      />
      <PedirMotivo
        aberto={!!recusar}
        titulo={recusar ? `Recusar: ${recusar.obra ?? ''}` : ''}
        apoio="O motivo vai para o fornecedor na Ajuda."
        botao="Recusar pedido"
        aoFechar={() => setRecusar(null)}
        aoConfirmar={async (m) => {
          if (!recusar?.ref) return;
          await responderPedidoObra(recusar.ref, false, m);
          setRecusar(null);
          setOk('Pedido recusado. O fornecedor recebeu o motivo na Ajuda.');
          await carregar();
        }}
      />
      <RegistrarContrato
        pedido={contrato}
        aoFechar={() => setContrato(null)}
        aoRegistrar={async (msg) => {
          setContrato(null);
          setOk(msg);
          await carregar();
        }}
      />
    </Pagina>
  );
}

// Validação do PGR, PCMSO (e o que mais estiver marcado como SST) enviado na homologação: o administrativo baixa, confere a vigência e decide.
function ValidarSst({ n, aoFechar, aoAprovar, aoDevolver }: {
  n: Notificacao | null;
  aoFechar: () => void;
  aoAprovar: (n: Notificacao) => Promise<void>;
  aoDevolver: (n: Notificacao, motivo: string) => Promise<void>;
}) {
  const [devolvendo, setDevolvendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setDevolvendo(false);
    setMotivo('');
    setErro(null);
  }, [n]);
  if (!n) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const x = n.extra ?? {};
  const dias = x.vencimento ? diasAte(x.vencimento) : null;

  async function rodar(fn: () => Promise<void>) {
    setEnviando(true);
    setErro(null);
    try {
      await fn();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={!!n} titulo={`Validar ${x.documento ?? 'documento'}`} aoFechar={aoFechar}>
      <div className="formulario formulario-largo">
        <p className="apoio"><strong>{n.empresa}</strong>, enviado na homologação {haQuanto(n.desde)}.</p>
        <dl className="ficha-pares ficha-pares-2">
          <div><dt>Emissão</dt><dd>{x.data_emissao ? data(x.data_emissao) : '-'}</dd></div>
          <div>
            <dt>Vence</dt>
            <dd className={dias !== null && dias < 30 ? 'texto-alerta' : undefined}>
              {x.vencimento ? data(x.vencimento) : 'Não informado'}
              {dias !== null && <small className="sub">{dias < 0 ? 'Já vencido' : `Faltam ${dias} dias`}{x.validade_dias ? `, vale ${x.validade_dias} dias da emissão` : ''}</small>}
            </dd>
          </div>
        </dl>
        <div className="linha-botoes">
          {(x.arquivos ?? []).map((a, i) => (
            <button key={a.caminho + i} type="button" className="botao botao-secundario botao-pequeno" onClick={() => abrirArquivoHomologacao(a.caminho).catch((e) => setErro(mensagemDeErro(e)))}>
              Baixar {a.nome ?? `arquivo ${i + 1}`}
            </button>
          ))}
        </div>
        <p className="dica">Confira se o documento é da empresa certa, está assinado pelo responsável técnico e está dentro da vigência.</p>
        {devolvendo && (
          <label className="campo">
            <span>O que precisa ser corrigido</span>
            <textarea rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <small className="dica">Vai para o fornecedor no portal e no e-mail de correções.</small>
          </label>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          {devolvendo ? (
            <>
              <button type="button" className="botao" disabled={enviando || motivo.trim().length < 3} onClick={() => rodar(() => aoDevolver(n, motivo.trim()))}>{enviando ? 'Salvando' : 'Devolver documento'}</button>
              <button type="button" className="botao botao-discreto" onClick={() => setDevolvendo(false)}>Voltar</button>
            </>
          ) : (
            <>
              <button type="button" className="botao" disabled={enviando} onClick={() => rodar(() => aoAprovar(n))}>{enviando ? 'Salvando' : 'Validar documento'}</button>
              <button type="button" className="botao botao-secundario" disabled={enviando} onClick={() => setDevolvendo(true)}>Devolver</button>
            </>
          )}
        </div>
      </div>
    </Dialogo>
  );
}
