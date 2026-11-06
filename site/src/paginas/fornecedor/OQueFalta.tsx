import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { LinhaCompacta } from '../../componentes/Farois';
import type { Cor } from '../../lib/farois';
import { EnvioDocumento, type PedidoDeEnvio } from '../../componentes/EnvioDocumento';
import { mensagemDeErro } from '../../lib/supabase';
import { data, rotuloSituacao, rotuloStatus } from '../../lib/formato';
import { enviarParaAnalise, lerDocumentosDaEmpresa, precisaAcao, type DocumentoEmpresa, type PendenciaFornecedor } from '../../lib/fornecedor';
import { documentosDoColaborador, nomeDoDocumento, podeEnviarParaAnalise, travasDaAlocacao, useFornecedor } from '../../lib/useFornecedor';

// Ordem do que pedir primeiro: devolvido e vencido travam e já foram cobrados; depois o que nunca foi enviado.
const prioridade: Record<string, number> = { devolvido: 0, vencido: 1, nao_enviado: 2, a_vencer: 3 };

export function OQueFalta() {
  const { dados, erro, setErro, recarregar, colaboradorPorId, empresaPorId, pendenciasPorAlocacao } = useFornecedor();
  const [docsEmpresa, setDocsEmpresa] = useState<Map<string, DocumentoEmpresa[]>>(new Map());
  const [pedido, setPedido] = useState<PedidoDeEnvio | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviandoAnalise, setEnviandoAnalise] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const alternar = (id: string) => setAberta((a) => (a === id ? null : id));

  useEffect(() => {
    if (!dados) return;
    Promise.all(dados.empresas.map(async (e) => [e.id, await lerDocumentosDaEmpresa(e, dados.tipos)] as const))
      .then((pares) => setDocsEmpresa(new Map(pares)))
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [dados, setErro]);

  const prontos = useMemo(
    () =>
      (dados?.alocacoes ?? [])
        .filter((a) => podeEnviarParaAnalise(a) && travasDaAlocacao(pendenciasPorAlocacao.get(a.alocacao_id)).length === 0)
        .sort((a, b) => a.colaborador.localeCompare(b.colaborador, 'pt-BR')),
    [dados, pendenciasPorAlocacao],
  );

  const porColaborador = useMemo(() => {
    if (!dados) return [];
    const ids = new Set(dados.pendencias.map((p) => p.colaborador_id));
    return [...ids]
      .map((id) => {
        const itens = documentosDoColaborador(id, dados.pendencias)
          .filter((p) => precisaAcao(p.situacao))
          .sort((a, b) => prioridade[a.situacao] - prioridade[b.situacao] || Number(b.impeditivo) - Number(a.impeditivo) || a.documento.localeCompare(b.documento, 'pt-BR'));
        return { colaborador: colaboradorPorId.get(id), itens, alocacoes: dados.alocacoes.filter((a) => a.colaborador_id === id && a.status !== 'encerrado') };
      })
      .filter((g) => g.colaborador && g.itens.length > 0)
      .sort((a, b) => (a.colaborador!.nome).localeCompare(b.colaborador!.nome, 'pt-BR'));
  }, [dados, colaboradorPorId]);

  const pendentesEmpresa = [...docsEmpresa.entries()]
    .map(([id, docs]) => ({ empresa: empresaPorId.get(id)!, docs: docs.filter((d) => precisaAcao(d.situacao)) }))
    .filter((x) => x.empresa && x.docs.length > 0);

  // Rescisórios pendentes dos colaboradores demitidos pelo portal.
  const rescisao = useMemo(() => {
    const m = new Map<string, NonNullable<typeof dados>['rescisao']>();
    (dados?.rescisao ?? [])
      .filter((r) => r.situacao === 'nao_enviado' || r.situacao === 'devolvido')
      .forEach((r) => m.set(r.colaborador_id, [...(m.get(r.colaborador_id) ?? []), r]));
    return [...m.entries()].map(([id, itens]) => ({ id, nome: itens[0].colaborador, desligado: itens[0].data_desligamento, empresaId: itens[0].empresa_id, itens }));
  }, [dados]);

  const totalItens =
    porColaborador.reduce((s, g) => s + g.itens.length, 0) + pendentesEmpresa.reduce((s, g) => s + g.docs.length, 0) + rescisao.reduce((s, g) => s + g.itens.length, 0);

  async function mandarParaAnalise(ids: string[]) {
    setErro(null);
    setOk(null);
    let enviados = 0;
    for (const id of ids) {
      setEnviandoAnalise(id);
      try {
        await enviarParaAnalise(id);
        enviados += 1;
      } catch (e) {
        setErro(mensagemDeErro(e as Error));
        break;
      }
    }
    setEnviandoAnalise(null);
    if (enviados > 0) setOk(enviados === 1 ? 'Colaborador enviado para análise da Emais.' : `${enviados} colaboradores enviados para análise da Emais.`);
    await recarregar();
  }

  function pedirEnvio(p: Pick<PendenciaFornecedor, 'tipo_codigo' | 'colaborador_id' | 'empresa_id' | 'situacao' | 'motivo_devolucao' | 'documento'>) {
    const tipo = dados?.tipos.get(p.tipo_codigo);
    const colab = colaboradorPorId.get(p.colaborador_id);
    const emp = empresaPorId.get(p.empresa_id);
    if (!tipo || !colab || !emp || !dados) return;
    setPedido({
      tipo: { ...tipo, nome: nomeDoDocumento(p, dados.incluidos) },
      empresaId: emp.id,
      empresaNome: emp.razao_social,
      colaborador: { id: colab.id, nome: colab.nome },
      motivoDevolucao: p.situacao === 'devolvido' ? p.motivo_devolucao : null,
    });
  }

  return (
    <Pagina
      titulo="O que falta"
      apoio={
        dados
          ? totalItens === 0 && prontos.length === 0
            ? 'Nada pendente. Quando algum documento estiver perto de vencer, ele aparece aqui.'
            : 'Documentos para enviar ou renovar, e colaboradores prontos para a análise da Emais.'
          : undefined
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!dados && !erro && <Carregando />}

      {prontos.length > 0 && (
        <section className="bloco bloco-destaque">
          <div className="barra-lista">
            <h2 className="bloco-titulo">Prontos para enviar à análise</h2>
            {prontos.length > 1 && (
              <button type="button" className="botao botao-pequeno" disabled={!!enviandoAnalise} onClick={() => mandarParaAnalise(prontos.map((a) => a.alocacao_id))}>
                Enviar todos ({prontos.length})
              </button>
            )}
          </div>
          <p className="dica">Os documentos obrigatórios destes colaboradores já foram enviados. Envie para a Emais conferir e liberar.</p>
          <ul className="lista-simples">
            {prontos.map((a) => (
              <li key={a.alocacao_id}>
                <span>
                  <strong>{a.colaborador}</strong>
                  <small className="sub">{a.obra}, {rotuloStatus[a.status].toLowerCase()}</small>
                </span>
                <button type="button" className="botao botao-pequeno" disabled={!!enviandoAnalise} onClick={() => mandarParaAnalise([a.alocacao_id])}>
                  {enviandoAnalise === a.alocacao_id ? 'Enviando' : 'Enviar para análise'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendentesEmpresa.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Documentos da empresa</h2>
          <ul className="lista-farois">
            {pendentesEmpresa.map(({ empresa, docs }) => {
              const id = `empresa-${empresa.id}`;
              return (
                <LinhaCompacta
                  key={id}
                  id={id}
                  cor={corDasPendencias(docs.map((d) => ({ situacao: d.situacao, impeditivo: d.tipo.impeditivo })))}
                  titulo={empresa.razao_social}
                  manchete={resumoPendencias(docs.map((d) => d.situacao))}
                  direita={<span className="contagem-emails">{docs.length === 1 ? '1 documento' : `${docs.length} documentos`}</span>}
                  aberta={aberta === id}
                  aoAlternar={() => alternar(id)}
                >
                  <ul className="lista-pendencias">
                    {docs.map((d) => (
                      <li key={d.tipo.codigo}>
                        <ItemPendencia
                          nome={d.tipo.nome}
                          situacao={d.situacao}
                          impeditivo={d.tipo.impeditivo}
                          vencimento={d.vencimento}
                          motivo={d.motivo_devolucao}
                          renovacaoEmAnalise={d.renovacaoEmAnalise}
                          aoEnviar={() => setPedido({ tipo: d.tipo, empresaId: empresa.id, empresaNome: empresa.razao_social, colaborador: null, motivoDevolucao: d.motivo_devolucao })}
                        />
                      </li>
                    ))}
                  </ul>
                </LinhaCompacta>
              );
            })}
          </ul>
        </section>
      )}

      {porColaborador.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">
            Documentos dos colaboradores <span className="sub">{porColaborador.length}</span>
          </h2>
          <p className="dica">Clique no nome para ver e enviar os documentos.</p>
          <ul className="lista-farois">
            {porColaborador.map(({ colaborador, itens, alocacoes }) => {
              const id = `colab-${colaborador!.id}`;
              const empresa = dados && dados.empresas.length > 1 ? empresaPorId.get(colaborador!.empresa_id)?.razao_social : undefined;
              const obras = alocacoes.map((a) => `${a.obra}: ${rotuloStatus[a.status].toLowerCase()}`).join('; ');
              return (
                <LinhaCompacta
                  key={id}
                  id={id}
                  cor={corDasPendencias(itens)}
                  titulo={colaborador!.nome}
                  subtitulo={[empresa, obras].filter(Boolean).join(' · ') || undefined}
                  manchete={resumoPendencias(itens.map((p) => p.situacao))}
                  direita={<span className="contagem-emails">{itens.length === 1 ? '1 documento' : `${itens.length} documentos`}</span>}
                  aberta={aberta === id}
                  aoAlternar={() => alternar(id)}
                >
                  <ul className="lista-pendencias">
                    {itens.map((p) => (
                      <li key={p.tipo_codigo}>
                        <ItemPendencia
                          nome={dados ? nomeDoDocumento(p, dados.incluidos) : p.documento}
                          situacao={p.situacao}
                          impeditivo={p.impeditivo}
                          vencimento={p.vencimento}
                          motivo={p.situacao === 'devolvido' ? p.motivo_devolucao : null}
                          renovacaoEmAnalise={p.status_envio_aberto === 'em_analise'}
                          aoEnviar={() => pedirEnvio(p)}
                        />
                      </li>
                    ))}
                  </ul>
                  <p className="linha-botoes">
                    <Link className="botao botao-secundario botao-pequeno" to={`/meus-colaboradores?ver=${colaborador!.id}`}>Abrir o cadastro</Link>
                  </p>
                </LinhaCompacta>
              );
            })}
          </ul>
        </section>
      )}

      {rescisao.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">
            Documentos rescisórios <span className="sub">{rescisao.length}</span>
          </h2>
          <p className="dica">Colaboradores demitidos com documentos da rescisão para enviar.</p>
          <ul className="lista-farois">
            {rescisao.map((g) => {
              const id = `resc-${g.id}`;
              return (
                <LinhaCompacta
                  key={id}
                  id={id}
                  cor={corDasPendencias(g.itens)}
                  titulo={g.nome}
                  subtitulo={g.desligado ? `Desligado em ${data(g.desligado)}` : undefined}
                  manchete={resumoPendencias(g.itens.map((p) => p.situacao))}
                  direita={<span className="contagem-emails">{g.itens.length === 1 ? '1 documento' : `${g.itens.length} documentos`}</span>}
                  aberta={aberta === id}
                  aoAlternar={() => alternar(id)}
                >
                  <ul className="lista-pendencias">
                    {g.itens.map((p) => (
                      <li key={p.tipo_codigo}>
                        <ItemPendencia
                          nome={p.documento}
                          situacao={p.situacao}
                          impeditivo={p.impeditivo}
                          vencimento={null}
                          motivo={p.situacao === 'devolvido' ? p.motivo_devolucao : null}
                          renovacaoEmAnalise={false}
                          aoEnviar={() => pedirEnvio(p)}
                        />
                      </li>
                    ))}
                  </ul>
                </LinhaCompacta>
              );
            })}
          </ul>
        </section>
      )}

      <EnvioDocumento
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (nome) => {
          setPedido(null);
          setOk(`${nome} enviado. A Emais confere e você acompanha por aqui.`);
          await recarregar();
        }}
      />
    </Pagina>
  );
}

// Vermelho: algo devolvido, vencido ou obrigatório sem envio. Amarelo: só o que vence em breve ou não trava.
function corDasPendencias(itens: { situacao: string; impeditivo: boolean }[]): Cor {
  return itens.some((i) => i.situacao === 'devolvido' || i.situacao === 'vencido' || (i.situacao === 'nao_enviado' && i.impeditivo)) ? 'vermelho' : 'amarelo';
}

function resumoPendencias(situacoes: string[]): string {
  const conta = (s: string) => situacoes.filter((x) => x === s).length;
  const partes: string[] = [];
  const add = (n: number, um: string, varios: string) => n && partes.push(`${n} ${n === 1 ? um : varios}`);
  add(conta('devolvido'), 'devolvido', 'devolvidos');
  add(conta('vencido'), 'vencido', 'vencidos');
  add(conta('nao_enviado'), 'não enviado', 'não enviados');
  add(conta('a_vencer'), 'vencendo em breve', 'vencendo em breve');
  return partes.join(', ') || 'Documentos para atualizar';
}

export function ItemPendencia({
  nome, situacao, impeditivo, vencimento, motivo, renovacaoEmAnalise, aoEnviar,
}: {
  nome: string;
  situacao: PendenciaFornecedor['situacao'];
  impeditivo: boolean;
  vencimento: string | null;
  motivo: string | null;
  renovacaoEmAnalise: boolean;
  aoEnviar: () => void;
}) {
  const acao = situacao === 'nao_enviado' ? 'Enviar' : situacao === 'em_analise' ? null : situacao === 'dispensado' || situacao === 'vigente' ? 'Atualizar' : 'Enviar novo';
  return (
    <div className="item-pendencia">
      <div>
        <strong>{nome}</strong>
        <span className="sub">
          {impeditivo ? 'Obrigatório para liberar' : 'Não trava a liberação'}
          {vencimento ? `, ${situacao === 'vencido' ? 'venceu' : 'vence'} em ${data(vencimento)}` : ''}
        </span>
        {motivo && <span className="sub texto-erro">Motivo da devolução: {motivo}</span>}
        {renovacaoEmAnalise && situacao !== 'em_analise' && <span className="sub">Novo envio já em análise na Emais</span>}
      </div>
      <span className={`selo selo-doc-${situacao}`}>{rotuloSituacao[situacao]}</span>
      {acao && !renovacaoEmAnalise ? (
        <button type="button" className={situacao === 'a_vencer' || situacao === 'vigente' || situacao === 'dispensado' ? 'botao botao-secundario botao-pequeno' : 'botao botao-pequeno'} onClick={aoEnviar}>
          {acao}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

