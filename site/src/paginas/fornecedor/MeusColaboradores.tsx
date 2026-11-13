import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { EnvioDocumento, type PedidoDeEnvio } from '../../componentes/EnvioDocumento';
import { mensagemDeErro } from '../../lib/supabase';
import { cpfValido, data, erroDatasColaborador, formatarCpf, hojeIso, ordemSituacao, rotuloStatus, soDigitos } from '../../lib/formato';
import {
  alocarEmObra, corrigirColaborador, criarColaborador, desligarColaborador, enviarParaAnalise, incluirDocumentoColaborador, lerFuncoes,
  lerTiposIncluiveis, salvarDatasColaborador, type MeuColaborador, type MinhaEmpresa,
} from '../../lib/fornecedor';
import { documentosDoColaborador, nomeDoDocumento, podeEnviarParaAnalise, travasDaAlocacao, useFornecedor } from '../../lib/useFornecedor';
import type { AlocacaoResumo } from '../../lib/admin';
import { ItemPendencia } from './OQueFalta';
import { ObrasEContratos } from './ObrasEContratos';

const NOVA_FUNCAO = '__nova__';

type Situacao = { rotulo: string; selo: string };

// Situação do colaborador como um todo (as obras podem estar em etapas diferentes).
function situacaoGeral(c: MeuColaborador, alocs: AlocacaoResumo[]): Situacao {
  if (c.bloqueado) return { rotulo: 'Bloqueado', selo: 'selo-bloqueado' };
  if (c.situacao !== 'ativo') return { rotulo: c.situacao === 'desistente' ? 'Desistiu' : 'Desligado', selo: 'selo-encerrado' };
  const st = new Set(alocs.map((a) => a.status));
  if (st.has('em_analise')) return { rotulo: 'Em análise', selo: 'selo-em_analise' };
  if (st.has('pendente_fornecedor')) return { rotulo: 'Com pendência', selo: 'selo-pendente_fornecedor' };
  if (st.has('em_cadastro')) return { rotulo: 'Em cadastro', selo: 'selo-em_cadastro' };
  if (st.has('aprovado_admin')) return { rotulo: 'Aguardando TST', selo: 'selo-aprovado_admin' };
  if (st.has('liberado')) return { rotulo: 'Liberado', selo: 'selo-liberado' };
  return { rotulo: 'Sem obra', selo: 'selo-encerrado' };
}

// Fornecedor corrige nome, CPF, empresa e função até a primeira obra ser enviada para análise.
function cadastroEditavel(alocs: AlocacaoResumo[]): boolean {
  return !alocs.some((a) => a.status === 'em_analise' || a.status === 'aprovado_admin' || a.status === 'liberado');
}

