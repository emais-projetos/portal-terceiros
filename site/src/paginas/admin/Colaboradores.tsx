import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../lib/sessao';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import {
  cpfValido, data, erroDatasColaborador, formatarCpf, hojeIso, ordemSituacao, rotuloSituacao, rotuloStatus, soDigitos,
} from '../../lib/formato';
import {
  abrirArquivo, alocarComoAdmin, aprovarAlocacao, devolverAlocacaoTst, excecoesNovas, lerAlocacoes, lerAnexos, lerBaseTreinamentos, lerColaborador,
  lerDevolucaoTst, lerEmailEmpresa, lerExcecoes, lerIdsComPendenciaCadastro, lerObrasCadastro, lerPendencias, linkOutlook, registrarIntegracao,
  salvarCadastro, salvarTreinamentos, validarAlocacao,
  type AlocacaoResumo, type BaseTreinamentos, type Colaborador, type Excecao, type ObraCadastro, type Pendencia,
} from '../../lib/admin';
import { bloquearColaborador, lerBloqueios, type Bloqueio } from '../../lib/fornecedor';
import { enderecoDoSite } from '../../lib/supabase';

const nomeNr = (codigo: string) => (codigo === 'outro_documento' ? 'Outro documento' : codigo.replace(/^nr(\d+)$/i, 'NR-$1'));
// NRs e "Outro documento": o TST pode ver o anexo.
const ehNr = (codigo: string) => /^nr\d+$/.test(codigo) || codigo === 'outro_documento';

type Filtro = 'abertos' | 'fornecedor' | 'analise' | 'tst' | 'liberados' | 'liberados_pendencia' | 'cadastro' | 'encerrados';

const filtros: { id: Filtro; rotulo: string }[] = [
  { id: 'abertos', rotulo: 'Todos ativos' },
  { id: 'analise', rotulo: 'Em análise' },
  { id: 'fornecedor', rotulo: 'Com o fornecedor' },
  { id: 'tst', rotulo: 'Aguardando TST' },
  { id: 'liberados', rotulo: 'Liberados' },
  { id: 'liberados_pendencia', rotulo: 'Liberados com pendência' },
  { id: 'cadastro', rotulo: 'Cadastro a corrigir' },
  { id: 'encerrados', rotulo: 'Desligados' },
];

function passa(a: AlocacaoResumo, f: Filtro, cadastro: Set<string>): boolean {
  switch (f) {
    case 'abertos': return a.status !== 'encerrado';
    case 'fornecedor': return a.status === 'pendente_fornecedor' || a.status === 'em_cadastro';
    case 'analise': return a.status === 'em_analise';
    case 'tst': return a.status === 'aprovado_admin';
    case 'liberados': return a.status === 'liberado';
    case 'liberados_pendencia': return a.status === 'liberado' && a.impeditivos_pendentes > 0;
    case 'cadastro': return cadastro.has(a.colaborador_id);
    case 'encerrados': return a.status === 'encerrado';
  }
}

