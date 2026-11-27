import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { lerPedidosObra, responderPedidoObra, type PedidoObra } from '../../lib/ajuda';
import {
  NOMES_SITUACAO_HOMOLOGACAO, NOMES_SITUACAO_FORNECEDOR, SELO_SITUACAO_FORNECEDOR, formatarCnpj, lerARegularizar, lerFornecedoresCadastro, resumoDocsFornecedor, lerAcessosPorEmpresa,
  type FornecedorARegularizar, type FornecedorCadastro,
} from '../../lib/homologacao';
import { lerTiposFornecedor, nomesDosTipos, type TipoFornecedor } from '../../lib/tiposFornecedor';
import { lerCategorias, nomesDasCategorias, type CategoriaServico } from '../../lib/categorias';
import { EditarCadastro, NovoFornecedor, PedirMotivo, RegistrarContrato, type PedidoContrato } from './Dialogos';
import { DetalheFornecedor, SELO_HOMOLOGACAO } from './Homologacoes';

const ABAS = [
  ['cadastro', 'Fornecedores'],
  ['pedidos', 'Pedidos de obra'],
] as const;
type Aba = (typeof ABAS)[number][0];

const FILTROS = [
  ['todos', 'Todos'],
  ['vencido', 'Com documento vencido'],
  ['vencendo', 'Vencendo'],
  ['faltando', 'Documento faltando'],
  ['contrato', 'Sem contrato ou BP'],
  ['regularizar', 'A regularizar'],
  ['sem_acesso', 'Sem acesso ao portal'],
  ['nunca', 'Nunca entrou'],
  ['bloqueados', 'Bloqueados'],
  ['inativos', 'Inativos'],
] as const;
type Filtro = (typeof FILTROS)[number][0];

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Fornecedores (Suprimentos): uma lista só com o cadastro, o acesso ao portal e o que falta regularizar (BP, contrato),
// e a aba dos pedidos para atuar em outra obra.
export function Fornecedores() {
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const aba: Aba = pedida === 'pedidos' ? 'pedidos' : 'cadastro';
  const empresa = params.get('empresa');
  const [empresas, setEmpresas] = useState<FornecedorCadastro[] | null>(null);
  const [acessos, setAcessos] = useState<Awaited<ReturnType<typeof lerAcessosPorEmpresa>> | null>(null);
  const [filtro, setFiltro] = useState<Filtro>(pedida === 'regularizar' ? 'regularizar' : pedida === 'acessos' ? 'sem_acesso' : 'todos');
  const [editando, setEditando] = useState<FornecedorCadastro | null>(null);
  const [regularizar, setRegularizar] = useState<FornecedorARegularizar[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoObra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [categoriasL, setCategoriasL] = useState<CategoriaServico[]>([]);
  const [tiposF, setTiposF] = useState<TipoFornecedor[]>([]);
  const [contrato, setContrato] = useState<PedidoContrato | null>(null);
  const [recusar, setRecusar] = useState<PedidoObra | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [e, r, p, a, tf] = await Promise.all([lerFornecedoresCadastro(), lerARegularizar(), lerPedidosObra(), lerAcessosPorEmpresa(), lerTiposFornecedor(true)]);
      setTiposF(tf);
      lerCategorias(true).then(setCategoriasL).catch(() => setCategoriasL([]));
      setEmpresas(e);
      setAcessos(a);
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
  const regPor = useMemo(() => new Map((regularizar ?? []).map((r) => [r.empresa_id, r])), [regularizar]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return (empresas ?? []).filter((e) => {
      const nome = `${e.razao_social} ${e.dados.nome_fantasia ?? ''} ${e.dados.cidade ?? ''} ${acessos?.porEmpresa.get(e.empresa_id)?.email ?? ''}`.toLowerCase();
      if (termo && !nome.includes(termo) && !(digitos.length >= 3 && e.cnpj.includes(digitos))) return false;
      if (tipoFiltro && !(e.tipos?.length ? e.tipos : ['mao_de_obra']).includes(tipoFiltro)) return false;
      if (categoriaFiltro && !(e.categorias ?? []).includes(categoriaFiltro)) return false;
      // Inativo só aparece no filtro dele; bloqueado aparece em todos.
      if (filtro === 'inativos') return e.situacao === 'inativo';
      if (e.situacao === 'inativo') return false;
      if (filtro === 'bloqueados') return e.situacao === 'bloqueado';
      const r = resumoDocsFornecedor(e);
      if (filtro === 'vencido') return r.vencidos.length > 0 || r.certidoesVencidas.length > 0 || e.colaboradores.com_vencido > 0;
      if (filtro === 'vencendo') return r.vencendo.length > 0 || e.colaboradores.com_vencendo > 0 || (e.certidoes.length > r.certidoesVencidas.length);
      if (filtro === 'faltando') return r.faltando.length > 0;
      if (filtro === 'contrato') return !e.subcontratada && (!e.codigo_bp || e.contratos_ativos === 0);
      const ac = acessos?.porEmpresa.get(e.empresa_id);
      if (filtro === 'regularizar') return regPor.has(e.empresa_id);
      if (filtro === 'sem_acesso') return !ac || !ac.ativo;
      if (filtro === 'nunca') return !!ac && ac.ativo && !ac.ultimo_login;
      return true;
    });
  }, [empresas, busca, filtro, acessos, regPor, tipoFiltro, categoriaFiltro]);

  if (empresa) return <DetalheFornecedor empresaId={empresa} aoVoltar={() => setParams(aba === 'cadastro' ? {} : { aba })} />;

  const pendentes = (pedidos ?? []).filter((p) => p.situacao === 'pendente');
  const respondidos = (pedidos ?? []).filter((p) => p.situacao !== 'pendente').slice(0, 50);
  const carregando = !empresas && !erro;

  return (
    <Pagina
      titulo="Fornecedores"
      apoio="Todos os fornecedores do portal, acesso ao portal (login), o que falta regularizar (código BP e contrato de cada obra) e os pedidos para atuar em outra obra."
      acoes={<button type="button" className="botao" onClick={() => setNovo(true)}>Novo fornecedor</button>}
      abas={
        <nav className="abas abas-botoes" aria-label="Fornecedores">
          {ABAS.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'cadastro' ? {} : { aba: a })}>
              {nome}
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
              <input type="search" value={busca} placeholder="Nome, cidade, CNPJ ou e-mail de login" onChange={(e) => setBusca(e.target.value)} />
            </label>
            <label className="campo">
              <span>Tipo</span>
              <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
                <option value="">Todos</option>
                {tiposF.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
              </select>
            </label>
            <label className="campo">
              <span>Categoria</span>
              <select value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
                <option value="">Todas</option>
                {categoriasL.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
              </select>
            </label>
            <div className="chips" role="group" aria-label="Filtrar fornecedores">
              {FILTROS.map(([f, nome]) => (
                <button key={f} type="button" className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                  {nome}
                  {f === 'regularizar' && !!regularizar?.length && <span className="chip-numero">{regularizar.length}</span>}
                </button>
              ))}
            </div>
          </div>
          <p className="dica">{filtradas.length} de {(empresas ?? []).filter((e) => e.situacao !== 'inativo').length} fornecedores ativos. Documentos e colaboradores contam só quem tem colaborador em obra.</p>
          {filtradas.length === 0 ? (
            <p className="vazio">Nenhum fornecedor encontrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Fornecedor</th>
                    <th scope="col">Contato</th>
                    <th scope="col">Acesso ao portal</th>
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
                          {e.situacao && e.situacao !== 'ativo' && (
                            <> <span className={`selo ${SELO_SITUACAO_FORNECEDOR[e.situacao]}`} title={e.situacao_motivo ?? undefined}>{NOMES_SITUACAO_FORNECEDOR[e.situacao]}</span></>
                          )}
                          <small className="sub">
                            {formatarCnpj(e.cnpj)}
                            {local ? ` · ${local}` : ''}
                            {e.subcontratada ? ' · subcontratada' : ''}
                          </small>
                          <small className="sub">{[nomesDosTipos(e.tipos, tiposF), nomesDasCategorias(e.categorias, categoriasL) || e.dados.ramo].filter(Boolean).join(' · ')}</small>
                        </th>
                        <td className="quebra">
                          {e.dados.contato || <span className="sub">Sem contato</span>}
                          {(e.dados.telefone || e.dados.celular) && <small className="sub">{[e.dados.telefone, e.dados.celular].filter(Boolean).join(' / ')}</small>}
                          <small className="sub">{e.dados.email_empresa || e.email_acesso || 'Sem e-mail'}</small>
                        </td>
                        <td className="quebra">
                          {(() => {
                            const ac = acessos?.porEmpresa.get(e.empresa_id);
                            if (!ac) return <span className="texto-alerta">Sem acesso</span>;
                            const outras = ac.empresas.length - 1;
                            return (
                              <>
                                {ac.email}
                                <small className={`sub${!ac.ativo ? ' texto-erro' : !ac.ultimo_login ? ' texto-alerta' : ''}`}>
                                  {!ac.ativo ? 'Desativado' : ac.ultimo_login ? `Último acesso em ${data(ac.ultimo_login)}` : 'Nunca entrou'}
                                </small>
                                {outras > 0 && <small className="sub">Cuida de mais {outras} empresa{outras > 1 ? 's' : ''}</small>}
                              </>
                            );
                          })()}
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
                          {(() => {
                            const r = regPor.get(e.empresa_id);
                            if (!r) return null;
                            const itens = [
                              r.sem_bp ? 'código BP' : '',
                              r.obras_sem_contrato.length ? `contrato de ${r.obras_sem_contrato.join(', ')}` : '',
                              ...r.contratos_vencendo.map((c) => `contrato ${c.numero} ${diasAte(c.termino) < 0 ? 'venceu' : 'vence'} em ${data(c.termino)}`),
                              ...r.certidoes.map((c) => `${c.tipo} ${diasAte(c.vencimento) < 0 ? 'venceu' : 'vence'} em ${data(c.vencimento)}`),
                            ].filter(Boolean);
                            return itens.length ? <small className="sub texto-alerta">A regularizar: {itens.join('; ')}</small> : null;
                          })()}
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
                            <span className="sub">{e.exige_colaboradores === false ? 'Não se aplica' : 'Nenhum em obra'}</span>
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
        acesso={editando ? acessos?.porEmpresa.get(editando.empresa_id) ?? null : null}
        acessos={acessos?.lista ?? []}
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
