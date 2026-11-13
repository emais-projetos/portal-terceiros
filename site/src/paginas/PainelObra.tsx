import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSessao } from '../lib/sessao';
import { DetalheFrentes, LegendaFarois, LinhaFarol, ResumoFarois } from '../componentes/Farois';
import { contarCores, faroisDaObra } from '../lib/farois';
import { Pagina, Mensagem } from '../componentes/Pagina';
import { Carregando } from '../componentes/Carregando';
import { Cartao } from '../componentes/Graficos';
import { GradeMedicao } from '../componentes/GradeMedicao';
import { mensagemDeErro } from '../lib/supabase';
import { data, diasAte, rotuloStatus } from '../lib/formato';
import { mesPorExtenso, rotuloStatusMedicao, seloMedicao } from '../lib/medicao';
import {
  INICIO_MEDICAO_PORTAL, type ObraDoPainel, lerObrasDoPainel, lerPainelObra, mesesDoPainel, pagamentoDe, situacaoIntegracao,
  type ColaboradorObra, type MedicaoObra, type PainelObra as Painel, type PendenciaDoc,
} from '../lib/painelObra';

const rotuloPendencia: Record<PendenciaDoc['situacao'], string> = {
  nao_enviado: 'não enviado',
  devolvido: 'devolvido, falta corrigir',
  vencido: 'vencido',
  em_analise: 'em análise na Emais',
};

const rotuloIntegracao = { em_dia: 'Em dia', vencendo: 'Vence em breve', vencida: 'Vencida', sem: 'Sem integração' } as const;
const seloIntegracao = { em_dia: 'selo-doc-vigente', vencendo: 'selo-doc-a_vencer', vencida: 'selo-doc-vencido', sem: 'selo-doc-nao_enviado' } as const;
const seloPagamento = { liberar: 'selo-doc-vigente', reter: 'selo-doc-vencido', aguardar: 'selo-doc-a_vencer' } as const;
const rotuloPagamento = { liberar: 'Liberar', reter: 'Reter', aguardar: 'Aguardar' } as const;

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
// Pendência que trava: o que está em análise ainda pode ser aprovado, então não conta como falta.
const trava = (c: ColaboradorObra) => c.pendencias.some((p) => p.situacao !== 'em_analise');

