import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import {
  NOMES_SITUACAO_HOMOLOGACAO, NOMES_SITUACAO_FORNECEDOR, SELO_HOMOLOGACAO, SELO_SITUACAO_FORNECEDOR, formatarCnpj, lerARegularizar, lerFornecedoresCadastro, resumoDocsFornecedor, lerAcessosPorEmpresa,
  type FornecedorARegularizar, type FornecedorCadastro,
} from '../../lib/homologacao';
import { lerTiposFornecedor, nomesDosTipos, type TipoFornecedor } from '../../lib/tiposFornecedor';
import { lerCategorias, type CategoriaServico } from '../../lib/categorias';
import { NovoFornecedor } from './Dialogos';
import { FichaFornecedor } from './Ficha';


// Filtros da lista: ficam na URL, então voltar da ficha mantém o que estava filtrado.
type ChaveFiltro = 'doc' | 'contrato' | 'acesso' | 'sit' | 'tipo' | 'cat';
const FILTROS_LISTA: { chave: ChaveFiltro; rotulo: string; opcoes: [string, string][] }[] = [
  { chave: 'doc', rotulo: 'Documentos', opcoes: [['', 'Todos'], ['vencido', 'Com vencido'], ['vencendo', 'Vencendo'], ['faltando', 'Faltando']] },
  { chave: 'contrato', rotulo: 'Contrato e BP', opcoes: [['', 'Todos'], ['regularizar', 'A regularizar'], ['sem', 'Sem contrato ou BP']] },
  { chave: 'acesso', rotulo: 'Acesso ao portal', opcoes: [['', 'Todos'], ['sem', 'Sem acesso'], ['nunca', 'Nunca entrou']] },
  { chave: 'sit', rotulo: 'Situação', opcoes: [['', 'Ativos'], ['bloqueados', 'Só bloqueados'], ['inativos', 'Inativos']] },
];
const CHAVES_FILTRO: ChaveFiltro[] = ['doc', 'contrato', 'acesso', 'sit', 'tipo', 'cat'];


