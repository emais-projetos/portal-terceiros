import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pagina, Mensagem } from '../componentes/Pagina';
import { Dialogo } from '../componentes/Dialogo';
import { Carregando } from '../componentes/Carregando';
import { useSessao } from '../lib/sessao';
import { mensagemDeErro } from '../lib/supabase';
import { data, diasAte, hojeIso } from '../lib/formato';
import { lerAlocacoes, type AlocacaoResumo } from '../lib/admin';
import {
  baixarListaPresenca, cancelarIntegracao, concluirIntegracao, criarIntegracao, lerIntegracoes, type Integracao,
} from '../lib/integracao';

const CHAVE_OBRA = 'portal-terceiros:obra-integracao';
const DIAS_AVISO = 30;

function situacaoIntegracao(a: AlocacaoResumo): 'sem' | 'vencida' | 'vencendo' | 'em_dia' {
  if (!a.data_integracao || !a.vencimento_integracao) return 'sem';
  const d = diasAte(a.vencimento_integracao);
  if (d <= 0) return 'vencida';
  if (d <= DIAS_AVISO) return 'vencendo';
  return 'em_dia';
}

const rotuloIntegracao = {
  sem: 'Sem integração',
  vencida: 'Integração vencida',
  vencendo: 'Integração vencendo',
} as const;

