import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { EnvioMedicao, type PedidoMedicao } from '../../componentes/EnvioMedicao';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { lerMeusColaboradores, lerMinhasEmpresasComObras, type MeuColaborador, type MinhaEmpresa } from '../../lib/fornecedor';
import {
  CHAVES_CONFERENCIA, abrirMedicao, arquivosAtuais, competenciaPadrao, competenciasRecentes, definirColaborador, editavelPeloFornecedor,
  enviarMedicao, lerMedicao, lerMedicoes, lerTiposMedicao, mesCurto, mesPorExtenso, removerColaborador, rotuloConferencia,
  rotuloSituacaoColaborador, rotuloStatusItem, rotuloStatusMedicao, seloItem, seloMedicao,
  type DetalheMedicao, type Medicao, type SituacaoColaborador, type TipoMedicao,
} from '../../lib/medicao';

export function MedicaoFornecedor() {
  const [params, setParams] = useSearchParams();
  const id = params.get('m');
  return id ? <DetalheFornecedor id={id} aoVoltar={() => setParams({})} /> : <ListaFornecedor aoAbrir={(m) => setParams({ m })} />;
}

// ---------------------------------------------------------------- Lista e abertura do mês

function ListaFornecedor({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const [empresas, setEmpresas] = useState<MinhaEmpresa[] | null>(null);
  const [medicoes, setMedicoes] = useState<Medicao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolha, setEscolha] = useState('');
  const [competencia, setCompetencia] = useState(competenciaPadrao());
  const [abrindo, setAbrindo] = useState(false);

  useEffect(() => {
    Promise.all([lerMinhasEmpresasComObras(), lerMedicoes()])
      .then(([e, m]) => {
        setEmpresas(e);
        setMedicoes(m);
        const primeira = e.find((x) => x.obras.length > 0);
        if (primeira) setEscolha(`${primeira.id}|${primeira.obras[0].id}`);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const opcoes = useMemo(
    () =>
      (empresas ?? []).flatMap((e) =>
        e.obras.map((o) => ({ valor: `${e.id}|${o.id}`, rotulo: (empresas ?? []).length > 1 ? `${o.nome} (${e.razao_social})` : o.nome })),
      ),
    [empresas],
  );

  const jaAberta = useMemo(() => {
    const [empresaId, obraId] = escolha.split('|');
    return (medicoes ?? []).find((m) => m.empresa_id === empresaId && m.obra_id === obraId && m.competencia === competencia) ?? null;
  }, [escolha, competencia, medicoes]);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    if (jaAberta) return aoAbrir(jaAberta.id);
    const [empresaId, obraId] = escolha.split('|');
    setErro(null);
    setAbrindo(true);
    try {
      aoAbrir(await abrirMedicao(empresaId, obraId, competencia));
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
      setAbrindo(false);
    }
  }

  const prazoDoMes = (() => {
    const [a, m] = competencia.split('-').map(Number);
    const proximo = new Date(Date.UTC(a, m, 25));
    return proximo.toISOString().slice(0, 10);
  })();

  return (
    <Pagina
      titulo="Mensal trabalhista"
      apoio="Todo mês, envie os documentos do F.48 de cada obra para a Emais conferir os pagamentos dos seus colaboradores. A entrega é até o dia 25 do mês seguinte ao trabalhado."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {(!empresas || !medicoes) && !erro && <Carregando />}

      {empresas && opcoes.length === 0 && (
        <p className="vazio">Sua empresa ainda não está cadastrada em nenhuma obra. Fale com o administrativo da Emais.</p>
      )}

      {empresas && opcoes.length > 0 && (
        <section className="bloco bloco-destaque">
          <h2 className="bloco-titulo">Enviar a mensal trabalhista de um mês</h2>
          <form className="em-linha" onSubmit={abrir}>
            <label className="campo">
              <span>Obra</span>
              <select value={escolha} onChange={(e) => setEscolha(e.target.value)}>
                {opcoes.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Mês trabalhado</span>
              <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
                {competenciasRecentes().map((c) => (
                  <option key={c} value={c}>{mesPorExtenso(c)}</option>
                ))}
              </select>
            </label>
            <button className="botao" type="submit" disabled={abrindo || !escolha}>
              {jaAberta ? 'Continuar esta medição' : abrindo ? 'Abrindo' : 'Começar'}
            </button>
          </form>
          <p className="dica">Entrega até {data(prazoDoMes)}. A lista de colaboradores já vem com quem está liberado na obra; você ajusta.</p>
        </section>
      )}

      {medicoes && medicoes.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Seus envios mensais</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Mês</th>
                  <th scope="col">Obra</th>
                  <th scope="col">Entrega até</th>
                  <th scope="col">Situação</th>
                  <th scope="col">O que falta</th>
                  <th scope="col"><span className="sr">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {medicoes.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">
                      {mesCurto(m.competencia)}
                      {(empresas ?? []).length > 1 && <small className="sub">{m.empresa}</small>}
                    </th>
                    <td>{m.obra ?? <span className="sub">Controle anterior, sem obra</span>}</td>
                    <td>
                      {data(m.prazo)}
                      {m.retida && <small className="sub texto-erro">regularizar: risco de bloqueio do pagamento</small>}
                      {m.em_atraso && <small className="sub texto-alerta">em atraso: regularize até {data(limiteDe(m))}</small>}
                    </td>
                    <td><span className={`selo ${seloMedicao[m.status]}`}>{rotuloStatusMedicao[m.status]}</span></td>
                    <td>{resumoDoQueFalta(m)}</td>
                    <td className="acoes">
                      <Link className="botao botao-secundario botao-pequeno" to={`/medicao?m=${m.id}`}>
                        {editavelPeloFornecedor(m) ? 'Abrir' : 'Ver'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Pagina>
  );
}

// Até quando o fornecedor ainda regulariza sem retenção: tolerância do dia 30 ou a data combinada, o que for maior.
function limiteDe(m: Medicao): string {
  return m.prazo_combinado && m.prazo_combinado > m.tolerancia ? m.prazo_combinado : m.tolerancia;
}

function resumoDoQueFalta(m: Medicao): string {
  if (m.status === 'aprovada') return 'Nada';
  if (m.status === 'em_analise') return 'Aguardando a conferência da Emais';
  const partes: string[] = [];
  const docs = m.itens_pendentes;
  if (docs > 0) partes.push(`${docs} ${docs === 1 ? 'documento' : 'documentos'}`);
  if (m.colaboradores_pendentes > 0) partes.push(`${m.colaboradores_pendentes} ${m.colaboradores_pendentes === 1 ? 'colaborador com pendência' : 'colaboradores com pendência'}`);
  if (partes.length === 0) return m.status === 'aberta' ? 'Enviar para conferência' : 'Enviar de novo para conferência';
  return partes.join(', ');
}

// ---------------------------------------------------------------- Uma medição

function DetalheFornecedor({ id, aoVoltar }: { id: string; aoVoltar: () => void }) {
  const [detalhe, setDetalhe] = useState<DetalheMedicao | null>(null);
  const [tipos, setTipos] = useState<TipoMedicao[] | null>(null);
  const [colaboradores, setColaboradores] = useState<MeuColaborador[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pedido, setPedido] = useState<PedidoMedicao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [novo, setNovo] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDetalhe(await lerMedicao(id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [id]);

  useEffect(() => {
    carregar();
    lerTiposMedicao().then(setTipos).catch((e) => setErro(mensagemDeErro(e)));
    lerMeusColaboradores().then(setColaboradores).catch(() => undefined);
  }, [carregar]);

  async function executar(chave: string, acao: () => Promise<void>, sucesso?: string) {
    setErro(null);
    setOk(null);
    setOcupado(chave);
    try {
      await acao();
      await carregar();
      if (sucesso) setOk(sucesso);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  if (!detalhe || !tipos) {
    return (
      <Pagina titulo="Mensal trabalhista">
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );
  }

  const { medicao: m, itens, colaboradores: linhas } = detalhe;
  const editavel = editavelPeloFornecedor(m);
  const itemPorTipo = new Map(itens.map((i) => [i.tipo_codigo, i]));
  const dias = diasAte(m.prazo);
  const faltando = tipos.filter((t) => t.impeditivo && ['nao_enviado', 'devolvido'].includes(itemPorTipo.get(t.codigo)?.status ?? 'nao_enviado'));
  const naLista = new Set(linhas.map((l) => l.colaborador_id).filter(Boolean));
  const paraAdicionar = colaboradores
    .filter((c) => c.empresa_id === m.empresa_id && c.situacao === 'ativo' && !naLista.has(c.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const comPendencia = linhas.filter((l) => Object.values(l.conferencia).includes('pendente'));

  const grupos: { titulo: string; dica: string; tipos: TipoMedicao[] }[] = [
    { titulo: 'Documentos dos colaboradores', dica: 'A Emais confere nome por nome com a lista abaixo.', tipos: tipos.filter((t) => t.coletivo) },
    { titulo: 'Documentos da empresa', dica: 'Folha, guias e comprovantes do mês.', tipos: tipos.filter((t) => !t.coletivo) },
  ];

  return (
    <Pagina
      titulo={`Mensal trabalhista de ${mesPorExtenso(m.competencia)}`}
      apoio={
        <>
          {m.empresa}
          {m.obra ? `, obra ${m.obra}` : ', controle anterior (sem obra)'}. Entrega até {data(m.prazo)}
          {editavel && dias >= 0 ? (dias === 0 ? ', hoje' : `, faltam ${dias} ${dias === 1 ? 'dia' : 'dias'}`) : ''}.
        </>
      }
      acoes={
        <button type="button" className="botao botao-discreto" onClick={aoVoltar}>
          Voltar para a lista
        </button>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className={`aviso ${m.status === 'aprovada' ? 'aviso-ok' : m.status === 'pendente_fornecedor' || m.retida || m.em_atraso ? 'aviso-alerta' : 'aviso-ok'}`}>
        <span className={`selo ${seloMedicao[m.status]}`}>{rotuloStatusMedicao[m.status]}</span>{' '}
        {m.status === 'aberta' && 'Confira a lista de colaboradores, envie os documentos e, no fim da página, envie para a conferência.'}
        {m.status === 'em_analise' && `Enviada em ${data(m.enviada_em)}. A Emais está conferindo; se faltar algo, a medição volta para você com o motivo.`}
        {m.status === 'pendente_fornecedor' && 'A Emais encontrou pendências. Corrija o que está marcado como devolvido ou pendente e envie de novo.'}
        {m.status === 'aprovada' && `Conferida${m.ultima_analise_em ? ` em ${data(m.ultima_analise_em)}` : ''}. Não há nada a fazer.`}
        {m.em_atraso && editavel && <strong> O prazo do dia {data(m.prazo).slice(0, 5)} venceu. Regularize até {data(limiteDe(m))}: a falta da regularização poderá ocasionar o bloqueio do pagamento.</strong>}
        {m.retida && m.status !== 'aprovada' && <strong> Prazo de regularização encerrado. A falta da regularização poderá ocasionar o bloqueio do pagamento.</strong>}
      </div>

      <section className="bloco">
        <div className="barra-lista">
          <h2 className="bloco-titulo">
            Colaboradores no mês <span className="sub">{linhas.length}</span>
          </h2>
          {editavel && <small className="dica">Tire quem não trabalhou na obra no mês e inclua quem faltou.</small>}
        </div>

        {editavel && comPendencia.length > 0 && (
          <p className="aviso aviso-alerta">
            A Emais marcou pendência em {comPendencia.length} {comPendencia.length === 1 ? 'colaborador' : 'colaboradores'}. Veja a coluna "Pendências" e envie o documento que faltou.
          </p>
        )}

        <div className="tabela-rolagem">
          <table className="tabela tabela-lista tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Situação no mês</th>
                <th scope="col">Pendências</th>
                {editavel && <th scope="col"><span className="sr">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={editavel ? 4 : 3} className="vazio-linha">Nenhum colaborador na lista.</td>
                </tr>
              )}
              {linhas.map((l) => {
                const pendentes = CHAVES_CONFERENCIA.filter((k) => l.conferencia[k] === 'pendente');
                return (
                  <tr key={l.id}>
                    <th scope="row">
                      {l.nome}
                      {l.observacao && <small className="sub">{l.observacao}</small>}
                    </th>
                    <td>
                      {editavel && l.colaborador_id ? (
                        <select
                          aria-label={`Situação de ${l.nome}`}
                          value={l.situacao}
                          disabled={ocupado === l.id}
                          onChange={(e) => executar(l.id, () => definirColaborador(m.id, l.colaborador_id!, e.target.value as SituacaoColaborador))}
                        >
                          {(Object.keys(rotuloSituacaoColaborador) as SituacaoColaborador[]).map((s) => (
                            <option key={s} value={s}>{rotuloSituacaoColaborador[s]}</option>
                          ))}
                        </select>
                      ) : (
                        rotuloSituacaoColaborador[l.situacao]
                      )}
                    </td>
                    <td>
                      {pendentes.length === 0 ? (
                        <span className="sub">{Object.keys(l.conferencia).length > 0 ? 'Nenhuma' : ''}</span>
                      ) : (
                        <span className="texto-erro">{pendentes.map((k) => rotuloConferencia[k]).join(', ')}</span>
                      )}
                    </td>
                    {editavel && (
                      <td className="acoes">
                        {l.colaborador_id && (
                          <button
                            type="button"
                            className="botao botao-discreto botao-pequeno"
                            disabled={ocupado === l.id}
                            onClick={() => executar(l.id, () => removerColaborador(m.id, l.colaborador_id!), `${l.nome} saiu da lista do mês.`)}
                          >
                            Tirar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editavel && paraAdicionar.length > 0 && (
          <form
            className="em-linha"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              const c = paraAdicionar.find((x) => x.id === novo);
              if (c) executar('novo', () => definirColaborador(m.id, c.id, 'trabalhou'), `${c.nome} entrou na lista do mês.`).then(() => setNovo(''));
            }}
          >
            <label className="campo">
              <span>Incluir colaborador</span>
              <select value={novo} onChange={(e) => setNovo(e.target.value)}>
                <option value="">Escolha um colaborador da empresa</option>
                {paraAdicionar.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </label>
            <button className="botao botao-secundario" type="submit" disabled={!novo || ocupado === 'novo'}>
              Incluir
            </button>
          </form>
        )}
        {editavel && (
          <p className="dica">
            Quem não aparece na lista de inclusão precisa ser cadastrado antes em <Link className="link" to="/meus-colaboradores">Colaboradores</Link>.
          </p>
        )}
      </section>

      {grupos.map((g) => (
        <section key={g.titulo} className="bloco">
          <div className="barra-lista">
            <h2 className="bloco-titulo">{g.titulo}</h2>
            <small className="dica">{g.dica}</small>
          </div>
          <ul className="lista-pendencias">
            {g.tipos.map((t) => {
              const item = itemPorTipo.get(t.codigo);
              if (!item) return null;
              const arquivos = arquivosAtuais(item);
              const podeMexer = editavel && item.status !== 'aprovado';
              return (
                <li key={t.codigo}>
                  <div className="item-pendencia">
                    <div>
                      <strong>
                        {t.item}. {t.nome}
                      </strong>
                      {arquivos.length > 0 && item.status !== 'nao_aplica' && !item.justificativa && (
                        <span className="sub">
                          {arquivos.length === 1 ? arquivos[0].nome_original : `${arquivos.length} arquivos`}, enviado em {data(item.enviado_em)}
                        </span>
                      )}
                      {item.justificativa && <span className="sub">Não se aplica: {item.justificativa}</span>}
                      {item.status === 'devolvido' && item.motivo_devolucao && <span className="sub texto-erro">Motivo da devolução: {item.motivo_devolucao}</span>}
                      {!t.quando_aplicavel ? null : item.status === 'nao_enviado' && <span className="sub">Se não houve no mês, marque "não se aplica".</span>}
                    </div>
                    <span className={`selo ${seloItem[item.status]}`}>{rotuloStatusItem[item.status]}</span>
                    {podeMexer ? (
                      <span className="linha-botoes">
                        <button
                          type="button"
                          className={item.status === 'em_analise' ? 'botao botao-secundario botao-pequeno' : 'botao botao-pequeno'}
                          onClick={() => setPedido({ medicao: m, item, tipo: t, modo: 'arquivo' })}
                        >
                          {item.status === 'nao_enviado' ? 'Enviar' : item.status === 'em_analise' ? 'Trocar arquivo' : 'Enviar de novo'}
                        </button>
                        {t.quando_aplicavel && item.status !== 'em_analise' && (
                          <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setPedido({ medicao: m, item, tipo: t, modo: 'nao_aplica' })}>
                            Não se aplica
                          </button>
                        )}
                      </span>
                    ) : (
                      <span />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {editavel && (
        <section className="bloco zona-final">
          {faltando.length > 0 ? (
            <p className="apoio">
              Para enviar, falta: {faltando.map((t) => `${t.item}. ${t.nome}`).join('; ')}.
            </p>
          ) : linhas.length === 0 ? (
            <p className="apoio">Para enviar, inclua os colaboradores que trabalharam na obra no mês.</p>
          ) : (
            <p className="apoio">Tudo pronto. Depois de enviar, você não consegue mudar nada até a Emais conferir.</p>
          )}
          <button
            type="button"
            className="botao"
            disabled={faltando.length > 0 || linhas.length === 0 || ocupado === 'enviar'}
            onClick={() => executar('enviar', () => enviarMedicao(m.id), 'Medição enviada para a conferência da Emais.')}
          >
            {ocupado === 'enviar' ? 'Enviando' : m.status === 'pendente_fornecedor' ? 'Enviar de novo para conferência' : 'Enviar para conferência'}
          </button>
        </section>
      )}

      <EnvioMedicao
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (texto) => {
          setPedido(null);
          setOk(texto);
          await carregar();
        }}
      />
    </Pagina>
  );
}