export function MeusColaboradores() {
  const forn = useFornecedor();
  const { dados, erro, setErro, recarregar, alocacoesPorColaborador, pendenciasPorAlocacao } = forn;
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState('');
  const [mostrarDesligados, setMostrarDesligados] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [obrasAberto, setObrasAberto] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const aberto = params.get('ver');

  function abrir(id: string | null) {
    const p = new URLSearchParams(params);
    if (id) p.set('ver', id);
    else p.delete('ver');
    setParams(p, { replace: true });
  }

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = soDigitos(busca);
    return (dados?.colaboradores ?? [])
      .filter((c) => mostrarDesligados || c.situacao === 'ativo')
      .filter((c) => !t || c.nome.toLowerCase().includes(t) || (d.length >= 3 && (c.cpf ?? '').includes(d)));
  }, [dados, busca, mostrarDesligados]);

  // Separados por empresa, como em Documentos da empresa.
  const porEmpresa = useMemo(
    () =>
      (dados?.empresas ?? [])
        .map((e) => ({ empresa: e, colaboradores: lista.filter((c) => c.empresa_id === e.id) }))
        .filter((g) => g.colaboradores.length > 0 || (dados?.empresas.length ?? 0) === 1),
    [dados, lista],
  );

  const ativos = (dados?.colaboradores ?? []).filter((c) => c.situacao === 'ativo').length;
  const colabAberto = aberto ? dados?.colaboradores.find((c) => c.id === aberto) ?? null : null;
  const variasEmpresas = (dados?.empresas.length ?? 0) > 1;

  return (
    <Pagina
      titulo="Colaboradores"
      apoio={dados ? `${ativos} ${ativos === 1 ? 'colaborador ativo' : 'colaboradores ativos'}. Clique no nome para ver os documentos e enviar para análise.` : undefined}
      acoes={
        dados && dados.empresas.length > 0 ? (
          <>
            <button className="botao botao-secundario" type="button" onClick={() => setObrasAberto(true)}>Obras e contratos</button>
            <button className="botao" type="button" onClick={() => setNovoAberto(true)}>Novo colaborador</button>
          </>
        ) : undefined
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!dados && !erro && <Carregando />}

      {dados && (
        <>
          <div className="filtros">
            <label className="campo campo-busca">
              <span>Buscar</span>
              <input type="search" placeholder="Nome ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
            <label className="opcao opcao-filtro">
              <input type="checkbox" checked={mostrarDesligados} onChange={(e) => setMostrarDesligados(e.target.checked)} />
              <span>Mostrar desligados</span>
            </label>
          </div>

          {dados.colaboradores.length === 0 ? (
            <p className="vazio">Nenhum colaborador cadastrado ainda. Use "Novo colaborador" para começar.</p>
          ) : (
            porEmpresa.map(({ empresa, colaboradores }) => (
              <section key={empresa.id} className="bloco">
                {variasEmpresas && (
                  <h2 className="bloco-titulo">
                    {empresa.razao_social} <span className="sub">{colaboradores.length}</span>
                  </h2>
                )}
                <div className="tabela-rolagem">
                  <table className="tabela tabela-lista">
                    <thead>
                      <tr>
                        <th scope="col">Colaborador</th>
                        <th scope="col">Situação</th>
                        <th scope="col">Obras</th>
                        <th scope="col">Falta enviar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {colaboradores.map((c) => {
                        const alocs = (alocacoesPorColaborador.get(c.id) ?? []).filter((a) => a.status !== 'encerrado');
                        const faltam = new Set(alocs.flatMap((a) => travasDaAlocacao(pendenciasPorAlocacao.get(a.alocacao_id)).filter((p) => p.grupo === 'colaborador').map((p) => p.tipo_codigo)));
                        const rescisorios = c.rescisao_exigida ? dados.rescisao.filter((r) => r.colaborador_id === c.id && (r.situacao === 'nao_enviado' || r.situacao === 'devolvido')).length : 0;
                        const sit = situacaoGeral(c, alocs);
                        return (
                          <tr key={c.id} className="linha-clicavel" onClick={() => abrir(c.id)}>
                            <th scope="row">
                              <button type="button" className="link-botao" onClick={(e) => { e.stopPropagation(); abrir(c.id); }}>{c.nome}</button>
                              <small className="sub">{formatarCpf(c.cpf) || 'CPF não informado'}{c.funcoes?.nome || c.funcao_texto ? `, ${(c.funcoes?.nome ?? c.funcao_texto ?? '').toLowerCase()}` : ''}</small>
                            </th>
                            <td><span className={`selo ${sit.selo}`}>{sit.rotulo}</span></td>
                            <td>
                              {c.situacao !== 'ativo' ? (
                                <span className="sub">{c.data_desligamento ? `Desligado em ${data(c.data_desligamento)}` : 'Desligado'}</span>
                              ) : alocs.length === 0 ? (
                                <span className="sub">Sem obra</span>
                              ) : (
                                alocs.map((a) => (
                                  <div key={a.alocacao_id} className="obra-status">
                                    <span>{a.obra}</span> <span className="sub">{rotuloStatus[a.status].toLowerCase()}</span>
                                  </div>
                                ))
                              )}
                            </td>
                            <td>
                              {c.situacao !== 'ativo'
                                ? rescisorios > 0 ? `${rescisorios} ${rescisorios === 1 ? 'rescisório' : 'rescisórios'}` : <span className="sub">Nada</span>
                                : faltam.size > 0 ? `${faltam.size} ${faltam.size === 1 ? 'documento' : 'documentos'}` : <span className="sub">Nada</span>}
                            </td>
                          </tr>
                        );
                      })}
                      {colaboradores.length === 0 && (
                        <tr><td colSpan={4} className="vazio-linha">Nenhum colaborador encontrado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}

          <NovoColaborador
            aberto={novoAberto}
            empresas={dados.empresas}
            aoFechar={() => setNovoAberto(false)}
            aoCriar={async (id, nome) => {
              setNovoAberto(false);
              setOk(`${nome} cadastrado. Envie os documentos dele e, no fim, clique em "Enviar para análise".`);
              await recarregar();
              abrir(id);
            }}
          />
          <ObrasEContratos aberto={obrasAberto} empresas={dados.empresas} aoFechar={() => setObrasAberto(false)} aoMudar={recarregar} />
          <DetalheColaborador
            colaborador={colabAberto}
            forn={forn}
            aoFechar={(aviso) => {
              abrir(null);
              if (aviso) setOk(aviso);
            }}
            aoMensagem={setOk}
          />
        </>
      )}
    </Pagina>
  );
}

// Função: escolhe da lista ou informa uma nova (a Emais confere quais NRs ela exige).
function CampoFuncao({
  funcoes, valor, texto, aoMudar, aoMudarTexto,
}: {
  funcoes: { id: string; nome: string }[];
  valor: string;
  texto: string;
  aoMudar: (v: string) => void;
  aoMudarTexto: (v: string) => void;
}) {
  return (
    <>
      <label className="campo">
        <span>Função (cargo)</span>
        <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
          <option value="">Escolha a função</option>
          {funcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          <option value={NOVA_FUNCAO}>+ Nova função (não está na lista)</option>
        </select>
        {valor !== NOVA_FUNCAO && <small className="dica">A função define quais NRs são obrigatórias.</small>}
      </label>
      {valor === NOVA_FUNCAO && (
        <label className="campo">
          <span>Nome da nova função</span>
          <input value={texto} onChange={(e) => aoMudarTexto(e.target.value)} placeholder="Ex.: OPERADOR DE ROLO COMPACTADOR" autoComplete="off" />
          <small className="dica">Função nova: a Emais confere quais treinamentos (NRs) ela exige.</small>
        </label>
      )}
    </>
  );
}

function NovoColaborador({
  aberto, empresas, aoFechar, aoCriar,
}: {
  aberto: boolean;
  empresas: MinhaEmpresa[];
  aoFechar: () => void;
  aoCriar: (id: string, nome: string) => void;
}) {
  const [empresaId, setEmpresaId] = useState('');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [funcaoId, setFuncaoId] = useState('');
  const [funcaoNova, setFuncaoNova] = useState('');
  const [admissao, setAdmissao] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [obras, setObras] = useState<string[]>([]);
  const [funcoes, setFuncoes] = useState<{ id: string; nome: string }[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setEmpresaId(empresas.length === 1 ? empresas[0].id : '');
    setNome('');
    setCpf('');
    setFuncaoId('');
    setFuncaoNova('');
    setAdmissao('');
    setNascimento('');
    setObras([]);
    setErro(null);
    if (funcoes.length === 0) lerFuncoes().then(setFuncoes).catch(() => undefined);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const empresa = empresas.find((e) => e.id === empresaId);
  const digitos = soDigitos(cpf);
  const cpfOk = cpfValido(digitos);
  const funcaoCadastrada = funcoes.find((f) => f.id === funcaoId);
  const funcaoOk = !!funcaoCadastrada || (funcaoId === NOVA_FUNCAO && funcaoNova.trim().length >= 3);
  const erroDatas = erroDatasColaborador(admissao, nascimento);
  const valido = !!empresa && nome.trim().split(/\s+/).length >= 2 && cpfOk && funcaoOk && !!admissao && !!nascimento && !erroDatas;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido || !empresa) return;
    setErro(null);
    setEnviando(true);
    try {
      const nomeFinal = nome.trim().replace(/\s+/g, ' ').toUpperCase();
      const id = await criarColaborador({
        empresa_id: empresa.id,
        nome: nomeFinal,
        cpf: digitos,
        funcao_id: funcaoCadastrada?.id ?? null,
        funcao_texto: (funcaoCadastrada?.nome ?? funcaoNova).trim().toUpperCase(),
        data_admissao: admissao,
        data_nascimento: nascimento,
        obras,
      });
      aoCriar(id, nomeFinal);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Novo colaborador" aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        {empresas.length > 1 && (
          <label className="campo">
            <span>Empresa</span>
            <select value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setObras([]); }}>
              <option value="">Escolha a empresa</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
            </select>
          </label>
        )}
        <div className="grade-2">
          <label className="campo">
            <span>Nome completo</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
          </label>
          <label className="campo">
            <span>CPF</span>
            <input inputMode="numeric" placeholder="000.000.000-00" value={cpf} aria-invalid={digitos.length === 11 && !cpfOk} onChange={(e) => setCpf(e.target.value)} />
            {digitos.length === 11 && !cpfOk && <small className="campo-erro">CPF inválido. Confira os números.</small>}
          </label>
        </div>
        <CampoFuncao funcoes={funcoes} valor={funcaoId} texto={funcaoNova} aoMudar={setFuncaoId} aoMudarTexto={setFuncaoNova} />
        <div className="grade-2">
          <label className="campo">
            <span>Data de admissão (registro)</span>
            <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
          </label>
          <label className="campo">
            <span>Data de nascimento</span>
            <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
          </label>
        </div>
        {erroDatas && <small className="campo-erro">{erroDatas}</small>}
        {empresa && (
          <div className="campo">
            <span>Obras onde vai trabalhar</span>
            {empresa.obras.length === 0 ? (
              <small className="dica">Sua empresa ainda não está cadastrada em nenhuma obra. Peça o acesso em Obras e contratos.</small>
            ) : (
              <ul className="lista-marcar lista-curta">
                {empresa.obras.map((o) => (
                  <li key={o.id}>
                    <label>
                      <input type="checkbox" checked={obras.includes(o.id)} onChange={() => setObras((l) => (l.includes(o.id) ? l.filter((x) => x !== o.id) : [...l, o.id]))} />
                      <span>{o.nome}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>{enviando ? 'Cadastrando' : 'Cadastrar colaborador'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function DetalheColaborador({
  colaborador, forn, aoFechar, aoMensagem,
}: {
  colaborador: MeuColaborador | null;
  forn: ReturnType<typeof useFornecedor>;
  aoFechar: (aviso?: string) => void;
  aoMensagem: (m: string) => void;
}) {
  const { dados, recarregar, empresaPorId, alocacoesPorColaborador, pendenciasPorAlocacao } = forn;
  const [pedido, setPedido] = useState<PedidoDeEnvio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [novaObra, setNovaObra] = useState('');
  const [painel, setPainel] = useState<'corrigir' | 'incluir' | 'desligar' | null>(null);

  useEffect(() => {
    setErro(null);
    setNovaObra('');
    setPainel(null);
  }, [colaborador?.id]);

  if (!colaborador || !dados) return <Dialogo aberto={false} titulo="" aoFechar={() => aoFechar()}>{null}</Dialogo>;
  const empresa = empresaPorId.get(colaborador.empresa_id);
  const alocs = (alocacoesPorColaborador.get(colaborador.id) ?? []).filter((a) => a.status !== 'encerrado');
  const docs = documentosDoColaborador(colaborador.id, dados.pendencias).sort(
    (a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || Number(b.impeditivo) - Number(a.impeditivo) || a.documento.localeCompare(b.documento, 'pt-BR'),
  );
  const rescisao = dados.rescisao.filter((r) => r.colaborador_id === colaborador.id);
  const obrasLivres = (empresa?.obras ?? []).filter((o) => !alocs.some((a) => a.obra_id === o.id));
  const ativo = colaborador.situacao === 'ativo';
  const editavel = ativo && cadastroEditavel(alocs);
  const sit = situacaoGeral(colaborador, alocs);
  const emCadastro = alocs.filter((a) => podeEnviarParaAnalise(a));

  // Ao fechar um cadastro que ainda não foi enviado, lembra que ele só vai para a Emais com "Enviar para análise".
  function fechar() {
    if (ativo && emCadastro.length > 0) {
      aoFechar(`Cadastro de ${colaborador!.nome} salvo. Ele só vai para a análise da Emais depois que todos os documentos obrigatórios forem enviados e você clicar em "Enviar para análise".`);
    } else {
      aoFechar();
    }
  }

  async function agir(chave: string, acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOcupado(chave);
    try {
      await acao();
      aoMensagem(sucesso);
      setPainel(null);
      await recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  function pedirEnvio(tipoCodigo: string, nomeDoc: string, motivoDevolucao: string | null) {
    const tipo = dados?.tipos.get(tipoCodigo);
    if (tipo && empresa) {
      setPedido({ tipo: { ...tipo, nome: nomeDoc }, empresaId: empresa.id, empresaNome: empresa.razao_social, colaborador: { id: colaborador!.id, nome: colaborador!.nome }, motivoDevolucao });
    }
  }

  return (
    <>
      <Dialogo aberto={!pedido} titulo={colaborador.nome} aoFechar={fechar} largura="larga">
        <div className="detalhe">
          <dl className="ficha">
            <div><dt>Situação</dt><dd><span className={`selo ${sit.selo}`}>{sit.rotulo}</span></dd></div>
            <div><dt>Empresa</dt><dd>{empresa?.razao_social}</dd></div>
            <div><dt>CPF</dt><dd>{formatarCpf(colaborador.cpf) || 'Não informado'}</dd></div>
            <div><dt>Função</dt><dd>{colaborador.funcoes?.nome ?? colaborador.funcao_texto ?? 'Não informada'}</dd></div>
            <div><dt>Admissão</dt><dd>{data(colaborador.data_admissao) || 'Não informada'}</dd></div>
            <div><dt>Nascimento</dt><dd>{data(colaborador.data_nascimento) || 'Não informada'}</dd></div>
            {!ativo && <div><dt>Desligamento</dt><dd>{data(colaborador.data_desligamento) || 'Não informado'}</dd></div>}
          </dl>

          {colaborador.bloqueado && (
            <p className="aviso aviso-erro">
              <strong>Bloqueado pela Emais.</strong> {colaborador.bloqueio_motivo} Enquanto estiver bloqueado, o colaborador não entra nas obras.
            </p>
          )}

          {ativo && (
            <div className="linha-botoes">
              {editavel ? (
                <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setPainel(painel === 'corrigir' ? null : 'corrigir')}>
                  Corrigir cadastro
                </button>
              ) : (
                <small className="dica">O cadastro já foi enviado para análise. Para corrigir nome, CPF, empresa ou função, fale com a Emais.</small>
              )}
            </div>
          )}
          {painel === 'corrigir' && editavel && (
            <CorrecaoCadastro
              colaborador={colaborador}
              empresas={dados.empresas}
              ocupado={ocupado === 'corrigir'}
              aoCancelar={() => setPainel(null)}
              aoSalvar={(d) => agir('corrigir', () => corrigirColaborador({ id: colaborador.id, ...d }), 'Cadastro corrigido.')}
            />
          )}

          {ativo && (
            <DatasDoCadastro
              key={colaborador.id}
              colaborador={colaborador}
              aoSalvar={(adm, nasc) => agir('datas', () => salvarDatasColaborador(colaborador.id, adm, nasc), 'Datas do cadastro atualizadas.')}
            />
          )}
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

          {!ativo && (
            <>
              <p className="aviso aviso-alerta">
                {colaborador.situacao === 'desistente' ? 'Colaborador desistiu antes de começar.' : 'Colaborador desligado.'} As alocações nas obras foram encerradas.
              </p>
              {rescisao.length > 0 && (
                <>
                  <h3 className="detalhe-subtitulo">Documentos rescisórios</h3>
                  <ul className="lista-pendencias">
                    {rescisao.map((r) => (
                      <li key={r.tipo_codigo}>
                        <ItemPendencia
                          nome={r.documento}
                          situacao={r.situacao}
                          impeditivo={r.impeditivo}
                          vencimento={null}
                          motivo={r.situacao === 'devolvido' ? r.motivo_devolucao : null}
                          renovacaoEmAnalise={false}
                          aoEnviar={() => pedirEnvio(r.tipo_codigo, r.documento, r.situacao === 'devolvido' ? r.motivo_devolucao : null)}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {ativo && (
            <>
              <h3 className="detalhe-subtitulo">Obras</h3>
              {alocs.length === 0 && <p className="sub">Ainda não está em nenhuma obra.</p>}
              <ul className="lista-simples">
                {alocs.map((a) => {
                  const travas = travasDaAlocacao(pendenciasPorAlocacao.get(a.alocacao_id));
                  return (
                    <li key={a.alocacao_id}>
                      <span>
                        <strong>{a.obra}</strong> <span className={`selo selo-${a.status}`}>{rotuloStatus[a.status]}</span>
                        {podeEnviarParaAnalise(a) && travas.length > 0 && (
                          <small className="sub">Para enviar à análise, falta: {travas.map((t) => nomeDoDocumento(t, dados.incluidos)).join(', ')}</small>
                        )}
                        {a.status === 'em_analise' && <small className="sub">A Emais está conferindo os documentos.</small>}
                        {a.status === 'aprovado_admin' && <small className="sub">Aprovado pela Emais, aguardando a segurança do trabalho da obra.</small>}
                      </span>
                      {podeEnviarParaAnalise(a) && (
                        <button
                          type="button"
                          className="botao botao-pequeno"
                          disabled={travas.length > 0 || !!ocupado || colaborador.bloqueado}
                          onClick={() => agir(a.alocacao_id, () => enviarParaAnalise(a.alocacao_id), `${colaborador.nome} enviado para análise em ${a.obra}. Situação: Em análise.`)}
                        >
                          {ocupado === a.alocacao_id ? 'Enviando' : 'Enviar para análise'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {obrasLivres.length > 0 && (
                <form
                  className="em-linha"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (novaObra) agir('obra', () => alocarEmObra(colaborador.id, novaObra), 'Colaborador incluído na obra.');
                  }}
                >
                  <label className="campo campo-compacto">
                    <span>Incluir em outra obra</span>
                    <select value={novaObra} onChange={(e) => setNovaObra(e.target.value)}>
                      <option value="">Escolha a obra</option>
                      {obrasLivres.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </select>
                  </label>
                  <button className="botao botao-secundario" type="submit" disabled={!novaObra || !!ocupado}>Incluir</button>
                </form>
              )}

              <div className="barra-lista">
                <h3 className="detalhe-subtitulo">Documentos do colaborador</h3>
                {alocs.length > 0 && (
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setPainel(painel === 'incluir' ? null : 'incluir')}>
                    + Outro documento
                  </button>
                )}
              </div>
              {painel === 'incluir' && (
                <IncluirDocumento
                  jaExigidos={new Set(docs.map((d) => d.tipo_codigo))}
                  ocupado={ocupado === 'incluir'}
                  aoCancelar={() => setPainel(null)}
                  aoIncluir={(tipo, descricao, nomeDoc) =>
                    agir('incluir', () => incluirDocumentoColaborador(colaborador.id, tipo, descricao), `${nomeDoc} incluído. Agora envie o arquivo dele.`)
                  }
                />
              )}
              {docs.length === 0 ? (
                <p className="sub">Os documentos exigidos aparecem quando o colaborador estiver em uma obra.</p>
              ) : (
                <ul className="lista-pendencias">
                  {docs.map((p) => {
                    const nomeDoc = nomeDoDocumento(p, dados.incluidos);
                    return (
                      <li key={p.tipo_codigo}>
                        <ItemPendencia
                          nome={nomeDoc}
                          situacao={p.situacao}
                          impeditivo={p.impeditivo}
                          vencimento={p.vencimento}
                          motivo={p.situacao === 'devolvido' ? p.motivo_devolucao : null}
                          renovacaoEmAnalise={p.status_envio_aberto === 'em_analise'}
                          aoEnviar={() => pedirEnvio(p.tipo_codigo, nomeDoc, p.situacao === 'devolvido' ? p.motivo_devolucao : null)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="dica">
                Se uma NR obrigatória pela função não se aplica ao serviço, abra a NR e marque a dispensa com a justificativa. Os documentos da empresa
                (cartão CNPJ, PGR, PCMSO e outros) ficam em Documentos da empresa.
              </p>

              <div className="zona-final">
                {painel !== 'desligar' ? (
                  <button type="button" className="botao botao-discreto" onClick={() => setPainel('desligar')}>Demitir ou informar desligamento</button>
                ) : (
                  <Desligamento
                    colaborador={colaborador}
                    ocupado={ocupado === 'deslig'}
                    aoCancelar={() => setPainel(null)}
                    aoConfirmar={(dataDeslig, desistente) =>
                      agir(
                        'deslig',
                        () => desligarColaborador(colaborador.id, dataDeslig, desistente),
                        desistente
                          ? `Desistência de ${colaborador.nome} registrada.`
                          : `Demissão de ${colaborador.nome} registrada. Envie os documentos rescisórios no cadastro dele.`,
                      )
                    }
                  />
                )}
              </div>
            </>
          )}
        </div>
      </Dialogo>
      <EnvioDocumento
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (nome) => {
          setPedido(null);
          aoMensagem(`${nome} enviado. A Emais confere e você acompanha por aqui.`);
          await recarregar();
        }}
      />
    </>
  );
}

function CorrecaoCadastro({
  colaborador, empresas, ocupado, aoCancelar, aoSalvar,
}: {
  colaborador: MeuColaborador;
  empresas: MinhaEmpresa[];
  ocupado: boolean;
  aoCancelar: () => void;
  aoSalvar: (d: { empresa_id: string; nome: string; cpf: string; funcao_id: string | null; funcao_texto: string | null }) => void;
}) {
  const [empresaId, setEmpresaId] = useState(colaborador.empresa_id);
  const [nome, setNome] = useState(colaborador.nome);
  const [cpf, setCpf] = useState(formatarCpf(colaborador.cpf));
  const [funcoes, setFuncoes] = useState<{ id: string; nome: string }[]>([]);
  const [funcaoId, setFuncaoId] = useState(colaborador.funcao_id ?? (colaborador.funcao_texto ? NOVA_FUNCAO : ''));
  const [funcaoNova, setFuncaoNova] = useState(colaborador.funcao_id ? '' : colaborador.funcao_texto ?? '');

  useEffect(() => {
    lerFuncoes().then(setFuncoes).catch(() => undefined);
  }, []);

  const digitos = soDigitos(cpf);
  const cpfOk = cpfValido(digitos);
  const funcaoCadastrada = funcoes.find((f) => f.id === funcaoId);
  const funcaoOk = !!funcaoCadastrada || (funcaoId === NOVA_FUNCAO && funcaoNova.trim().length >= 3);
  const valido = nome.trim().split(/\s+/).length >= 2 && cpfOk && funcaoOk && !!empresaId;

  return (
    <form
      className="formulario formulario-largo caixa"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) {
          aoSalvar({
            empresa_id: empresaId,
            nome: nome.trim(),
            cpf: digitos,
            funcao_id: funcaoCadastrada?.id ?? null,
            funcao_texto: (funcaoCadastrada?.nome ?? funcaoNova).trim().toUpperCase(),
          });
        }
      }}
      noValidate
    >
      <h3 className="detalhe-subtitulo">Corrigir cadastro</h3>
      {empresas.length > 1 && (
        <label className="campo">
          <span>Empresa</span>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
          </select>
        </label>
      )}
      <div className="grade-2">
        <label className="campo">
          <span>Nome completo</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
        </label>
        <label className="campo">
          <span>CPF</span>
          <input inputMode="numeric" value={cpf} aria-invalid={digitos.length === 11 && !cpfOk} onChange={(e) => setCpf(e.target.value)} />
          {digitos.length === 11 && !cpfOk && <small className="campo-erro">CPF inválido. Confira os números.</small>}
        </label>
      </div>
      <CampoFuncao funcoes={funcoes} valor={funcaoId} texto={funcaoNova} aoMudar={setFuncaoId} aoMudarTexto={setFuncaoNova} />
      <small className="dica">Pode corrigir até o cadastro ser enviado para análise. Depois disso, só a Emais corrige.</small>
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!valido || ocupado}>{ocupado ? 'Salvando' : 'Salvar correção'}</button>
        <button className="botao botao-discreto" type="button" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

// NR a mais ou "Outro documento" (ex.: treinamento específico de máquina).
function IncluirDocumento({
  jaExigidos, ocupado, aoCancelar, aoIncluir,
}: {
  jaExigidos: Set<string>;
  ocupado: boolean;
  aoCancelar: () => void;
  aoIncluir: (tipo: string, descricao: string, nome: string) => void;
}) {
  const [tipos, setTipos] = useState<{ codigo: string; nome: string }[]>([]);
  const [tipo, setTipo] = useState('');
  const [descricao, setDescricao] = useState('');

  useEffect(() => {
    lerTiposIncluiveis().then(setTipos).catch(() => undefined);
  }, []);

  const opcoes = tipos.filter((t) => !jaExigidos.has(t.codigo));
  const escolhido = tipos.find((t) => t.codigo === tipo);
  const outro = tipo === 'outro_documento';
  const valido = !!escolhido && (!outro || descricao.trim().length >= 3);

  return (
    <form
      className="formulario formulario-largo caixa"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido && escolhido) aoIncluir(tipo, descricao.trim(), outro ? `${escolhido.nome}: ${descricao.trim()}` : escolhido.nome);
      }}
      noValidate
    >
      <h3 className="detalhe-subtitulo">Incluir outro documento</h3>
      <div className="grade-2">
        <label className="campo">
          <span>Documento</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Escolha</option>
            {opcoes.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>{outro ? 'Qual documento' : 'Observação (opcional)'}</span>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={outro ? 'Ex.: treinamento de operador de escavadeira' : ''} />
        </label>
      </div>
      <small className="dica">O documento incluído passa a ser exigido do colaborador. Depois de incluir, envie o arquivo na lista abaixo.</small>
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!valido || ocupado}>{ocupado ? 'Incluindo' : 'Incluir documento'}</button>
        <button className="botao botao-discreto" type="button" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function Desligamento({
  colaborador, ocupado, aoCancelar, aoConfirmar,
}: {
  colaborador: MeuColaborador;
  ocupado: boolean;
  aoCancelar: () => void;
  aoConfirmar: (dataDeslig: string, desistente: boolean) => void;
}) {
  const [dataDeslig, setDataDeslig] = useState(hojeIso());
  const [desistente, setDesistente] = useState(false);
  const antesDaAdmissao = !!colaborador.data_admissao && dataDeslig < colaborador.data_admissao;

  return (
    <form
      className="formulario formulario-largo caixa"
      onSubmit={(e) => {
        e.preventDefault();
        if (dataDeslig && !antesDaAdmissao) aoConfirmar(dataDeslig, desistente);
      }}
    >
      <h3 className="detalhe-subtitulo">Desligamento de {colaborador.nome}</h3>
      <div className="opcoes-linha" role="radiogroup" aria-label="Tipo de desligamento">
        <label className="opcao">
          <input type="radio" name="tipo-deslig" checked={!desistente} onChange={() => setDesistente(false)} />
          <span>Demitido: pede os documentos rescisórios</span>
        </label>
        <label className="opcao">
          <input type="radio" name="tipo-deslig" checked={desistente} onChange={() => setDesistente(true)} />
          <span>Desistiu antes de começar: sem rescisórios</span>
        </label>
      </div>
      <label className="campo campo-data">
        <span>Data do desligamento</span>
        <input type="date" value={dataDeslig} onChange={(e) => setDataDeslig(e.target.value)} />
        {antesDaAdmissao && <small className="campo-erro">A data não pode ser antes da admissão.</small>}
      </label>
      {!desistente && (
        <p className="dica">
          Ficam pendentes no cadastro: TRCT assinado, guia e comprovante do FGTS rescisório, ASO demissional e comprovante de pagamento das verbas
          rescisórias. O colaborador sai das obras na hora.
        </p>
      )}
      <div className="linha-botoes">
        <button type="submit" className="botao" disabled={!dataDeslig || antesDaAdmissao || ocupado}>{ocupado ? 'Registrando' : 'Confirmar desligamento'}</button>
        <button type="button" className="botao botao-discreto" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

// Admissão e nascimento: o fornecedor completa quando falta e corrige quando está errado.
function DatasDoCadastro({ colaborador, aoSalvar }: { colaborador: MeuColaborador; aoSalvar: (adm: string, nasc: string) => void }) {
  const faltam = !colaborador.data_admissao || !colaborador.data_nascimento;
  const [aberto, setAberto] = useState(false);
  const [admissao, setAdmissao] = useState(colaborador.data_admissao ?? '');
  const [nascimento, setNascimento] = useState(colaborador.data_nascimento ?? '');
  const erro = erroDatasColaborador(admissao, nascimento);

  if (!aberto) {
    return faltam ? (
      <p className="aviso aviso-alerta aviso-faixa">
        <span>Complete o cadastro: falta a data de {!colaborador.data_admissao && !colaborador.data_nascimento ? 'admissão e de nascimento' : !colaborador.data_admissao ? 'admissão' : 'nascimento'}.</span>
        <button type="button" className="botao botao-pequeno" onClick={() => setAberto(true)}>Informar datas</button>
      </p>
    ) : (
      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setAberto(true)}>Corrigir datas</button>
    );
  }
  return (
    <form
      className="formulario formulario-largo caixa"
      onSubmit={(e) => {
        e.preventDefault();
        if (admissao && nascimento && !erro) {
          aoSalvar(admissao, nascimento);
          setAberto(false);
        }
      }}
      noValidate
    >
      <div className="grade-2">
        <label className="campo">
          <span>Data de admissão (registro)</span>
          <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
        </label>
        <label className="campo">
          <span>Data de nascimento</span>
          <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
        </label>
      </div>
      {erro && <small className="campo-erro">{erro}</small>}
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!admissao || !nascimento || !!erro}>Salvar datas</button>
        <button className="botao botao-discreto" type="button" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </form>
  );
}