// Fornecedores (Suprimentos e administrativo): uma lista só com o cadastro, o acesso ao portal e o que falta regularizar (BP, contrato).
// Os pedidos para atuar em outra obra ficam em Notificações.
export function Fornecedores() {
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const empresa = params.get('empresa');
  const [empresas, setEmpresas] = useState<FornecedorCadastro[] | null>(null);
  const [acessos, setAcessos] = useState<Awaited<ReturnType<typeof lerAcessosPorEmpresa>> | null>(null);
  const [regularizar, setRegularizar] = useState<FornecedorARegularizar[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const filtros = Object.fromEntries(CHAVES_FILTRO.map((k) => [k, params.get(k) ?? ''])) as Record<ChaveFiltro, string>;
  // Links antigos: ?aba=regularizar e ?aba=acessos viram os filtros novos.
  if (pedida === 'regularizar' && !filtros.contrato) filtros.contrato = 'regularizar';
  if (pedida === 'acessos' && !filtros.acesso) filtros.acesso = 'sem';
  const [busca, setBuscaLocal] = useState(params.get('q') ?? '');
  const algumFiltro = !!busca.trim() || CHAVES_FILTRO.some((k) => filtros[k]);
  function novosParams(muda: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(params);
    if (p.get('aba') === 'regularizar' || p.get('aba') === 'acessos') {
      if (p.get('aba') === 'regularizar' && !p.get('contrato')) p.set('contrato', 'regularizar');
      if (p.get('aba') === 'acessos' && !p.get('acesso')) p.set('acesso', 'sem');
      p.delete('aba');
    }
    muda(p);
    setParams(p, { replace: true });
  }
  const mudarFiltro = (k: ChaveFiltro, v: string) => novosParams((p) => (v ? p.set(k, v) : p.delete(k)));
  const setBusca = (v: string) => {
    setBuscaLocal(v);
    novosParams((p) => (v.trim() ? p.set('q', v) : p.delete('q')));
  };
  const limparFiltros = () => {
    setBuscaLocal('');
    novosParams((p) => ['q', ...CHAVES_FILTRO].forEach((k) => p.delete(k)));
  };
  const [categoriasL, setCategoriasL] = useState<CategoriaServico[]>([]);
  const [tiposF, setTiposF] = useState<TipoFornecedor[]>([]);

  const carregar = useCallback(async () => {
    try {
      const [e, r, a, tf] = await Promise.all([lerFornecedoresCadastro(), lerARegularizar(), lerAcessosPorEmpresa(), lerTiposFornecedor(true)]);
      setTiposF(tf);
      lerCategorias(true).then(setCategoriasL).catch(() => setCategoriasL([]));
      setEmpresas(e);
      setAcessos(a);
      setRegularizar(r);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    if (!empresa) carregar();
  }, [carregar, empresa]);

  const abrir = (id: string, ficha?: string) => {
    const p = new URLSearchParams(params);
    p.set('empresa', id);
    if (ficha) p.set('ficha', ficha);
    setParams(p);
  };
  const voltarDaFicha = () => {
    const p = new URLSearchParams(params);
    ['empresa', 'ficha', 'filtro', 'foco'].forEach((k) => p.delete(k));
    setParams(p);
  };
  const regPor = useMemo(() => new Map((regularizar ?? []).map((r) => [r.empresa_id, r])), [regularizar]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return (empresas ?? []).filter((e) => {
      const nome = `${e.razao_social} ${e.dados.nome_fantasia ?? ''} ${e.dados.cidade ?? ''} ${acessos?.porEmpresa.get(e.empresa_id)?.email ?? ''}`.toLowerCase();
      if (termo && !nome.includes(termo) && !(digitos.length >= 3 && e.cnpj.includes(digitos))) return false;
      if (filtros.tipo && !(e.tipos?.length ? e.tipos : ['mao_de_obra']).includes(filtros.tipo)) return false;
      if (filtros.cat && !(e.categorias ?? []).includes(filtros.cat)) return false;
      // Inativo só aparece no filtro dele; bloqueado aparece junto com os ativos.
      if (filtros.sit === 'inativos') { if (e.situacao !== 'inativo') return false; }
      else if (e.situacao === 'inativo') return false;
      if (filtros.sit === 'bloqueados' && e.situacao !== 'bloqueado') return false;
      const r = resumoDocsFornecedor(e);
      if (filtros.doc === 'vencido' && !(r.vencidos.length > 0 || r.certidoesVencidas.length > 0 || e.colaboradores.com_vencido > 0)) return false;
      if (filtros.doc === 'vencendo' && !(r.vencendo.length > 0 || e.colaboradores.com_vencendo > 0 || e.certidoes.length > r.certidoesVencidas.length)) return false;
      if (filtros.doc === 'faltando' && !(r.faltando.length > 0)) return false;
      if (filtros.contrato === 'regularizar' && !regPor.has(e.empresa_id)) return false;
      if (filtros.contrato === 'sem' && !(!e.subcontratada && (!e.codigo_bp || e.contratos_ativos === 0))) return false;
      const ac = acessos?.porEmpresa.get(e.empresa_id);
      if (filtros.acesso === 'sem' && !(!ac || !ac.ativo)) return false;
      if (filtros.acesso === 'nunca' && !(!!ac && ac.ativo && !ac.ultimo_login)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresas, busca, acessos, regPor, ...CHAVES_FILTRO.map((k) => filtros[k])]);

  if (pedida === 'pedidos') return <Navigate to="/notificacoes?tipo=pedido_obra" replace />;
  if (empresa) return <FichaFornecedor empresaId={empresa} voltarRotulo="Fornecedores" aoVoltar={voltarDaFicha} />;

  const carregando = !empresas && !erro;

  return (
    <Pagina
      titulo="Fornecedores"
      apoio="Todos os fornecedores do portal, acesso ao portal (login), o que falta regularizar (código BP e contrato de cada obra)."
      acoes={<button type="button" className="botao" onClick={() => setNovo(true)}>Novo fornecedor</button>}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {carregando && <Carregando />}

      {!carregando && (
        <>
          <div className="filtros filtros-linha">
            <label className="campo campo-busca">
              <span>Buscar</span>
              <input type="search" value={busca} placeholder="Nome, cidade, CNPJ ou e-mail de login" onChange={(e) => setBusca(e.target.value)} />
            </label>
            {FILTROS_LISTA.map((f) => (
              <label key={f.chave} className="campo campo-filtro">
                <span>{f.rotulo}</span>
                <select value={filtros[f.chave]} aria-invalid={false} className={filtros[f.chave] ? 'filtro-ativo' : undefined} onChange={(e) => mudarFiltro(f.chave, e.target.value)}>
                  {f.opcoes.map(([v, nome]) => (
                    <option key={v} value={v}>
                      {nome}
                      {v === 'regularizar' && regularizar?.length ? ` (${regularizar.length})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="campo campo-filtro">
              <span>Tipo</span>
              <select value={filtros.tipo} className={filtros.tipo ? 'filtro-ativo' : undefined} onChange={(e) => mudarFiltro('tipo', e.target.value)}>
                <option value="">Todos</option>
                {tiposF.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
              </select>
            </label>
            <label className="campo campo-filtro">
              <span>Categoria</span>
              <select value={filtros.cat} className={filtros.cat ? 'filtro-ativo' : undefined} onChange={(e) => mudarFiltro('cat', e.target.value)}>
                <option value="">Todas</option>
                {categoriasL.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
              </select>
            </label>
          </div>
          <div className="barra-resultado">
            <span className="sub">
              {filtradas.length} de {(empresas ?? []).filter((e) => e.situacao !== 'inativo').length} fornecedores ativos
              {filtros.sit === 'inativos' ? ' (mostrando os inativos)' : ''}
            </span>
            {algumFiltro && <button type="button" className="botao-link link-acao" onClick={limparFiltros}>Limpar filtros</button>}
          </div>
          {filtradas.length === 0 ? (
            <p className="vazio">Nenhum fornecedor encontrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista tabela-densa">
                <thead>
                  <tr>
                    <th scope="col">Fornecedor</th>
                    <th scope="col">Homologação</th>
                    <th scope="col">Contrato</th>
                    <th scope="col">Documentos</th>
                    <th scope="col">Colaboradores</th>
                    <th scope="col">Acesso ao portal</th>
                    <th scope="col"><span className="sr">Abrir</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((e) => {
                    const r = resumoDocsFornecedor(e);
                    const local = [e.dados.cidade, e.dados.estado].filter(Boolean).join('/');
                    const ac = acessos?.porEmpresa.get(e.empresa_id);
                    const reg = regPor.get(e.empresa_id);
                    const vencidos = r.vencidos.length + r.certidoesVencidas.length;
                    const vencendo = r.vencendo.length + (e.certidoes.length - r.certidoesVencidas.length);
                    const terminoPerto = e.proximo_termino && diasAte(e.proximo_termino) <= 30;
                    return (
                      <tr key={e.empresa_id} className="linha-clicavel" onClick={() => abrir(e.empresa_id)}>
                        <th scope="row">
                          <span className="nome-com-selos">
                            {e.razao_social}
                            {e.situacao && e.situacao !== 'ativo' && (
                              <span className={`selo selo-mini ${SELO_SITUACAO_FORNECEDOR[e.situacao]}`} title={e.situacao_motivo ?? undefined}>{NOMES_SITUACAO_FORNECEDOR[e.situacao]}</span>
                            )}
                            {e.receita?.situacao && e.receita.situacao !== 'ATIVA' && (
                              <span className="selo selo-mini selo-bloqueado" title={e.receita.aviso ?? undefined}>Receita: {e.receita.situacao.toLowerCase()}</span>
                            )}
                          </span>
                          <small className="sub">
                            {[formatarCnpj(e.cnpj), local, nomesDosTipos(e.tipos, tiposF), e.subcontratada ? 'subcontratada' : ''].filter(Boolean).join(' · ')}
                          </small>
                        </th>
                        <td className="num" data-rotulo="Homologação">
                          <span className={`selo selo-mini ${SELO_HOMOLOGACAO[e.homologacao]}`}>{e.homologacao === 'anterior' ? 'Anterior' : NOMES_SITUACAO_HOMOLOGACAO[e.homologacao]}</span>
                          {e.homologacao === 'homologada' && !e.liberado_em && <small className="sub texto-alerta">portal não liberado</small>}
                        </td>
                        <td className="num" data-rotulo="Contrato">
                          {e.subcontratada ? (
                            <span className="sub">pela contratante</span>
                          ) : !e.codigo_bp || e.contratos_ativos === 0 ? (
                            <span className="texto-alerta" title={reg ? 'Em A regularizar' : undefined}>{!e.codigo_bp && e.contratos_ativos === 0 ? 'Sem BP e contrato' : !e.codigo_bp ? 'Sem BP' : 'Sem contrato'}</span>
                          ) : (
                            <span className={terminoPerto ? 'texto-alerta' : undefined}>
                              {e.contratos_ativos} ativo{e.contratos_ativos > 1 ? 's' : ''}
                              {terminoPerto && e.proximo_termino ? `, ${diasAte(e.proximo_termino) < 0 ? 'venceu' : 'vence'} ${data(e.proximo_termino).slice(0, 5)}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="num" data-rotulo="Documentos">
                          {vencidos || r.faltando.length || vencendo ? (
                            <span className="selos-linha">
                              {vencidos > 0 && <span className="selo selo-mini selo-doc-vencido">{vencidos} vencido{vencidos > 1 ? 's' : ''}</span>}
                              {r.faltando.length > 0 && <span className="selo selo-mini selo-doc-nao_enviado">{r.faltando.length} faltando</span>}
                              {vencendo > 0 && <span className="selo selo-mini selo-doc-a_vencer">{vencendo} vencendo</span>}
                            </span>
                          ) : (
                            <span className="sub">{e.documentos.length ? 'Em dia' : 'Sem cobrança'}</span>
                          )}
                        </td>
                        <td className="num" data-rotulo="Colaboradores">
                          {e.colaboradores.em_obra === 0 ? (
                            <span className="sub">{e.exige_colaboradores === false ? 'Não se aplica' : 'Nenhum'}</span>
                          ) : (
                            <span className={e.colaboradores.com_vencido ? 'texto-erro' : undefined}>
                              {e.colaboradores.liberados} de {e.colaboradores.em_obra} liberados
                            </span>
                          )}
                        </td>
                        <td className="num" data-rotulo="Acesso">
                          {!ac ? (
                            <span className="texto-alerta">Sem acesso</span>
                          ) : !ac.ativo ? (
                            <span className="texto-erro">Desativado</span>
                          ) : ac.ultimo_login ? (
                            <span>Entrou {data(ac.ultimo_login)}</span>
                          ) : (
                            <span className="texto-alerta">Nunca entrou</span>
                          )}
                        </td>
                        <td className="acoes acoes-seta" aria-hidden="true">›</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
    </Pagina>
  );
}
