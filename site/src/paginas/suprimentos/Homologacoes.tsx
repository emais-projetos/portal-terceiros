import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { useSessao } from '../../lib/sessao';
import {
  ITENS_QUALIFICACAO, NOMES_SITUACAO_HOMOLOGACAO, abrirArquivoHomologacao, analisarDocumentoHomologacao, devolverHomologacao, documentoAtual,
  encerrarContrato, formatarCnpj, homologarFornecedor, lerDetalheHomologacao, lerListaHomologacoes, lerTiposHomologacao, reenviarConvite,
  reprovarHomologacao,
  type DetalheHomologacao, type DocumentoHomologacao, type ItemHomologacao, type RespostaQualificacao, type SituacaoHomologacao, type TipoHomologacao,
} from '../../lib/homologacao';
import { NovoFornecedor, PedirMotivo, RegistrarContrato, type PedidoContrato } from './Dialogos';

export const SELO_HOMOLOGACAO: Record<SituacaoHomologacao, string> = {
  anterior: 'selo-aprovado_admin',
  convidada: 'selo-em_cadastro',
  enviada: 'selo-em_analise',
  devolvida: 'selo-pendente_fornecedor',
  homologada: 'selo-liberado',
  reprovada: 'selo-bloqueado',
};

const ABAS = [
  ['analisar', 'Para analisar', ['enviada']],
  ['fornecedor', 'Com o fornecedor', ['convidada', 'devolvida']],
  ['homologados', 'Homologados', ['homologada']],
  ['reprovados', 'Reprovados', ['reprovada']],
] as const;
type Aba = (typeof ABAS)[number][0];