export function Colaboradores() {
  const { usuario } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const filtrosDoPerfil = ehAdmin ? filtros : filtros.filter((f) => f.id !== 'cadastro');
  const [params, setParams] = useSearchParams();
  const [alocacoes, setAlocacoes] = useState<AlocacaoResumo[] | null>(null);
  const [cadastro, setCadastro] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<AlocacaoResumo | null>(null);

  const obra = params.get('obra') ?? '';
  const filtro = (params.get('situacao') as Filtro) || 'abertos';
  const busca = params.get('busca') ?? '';

  function mudar(chave: string, valor: string) {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    setParams(p, { replace: true });
  }

  async function carregar() {
    try {
      const [a, c] = await Promise.all([lerAlocacoes(), ehAdmin ? lerIdsComPendenciaCadastro() : Promise.resolve(new Set<string>())]);
      setAlocacoes(a);
      setCadastro(c);
      return a;
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      return null;
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const obras = useMemo(() => {
    const m = new Map<string, string>();
    (alocacoes ?? []).forEach((a) => m.set(a.obra_id, a.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [alocacoes]);

  const daObra = useMemo(() => (alocacoes ?? []).filter((a) => !obra || a.obra_id === obra), [alocacoes, obra]);

  const contagem = useMemo(() => {
    const c = {} as Record<Filtro, number>;
    filtros.forEach((f) => (c[f.id] = daObra.filter((a) => passa(a, f.id, cadastro)).length));
    return c;
  }, [daObra, cadastro]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return daObra
      .filter((a) => passa(a, filtro, cadastro))
      .filter((a) => !t || a.colaborador.toLowerCase().includes(t) || a.empresa.toLowerCase().includes(t))
      .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR') || a.colaborador.localeCompare(b.colaborador, 'pt-BR'));
  }, [daObra, filtro, busca, cadastro]);

  return (
    <Pagina
      titulo={!ehAdmin && filtro === 'tst' ? 'Para validar' : 'Colaboradores'}
      apoio={ehAdmin
        ? 'Situação de cada colaborador por obra. Clique em um nome para ver as pendências e agir.'
        : 'Colaboradores das suas obras. Os aprovados pela Emais esperam a sua validação para serem liberados.'}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}

      <div className="filtros">
        <label className="campo">
          <span>Obra</span>
          <select value={obra} onChange={(e) => mudar('obra', e.target.value)}>
            <option value="">Todas as obras</option>
            {obras.map(([id, nome]) => (
              <option key={id} value={id}>{nome}</option>
            ))}
          </select>
        </label>
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Colaborador ou empresa" value={busca} onChange={(e) => mudar('busca', e.target.value)} />
        </label>
      </div>

      {alocacoes && (
      <div className="chips chips-filtro" role="group" aria-label="Situação">
        {filtrosDoPerfil.map((f) => (
          <button
            key={f.id}
            type="button"
            className="chip"
            aria-pressed={filtro === f.id}
            onClick={() => mudar('situacao', f.id === 'abertos' ? '' : f.id)}
          >
            {f.rotulo} <span className="chip-numero">{contagem[f.id] ?? 0}</span>
          </button>
        ))}
      </div>
      )}

      {!alocacoes && !erro && <Carregando />}
      {alocacoes && (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Colaborador</th>
                <th scope="col">Obra</th>
                <th scope="col">Situação</th>
                <th scope="col">Pendências</th>
                <th scope="col">Integração</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.alocacao_id} className="linha-clicavel" onClick={() => setAberta(a)}>
                  <th scope="row">
                    <button type="button" className="link-botao" onClick={(e) => { e.stopPropagation(); setAberta(a); }}>
                      {a.colaborador}
                    </button>
                    <small className="sub">{a.empresa}{a.funcao ? `, ${a.funcao.toLowerCase()}` : ''}</small>
                  </th>
                  <td>{a.obra}</td>
                  <td>
                    <span className={`selo selo-${a.status}`}>{rotuloStatus[a.status]}</span>
                    {a.bloqueado && <span className="selo selo-bloqueado">Bloqueado</span>}
                    {cadastro.has(a.colaborador_id) && <small className="sub texto-alerta">cadastro a corrigir</small>}
                  </td>
                  <td>
                    {a.status === 'encerrado' ? (
                      <span className="sub">Não se aplica</span>
                    ) : a.impeditivos_pendentes > 0 ? (
                      <>
                        {a.impeditivos_pendentes} {a.impeditivos_pendentes === 1 ? 'impeditivo' : 'impeditivos'}
                        <small className="sub">{[a.pendentes_adm && `${a.pendentes_adm} ADM`, a.pendentes_sst && `${a.pendentes_sst} SST`].filter(Boolean).join(', ')}</small>
                      </>
                    ) : (
                      <span className="sub">Nenhuma impeditiva</span>
                    )}
                    {a.a_vencer > 0 && <small className="sub texto-alerta">{a.a_vencer} vencendo em breve</small>}
                  </td>
                  <td>{a.data_integracao ? data(a.data_integracao) : <span className="sub">Não registrada</span>}</td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={5} className="vazio-linha">Nenhum colaborador nesta seleção.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Detalhe
        ehAdmin={ehAdmin}
        alocacao={aberta}
        aoFechar={() => setAberta(null)}
        aoMudar={async () => {
          const novas = await carregar();
          if (novas && aberta) setAberta(novas.find((x) => x.alocacao_id === aberta.alocacao_id) ?? null);
        }}
      />
    </Pagina>
  );
}

export function Detalhe({ ehAdmin, alocacao, aoFechar, aoMudar }: { ehAdmin: boolean; alocacao: AlocacaoResumo | null; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const [colab, setColab] = useState<Colaborador | null>(null);
  const [pend, setPend] = useState<Pendencia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [dataInt, setDataInt] = useState(hojeIso());
  const [devolvendo, setDevolvendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [devolucaoTst, setDevolucaoTst] = useState<{ motivo: string; em: string } | null>(null);
  const [excecoes, setExcecoes] = useState<Excecao[]>([]);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [bloqueando, setBloqueando] = useState(false);
  const [motivoBloqueio, setMotivoBloqueio] = useState('');
  const [obras, setObras] = useState<ObraCadastro[]>([]);
  const [novaObra, setNovaObra] = useState('');
  const [alocadas, setAlocadas] = useState<Set<string>>(new Set());

  const id = alocacao?.alocacao_id;
  const colabId = alocacao?.colaborador_id;

  useEffect(() => {
    setErro(null);
    setOk(null);
    setEditando(false);
    setColab(null);
    setPend(null);
    setDataInt(hojeIso());
    setDevolvendo(false);
    setMotivo('');
    setDevolucaoTst(null);
    setExcecoes([]);
    setBloqueios([]);
    setBloqueando(false);
    setMotivoBloqueio('');
    setNovaObra('');
    if (!id || !colabId) return;
    lerExcecoes(colabId).then(setExcecoes).catch(() => undefined);
    lerBloqueios(colabId).then(setBloqueios).catch(() => undefined);
    if (ehAdmin) {
      lerObrasCadastro().then((o) => setObras(o.filter((x) => x.ativa))).catch(() => undefined);
      lerAlocacoes()
        .then((l) => setAlocadas(new Set(l.filter((a) => a.colaborador_id === colabId && a.status !== 'encerrado').map((a) => a.obra_id))))
        .catch(() => undefined);
    }
    if (ehAdmin) lerDevolucaoTst(id).then(setDevolucaoTst).catch(() => undefined);
    Promise.all([lerColaborador(colabId), lerPendencias(id)])
      .then(([c, p]) => {
        setColab(c);
        setPend(p.sort((a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || Number(b.impeditivo) - Number(a.impeditivo) || a.documento.localeCompare(b.documento, 'pt-BR')));
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [id, colabId, ehAdmin]);

  async function agir(acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      await acao();
      setOk(sucesso);
      await aoMudar();
      if (colabId) {
        setColab(await lerColaborador(colabId));
        setExcecoes(await lerExcecoes(colabId));
        setBloqueios(await lerBloqueios(colabId));
      }
      if (id) setPend(await lerPendencias(id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(false);
    }
  }

  if (!alocacao) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;

  const travas = (pend ?? []).filter((p) => p.impeditivo && ['nao_enviado', 'em_analise', 'devolvido', 'vencido'].includes(p.situacao));
  const bloqueado = colab?.bloqueado ?? alocacao.bloqueado;

  async function verAnexo(tipo: string) {
    setErro(null);
    try {
      const anexos = await lerAnexos(alocacao!.colaborador_id, tipo);
      if (anexos.length === 0) {
        setErro('Não há arquivo guardado para este documento (ainda não enviado ou já apagado do portal).');
        return;
      }
      for (const a of anexos) await abrirArquivo(a.caminho);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  // E-mail ao fornecedor sobre este colaborador, com o que falta.
  async function emailFornecedor() {
    setErro(null);
    try {
      const para = await lerEmailEmpresa(alocacao!.empresa_id);
      const faltam = (pend ?? []).filter((p) => p.impeditivo && ['nao_enviado', 'devolvido', 'vencido'].includes(p.situacao));
      const corpo = [
        'Olá,',
        '',
        `Sobre o colaborador ${alocacao!.colaborador} (obra ${alocacao!.obra}):`,
        '',
        ...(faltam.length
          ? ['Falta regularizar no Portal de Terceiros:', ...faltam.map((p) => `- ${p.documento}: ${rotuloSituacao[p.situacao].toLowerCase()}${p.situacao === 'devolvido' && p.motivo_devolucao ? ` (${p.motivo_devolucao})` : ''}`)]
          : ['']),
        '',
        `Envie os documentos pelo portal: ${enderecoDoSite}meus-colaboradores`,
        '',
        'Atenciosamente,',
      ].join('\n');
      window.location.href = linkOutlook(para, `Colaborador ${alocacao!.colaborador} · ${alocacao!.obra}`, corpo);
      if (!para) setOk('O e-mail abriu sem destinatário: a empresa não tem e-mail cadastrado.');
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  return (
    <Dialogo aberto titulo={alocacao.colaborador} aoFechar={aoFechar} largura="larga">
      <div className="detalhe">
        <dl className="ficha">
          <div><dt>Empresa</dt><dd>{alocacao.empresa}</dd></div>
          <div><dt>Obra</dt><dd>{alocacao.obra}</dd></div>
          <div><dt>Função</dt><dd>{colab?.funcoes?.nome ?? colab?.funcao_texto ?? alocacao.funcao ?? 'Não informada'}</dd></div>
          <div><dt>CPF</dt><dd>{colab ? formatarCpf(colab.cpf) || 'Não informado' : ''}</dd></div>
          <div><dt>Admissão</dt><dd>{colab ? data(colab.data_admissao) || 'Não informada' : ''}</dd></div>
          <div><dt>Nascimento</dt><dd>{colab ? data(colab.data_nascimento) || 'Não informada' : ''}</dd></div>
          <div><dt>Situação</dt><dd><span className={`selo selo-${alocacao.status}`}>{rotuloStatus[alocacao.status]}</span></dd></div>
          <div><dt>Integração</dt><dd>{alocacao.data_integracao ? data(alocacao.data_integracao) : 'Não registrada'}</dd></div>
        </dl>

        {bloqueado && (
          <p className="aviso aviso-erro">
            <strong>Colaborador bloqueado{colab?.bloqueado_em ? ` desde ${data(colab.bloqueado_em)}` : ''}.</strong> {colab?.bloqueio_motivo ?? alocacao.bloqueio_motivo}
          </p>
        )}
        {ehAdmin && alocacao.status === 'em_analise' && devolucaoTst && (
          <p className="aviso aviso-alerta">
            <strong>Devolvido pelo TST em {data(devolucaoTst.em)}.</strong> {devolucaoTst.motivo}
          </p>
        )}
        {ehAdmin && colab?.pendencia_cadastro && (
          <p className="aviso aviso-alerta">
            <strong>Cadastro a corrigir.</strong> {colab.pendencia_cadastro}
          </p>
        )}
        {excecoes.length > 0 && (
          <div className="aviso aviso-info">
            <strong>Treinamentos ajustados para este colaborador</strong> (fora da regra da função):
            <ul className="lista-ajustes">
              {[...excecoes].sort((a, b) => a.tipo_codigo.localeCompare(b.tipo_codigo)).map((e) => (
                <li key={e.tipo_codigo}>
                  {nomeNr(e.tipo_codigo)} {e.exige ? 'obrigatória' : 'não obrigatória'}
                  {e.motivo ? `: ${e.motivo}` : ''} <span className="sub sub-linha">(desde {data(e.incluido_em)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {ok && <p className="aviso aviso-ok" role="status">{ok}</p>}

        {!ehAdmin && alocacao.status === 'aprovado_admin' && (
          <div className="caixa">
            <p className="caixa-texto">
              A documentação foi conferida e aprovada pelo administrativo da Emais. Confira os dados abaixo e dê a validação final
              da segurança do trabalho.
            </p>
            {!devolvendo ? (
              <div className="linha-botoes">
                <button
                  type="button"
                  className="botao"
                  disabled={ocupado}
                  onClick={() => agir(() => validarAlocacao(alocacao.alocacao_id), `${alocacao.colaborador} liberado para ${alocacao.obra}.`)}
                >
                  Validar e liberar
                </button>
                <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => setDevolvendo(true)}>
                  Devolver ao administrativo
                </button>
              </div>
            ) : (
              <form
                className="formulario formulario-largo"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (motivo.trim()) agir(() => devolverAlocacaoTst(alocacao.alocacao_id, motivo.trim()), 'Devolvido ao administrativo com o motivo informado.');
                }}
              >
                <label className="campo">
                  <span>O que precisa ser revisto</span>
                  <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: NR-35 sem carga horária mínima; função não confere com a atividade na obra" />
                </label>
                <div className="linha-botoes">
                  <button className="botao" type="submit" disabled={!motivo.trim() || ocupado}>Devolver</button>
                  <button className="botao botao-discreto" type="button" onClick={() => setDevolvendo(false)}>Cancelar</button>
                </div>
              </form>
            )}
          </div>
        )}

        {ehAdmin && (
        <div className="linha-botoes">
          {alocacao.status === 'em_analise' && (
            <button
              type="button"
              className="botao"
              disabled={ocupado || travas.length > 0 || !pend}
              title={travas.length > 0 ? 'Ainda há documento impeditivo pendente' : undefined}
              onClick={() => agir(() => aprovarAlocacao(alocacao.alocacao_id), 'Alocação aprovada. Agora falta a validação do TST da obra.')}
            >
              Aprovar e enviar ao TST
            </button>
          )}
          {alocacao.status === 'liberado' && (
            <form
              className="em-linha"
              onSubmit={(e) => {
                e.preventDefault();
                agir(() => registrarIntegracao(alocacao.alocacao_id, dataInt), `Integração registrada em ${data(dataInt)}.`);
              }}
            >
              <label className="campo campo-compacto">
                <span>Data da integração</span>
                <input type="date" value={dataInt} max={hojeIso()} onChange={(e) => setDataInt(e.target.value)} />
              </label>
              <button className="botao botao-secundario" type="submit" disabled={ocupado || !dataInt}>
                {alocacao.data_integracao ? 'Atualizar integração' : 'Registrar integração'}
              </button>
            </form>
          )}
          {colab && !editando && (
            <button type="button" className="botao botao-secundario" onClick={() => setEditando(true)}>Editar cadastro</button>
          )}
          <button type="button" className="botao botao-secundario" disabled={!pend} onClick={emailFornecedor}>E-mail ao fornecedor</button>
        </div>
        )}

        {ehAdmin && colab?.situacao === 'ativo' && obras.some((o) => !alocadas.has(o.id)) && (
          <form
            className="em-linha"
            onSubmit={(e) => {
              e.preventDefault();
              const o = obras.find((x) => x.id === novaObra);
              if (o) {
                agir(async () => {
                  await alocarComoAdmin(alocacao.colaborador_id, alocacao.empresa_id, o.id);
                  setAlocadas((s) => new Set([...s, o.id]));
                  setNovaObra('');
                }, `${alocacao.colaborador} incluído na obra ${o.nome}. A alocação começa em cadastro.`);
              }
            }}
          >
            <label className="campo campo-compacto">
              <span>Alocar em outra obra</span>
              <select value={novaObra} onChange={(e) => setNovaObra(e.target.value)}>
                <option value="">Escolha a obra</option>
                {obras.filter((o) => !alocadas.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </label>
            <button className="botao botao-secundario" type="submit" disabled={!novaObra || ocupado}>Alocar</button>
          </form>
        )}

        {colab?.situacao === 'ativo' && (
          <div className="caixa">
            {!bloqueando ? (
              <div className="barra-lista">
                <span className="caixa-texto">
                  {bloqueado ? 'Colaborador bloqueado: não é aprovado nem liberado em nenhuma obra.' : 'Bloqueio impede o colaborador em todas as obras, com motivo registrado.'}
                </span>
                <button type="button" className={bloqueado ? 'botao botao-secundario botao-pequeno' : 'botao botao-discreto botao-pequeno'} onClick={() => setBloqueando(true)}>
                  {bloqueado ? 'Desbloquear' : 'Bloquear colaborador'}
                </button>
              </div>
            ) : (
              <form
                className="formulario formulario-largo"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (motivoBloqueio.trim().length >= 5) {
                    agir(async () => {
                      await bloquearColaborador(alocacao.colaborador_id, !bloqueado, motivoBloqueio.trim());
                      setBloqueando(false);
                      setMotivoBloqueio('');
                    }, bloqueado ? `${alocacao.colaborador} desbloqueado.` : `${alocacao.colaborador} bloqueado. O fornecedor vê o motivo no cadastro.`);
                  }
                }}
              >
                <label className="campo">
                  <span>{bloqueado ? 'Motivo do desbloqueio' : 'Motivo do bloqueio'}</span>
                  <textarea
                    rows={2}
                    value={motivoBloqueio}
                    onChange={(e) => setMotivoBloqueio(e.target.value)}
                    placeholder={bloqueado ? 'Ex.: reciclagem da NR-35 apresentada' : 'Ex.: flagrado sem cinto de segurança em altura em 05/11'}
                  />
                  <small className="dica">Fica no histórico do colaborador. O fornecedor vê o motivo.</small>
                </label>
                <div className="linha-botoes">
                  <button className="botao" type="submit" disabled={motivoBloqueio.trim().length < 5 || ocupado}>{bloqueado ? 'Desbloquear' : 'Bloquear'}</button>
                  <button className="botao botao-discreto" type="button" onClick={() => setBloqueando(false)}>Cancelar</button>
                </div>
              </form>
            )}
            {bloqueios.length > 0 && (
              <ul className="historico-bloqueio">
                {bloqueios.map((b) => (
                  <li key={b.id}>
                    <strong>{b.acao === 'bloqueio' ? 'Bloqueado' : 'Desbloqueado'}</strong> em {data(b.feito_em)}
                    {b.feito_por_nome ? ` por ${b.feito_por_nome}` : ''}: {b.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {ehAdmin && alocacao.status === 'em_analise' && travas.length > 0 && (
          <p className="dica">Para aprovar, todos os documentos impeditivos precisam estar aprovados e em dia. Faltam {travas.length}.</p>
        )}

        {ehAdmin && colab && editando && (
          <EdicaoCadastro
            colaborador={colab}
            excecoes={excecoes}
            aoCancelar={() => setEditando(false)}
            aoSalvar={(dados, nr) =>
              agir(async () => {
                await salvarCadastro(colab.id, dados);
                await salvarTreinamentos(colab.id, nr.exigidos, nr.daFuncao, excecoes, nr.todos, nr.motivo);
                setEditando(false);
              }, 'Cadastro atualizado. Os documentos exigidos abaixo já seguem a nova regra.')
            }
          />
        )}

        <h3 className="detalhe-subtitulo">Documentos exigidos</h3>
        {!pend && !erro && <Carregando />}
        {pend && pend.length === 0 && <p className="sub">Nenhum documento exigido para este colaborador.</p>}
        {pend && pend.length > 0 && (
          <table className="tabela tabela-lista tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Situação</th>
                <th scope="col">Vence em</th>
                <th scope="col"><span className="sr">Anexo</span></th>
              </tr>
            </thead>
            <tbody>
              {pend.map((p) => (
                <tr key={p.tipo_codigo}>
                  <th scope="row">
                    {p.documento}
                    <small className="sub">{p.grupo === 'empresa' ? 'da empresa' : 'do colaborador'}, {p.area}{p.impeditivo ? ', impeditivo' : ''}</small>
                  </th>
                  <td>
                    <span className={`selo selo-doc-${p.situacao}`}>{rotuloSituacao[p.situacao]}</span>
                    {p.situacao === 'devolvido' && p.motivo_devolucao && <small className="sub">{p.motivo_devolucao}</small>}
                    {p.status_envio_aberto === 'em_analise' && p.situacao !== 'em_analise' && <small className="sub">renovação em análise</small>}
                  </td>
                  <td>{p.vencimento ? data(p.vencimento) : <span className="sub">{p.situacao === 'dispensado' ? 'Dispensado' : p.situacao === 'nao_enviado' ? '' : 'Não vence'}</span>}</td>
                  <td className="acoes">
                    {(ehAdmin || ehNr(p.tipo_codigo)) && p.grupo === 'colaborador' && !['nao_enviado', 'dispensado'].includes(p.situacao) && (
                      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => verAnexo(p.tipo_codigo)}>Ver anexo</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialogo>
  );
}

type Treinamentos = { exigidos: Set<string>; daFuncao: Set<string>; todos: string[]; motivo: string };
type DadosCadastro = {
  nome: string;
  cpf: string | null;
  pendencia_cadastro: string | null;
  funcao_id: string | null;
  data_admissao: string | null;
  data_nascimento: string | null;
};

function EdicaoCadastro({
  colaborador, excecoes, aoCancelar, aoSalvar,
}: {
  colaborador: Colaborador;
  excecoes: Excecao[];
  aoCancelar: () => void;
  aoSalvar: (d: DadosCadastro, nr: Treinamentos) => void;
}) {
  const [nome, setNome] = useState(colaborador.nome);
  const [cpf, setCpf] = useState(formatarCpf(colaborador.cpf));
  const [conferido, setConferido] = useState(true);
  const [funcaoId, setFuncaoId] = useState(colaborador.funcao_id ?? '');
  const [admissao, setAdmissao] = useState(colaborador.data_admissao ?? '');
  const [nascimento, setNascimento] = useState(colaborador.data_nascimento ?? '');
  const erroDatas = erroDatasColaborador(admissao, nascimento);
  const [base, setBase] = useState<BaseTreinamentos | null>(null);
  const [erroBase, setErroBase] = useState<string | null>(null);
  // Marcação do formulário: começa com a regra atual (função + exceções).
  const [exigidos, setExigidos] = useState<Set<string> | null>(null);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    lerBaseTreinamentos()
      .then((b) => {
        setBase(b);
        const daFuncao = b.porFuncao.get(colaborador.funcao_id ?? '') ?? new Set<string>();
        const inicial = new Set(b.tipos.map((t) => t.codigo).filter((c) => excecoes.find((e) => e.tipo_codigo === c)?.exige ?? daFuncao.has(c)));
        setExigidos(inicial);
      })
      .catch((e) => setErroBase(mensagemDeErro(e)));
    // Só ao abrir o formulário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const digitos = soDigitos(cpf);
  const cpfOk = digitos.length === 0 || cpfValido(digitos);
  const todos = base?.tipos.map((t) => t.codigo) ?? [];
  const daFuncao = base?.porFuncao.get(funcaoId) ?? new Set<string>();
  const mudancas = base && exigidos ? excecoesNovas(exigidos, daFuncao, excecoes, todos) : { gravar: [], apagar: [] };
  const precisaMotivo = mudancas.gravar.length > 0;
  const podeSalvar = cpfOk && !erroDatas && nome.trim().length >= 2 && !!exigidos && (!precisaMotivo || motivo.trim().length >= 5);

  function trocarFuncao(novaId: string) {
    // Ao trocar a função, as NRs passam a seguir a nova função (as exceções marcadas à mão continuam).
    if (base && exigidos) {
      const antiga = base.porFuncao.get(funcaoId) ?? new Set<string>();
      const nova = base.porFuncao.get(novaId) ?? new Set<string>();
      setExigidos(new Set(todos.filter((c) => (exigidos.has(c) !== antiga.has(c) ? exigidos.has(c) : nova.has(c)))));
    }
    setFuncaoId(novaId);
  }

  function marcar(codigo: string, valor: boolean) {
    setExigidos((x) => {
      const n = new Set(x);
      if (valor) n.add(codigo);
      else n.delete(codigo);
      return n;
    });
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!podeSalvar || !exigidos) return;
    aoSalvar(
      {
        nome: nome.trim().toUpperCase(),
        cpf: digitos || null,
        pendencia_cadastro: conferido && digitos ? null : colaborador.pendencia_cadastro,
        funcao_id: funcaoId || null,
        data_admissao: admissao || null,
        data_nascimento: nascimento || null,
      },
      { exigidos, daFuncao, todos, motivo: motivo.trim() },
    );
  }

  return (
    <form className="formulario formulario-largo caixa" onSubmit={enviar} noValidate>
      <h3 className="detalhe-subtitulo">Editar cadastro</h3>
      <div className="grade-2">
        <label className="campo">
          <span>Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo">
          <span>CPF</span>
          <input inputMode="numeric" value={cpf} aria-invalid={!cpfOk} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
          {!cpfOk && <small className="campo-erro">CPF inválido. Confira os números.</small>}
        </label>
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
      {colaborador.pendencia_cadastro && (
        <label className="opcao">
          <input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
          <span>Cadastro conferido: tirar o aviso de correção</span>
        </label>
      )}

      {erroBase && <p className="aviso aviso-erro" role="alert">{erroBase}</p>}
      {!base && !erroBase && <Carregando />}
      {base && exigidos && (
        <>
          <label className="campo">
            <span>Função</span>
            <select value={funcaoId} onChange={(e) => trocarFuncao(e.target.value)}>
              <option value="">Não cadastrada{colaborador.funcao_texto ? ` (informada: ${colaborador.funcao_texto.toLowerCase()})` : ''}</option>
              {base.funcoes.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
            <small className="dica">A função define as NRs obrigatórias. Abaixo dá para ajustar para este colaborador.</small>
          </label>

          <fieldset className="campo-grupo">
            <legend>Treinamentos obrigatórios (NR)</legend>
            <div className="grade-nr">
              {base.tipos.map((t) => {
                const marcado = exigidos.has(t.codigo);
                const ajuste = marcado !== daFuncao.has(t.codigo);
                return (
                  <label key={t.codigo} className={`opcao opcao-nr${ajuste ? ' opcao-ajuste' : ''}`}>
                    <input type="checkbox" checked={marcado} onChange={(e) => marcar(t.codigo, e.target.checked)} />
                    <span>
                      {t.nome}
                      <small className="sub">
                        {ajuste ? (marcado ? 'Ajuste: a função não pede' : 'Ajuste: a função pede') : daFuncao.has(t.codigo) ? 'Pela função' : 'Não se aplica'}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {precisaMotivo && (
            <label className="campo">
              <span>Motivo do ajuste</span>
              <textarea
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: atividade na obra não envolve trabalho em altura, conforme a engenharia"
              />
              <small className="dica">
                Fica registrado no histórico do colaborador. Vale para {mudancas.gravar.map(nomeNr).join(', ')}.
              </small>
            </label>
          )}
        </>
      )}
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!podeSalvar}>Salvar cadastro</button>
        <button className="botao botao-discreto" type="button" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