export function PainelObra() {
  const { usuario } = useSessao();
  // Os detalhes (pagamento por mês, histórico da medição, documentos e colaboradores) ficam só para o administrativo.
  const comDetalhes = usuario?.perfil === 'admin';
  const [params, setParams] = useSearchParams();
  const [obras, setObras] = useState<ObraDoPainel[] | null>(null);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const obraId = params.get('obra') ?? obras?.[0]?.id ?? '';

  useEffect(() => {
    lerObrasDoPainel()
      .then(setObras)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  useEffect(() => {
    if (!obraId) return;
    setPainel(null);
    lerPainelObra(obraId)
      .then(setPainel)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [obraId]);

  return (
    <Pagina
      titulo={painel ? painel.obra : 'Painel da obra'}
      apoio="Situação de cada empresa da obra em documentos, integração e medição. Clique numa empresa para ver o que é cada pendência."
      acoes={
        obras && obras.length > 1 ? (
          <label className="campo">
            <span>Obra</span>
            <select value={obraId} onChange={(e) => setParams({ obra: e.target.value })}>
              {obras.map((o) => (
                <option key={o.id} value={o.id}>{o.nome}{o.situacao === 'em_encerramento' ? ' (em encerramento)' : ''}</option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {obras && obras.length === 0 && <p className="vazio">Nenhuma obra está ligada ao seu acesso. Peça ao administrativo da Emais para incluir as suas obras.</p>}
      {obraId && !painel && !erro && <Carregando />}
      {painel && (
        <>
          <FaroisDaObra painel={painel} obraId={obraId} />
          {comDetalhes && (
            <details className="detalhes-obra">
              <summary>Mais detalhes da obra: pagamento por mês, histórico da medição, documentos e colaboradores</summary>
              <Conteudo painel={painel} />
            </details>
          )}
        </>
      )}
    </Pagina>
  );
}

// Faróis: uma linha por empresa, o pior farol primeiro. Ao clicar, o que está por trás de cada um.
function FaroisDaObra({ painel, obraId }: { painel: Painel; obraId: string }) {
  const { usuario } = useSessao();
  const farois = useMemo(() => faroisDaObra(painel.colaboradores, painel.medicoes), [painel]);
  const [aberta, setAberta] = useState<string | null>(null);
  const contagem = contarCores(farois);
  if (!farois.length) return <p className="vazio">Nenhuma empresa com colaborador nesta obra.</p>;
  return (
    <section aria-label="Faróis das empresas">
      <ResumoFarois contagem={contagem} />
      <LegendaFarois />
      <ul className="lista-farois">
        {farois.map((f) => (
          <LinhaFarol
            key={f.empresaId}
            id={f.empresaId}
            geral={f.geral}
            titulo={f.empresa}
            manchete={f.manchete}
            doc={f.doc.cor}
            int={f.int.cor}
            med={f.med.cor}
            aberta={aberta === f.empresaId}
            aoAlternar={() => setAberta(aberta === f.empresaId ? null : f.empresaId)}
          >
            <DetalheFrentes
              doc={f.doc}
              int={f.int}
              med={f.med}
              extra={
                (usuario?.perfil === 'tst' || usuario?.perfil === 'admin') && f.aguardandoTst > 0 ? (
                  <p className="linha-botoes">
                    <Link className="botao botao-pequeno" to={`/colaboradores?situacao=tst&obra=${obraId}&busca=${encodeURIComponent(f.empresa)}`}>
                      Validar {f.aguardandoTst} {f.aguardandoTst === 1 ? 'colaborador' : 'colaboradores'}
                    </Link>
                  </p>
                ) : undefined
              }
            />
          </LinhaFarol>
        ))}
      </ul>
      <p className="dica">Bloqueios primeiro, depois pendências, depois as empresas em dia. Integração conta só os liberados pelo portal, de setembro de 2026 em diante.</p>
    </section>
  );
}

function Conteudo({ painel }: { painel: Painel }) {
  const meses = useMemo(() => mesesDoPainel(painel.medicoes), [painel]);
  const [mes, setMes] = useState(meses[0]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'pendencia' | 'integracao' | 'aguardando'>('todos');
  const [limite, setLimite] = useState(30);
  const [aberta, setAberta] = useState<string | null>(null);

  const colabs = painel.colaboradores;
  const liberados = colabs.filter((c) => c.status === 'liberado');
  const aguardando = colabs.filter((c) => c.status !== 'liberado');
  const liberadosComPendencia = liberados.filter(trava);
  const integracaoEmDia = liberados.filter((c) => situacaoIntegracao(c) === 'em_dia').length;
  const semIntegracao = liberados.filter((c) => situacaoIntegracao(c) === 'sem').length;
  const integracaoVencendo = liberados.filter((c) => ['vencendo', 'vencida'].includes(situacaoIntegracao(c))).length;

  // Empresas da obra: as que têm colaborador e as que têm medição.
  const empresas = useMemo(() => {
    const m = new Map<string, string>();
    colabs.forEach((c) => m.set(c.empresa_id, c.empresa));
    painel.medicoes.forEach((x) => m.set(x.empresa_id, x.empresa));
    return [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [colabs, painel.medicoes]);

  // Medição do mês: uma linha por empresa com colaborador liberado ou com medição no mês.
  const linhasMedicao = useMemo(() => {
    const doMes = new Map<string, MedicaoObra>(painel.medicoes.filter((m) => m.competencia === mes).map((m) => [m.empresa_id, m]));
    const comLiberado = new Set(liberados.map((c) => c.empresa_id));
    return empresas
      .filter((e) => doMes.has(e.id) || (comLiberado.has(e.id) && mes >= INICIO_MEDICAO_PORTAL))
      .map((e) => ({ empresa: e, medicao: doMes.get(e.id) ?? null, pagamento: pagamentoDe(doMes.get(e.id) ?? null, mes) }))
      .sort((a, b) => ordemPagamento[a.pagamento.acao] - ordemPagamento[b.pagamento.acao] || a.empresa.nome.localeCompare(b.empresa.nome, 'pt-BR'));
  }, [painel.medicoes, empresas, liberados, mes]);
  const itensGrade = useMemo(() => painel.medicoes.map((m) => ({ ...m, pendentes: m.itens_pendentes.length })), [painel.medicoes]);
  const verMes = (competencia: string) => {
    setMes(competencia);
    document.getElementById('medicao-mes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const liberar = linhasMedicao.filter((l) => l.pagamento.acao === 'liberar').length;
  const reter = linhasMedicao.filter((l) => l.pagamento.acao === 'reter').length;
  const aguardar = linhasMedicao.length - liberar - reter;

  const conformidade = empresas
    .map((e) => {
      const l = colabs.filter((c) => c.empresa_id === e.id);
      const lib = l.filter((c) => c.status === 'liberado');
      return {
        empresa: e,
        liberados: lib.length,
        comPendencia: lib.filter(trava),
        aguardando: l.filter((c) => c.status !== 'liberado').length,
        aVencer: lib.filter((c) => c.a_vencer.length > 0).length,
      };
    })
    .filter((x) => x.liberados + x.aguardando > 0)
    .sort((a, b) => b.comPendencia.length - a.comPendencia.length || a.empresa.nome.localeCompare(b.empresa.nome, 'pt-BR'));

  const turmasAbertas = painel.integracoes.filter((t) => !t.concluida_em).sort((a, b) => a.data.localeCompare(b.data));
  const turmasRealizadas = painel.integracoes.filter((t) => t.concluida_em).slice(0, 6);
  const precisamIntegracao = liberados
    .filter((c) => situacaoIntegracao(c) !== 'em_dia')
    .sort((a, b) => (a.vencimento_integracao ?? '').localeCompare(b.vencimento_integracao ?? '') || a.colaborador.localeCompare(b.colaborador, 'pt-BR'));

  const t = busca.trim().toLowerCase();
  const filtrados = colabs.filter(
    (c) =>
      (!t || c.colaborador.toLowerCase().includes(t) || c.empresa.toLowerCase().includes(t) || (c.funcao ?? '').toLowerCase().includes(t)) &&
      (filtro === 'todos' ||
        (filtro === 'pendencia' && c.status === 'liberado' && trava(c)) ||
        (filtro === 'integracao' && c.status === 'liberado' && situacaoIntegracao(c) !== 'em_dia') ||
        (filtro === 'aguardando' && c.status !== 'liberado')),
  );
  const visiveis = filtrados.slice(0, limite);

  return (
    <>
      <div className="cartoes">
        <Cartao rotulo="Liberados para trabalhar" valor={String(liberados.length)} apoio={`${aguardando.length} aguardando liberação na obra.`} />
        <Cartao
          rotulo="Conformidade documental"
          valor={`${pct(liberados.length - liberadosComPendencia.length, liberados.length)}%`}
          alerta={liberadosComPendencia.length > 0}
          apoio={liberadosComPendencia.length ? `${liberadosComPendencia.length} liberados com documento vencido ou faltando.` : 'Todos os liberados com documentos em dia.'}
        />
        <Cartao
          rotulo="Integração em dia"
          valor={`${pct(integracaoEmDia, liberados.length)}%`}
          alerta={semIntegracao + integracaoVencendo > 0}
          apoio={`${semIntegracao} sem integração registrada, ${integracaoVencendo} vencida ou vencendo em 30 dias.`}
        />
        <Cartao
          rotulo={`Pagamentos de ${mesPorExtenso(mes).split(' ')[0]}`}
          valor={`${liberar} liberar`}
          alerta={reter > 0}
          apoio={`${reter} reter, ${aguardar} aguardando.`}
        />
      </div>

      <section className="bloco" id="medicao-mes">
        <div className="barra-lista">
          <h2 className="bloco-titulo">Medição: pagamento das empresas</h2>
          <label className="campo campo-compacto">
            <span className="sr">Mês trabalhado</span>
            <select value={mes} onChange={(e) => setMes(e.target.value)}>
              {meses.map((m) => (
                <option key={m} value={m}>{mesPorExtenso(m)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="dica">
          Liberar: medição aprovada pela Emais. Reter: passou do dia 30 (ou da data combinada) sem aprovação. Aguardar: ainda no prazo, na tolerância ou em
          conferência.
        </p>
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">Pagamento</th>
                <th scope="col">Medição</th>
                <th scope="col">O que falta</th>
              </tr>
            </thead>
            <tbody>
              {linhasMedicao.length === 0 && (
                <tr>
                  <td colSpan={4} className="vazio-linha">Nenhuma empresa com medição neste mês.</td>
                </tr>
              )}
              {linhasMedicao.map(({ empresa, medicao, pagamento }) => (
                <tr key={empresa.id}>
                  <th scope="row">{empresa.nome}</th>
                  <td>
                    <span className={`selo ${seloPagamento[pagamento.acao]}`}>{rotuloPagamento[pagamento.acao]}</span>
                    <small className="sub">
                      {pagamento.motivo}
                      {pagamento.ate ? `, até ${data(pagamento.ate)}` : ''}
                    </small>
                  </td>
                  <td>
                    {medicao ? <span className={`selo ${seloMedicao[medicao.status]}`}>{rotuloStatusMedicao[medicao.status]}</span> : <span className="sub">Não enviada</span>}
                    {medicao?.primeiro_envio_em && <small className="sub">Enviada em {data(medicao.primeiro_envio_em)}</small>}
                  </td>
                  <td>
                    {!medicao ? (
                      <span className="sub">Medição não iniciada</span>
                    ) : medicao.status === 'aprovada' ? (
                      <span className="sub">Nada</span>
                    ) : medicao.itens_pendentes.length >= 12 ? (
                      <span className="sub">Documentos não enviados</span>
                    ) : medicao.itens_pendentes.length > 0 ? (
                      <span>{medicao.itens_pendentes.join('; ')}</span>
                    ) : (
                      <span className="sub">{medicao.status === 'em_analise' ? 'Em conferência na Emais' : 'Correção de colaboradores'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Histórico da medição por empresa</h2>
        <p className="dica">
          Situação de cada empresa mês a mês, como na planilha de controle. De março a agosto de 2026 os meses vêm da planilha, que não separava por obra;
          aparecem aqui as empresas que têm ou tiveram colaborador nesta obra. Clique numa célula para ver o mês no quadro de pagamento.
        </p>
        <GradeMedicao
          itens={itensGrade}
          textoAjuda="Passe o mouse na célula para ver a origem e os itens pendentes."
          celula={(m, conteudo, props) => (
            <button type="button" {...props} onClick={() => verMes(m.competencia)}>
              {conteudo}
            </button>
          )}
        />
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Conformidade documental por empresa</h2>
        <p className="dica">Documentos obrigatórios dos colaboradores liberados. Clique na empresa para ver quem tem pendência.</p>
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col" className="num">Liberados</th>
                <th scope="col" className="num">Com pendência</th>
                <th scope="col" className="num">Em dia</th>
                <th scope="col" className="num">Vencem em 30 dias</th>
                <th scope="col" className="num">Aguardando liberação</th>
              </tr>
            </thead>
            <tbody>
              {conformidade.map((x) => {
                const emDia = pct(x.liberados - x.comPendencia.length, x.liberados);
                const expandida = aberta === x.empresa.id;
                return [
                  <tr key={x.empresa.id}>
                    <th scope="row">
                      {x.comPendencia.length > 0 ? (
                        <button type="button" className="link-botao" aria-expanded={expandida} onClick={() => setAberta(expandida ? null : x.empresa.id)}>
                          {x.empresa.nome}
                        </button>
                      ) : (
                        x.empresa.nome
                      )}
                    </th>
                    <td className="num" data-rotulo="Liberados">{x.liberados}</td>
                    <td className="num" data-rotulo="Com pendência">{x.comPendencia.length ? <strong className="texto-erro">{x.comPendencia.length}</strong> : <span className="zero">0</span>}</td>
                    <td className="num" data-rotulo="Em dia">{x.liberados ? `${emDia}%` : ''}</td>
                    <td className="num" data-rotulo="Vencem em 30 dias">{x.aVencer || <span className="zero">0</span>}</td>
                    <td className="num" data-rotulo="Aguardando liberação">{x.aguardando || <span className="zero">0</span>}</td>
                  </tr>,
                  expandida && (
                    <tr key={`${x.empresa.id}-det`} className="linha-detalhe">
                      <td colSpan={6}>
                        <ul className="lista-simples">
                          {x.comPendencia.map((c) => (
                            <li key={c.alocacao_id} className="item-pessoa">
                              <span>
                                <strong>{c.colaborador}</strong>
                                {c.funcao && <small className="sub">{c.funcao.toLowerCase()}</small>}
                              </span>
                              <span className="texto-erro">
                                {c.pendencias
                                  .filter((p) => p.situacao !== 'em_analise')
                                  .map((p) => `${p.documento} (${rotuloPendencia[p.situacao]}${p.situacao === 'vencido' && p.vencimento ? ` em ${data(p.vencimento)}` : ''})`)
                                  .join('; ')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Integração</h2>
        <div className="duas-colunas">
          <div>
            <h3 className="detalhe-subtitulo">Turmas agendadas</h3>
            {turmasAbertas.length === 0 ? (
              <p className="dica">Nenhuma turma aguardando realização.</p>
            ) : (
              <ul className="lista-pendencias">
                {turmasAbertas.map((t) => (
                  <li key={t.id} className="item-turma">
                    <div>
                      <strong>
                        {data(t.data)}
                        {t.horario ? `, ${t.horario}` : ''}
                      </strong>
                      <span className="sub">
                        {t.participantes} {t.participantes === 1 ? 'participante' : 'participantes'}
                        {t.local ? `, ${t.local}` : ''}, instrutor(a) {t.responsavel}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {turmasRealizadas.length > 0 && (
              <>
                <h3 className="detalhe-subtitulo">Realizadas nos últimos 90 dias</h3>
                <ul className="lista-simples">
                  {turmasRealizadas.map((t) => (
                    <li key={t.id}>
                      {data(t.data)}: {t.presentes} de {t.participantes} presentes
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <h3 className="detalhe-subtitulo">Liberados que precisam de integração {precisamIntegracao.length > 0 && <span className="sub sub-linha">{precisamIntegracao.length}</span>}</h3>
            {precisamIntegracao.length === 0 ? (
              <p className="dica">Todos os liberados com integração em dia.</p>
            ) : (
              <ul className="lista-simples lista-alta lista-rolagem">
                {precisamIntegracao.map((c) => {
                  const s = situacaoIntegracao(c);
                  return (
                    <li key={c.alocacao_id} className="item-pessoa">
                      <span>
                        <strong>{c.colaborador}</strong>
                        <small className="sub">{c.empresa}</small>
                      </span>
                      <span className={`selo ${seloIntegracao[s]}`}>
                        {rotuloIntegracao[s]}
                        {s !== 'sem' && c.vencimento_integracao ? ` ${diasAte(c.vencimento_integracao) <= 0 ? 'em' : 'até'} ${data(c.vencimento_integracao)}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="bloco">
        <div className="barra-lista">
          <h2 className="bloco-titulo">
            Colaboradores na obra <span className="sub sub-linha">{filtrados.length}</span>
          </h2>
          <label className="campo campo-compacto">
            <span className="sr">Mostrar</span>
            <select value={filtro} onChange={(e) => { setFiltro(e.target.value as typeof filtro); setLimite(30); }}>
              <option value="todos">Todos</option>
              <option value="pendencia">Liberados com pendência</option>
              <option value="integracao">Liberados sem integração em dia</option>
              <option value="aguardando">Aguardando liberação</option>
            </select>
          </label>
          <label className="campo campo-busca campo-compacto">
            <span className="sr">Buscar colaborador</span>
            <input type="search" placeholder="Nome, empresa ou função" value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(30); }} />
          </label>
        </div>
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Colaborador</th>
                <th scope="col">Empresa</th>
                <th scope="col">Situação</th>
                <th scope="col">Integração</th>
                <th scope="col">Documentos</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => {
                const s = situacaoIntegracao(c);
                const faltas = c.pendencias.filter((p) => p.situacao !== 'em_analise');
                return (
                  <tr key={c.alocacao_id}>
                    <th scope="row">
                      {c.colaborador}
                      {c.funcao && <small className="sub">{c.funcao.toLowerCase()}</small>}
                    </th>
                    <td>{c.empresa}</td>
                    <td><span className={`selo selo-${c.status}`}>{rotuloStatus[c.status]}</span></td>
                    <td>
                      {c.status === 'liberado' ? (
                        <>
                          <span className={`selo ${seloIntegracao[s]}`}>{rotuloIntegracao[s]}</span>
                          {c.data_integracao && <small className="sub">em {data(c.data_integracao)}</small>}
                        </>
                      ) : (
                        <span className="sub">Depois da liberação</span>
                      )}
                    </td>
                    <td>
                      {faltas.length === 0 ? (
                        <span className="sub">{c.a_vencer.length ? `Em dia, ${c.a_vencer.length} vencendo` : 'Em dia'}</span>
                      ) : (
                        <span className="texto-erro">{faltas.map((p) => p.documento).join(', ')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={5} className="vazio-linha">Nenhum colaborador neste filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtrados.length > limite && (
          <button type="button" className="botao botao-secundario botao-mais" onClick={() => setLimite((n) => n + 50)}>
            Mostrar mais {Math.min(50, filtrados.length - limite)} de {filtrados.length - limite}
          </button>
        )}
      </section>
    </>
  );
}

const ordemPagamento = { reter: 0, aguardar: 1, liberar: 2 } as const;