// Homologação (Suprimentos): fornecedores convidados, o que chegou para analisar e o parecer do F.31.
export function Homologacoes() {
  const [params, setParams] = useSearchParams();
  const empresa = params.get('empresa');
  const aba = (params.get('aba') as Aba) || 'analisar';
  const [lista, setLista] = useState<ItemHomologacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (empresa) return;
    lerListaHomologacoes()
      .then(setLista)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [empresa, versao]);

  if (empresa) {
    return <DetalheFornecedor empresaId={empresa} aoVoltar={() => setParams(aba === 'analisar' ? {} : { aba })} />;
  }

  const definicao = ABAS.find((a) => a[0] === aba) ?? ABAS[0];
  const filtrada = (lista ?? []).filter((h) => (definicao[2] as readonly string[]).includes(h.situacao));
  const contagem = (sit: readonly string[]) => (lista ?? []).filter((h) => sit.includes(h.situacao)).length;

  return (
    <Pagina
      titulo="Homologação"
      apoio="Fornecedores de serviço novos: convite, conferência dos dados e documentos do F.31 e o parecer do Suprimentos. Depois de homologado, registre o contrato em Fornecedores."
      acoes={<button type="button" className="botao" onClick={() => setNovo(true)}>Novo fornecedor</button>}
      abas={
        <nav className="abas abas-botoes" aria-label="Homologação">
          {ABAS.map(([a, nome, sit]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'analisar' ? {} : { aba: a })}>
              {nome}
              {a === 'analisar' ? !!contagem(sit) && <span className="contador">{contagem(sit)}</span> : <span className="sub"> {contagem(sit)}</span>}
            </button>
          ))}
        </nav>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!lista && !erro ? (
        <Carregando />
      ) : filtrada.length === 0 ? (
        <p className="vazio">{aba === 'analisar' ? 'Nenhuma homologação aguardando análise.' : 'Nenhum fornecedor nesta situação.'}</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Fornecedor</th>
                <th scope="col">Situação</th>
                <th scope="col">Datas</th>
                <th scope="col">Obras previstas</th>
                <th scope="col"><span className="sr">Abrir</span></th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((h) => (
                <tr key={h.empresa_id}>
                  <th scope="row">
                    {h.razao_social}
                    <small className="sub">{formatarCnpj(h.cnpj)}{h.email ? ` · ${h.email}` : ''}</small>
                  </th>
                  <td>
                    <span className={`selo ${SELO_HOMOLOGACAO[h.situacao]}`}>{NOMES_SITUACAO_HOMOLOGACAO[h.situacao]}</span>
                    {h.situacao === 'homologada' && (
                      <small className="sub">
                        {h.contratos === 0 ? 'Falta registrar o contrato' : h.liberado_em ? `Portal liberado em ${data(h.liberado_em)}` : 'Aguardando o administrativo liberar o portal'}
                      </small>
                    )}
                    {h.docs_em_analise > 0 && h.situacao !== 'enviada' && <small className="sub">{h.docs_em_analise} documento(s) novo(s) para conferir</small>}
                  </td>
                  <td>
                    <small className="sub">Convite {data(h.convidada_em)}</small>
                    {h.enviada_em && <small className="sub">Enviada {data(h.enviada_em)}</small>}
                    {h.decidida_em && <small className="sub">Parecer {data(h.decidida_em)}</small>}
                  </td>
                  <td className="quebra">{h.obras_previstas.length ? h.obras_previstas.join(', ') : <span className="sub">-</span>}</td>
                  <td className="acoes">
                    <button type="button" className="botao botao-pequeno" onClick={() => setParams({ ...(aba === 'analisar' ? {} : { aba }), empresa: h.empresa_id })}>
                      {h.situacao === 'enviada' ? 'Analisar' : 'Abrir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NovoFornecedor
        aberto={novo}
        aoFechar={() => setNovo(false)}
        aoCadastrar={(msg) => {
          setNovo(false);
          setOk(msg);
          setParams({ aba: 'fornecedor' });
          setVersao((v) => v + 1);
        }}
      />
    </Pagina>
  );
}

const ROTULO_DOC: Record<string, string> = { em_analise: 'Para conferir', aprovado: 'Aprovado', devolvido: 'Devolvido', nao: 'Não enviado', vencido: 'Vencido' };
const CLASSE_DOC: Record<string, string> = { em_analise: 'selo-doc-em_analise', aprovado: 'selo-doc-vigente', devolvido: 'selo-doc-devolvido', nao: 'selo-doc-nao_enviado', vencido: 'selo-doc-vencido' };

export function DetalheFornecedor({ empresaId, aoVoltar }: { empresaId: string; aoVoltar: () => void }) {
  const { usuario } = useSessao();
  const [d, setD] = useState<DetalheHomologacao | null>(null);
  const [tipos, setTipos] = useState<TipoHomologacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [devolverDoc, setDevolverDoc] = useState<DocumentoHomologacao | null>(null);
  const [dialogo, setDialogo] = useState<'devolver' | 'reprovar' | null>(null);
  const [encerrar, setEncerrar] = useState<string | null>(null);
  const [contrato, setContrato] = useState<PedidoContrato | null>(null);
  const [qualificacao, setQualificacao] = useState<Record<string, RespostaQualificacao>>({});
  const [comentarios, setComentarios] = useState('');
  const [responsavel, setResponsavel] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [x, t] = await Promise.all([lerDetalheHomologacao(empresaId), lerTiposHomologacao()]);
      setD(x);
      setTipos(t);
      setQualificacao(x.qualificacao ?? {});
      setComentarios(x.comentarios ?? '');
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [empresaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (d && !responsavel) setResponsavel(d.responsavel ?? usuario?.nome ?? '');
  }, [d, responsavel, usuario]);

  const resumoDocs = useMemo(() => {
    if (!d) return { faltando: [] as string[], emAnalise: 0 };
    const faltando = tipos.filter((t) => t.obrigatorio && !d.documentos.some((x) => x.tipo === t.codigo && x.status === 'aprovado')).map((t) => t.nome);
    return { faltando, emAnalise: d.documentos.filter((x) => x.status === 'em_analise').length };
  }, [d, tipos]);

  async function acao(fn: () => Promise<unknown>, msg: string) {
    setErro(null);
    setOcupado(true);
    try {
      await fn();
      setOk(msg);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      throw e;
    } finally {
      setOcupado(false);
    }
  }

  const titulo = d?.razao_social ?? 'Fornecedor';
  if (!d) {
    return (
      <Pagina titulo={titulo}>
        <p><button type="button" className="link-voltar botao-link" onClick={aoVoltar}>‹ Voltar</button></p>
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );
  }

  const dados = d.dados ?? {};
  const analisando = d.situacao === 'enviada';
  const qualificacaoCompleta = ITENS_QUALIFICACAO.every((i) => qualificacao[i.chave]);
  const podeHomologar = analisando && resumoDocs.faltando.length === 0 && resumoDocs.emAnalise === 0 && qualificacaoCompleta && responsavel.trim().length >= 3;
  const ativos = d.contratos.filter((c) => c.situacao === 'ativo');

  const valor = (rotulo: string, v: string | null | undefined) => (
    <div className="campo">
      <span>{rotulo}</span>
      <span className="valor-fixo">{v || '-'}</span>
    </div>
  );

  return (
    <Pagina
      titulo={titulo}
      apoio={`CNPJ ${formatarCnpj(d.cnpj)}${d.email ? ` · ${d.email}` : ''}${d.codigo_bp ? ` · BP ${d.codigo_bp}` : ''}`}
      acoes={
        d.situacao !== 'anterior' ? (
          <button
            type="button"
            className="botao botao-secundario"
            onClick={() => import('../../lib/pdfF31').then((m) => m.baixarF31(d, tipos)).catch((e) => setErro(mensagemDeErro(e)))}
          >
            Baixar F.31 (PDF)
          </button>
        ) : undefined
      }
    >
      <p><button type="button" className="link-voltar botao-link" onClick={aoVoltar}>‹ Voltar</button></p>
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <section className="bloco">
        <div className="barra-lista">
          <h2 className="bloco-titulo">Situação</h2>
          <span className={`selo ${SELO_HOMOLOGACAO[d.situacao]}`}>{NOMES_SITUACAO_HOMOLOGACAO[d.situacao]}</span>
        </div>
        <ul className="lista-simples">
          {d.convidada_em && <li>Convite enviado em {data(d.convidada_em)}</li>}
          {d.enviada_em && <li>Enviada pelo fornecedor em {data(d.enviada_em)}</li>}
          {d.decidida_em && <li>Parecer em {data(d.decidida_em)}{d.decidida_por ? ` por ${d.decidida_por}` : ''}{d.responsavel ? `, aprovação de ${d.responsavel}` : ''}</li>}
          {d.motivo && <li>{d.situacao === 'reprovada' ? 'Motivo da reprovação' : 'Observação enviada'}: {d.motivo}</li>}
          {d.situacao === 'homologada' && (
            <li>
              {ativos.length === 0
                ? 'Próximo passo: registrar o contrato assinado, mais abaixo.'
                : d.liberado_em
                  ? `Portal liberado pelo administrativo em ${data(d.liberado_em)}.`
                  : 'Contrato registrado. Aguardando o administrativo liberar o portal para o fornecedor.'}
            </li>
          )}
          {d.obras_previstas.length > 0 && <li>Obras previstas: {d.obras_previstas.map((o) => o.nome).join(', ')}</li>}
        </ul>
        {(d.situacao === 'convidada' || d.situacao === 'devolvida') && (
          <div className="linha-botoes">
            <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado} onClick={() => acao(() => reenviarConvite(d.empresa_id), 'Convite colocado de novo na fila de e-mails.').catch(() => undefined)}>
              Reenviar convite
            </button>
            <button type="button" className="botao botao-discreto botao-pequeno" disabled={ocupado} onClick={() => setDialogo('reprovar')}>Reprovar</button>
          </div>
        )}
      </section>

      {d.situacao !== 'anterior' && (
        <section className="bloco">
          <h2 className="bloco-titulo">Dados do F.31</h2>
          {!d.dados || Object.keys(dados).filter((k) => k !== 'email').length === 0 ? (
            <p className="vazio">O fornecedor ainda não preencheu os dados.</p>
          ) : (
            <>
              <div className="grade-3">
                {valor('Razão social', dados.razao_social)}
                {valor('Nome fantasia', dados.nome_fantasia)}
                {valor('Ramo de atividade', dados.ramo)}
                {valor('Endereço', [dados.endereco, dados.numero, dados.complemento].filter(Boolean).join(', '))}
                {valor('Bairro', dados.bairro)}
                {valor('Cidade/UF', [dados.cidade, dados.estado].filter(Boolean).join('/'))}
                {valor('CEP', dados.cep)}
                {valor('Contato', dados.contato)}
                {valor('Telefone', [dados.telefone, dados.celular].filter(Boolean).join(' / '))}
                {valor('E-mail da empresa', dados.email_empresa)}
                {valor('Praça de atuação', dados.praca)}
                {valor('Inscrição estadual', dados.inscricao_estadual)}
                {valor('Inscrição municipal', dados.inscricao_municipal)}
                {valor('Banco', dados.banco)}
                {valor('Agência e conta', [dados.agencia, dados.conta].filter(Boolean).join(' / '))}
              </div>
              <h3 className="detalhe-subtitulo">Referências comerciais</h3>
              {(dados.referencias ?? []).filter((r) => r.empresa).length === 0 ? (
                <p className="dica">Nenhuma referência informada.</p>
              ) : (
                <ul className="lista-simples">
                  {(dados.referencias ?? []).filter((r) => r.empresa).map((r, i) => (
                    <li key={i}>
                      <span>
                        <strong>{r.empresa}</strong>
                        {[r.contato, r.telefone, r.email, [r.cidade, r.estado].filter(Boolean).join('/')].filter(Boolean).map((x) => ` · ${x}`).join('')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {d.situacao !== 'anterior' && (
        <section className="bloco">
          <h2 className="bloco-titulo">Documentos</h2>
          <div className="lista-pendencias">
            {tipos.map((t) => {
              const doc = documentoAtual(d.documentos, t.codigo);
              const anterior = doc?.status === 'em_analise' ? d.documentos.find((x) => x.tipo === t.codigo && x.status === 'aprovado') : null;
              const vencido = doc?.status === 'aprovado' && !!doc.vencimento && diasAte(doc.vencimento) < 0;
              const sit = !doc ? 'nao' : vencido ? 'vencido' : doc.status;
              return (
                <div className="item-pendencia" key={t.codigo}>
                  <div>
                    <strong>{t.nome}</strong>
                    <span className="sub">
                      {t.obrigatorio ? 'Obrigatório' : 'Se houver'}
                      {doc?.data_emissao ? `, emitido em ${data(doc.data_emissao)}` : ''}
                      {doc?.vencimento ? `, ${vencido ? 'venceu' : 'vence'} em ${data(doc.vencimento)}` : ''}
                      {t.tipo_portal ? ', vale também em Documentos da empresa' : ''}
                    </span>
                    {doc?.status === 'devolvido' && doc.motivo && <span className="sub texto-erro">Devolvido: {doc.motivo}</span>}
                    {doc?.status === 'aprovado' && doc.analisado_por && <span className="sub">Aprovado por {doc.analisado_por}{doc.analisado_em ? ` em ${data(doc.analisado_em)}` : ''}</span>}
                    {anterior && <span className="sub">Renovação: o aprovado anterior vence em {anterior.vencimento ? data(anterior.vencimento) : '-'}</span>}
                    {doc?.arquivos?.length ? (
                      <span className="sub">
                        {doc.arquivos.map((a, i) => (
                          <button key={a.caminho} type="button" className="botao-link" onClick={() => abrirArquivoHomologacao(a.caminho).catch((e) => setErro(mensagemDeErro(e)))}>
                            {a.nome ?? `Arquivo ${i + 1}`}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <span className={`selo ${CLASSE_DOC[sit]}`}>{ROTULO_DOC[sit]}</span>
                  {doc?.status === 'em_analise' ? (
                    <span className="acoes">
                      <button type="button" className="botao botao-pequeno" disabled={ocupado} onClick={() => acao(() => analisarDocumentoHomologacao(doc.id, true), `${t.nome} aprovado.`).catch(() => undefined)}>
                        Aprovar
                      </button>
                      <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado} onClick={() => setDevolverDoc(doc)}>
                        Devolver
                      </button>
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(analisando || d.situacao === 'homologada' || d.situacao === 'reprovada') && (
        <section className="bloco">
          <h2 className="bloco-titulo">Qualificação</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Sim</th>
                  <th scope="col">Não</th>
                  <th scope="col">NA</th>
                </tr>
              </thead>
              <tbody>
                {ITENS_QUALIFICACAO.map((i) => (
                  <tr key={i.chave}>
                    <th scope="row">{i.texto}<small className="sub">{i.grupo}</small></th>
                    {(['sim', 'nao', 'na'] as RespostaQualificacao[]).map((r) => (
                      <td key={r}>
                        <input
                          type="radio"
                          name={`q-${i.chave}`}
                          aria-label={`${i.texto}: ${r}`}
                          checked={qualificacao[i.chave] === r}
                          disabled={!analisando}
                          onChange={() => setQualificacao((q) => ({ ...q, [i.chave]: r }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grade-2">
            <label className="campo">
              <span>Comentários</span>
              <textarea rows={3} value={comentarios} maxLength={2000} readOnly={!analisando} onChange={(e) => setComentarios(e.target.value)} />
            </label>
            <label className="campo">
              <span>Responsável pela aprovação</span>
              <input value={responsavel} maxLength={200} readOnly={!analisando} onChange={(e) => setResponsavel(e.target.value)} />
            </label>
          </div>
          {analisando && (
            <>
              {!podeHomologar && (
                <ul className="lista-simples dica">
                  {resumoDocs.emAnalise > 0 && <li>Confira os {resumoDocs.emAnalise} documento(s) para conferir.</li>}
                  {resumoDocs.faltando.length > 0 && <li>Para homologar, faltam aprovados: {resumoDocs.faltando.join(', ')}. Devolva para o fornecedor corrigir.</li>}
                  {!qualificacaoCompleta && <li>Responda todos os itens da qualificação.</li>}
                </ul>
              )}
              <div className="linha-botoes">
                <button
                  type="button"
                  className="botao"
                  disabled={!podeHomologar || ocupado}
                  onClick={() => acao(() => homologarFornecedor(d.empresa_id, qualificacao, comentarios, responsavel.trim()), 'Fornecedor homologado. Agora registre o contrato assinado.').catch(() => undefined)}
                >
                  Homologar
                </button>
                <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => setDialogo('devolver')}>Devolver para correção</button>
                <button type="button" className="botao botao-discreto" disabled={ocupado} onClick={() => setDialogo('reprovar')}>Reprovar</button>
              </div>
            </>
          )}
        </section>
      )}

      {(d.situacao === 'homologada' || d.situacao === 'anterior') && (
        <section className="bloco">
          <div className="barra-lista">
            <h2 className="bloco-titulo">Contratos</h2>
            <button
              type="button"
              className="botao botao-pequeno"
              onClick={() => {
                const semContrato = d.obras_ativas.filter((o) => !ativos.some((c) => c.obras.some((x) => x.id === o.id)));
                setContrato({
                  empresaId: d.empresa_id,
                  empresaNome: d.razao_social,
                  codigoBp: d.codigo_bp,
                  contrato: null,
                  obrasIniciais: semContrato.length ? semContrato.map((o) => o.id) : ativos.length ? [] : d.obras_previstas.map((o) => o.id),
                  numeroInicial: semContrato.find((o) => o.numero_contrato)?.numero_contrato ?? null,
                });
              }}
            >
              Registrar contrato
            </button>
          </div>
          {d.contratos.length === 0 ? (
            <p className="vazio">Nenhum contrato registrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Contrato</th>
                    <th scope="col">Vigência</th>
                    <th scope="col">Obras</th>
                    <th scope="col"><span className="sr">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {d.contratos.map((c) => {
                    const dias = diasAte(c.termino);
                    return (
                      <tr key={c.id} className={c.situacao === 'encerrado' ? 'linha-inativa' : undefined}>
                        <th scope="row">
                          {c.numero}
                          <small className="sub">BP {c.codigo_bp}</small>
                          <button type="button" className="botao-link" onClick={() => abrirArquivoHomologacao(c.arquivo).catch((e) => setErro(mensagemDeErro(e)))}>{c.arquivo_nome}</button>
                        </th>
                        <td>
                          {data(c.inicio)} a {data(c.termino)}
                          {c.situacao === 'encerrado' ? (
                            <small className="sub">Encerrado</small>
                          ) : dias < 0 ? (
                            <small className="sub texto-erro">Vencido</small>
                          ) : dias <= 30 ? (
                            <small className="sub texto-alerta">Vence em {dias} dia(s)</small>
                          ) : null}
                        </td>
                        <td className="quebra">{c.obras.map((o) => o.nome).join(', ')}</td>
                        <td className="acoes">
                          {c.situacao === 'ativo' && (
                            <>
                              <button
                                type="button"
                                className="botao botao-secundario botao-pequeno"
                                onClick={() => setContrato({ empresaId: d.empresa_id, empresaNome: d.razao_social, codigoBp: d.codigo_bp, contrato: c, obrasIniciais: [] })}
                              >
                                Editar
                              </button>
                              <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setEncerrar(c.id)}>Encerrar</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {d.obras_ativas.length > 0 && (
            <p className="dica">Obras ativas do fornecedor: {d.obras_ativas.map((o) => `${o.nome}${o.numero_contrato ? ` (${o.numero_contrato})` : ' (sem contrato)'}`).join(', ')}</p>
          )}
        </section>
      )}

      <p><Link className="link" to="/fornecedores">Ver todos os fornecedores ›</Link></p>

      <PedirMotivo
        aberto={!!devolverDoc}
        titulo={devolverDoc ? `Devolver ${tipos.find((t) => t.codigo === devolverDoc.tipo)?.nome ?? 'documento'}` : ''}
        apoio="O motivo aparece para o fornecedor no portal e no e-mail de correções."
        botao="Devolver documento"
        aoFechar={() => setDevolverDoc(null)}
        aoConfirmar={async (m) => {
          if (!devolverDoc) return;
          await acao(() => analisarDocumentoHomologacao(devolverDoc.id, false, m), 'Documento devolvido.');
          setDevolverDoc(null);
        }}
      />
      <PedirMotivo
        aberto={dialogo === 'devolver'}
        titulo="Devolver para correção"
        apoio="O fornecedor recebe um e-mail com os documentos devolvidos e esta observação. Se só os dados precisam de ajuste, explique aqui."
        botao="Devolver ao fornecedor"
        rotulo="Observação para o fornecedor"
        minimo={0}
        aoFechar={() => setDialogo(null)}
        aoConfirmar={async (m) => {
          await acao(() => devolverHomologacao(d.empresa_id, m), 'Homologação devolvida. O e-mail de correções entrou na fila.');
          setDialogo(null);
        }}
      />
      <PedirMotivo
        aberto={dialogo === 'reprovar'}
        titulo="Reprovar homologação"
        apoio="O fornecedor recebe o motivo por e-mail e não segue para o cadastro dos colaboradores."
        botao="Reprovar"
        minimo={5}
        aoFechar={() => setDialogo(null)}
        aoConfirmar={async (m) => {
          await acao(() => reprovarHomologacao(d.empresa_id, m), 'Homologação reprovada.');
          setDialogo(null);
        }}
      />
      <PedirMotivo
        aberto={!!encerrar}
        titulo="Encerrar contrato"
        apoio="O contrato sai das obras em A regularizar. Os colaboradores do fornecedor não são bloqueados por isso."
        botao="Encerrar contrato"
        aoFechar={() => setEncerrar(null)}
        aoConfirmar={async (m) => {
          if (!encerrar) return;
          await acao(() => encerrarContrato(encerrar, m), 'Contrato encerrado.');
          setEncerrar(null);
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