export function Integracao() {
  const { usuario } = useSessao();
  const [alocacoes, setAlocacoes] = useState<AlocacaoResumo[] | null>(null);
  const [obra, setObra] = useState('');
  const [busca, setBusca] = useState('');
  const [turmas, setTurmas] = useState<Integracao[] | null>(null);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Integracao | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const [dia, setDia] = useState(hojeIso());
  const [horario, setHorario] = useState('07:30');
  const [local, setLocal] = useState('');
  const [responsavel, setResponsavel] = useState(usuario?.nome ?? '');
  const [criando, setCriando] = useState(false);

  async function carregarAlocacoes() {
    try {
      const a = await lerAlocacoes();
      setAlocacoes(a);
      return a;
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      return null;
    }
  }

  useEffect(() => {
    carregarAlocacoes().then((a) => {
      if (!a) return;
      const obras = [...new Set(a.map((x) => x.obra_id))];
      let guardada = '';
      try {
        guardada = window.localStorage.getItem(CHAVE_OBRA) ?? '';
      } catch {
        guardada = '';
      }
      setObra(obras.includes(guardada) ? guardada : obras.length === 1 ? obras[0] : '');
    });
  }, []);

  async function carregarTurmas(o: string) {
    try {
      setTurmas(await lerIntegracoes(o));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    setSelecao(new Set());
    setTurmas(null);
    if (!obra) return;
    try {
      window.localStorage.setItem(CHAVE_OBRA, obra);
    } catch {
      // segue sem lembrar a obra
    }
    carregarTurmas(obra);
  }, [obra]);

  const obras = useMemo(() => {
    const m = new Map<string, string>();
    (alocacoes ?? []).forEach((a) => m.set(a.obra_id, a.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [alocacoes]);
  const nomeObra = obras.find(([id]) => id === obra)?.[1] ?? '';
  const porId = useMemo(() => new Map((alocacoes ?? []).map((a) => [a.alocacao_id, a])), [alocacoes]);

  // Busca por colaborador ou empresa: filtra os liberados e as turmas em que eles estão.
  const termo = busca.trim().toLowerCase();
  const casa = (a: AlocacaoResumo | undefined) => !!a && (a.colaborador.toLowerCase().includes(termo) || a.empresa.toLowerCase().includes(termo));
  const turmaCasa = (t: Integracao) => !termo || t.integracoes_participantes.some((p) => casa(porId.get(p.alocacao_id)));
  const todasAbertas = (turmas ?? []).filter((t) => !t.concluida_em);
  const abertas = todasAbertas.filter(turmaCasa);
  const concluidas = (turmas ?? []).filter((t) => t.concluida_em).filter(turmaCasa);
  const emTurmaAberta = new Set(todasAbertas.flatMap((t) => t.integracoes_participantes.map((p) => p.alocacao_id)));

  const elegiveis = useMemo(
    () =>
      (alocacoes ?? [])
        .filter((a) => a.obra_id === obra && a.status === 'liberado' && situacaoIntegracao(a) !== 'em_dia' && !emTurmaAberta.has(a.alocacao_id))
        .filter((a) => !termo || casa(a))
        .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR') || a.colaborador.localeCompare(b.colaborador, 'pt-BR')),
    [alocacoes, obra, turmas, termo], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function alternar(id: string) {
    setSelecao((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function participantesDa(t: Integracao) {
    const alocs = t.integracoes_participantes.map((p) => ({ p, a: porId.get(p.alocacao_id) })).filter((x) => x.a);
    return alocs
      .map(({ p, a }) => ({ nome: a!.colaborador, empresa: a!.empresa, funcao: a!.funcao, presente: p.presente }))
      .sort((x, y) => x.empresa.localeCompare(y.empresa, 'pt-BR') || x.nome.localeCompare(y.nome, 'pt-BR'));
  }

  async function baixar(t: Integracao) {
    setErro(null);
    setBaixando(t.id);
    try {
      await baixarListaPresenca(t, nomeObra, await participantesDa(t));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setBaixando(null);
    }
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (selecao.size === 0 || !responsavel.trim() || !dia) return;
    setErro(null);
    setOk(null);
    setCriando(true);
    try {
      const t = await criarIntegracao({ obraId: obra, data: dia, horario, local, responsavel: responsavel.trim(), alocacoes: [...selecao] });
      await baixarListaPresenca(t, nomeObra, await participantesDa(t));
      setOk(`Turma de ${data(dia)} criada com ${selecao.size} ${selecao.size === 1 ? 'participante' : 'participantes'}. A lista de presença foi baixada.`);
      setSelecao(new Set());
      await carregarTurmas(obra);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setCriando(false);
    }
  }

  async function cancelar(t: Integracao) {
    setErro(null);
    try {
      await cancelarIntegracao(t.id);
      setOk(`Turma de ${data(t.data)} cancelada. Os participantes voltaram para a lista.`);
      await carregarTurmas(obra);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  return (
    <Pagina titulo="Integração" apoio="Monte a turma com os liberados, baixe a lista de presença para as assinaturas e, depois, confirme quem participou.">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!alocacoes && !erro && <Carregando />}

      {alocacoes && obras.length > 0 && (
        <div className="filtros">
          {obras.length > 1 && (
            <label className="campo">
              <span>Obra</span>
              <select value={obra} onChange={(e) => setObra(e.target.value)}>
                <option value="">Escolha a obra</option>
                {obras.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              </select>
            </label>
          )}
          {obra && (
            <label className="campo campo-busca">
              <span>Buscar</span>
              <input type="search" placeholder="Colaborador ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
          )}
        </div>
      )}
      {alocacoes && obras.length === 0 && <p className="vazio">Nenhuma obra ligada ao seu acesso.</p>}

      {obra && !turmas && <Carregando />}

      {obra && turmas && abertas.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Turmas aguardando confirmação de presença</h2>
          <ul className="lista-pendencias">
            {abertas.map((t) => {
              const futura = t.data > hojeIso();
              return (
                <li key={t.id}>
                  <div className="item-turma">
                    <div>
                      <strong>{data(t.data)}{t.horario ? `, ${t.horario}` : ''}</strong>
                      <span className="sub">
                        {t.integracoes_participantes.length} {t.integracoes_participantes.length === 1 ? 'participante' : 'participantes'}
                        {t.local ? `, ${t.local}` : ''}, responsável {t.responsavel}
                      </span>
                    </div>
                    <div className="linha-botoes">
                      <button type="button" className="botao botao-secundario botao-pequeno" disabled={baixando === t.id} onClick={() => baixar(t)}>
                        {baixando === t.id ? 'Gerando PDF' : 'Baixar lista'}
                      </button>
                      <button
                        type="button"
                        className="botao botao-pequeno"
                        disabled={futura}
                        title={futura ? 'A confirmação abre no dia da integração' : undefined}
                        onClick={() => setConfirmando(t)}
                      >
                        Confirmar presença
                      </button>
                      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => cancelar(t)}>Cancelar turma</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {obra && turmas && (
        <section className="bloco">
          <div className="barra-lista">
            <h2 className="bloco-titulo">Montar turma</h2>
            {elegiveis.length > 0 && (
              <div className="linha-botoes">
                <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setSelecao(new Set(elegiveis.map((a) => a.alocacao_id)))}>
                  Marcar todos ({elegiveis.length})
                </button>
                {selecao.size > 0 && (
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setSelecao(new Set())}>Limpar</button>
                )}
              </div>
            )}
          </div>
          {elegiveis.length === 0 ? (
            <p className="vazio">Todos os liberados desta obra estão com a integração em dia ou já estão em uma turma.</p>
          ) : (
            <div className="duas-colunas">
              <ul className="lista-marcar lista-alta">
                {elegiveis.map((a) => {
                  const s = situacaoIntegracao(a) as keyof typeof rotuloIntegracao;
                  return (
                    <li key={a.alocacao_id}>
                      <label>
                        <input type="checkbox" checked={selecao.has(a.alocacao_id)} onChange={() => alternar(a.alocacao_id)} />
                        <span>
                          {a.colaborador}
                          <small className="sub">
                            {a.empresa}
                            {a.funcao ? `, ${a.funcao.toLowerCase()}` : ''}. {rotuloIntegracao[s]}
                            {s !== 'sem' && a.vencimento_integracao ? ` (${s === 'vencida' ? 'venceu' : 'vence'} em ${data(a.vencimento_integracao)})` : ''}
                          </small>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <form className="formulario formulario-largo" onSubmit={criar}>
                <div className="grade-2">
                  <label className="campo">
                    <span>Data</span>
                    <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
                  </label>
                  <label className="campo">
                    <span>Horário</span>
                    <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
                  </label>
                </div>
                <label className="campo">
                  <span>Local</span>
                  <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Ex.: sala de integração do canteiro" />
                </label>
                <label className="campo">
                  <span>Instrutor (técnico de segurança)</span>
                  <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
                </label>
                <button className="botao" type="submit" disabled={selecao.size === 0 || !responsavel.trim() || !dia || criando}>
                  {criando ? 'Criando' : `Criar turma e baixar lista (${selecao.size})`}
                </button>
                <p className="dica">A lista sai em PDF com nome, CPF parcial, empresa, função e o espaço da assinatura.</p>
              </form>
            </div>
          )}
        </section>
      )}

      {obra && concluidas.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Integrações realizadas</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista tabela-compacta">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Presentes</th>
                  <th scope="col">Responsável</th>
                  <th scope="col"><span className="sr">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {concluidas.map((t) => {
                  const presentes = t.integracoes_participantes.filter((p) => p.presente).length;
                  return (
                    <tr key={t.id}>
                      <th scope="row">{data(t.data)}{t.horario ? `, ${t.horario}` : ''}</th>
                      <td>{presentes} de {t.integracoes_participantes.length}</td>
                      <td>{t.responsavel}</td>
                      <td className="acoes">
                        <button type="button" className="botao botao-discreto botao-pequeno" disabled={baixando === t.id} onClick={() => baixar(t)}>
                          {baixando === t.id ? 'Gerando PDF' : 'Baixar lista com presença'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmarPresenca
        turma={confirmando}
        porId={porId}
        aoFechar={() => setConfirmando(null)}
        aoConfirmar={async (presentes) => {
          const t = confirmando!;
          setConfirmando(null);
          setErro(null);
          try {
            const qtd = await concluirIntegracao(t.id, presentes);
            setOk(`Integração de ${data(t.data)} registrada para ${qtd} ${qtd === 1 ? 'colaborador' : 'colaboradores'}.`);
            await Promise.all([carregarTurmas(obra), carregarAlocacoes()]);
          } catch (e) {
            setErro(mensagemDeErro(e as Error));
          }
        }}
      />
    </Pagina>
  );
}

function ConfirmarPresenca({
  turma, porId, aoFechar, aoConfirmar,
}: {
  turma: Integracao | null;
  porId: Map<string, AlocacaoResumo>;
  aoFechar: () => void;
  aoConfirmar: (presentes: string[]) => void;
}) {
  const [presentes, setPresentes] = useState<Set<string>>(new Set());
  useEffect(() => setPresentes(new Set(turma?.integracoes_participantes.map((p) => p.alocacao_id) ?? [])), [turma]);
  if (!turma) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const lista = turma.integracoes_participantes
    .map((p) => porId.get(p.alocacao_id))
    .filter((a): a is AlocacaoResumo => !!a)
    .sort((a, b) => a.colaborador.localeCompare(b.colaborador, 'pt-BR'));
  const ausentes = lista.length - presentes.size;

  return (
    <Dialogo aberto titulo={`Presença na integração de ${data(turma.data)}`} aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        <p className="apoio">Confira com a lista assinada e desmarque quem faltou. Só os presentes recebem a data da integração.</p>
        <ul className="lista-marcar lista-alta">
          {lista.map((a) => (
            <li key={a.alocacao_id}>
              <label>
                <input
                  type="checkbox"
                  checked={presentes.has(a.alocacao_id)}
                  onChange={() =>
                    setPresentes((s) => {
                      const n = new Set(s);
                      if (n.has(a.alocacao_id)) n.delete(a.alocacao_id);
                      else n.add(a.alocacao_id);
                      return n;
                    })
                  }
                />
                <span>
                  {a.colaborador}
                  <small className="sub">{a.empresa}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="linha-botoes">
          <button type="button" className="botao" onClick={() => aoConfirmar([...presentes])}>
            Registrar {presentes.size} {presentes.size === 1 ? 'presente' : 'presentes'}{ausentes > 0 ? ` e ${ausentes} ${ausentes === 1 ? 'ausente' : 'ausentes'}` : ''}
          </button>
          <button type="button" className="botao botao-discreto" onClick={aoFechar}>Cancelar</button>
        </div>
      </div>
    </Dialogo>
  );
}
