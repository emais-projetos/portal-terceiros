import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { lerPedidosObra, responderPedidoObra, type PedidoObra } from '../../lib/ajuda';
import {
  NOMES_SITUACAO_HOMOLOGACAO, formatarCnpj, lerARegularizar, lerFornecedoresCadastro, resumoDocsFornecedor,
  type FornecedorARegularizar, type FornecedorCadastro,
} from '../../lib/homologacao';
import { EditarCadastro, NovoFornecedor, PedirMotivo, RegistrarContrato, type PedidoContrato } from './Dialogos';
import { DetalheFornecedor, SELO_HOMOLOGACAO } from './Homologacoes';

const ABAS = [
  ['cadastro', 'Cadastro'],
  ['regularizar', 'A regularizar'],
  ['pedidos', 'Pedidos de obra'],
] as const;
type Aba = (typeof ABAS)[number][0];

const FILTROS = [
  ['todos', 'Todos'],
  ['vencido', 'Com documento vencido'],
  ['vencendo', 'Vencendo'],
  ['faltando', 'Documento faltando'],
  ['contrato', 'Sem contrato ou BP'],
] as const;
type Filtro = (typeof FILTROS)[number][0];

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Fornecedores (Suprimentos): cadastro de todos, o que falta regularizar (BP, contrato) e os pedidos de outra obra.
export function Fornecedores() {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'cadastro';
  const empresa = params.get('empresa');
  const [empresas, setEmpresas] = useState<FornecedorCadastro[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [editando, setEditando] = useState<FornecedorCadastro | null>(null);
  const [regularizar, setRegularizar] = useState<FornecedorARegularizar[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoObra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState('');
  const [contrato, setContrato] = useState<PedidoContrato | null>(null);
  const [recusar, setRecusar] = useState<PedidoObra | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [e, r, p] = await Promise.all([lerFornecedoresCadastro(), lerARegularizar(), lerPedidosObra()]);
      setEmpresas(e);
      setRegularizar(r);
      setPedidos(p);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    if (!empresa) carregar();
  }, [carregar, empresa]);

  const abrir = (id: string) => setParams({ ...(aba === 'cadastro' ? {} : { aba }), empresa: id });

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return (empresas ?? []).filter((e) => {
      const nome = `${e.razao_social} ${e.dados.nome_fantasia ?? ''} ${e.dados.cidade ?? ''}`.toLowerCase();
      if (termo && !nome.includes(termo) && !(digitos.length >= 3 && e.cnpj.includes(digitos))) return false;
      const r = resumoDocsFornecedor(e);
      if (filtro === 'vencido') return r.vencidos.length > 0 || r.certidoesVencidas.length > 0 || e.colaboradores.com_vencido > 0;
      if (filtro === 'vencendo') return r.vencendo.length > 0 || e.colaboradores.com_vencendo > 0 || (e.certidoes.length > r.certidoesVencidas.length);
      if (filtro === 'faltando') return r.faltando.length > 0;
      if (filtro === 'contrato') return !e.subcontratada && (!e.codigo_bp || e.contratos_ativos === 0);
      return true;
    });
  }, [empresas, busca, filtro]);

  if (empresa) return <DetalheFornecedor empresaId={empresa} aoVoltar={() => setParams(aba === 'cadastro' ? {} : { aba })} />;

  const pendentes = (pedidos ?? []).filter((p) => p.situacao === 'pendente');
  const respondidos = (pedidos ?? []).filter((p) => p.situacao !== 'pendente').slice(0, 50);
  const carregando = !empresas && !erro;

  return (
    <Pagina
      titulo="Fornecedores"
      apoio="Todos os fornecedores do portal, o que falta regularizar no cadastro (código BP e contrato de cada obra) e os pedidos para atuar em outra obra."
      acoes={<button type="button" className="botao" onClick={() => setNovo(true)}>Novo fornecedor</button>}
      abas={
        <nav className="abas abas-botoes" aria-label="Fornecedores">
          {ABAS.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'cadastro' ? {} : { aba: a })}>
              {nome}
              {a === 'regularizar' && !!regularizar?.length && <span className="sub"> {regularizar.length}</span>}
              {a === 'pedidos' && !!pendentes.length && <span className="contador">{pendentes.length}</span>}
            </button>
          ))}
        </nav>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {carregando && <Carregando />}

      {!carregando && aba === 'cadastro' && (
        <>
          <div className="filtros">
            <label className="campo campo-busca">
              <span>Buscar</span>
              <input type="search" value={busca} placeholder="Nome, cidade ou CNPJ" onChange={(e) => setBusca(e.target.value)} />
            </label>
            <div className="chips" role="group" aria-label="Filtrar fornecedores">
              {FILTROS.map(([f, nome]) => (
                <button key={f} type="button" className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{nome}</button>
              ))}
            </div>
          </div>
          <p className="dica">{filtradas.length} de {(empresas ?? []).length} fornecedores. Documentos e colaboradores contam só quem tem colaborador em obra.</p>
          {filtradas.length === 0 ? (
            <p className="vazio">Nenhum fornecedor encontrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Fornecedor</th>
                    <th scope="col">Contato</th>
                    <th scope="col">Homologação e contrato</th>
                    <th scope="col">Documentos</th>
                    <th scope="col">Colaboradores</th>
                    <th scope="col"><span className="sr">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((e) => {
                    const r = resumoDocsFornecedor(e);
                    const local = [e.dados.cidade, e.dados.estado].filter(Boolean).join('/');
                    const vencendoCert = e.certidoes.length - r.certidoesVencidas.length;
                    return (
                      <tr key={e.empresa_id} className="linha-clicavel" onClick={() => abrir(e.empresa_id)}>
                        <th scope="row">
                          {e.razao_social}
                          <small className="sub">
                            {formatarCnpj(e.cnpj)}
                            {local ? ` · ${local}` : ''}
                            {e.subcontratada ? ' · subcontratada' : ''}
                          </small>
                          {e.dados.ramo && <small className="sub">{e.dados.ramo}</small>}
                        </th>
                        <td className="quebra">
                          {e.dados.contato || <span className="sub">Sem contato</span>}
                          {(e.dados.telefone || e.dados.celular) && <small className="sub">{[e.dados.telefone, e.dados.celular].filter(Boolean).join(' / ')}</small>}
                          <small className="sub">{e.dados.email_empresa || e.email_acesso || 'Sem e-mail'}</small>
                        </td>
                        <td>
                          <span className={`selo ${SELO_HOMOLOGACAO[e.homologacao]}`}>{e.homologacao === 'anterior' ? 'Anterior ao portal' : NOMES_SITUACAO_HOMOLOGACAO[e.homologacao]}</span>
                          {e.homologacao === 'homologada' && !e.liberado_em && <small className="sub">Portal ainda não liberado</small>}
                          {!e.subcontratada && (
                            <small className={`sub${!e.codigo_bp || e.contratos_ativos === 0 ? ' texto-alerta' : ''}`}>
                              {e.codigo_bp ? `BP ${e.codigo_bp}` : 'Sem BP'}
                              {' · '}
                              {e.contratos_ativos === 0
                                ? 'sem contrato'
                                : `${e.contratos_ativos} contrato(s)${e.proximo_termino ? `, ${diasAte(e.proximo_termino) < 0 ? 'venceu' : 'vence'} em ${data(e.proximo_termino)}` : ''}`}
                            </small>
                          )}
                        </td>
                        <td>
                          {r.vencidos.length === 0 && r.vencendo.length === 0 && r.faltando.length === 0 && e.certidoes.length === 0 ? (
                            <span className="sub">{e.documentos.length ? 'Em dia' : 'Sem cobrança'}</span>
                          ) : (
                            <span className="selos-linha">
                              {r.vencidos.length > 0 && <span className="selo selo-doc-vencido" title={r.vencidos.map((d) => d.nome).join(', ')}>{r.vencidos.length} vencido(s)</span>}
                              {r.faltando.length > 0 && <span className="selo selo-doc-nao_enviado" title={r.faltando.map((d) => d.nome).join(', ')}>{r.faltando.length} faltando</span>}
                              {r.vencendo.length > 0 && <span className="selo selo-doc-a_vencer" title={r.vencendo.map((d) => d.nome).join(', ')}>{r.vencendo.length} vencendo</span>}
                              {r.certidoesVencidas.length > 0 && <span className="selo selo-doc-vencido" title={r.certidoesVencidas.map((d) => d.nome).join(', ')}>{r.certidoesVencidas.length} certidão vencida</span>}
                              {vencendoCert > 0 && <span className="selo selo-doc-a_vencer">{vencendoCert} certidão vencendo</span>}
                            </span>
                          )}
                        </td>
                        <td>
                          {e.colaboradores.em_obra === 0 ? (
                            <span className="sub">Nenhum em obra</span>
                          ) : (
                            <>
                              {e.colaboradores.em_obra} em obra
                              <small className="sub">{e.colaboradores.liberados} liberado(s)</small>
                              {(e.colaboradores.com_vencido > 0 || e.colaboradores.com_vencendo > 0) && (
                                <small className={`sub${e.colaboradores.com_vencido ? ' texto-erro' : ' texto-alerta'}`}>
                                  {[e.colaboradores.com_vencido ? `${e.colaboradores.com_vencido} com doc. vencido` : '', e.colaboradores.com_vencendo ? `${e.colaboradores.com_vencendo} vencendo` : ''].filter(Boolean).join(', ')}
                                </small>
                              )}
                            </>
                          )}
                        </td>
                        <td className="acoes">
                          <button type="button" className="botao botao-secundario botao-pequeno" onClick={(ev) => { ev.stopPropagation(); setEditando(e); }}>Editar</button>
                          <button type="button" className="botao botao-pequeno" onClick={(ev) => { ev.stopPropagation(); abrir(e.empresa_id); }}>Abrir</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!carregando && aba === 'regularizar' && (
        <>
          <p className="apoio">
            Fornecedores que já usam o portal com algum dado faltando. Nada aqui trava a liberação dos colaboradores: é só para manter o cadastro em dia com o SAP.
          </p>
          {!regularizar?.length ? (
            <p className="vazio">Nenhum fornecedor a regularizar.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Fornecedor</th>
                    <th scope="col">O que falta</th>
                    <th scope="col"><span className="sr">Regularizar</span></th>
                  </tr>
                </thead>
                <tbody>
                  {regularizar.map((r) => (
                    <tr key={r.empresa_id}>
                      <th scope="row">
                        {r.razao_social}
                        <small className="sub">{formatarCnpj(r.cnpj)}</small>
                      </th>
                      <td className="quebra">
                        <ul className="lista-simples">
                          {r.sem_bp && <li>Código BP do SAP</li>}
                          {r.obras_sem_contrato.length > 0 && <li>Contrato da obra: {r.obras_sem_contrato.join(', ')}</li>}
                          {r.contratos_vencendo.map((c) => (
                            <li key={c.id}>Contrato {c.numero} {diasAte(c.termino) < 0 ? 'venceu' : 'vence'} em {data(c.termino)}</li>
                          ))}
                          {r.certidoes.map((c) => (
                            <li key={c.tipo}>{c.tipo} {diasAte(c.vencimento) < 0 ? 'venceu' : 'vence'} em {data(c.vencimento)} (pedido ao fornecedor por e-mail)</li>
                          ))}
                        </ul>
                      </td>
                      <td className="acoes">
                        <button type="button" className="botao botao-pequeno" onClick={() => abrir(r.empresa_id)}>Regularizar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!carregando && aba === 'pedidos' && (
        <>
          <p className="apoio">
            Para aprovar um pedido, registre o contrato da obra. A obra é liberada para o fornecedor na hora e ele recebe o aviso na Ajuda. Se a obra entra num
            contrato que já existe, abra o fornecedor e edite esse contrato.
          </p>
          <section className="bloco">
            <h2 className="bloco-titulo">Aguardando <span className="sub">{pendentes.length}</span></h2>
            {pendentes.length === 0 ? (
              <p className="vazio">Nenhum pedido aguardando.</p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela tabela-lista">
                  <thead>
                    <tr>
                      <th scope="col">Fornecedor</th>
                      <th scope="col">Obra pedida</th>
                      <th scope="col">Contrato e observação</th>
                      <th scope="col">Pedido</th>
                      <th scope="col"><span className="sr">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendentes.map((p) => {
                      const emp = empresas?.find((e) => e.empresa_id === p.empresa_id);
                      return (
                        <tr key={p.id}>
                          <th scope="row">
                            {p.empresas?.razao_social}
                            <small className="sub">{formatarCnpj(p.empresas?.cnpj ?? '')}</small>
                          </th>
                          <td>{p.obras?.nome}</td>
                          <td className="quebra">
                            {p.numero_contrato ? `Contrato informado: ${p.numero_contrato}` : <span className="sub">Sem contrato informado</span>}
                            {p.observacao && <small className="sub">{p.observacao}</small>}
                          </td>
                          <td>
                            {hora(p.pedido_em)}
                            {p.usuarios && <small className="sub">{p.usuarios.nome}</small>}
                          </td>
                          <td className="acoes">
                            <button
                              type="button"
                              className="botao botao-pequeno"
                              onClick={() =>
                                setContrato({
                                  empresaId: p.empresa_id,
                                  empresaNome: p.empresas?.razao_social ?? '',
                                  codigoBp: emp?.codigo_bp ?? null,
                                  contrato: null,
                                  obrasIniciais: [p.obra_id],
                                  numeroInicial: p.numero_contrato,
                                  titulo: `Contrato da obra ${p.obras?.nome ?? ''}`,
                                })
                              }
                            >
                              Registrar contrato
                            </button>
                            <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => abrir(p.empresa_id)}>Abrir fornecedor</button>
                            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setRecusar(p)}>Recusar</button>
                          </td>
                        </tr>
                      );
                    })}
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
                      <th scope="col">Fornecedor</th>
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
                            {p.numero_contrato && p.situacao === 'aprovado' ? `, contrato ${p.numero_contrato}` : ''}
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
        </>
      )}

      <NovoFornecedor
        aberto={novo}
        aoFechar={() => setNovo(false)}
        aoCadastrar={(msg) => {
          setNovo(false);
          setOk(`${msg} Acompanhe em Homologação.`);
          carregar();
        }}
      />
      <EditarCadastro
        fornecedor={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (msg) => {
          setEditando(null);
          setOk(`${msg}`);
          await carregar();
        }}
      />
      <RegistrarContrato
        pedido={contrato}
        aoFechar={() => setContrato(null)}
        aoRegistrar={async (msg) => {
          setContrato(null);
          setOk(`${msg} O pedido foi aprovado e o fornecedor recebeu o aviso.`);
          await carregar();
        }}
      />
      <PedirMotivo
        aberto={!!recusar}
        titulo={recusar ? `Recusar: ${recusar.obras?.nome ?? ''}` : ''}
        apoio="O motivo vai para o fornecedor na Ajuda."
        botao="Recusar pedido"
        aoFechar={() => setRecusar(null)}
        aoConfirmar={async (m) => {
          if (!recusar) return;
          await responderPedidoObra(recusar.id, false, m);
          setRecusar(null);
          setOk('Pedido recusado. O fornecedor recebeu o motivo na Ajuda.');
          await carregar();
        }}
      />
    </Pagina>
  );
}
