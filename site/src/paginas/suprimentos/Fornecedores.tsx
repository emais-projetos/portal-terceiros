import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro, supabase } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { lerPedidosObra, responderPedidoObra, type PedidoObra } from '../../lib/ajuda';
import { NOMES_SITUACAO_HOMOLOGACAO, formatarCnpj, lerARegularizar, type FornecedorARegularizar, type SituacaoHomologacao } from '../../lib/homologacao';
import { NovoFornecedor, PedirMotivo, RegistrarContrato, type PedidoContrato } from './Dialogos';
import { DetalheFornecedor, SELO_HOMOLOGACAO } from './Homologacoes';

const ABAS = [
  ['cadastro', 'Cadastro'],
  ['regularizar', 'A regularizar'],
  ['pedidos', 'Pedidos de obra'],
] as const;
type Aba = (typeof ABAS)[number][0];

type EmpresaCadastro = {
  id: string;
  razao_social: string;
  cnpj: string;
  homologacao: SituacaoHomologacao;
  codigo_bp: string | null;
  portal_liberado_em: string | null;
  contratos_fornecedor: { id: string; situacao: string; termino: string }[];
  empresas_obras: { ativo: boolean; subcontratada: boolean }[];
};

async function lerCadastro(): Promise<EmpresaCadastro[]> {
  const { data: linhas, error } = await supabase
    .from('empresas')
    .select('id, razao_social, cnpj, homologacao, codigo_bp, portal_liberado_em, contratos_fornecedor(id, situacao, termino), empresas_obras!empresas_obras_empresa_id_fkey(ativo, subcontratada)')
    .eq('ativa', true)
    .order('razao_social');
  if (error) throw error;
  return (linhas ?? []) as unknown as EmpresaCadastro[];
}

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Fornecedores (Suprimentos): cadastro de todos, o que falta regularizar (BP, contrato) e os pedidos de outra obra.
export function Fornecedores() {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'cadastro';
  const empresa = params.get('empresa');
  const [empresas, setEmpresas] = useState<EmpresaCadastro[] | null>(null);
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
      const [e, r, p] = await Promise.all([lerCadastro(), lerARegularizar(), lerPedidosObra()]);
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
    return (empresas ?? []).filter((e) => !termo || e.razao_social.toLowerCase().includes(termo) || (digitos.length >= 3 && e.cnpj.includes(digitos)));
  }, [empresas, busca]);

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
          <label className="campo campo-busca">
            <span>Buscar</span>
            <input type="search" value={busca} placeholder="Razão social ou CNPJ" onChange={(e) => setBusca(e.target.value)} />
          </label>
          {filtradas.length === 0 ? (
            <p className="vazio">Nenhum fornecedor encontrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Fornecedor</th>
                    <th scope="col">Homologação</th>
                    <th scope="col">BP</th>
                    <th scope="col">Contratos</th>
                    <th scope="col"><span className="sr">Abrir</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((e) => {
                    const ativos = e.contratos_fornecedor.filter((c) => c.situacao === 'ativo');
                    const proximo = ativos.map((c) => c.termino).sort()[0];
                    const soSub = e.empresas_obras.length > 0 && e.empresas_obras.every((o) => o.subcontratada);
                    return (
                      <tr key={e.id} className="linha-clicavel" onClick={() => abrir(e.id)}>
                        <th scope="row">
                          {e.razao_social}
                          <small className="sub">{formatarCnpj(e.cnpj)}{soSub ? ' · subcontratada' : ''}</small>
                        </th>
                        <td>
                          <span className={`selo ${SELO_HOMOLOGACAO[e.homologacao]}`}>{e.homologacao === 'anterior' ? 'Anterior ao portal' : NOMES_SITUACAO_HOMOLOGACAO[e.homologacao]}</span>
                          {e.homologacao === 'homologada' && !e.portal_liberado_em && <small className="sub">Portal ainda não liberado</small>}
                        </td>
                        <td>{e.codigo_bp ?? <span className="sub">{soSub ? '-' : 'Sem BP'}</span>}</td>
                        <td>
                          {ativos.length === 0 ? (
                            <span className="sub">{soSub ? '-' : 'Nenhum'}</span>
                          ) : (
                            <>
                              {ativos.length} ativo(s)
                              {proximo && <small className={`sub${diasAte(proximo) <= 30 ? ' texto-alerta' : ''}`}>{diasAte(proximo) < 0 ? 'venceu' : 'vence'} em {data(proximo)}</small>}
                            </>
                          )}
                        </td>
                        <td className="acoes">
                          <button type="button" className="botao botao-secundario botao-pequeno" onClick={(ev) => { ev.stopPropagation(); abrir(e.id); }}>Abrir</button>
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
                      const emp = empresas?.find((e) => e.id === p.empresa_id);
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
