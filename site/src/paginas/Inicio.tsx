import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSessao } from '../lib/sessao';
import { lerAlocacoesAbertas, resumirPorObra, type ResumoObra } from '../lib/consultas';
import { lerObrasDoPainel, lerPainelObra } from '../lib/painelObra';
import { contarCores, faroisDaObra, ordemCor, pior, rotuloCor, type Cor, type FarolEmpresa } from '../lib/farois';
import { Farol, LegendaFarois, LinhaFarol, ResumoFarois, SeloFrente } from '../componentes/Farois';
import { mensagemDeErro } from '../lib/supabase';
import { Pagina } from '../componentes/Pagina';
import { Carregando } from '../componentes/Carregando';
import { Dialogo } from '../componentes/Dialogo';
import { conferirEncerramento, criarObra, lerObrasCadastro, mudarSituacaoObra, renomearObra, type ConferenciaEncerramento, type ObraCadastro } from '../lib/admin';
import { data, hojeIso } from '../lib/formato';
import { PainelObra } from './PainelObra';
import { MinhasObras } from './fornecedor/MinhasObras';

// Engenharia e TST entram direto no painel da obra com os faróis; o fornecedor, nas suas obras com os faróis;
// o administrativo vê todas as obras com os faróis.
export function Inicio() {
  const { usuario } = useSessao();
  if (usuario?.perfil === 'engenharia' || usuario?.perfil === 'tst') return <PainelObra />;
  if (usuario?.perfil === 'fornecedor') return <MinhasObras />;
  return <InicioPadrao />;
}

type Obra = {
  id: string;
  nome: string;
  geral: Cor;
  doc: Cor;
  int: Cor;
  med: Cor;
  farois: FarolEmpresa[];
  contagem: Record<Cor, number>;
  numeros: ResumoObra | null;
  emEncerramento: boolean;
};

// Situação das obras (administrativo): uma linha por obra com os faróis; ao clicar, as empresas da obra.
function InicioPadrao() {
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [gestao, setGestao] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [lista, alocacoes] = await Promise.all([lerObrasDoPainel(), lerAlocacoesAbertas()]);
      const numeros = new Map(resumirPorObra(alocacoes).map((r) => [r.obraId, r]));
      const paineis = await Promise.all(lista.map(async (o) => ({ obra: o, painel: await lerPainelObra(o.id) })));
      const montadas = paineis
        .map(({ obra, painel }): Obra => {
          const farois = faroisDaObra(painel.colaboradores, painel.medicoes);
          return {
            id: obra.id,
            nome: obra.nome,
            geral: pior(...farois.map((f) => f.geral)),
            doc: pior(...farois.map((f) => f.doc.cor)),
            int: pior(...farois.map((f) => f.int.cor)),
            med: pior(...farois.map((f) => f.med.cor)),
            farois,
            contagem: contarCores(farois),
            numeros: numeros.get(obra.id) ?? null,
            emEncerramento: obra.situacao === 'em_encerramento',
          };
        })
        .filter((o) => o.farois.length > 0 || o.numeros)
        .sort((a, b) => ordemCor[a.geral] - ordemCor[b.geral] || a.nome.localeCompare(b.nome, 'pt-BR'));
      if (cancelado) return;
      setObras(montadas);
    })().catch((e) => !cancelado && setErro(mensagemDeErro(e)));
    return () => {
      cancelado = true;
    };
  }, [versao]);

  const empresas = useMemo(() => (obras ?? []).flatMap((o) => o.farois), [obras]);

  return (
    <Pagina
      titulo="Situação das obras"
      apoio="Cada obra com os faróis de documentos, integração e medição das empresas que trabalham nela. Os números do topo contam as empresas em cada obra. Clique na obra para ver as empresas."
      acoes={<button type="button" className="botao botao-secundario" onClick={() => setGestao(true)}>Gerenciar obras</button>}
    >

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {!erro && !obras && <Carregando />}
        {obras && obras.length === 0 && <p className="vazio">Nenhuma alocação aberta no momento.</p>}

        {obras && obras.length > 0 && (
          <>
            <ResumoFarois contagem={contarCores(empresas)} />
            <LegendaFarois />
            <ul className="lista-farois">
              {obras.map((o) => (
                <LinhaFarol
                  key={o.id}
                  id={o.id}
                  geral={o.geral}
                  titulo={o.nome}
                  subtitulo={[o.emEncerramento ? 'Em encerramento' : '', o.numeros ? numerosDaObra(o.numeros) : ''].filter(Boolean).join(' · ') || undefined}
                  manchete={mancheteDaObra(o)}
                  doc={o.doc}
                  int={o.int}
                  med={o.med}
                  aberta={aberta === o.id}
                  aoAlternar={() => setAberta(aberta === o.id ? null : o.id)}
                >
                  {o.farois.length === 0 ? (
                    <p className="frente">Nenhuma empresa com colaborador ou medição nesta obra.</p>
                  ) : (
                    <ul className="empresas-obra">
                      {o.farois.map((f) => (
                        <li key={f.empresaId} className="empresa-obra">
                          <span className="tarefa-texto">
                            <Farol cor={f.geral} rotulo={rotuloCor[f.geral]} />
                            <span>
                              <strong>{f.empresa}</strong>
                              {f.manchete}
                            </span>
                          </span>
                          <span className="linha-farol-frentes">
                            <SeloFrente nome="Documentos" cor={f.doc.cor} />
                            <SeloFrente nome="Integração" cor={f.int.cor} />
                            <SeloFrente nome="Medição" cor={f.med.cor} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="linha-botoes">
                    <Link className="botao botao-pequeno" to={`/painel-obra?obra=${o.id}`}>Abrir o painel da obra</Link>
                    <Link className="botao botao-secundario botao-pequeno" to={`/colaboradores?obra=${o.id}`}>Ver colaboradores</Link>
                  </p>
                </LinhaFarol>
              ))}
            </ul>
            <p className="dica">Bloqueios primeiro, depois pendências, depois as obras em dia. O farol da obra é o pior entre as empresas dela.</p>
          </>
        )}
        <GestaoObras aberto={gestao} aoFechar={() => setGestao(false)} aoMudar={() => setVersao((v) => v + 1)} />
    </Pagina>
  );
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function numerosDaObra(r: ResumoObra): string {
  const partes = [plural(r.ativos, 'ativo', 'ativos'), plural(r.liberados, 'liberado', 'liberados')];
  const emAnalise = r.emAnalise + r.aguardandoTst;
  if (emAnalise) partes.push(`${emAnalise} em análise`);
  if (r.comFornecedor) partes.push(`${r.comFornecedor} com o fornecedor`);
  return partes.join(' · ');
}

function mancheteDaObra(o: Obra): string {
  const c = o.contagem;
  const partes: string[] = [];
  if (c.vermelho) partes.push(`${plural(c.vermelho, 'empresa', 'empresas')} com bloqueio`);
  if (c.amarelo) partes.push(`${plural(c.amarelo, 'empresa', 'empresas')} com pendência`);
  if (c.verde) partes.push(`${plural(c.verde, 'empresa', 'empresas')} em dia`);
  return partes.length ? partes.join(', ') : 'Nenhuma empresa na obra';
}

// Cadastro de obras: criar, renomear e encerrar.
// Encerramento em dois passos: "em encerramento" (não entra ninguém novo; a Emais confere as movimentações) e
// "encerrada" (a Emais confirma: alocações abertas são encerradas e a obra some da gestão de terceiros).
const ROTULO_SITUACAO: Record<ObraCadastro['situacao'], string> = {
  ativa: 'Ativa',
  em_encerramento: 'Em encerramento',
  encerrada: 'Encerrada',
};

function GestaoObras({ aberto, aoFechar, aoMudar }: { aberto: boolean; aoFechar: () => void; aoMudar: () => void }) {
  const [obras, setObras] = useState<ObraCadastro[] | null>(null);
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [encerrando, setEncerrando] = useState<ObraCadastro | null>(null);
  const [verEncerradas, setVerEncerradas] = useState(false);

  async function carregar() {
    try {
      setObras(await lerObrasCadastro());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setOk(null);
    setNova('');
    setEditando(null);
    setVerEncerradas(false);
    carregar();
  }, [aberto]);

  async function agir(acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      await acao();
      setOk(sucesso);
      await carregar();
      aoMudar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(false);
    }
  }

  function criar(e: FormEvent) {
    e.preventDefault();
    const n = nova.trim();
    if (n.length < 3) return;
    agir(async () => {
      await criarObra(n);
      setNova('');
    }, `Obra ${n.toUpperCase()} criada. Para os fornecedores usarem, aloque os colaboradores nela (Colaboradores, "Alocar em outra obra").`);
  }

  const emAndamento = (obras ?? []).filter((o) => o.situacao !== 'encerrada');
  const encerradas = (obras ?? []).filter((o) => o.situacao === 'encerrada');

  function linha(o: ObraCadastro) {
    if (editando === o.id) {
      return (
        <li key={o.id}>
          <form
            className="em-linha"
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim().length >= 3) agir(async () => { await renomearObra(o.id, nome); setEditando(null); }, `Obra renomeada para ${nome.trim().toUpperCase()}.`);
            }}
          >
            <label className="campo campo-compacto">
              <span className="sr">Novo nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
            </label>
            <button className="botao botao-pequeno" type="submit" disabled={nome.trim().length < 3 || ocupado}>Salvar</button>
            <button className="botao botao-discreto botao-pequeno" type="button" onClick={() => setEditando(null)}>Cancelar</button>
          </form>
        </li>
      );
    }
    return (
      <li key={o.id}>
        <span>
          <strong>{o.nome}</strong>
          {o.situacao === 'em_encerramento' && (
            <small className="sub">Em encerramento desde {data(o.encerramento_iniciado_em)}: não recebe ninguém novo</small>
          )}
          {o.situacao === 'encerrada' && (
            <small className="sub">Encerrada em {data(o.encerrada_em)}{o.encerramento_obs ? `: ${o.encerramento_obs}` : ''}</small>
          )}
        </span>
        <span className="linha-botoes">
          <span className={`selo selo-obra-${o.situacao}`}>{ROTULO_SITUACAO[o.situacao]}</span>
          {o.situacao !== 'encerrada' && (
            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => { setEditando(o.id); setNome(o.nome); }}>
              Renomear
            </button>
          )}
          {o.situacao === 'ativa' && (
            <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setEncerrando(o)}>Encerrar obra</button>
          )}
          {o.situacao === 'em_encerramento' && (
            <button type="button" className="botao botao-pequeno" onClick={() => setEncerrando(o)}>Conferir e concluir</button>
          )}
          {o.situacao === 'encerrada' && (
            <button
              type="button"
              className="botao botao-discreto botao-pequeno"
              disabled={ocupado}
              onClick={() => agir(async () => { await mudarSituacaoObra(o.id, 'reabrir'); }, `Obra ${o.nome} reaberta. Colaboradores e empresas não voltam sozinhos: aloque de novo quem for continuar.`)}
            >
              Reabrir
            </button>
          )}
        </span>
      </li>
    );
  }

  return (
    <Dialogo aberto={aberto} titulo="Obras" aoFechar={aoFechar} largura="larga">
      <div className="detalhe">
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {ok && <p className="aviso aviso-ok" role="status">{ok}</p>}
        <form className="em-linha" onSubmit={criar}>
          <label className="campo">
            <span>Nova obra</span>
            <input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Ex.: ECIVITAS JUNDIAÍ" />
          </label>
          <button className="botao" type="submit" disabled={nova.trim().length < 3 || ocupado}>Criar obra</button>
        </form>

        <h3 className="detalhe-subtitulo">Obras em andamento</h3>
        {!obras && <Carregando />}
        {obras && emAndamento.length === 0 && <p className="sub">Nenhuma obra em andamento.</p>}
        {obras && emAndamento.length > 0 && <ul className="lista-simples">{emAndamento.map(linha)}</ul>}

        {encerradas.length > 0 && (
          <>
            <button type="button" className="botao botao-discreto botao-pequeno" aria-expanded={verEncerradas} onClick={() => setVerEncerradas((v) => !v)}>
              {verEncerradas ? 'Ocultar' : 'Ver'} obras encerradas ({encerradas.length})
            </button>
            {verEncerradas && <ul className="lista-simples">{encerradas.map(linha)}</ul>}
          </>
        )}
      </div>
      <EncerrarObra
        obra={encerrando}
        aoFechar={() => setEncerrando(null)}
        aoMudar={(msg) => {
          setEncerrando(null);
          setOk(msg);
          carregar();
          aoMudar();
        }}
      />
    </Dialogo>
  );
}

const ROTULO_ALOCACAO: Record<string, string> = {
  em_cadastro: 'Em cadastro',
  em_analise: 'Em análise',
  pendente_fornecedor: 'Pendente com o fornecedor',
  aprovado_admin: 'Aguardando TST',
  liberado: 'Liberado',
};

// Conferência e encerramento de uma obra.
function EncerrarObra({ obra, aoFechar, aoMudar }: { obra: ObraCadastro | null; aoFechar: () => void; aoMudar: (mensagem: string) => void }) {
  const [conf, setConf] = useState<ConferenciaEncerramento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dataFim, setDataFim] = useState(hojeIso());
  const [obs, setObs] = useState('');
  const [confirmo, setConfirmo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!obra) return;
    setConf(null);
    setErro(null);
    setDataFim(hojeIso());
    setObs('');
    setConfirmo(false);
    conferirEncerramento(obra.id).then(setConf).catch((e) => setErro(mensagemDeErro(e)));
  }, [obra]);

  if (!obra) return null;
  const pendente = !!conf && (conf.colaboradores.length > 0 || conf.medicoes.length > 0);
  const emEncerramento = obra.situacao === 'em_encerramento';

  async function executar(acao: 'iniciar' | 'cancelar' | 'concluir') {
    if (!obra) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await mudarSituacaoObra(obra.id, acao, acao === 'concluir' ? { data: dataFim, observacao: obs, confirmo } : {});
      aoMudar(
        acao === 'iniciar'
          ? `Obra ${obra.nome} em encerramento. Ela não recebe mais colaboradores, empresas nem integrações. Confira as movimentações e conclua quando estiver tudo certo.`
          : acao === 'cancelar'
            ? `Encerramento de ${obra.nome} cancelado. A obra voltou a ficar ativa.`
            : `Obra ${obra.nome} encerrada: ${r.alocacoes} alocação(ões) encerrada(s), ${r.empresas} empresa(s) saíram da obra${r.pedidos ? `, ${r.pedidos} pedido(s) recusado(s)` : ''}${r.integracoes ? `, ${r.integracoes} integração(ões) cancelada(s)` : ''}.`,
      );
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(false);
    }
  }

  const porEmpresa = new Map<string, NonNullable<typeof conf>['colaboradores']>();
  (conf?.colaboradores ?? []).forEach((c) => porEmpresa.set(c.empresa, [...(porEmpresa.get(c.empresa) ?? []), c]));

  return (
    <Dialogo aberto={!!obra} titulo={`Encerrar obra ${obra.nome}`} aoFechar={aoFechar} largura="larga">
      <div className="detalhe">
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <ol className="passos-encerramento">
          <li className={emEncerramento ? 'feito' : 'atual'}>
            <strong>1. Colocar em encerramento</strong>
            <span>A obra para de receber colaboradores, empresas, pedidos de acesso e integrações. Fornecedores veem o aviso.</span>
          </li>
          <li className={emEncerramento ? 'atual' : ''}>
            <strong>2. Conferir as movimentações</strong>
            <span>Desligue ou transfira os colaboradores em Colaboradores e confira as últimas medições.</span>
          </li>
          <li>
            <strong>3. Concluir o encerramento</strong>
            <span>A Emais confirma o fechamento e a obra sai da gestão de terceiros.</span>
          </li>
        </ol>

        {!conf && !erro && <Carregando />}
        {conf && (
          <>
            <h3 className="detalhe-subtitulo">O que ainda está aberto</h3>
            <ul className="conferencia-obra">
              <li className={conf.colaboradores.length ? 'alerta' : 'ok'}><strong>{conf.colaboradores.length}</strong> colaborador(es) na obra</li>
              <li className={conf.medicoes.length ? 'alerta' : 'ok'}><strong>{conf.medicoes.length}</strong> medição(ões) sem aprovação</li>
              <li className={conf.documentos_em_analise ? 'alerta' : 'ok'}><strong>{conf.documentos_em_analise}</strong> documento(s) em análise</li>
              <li className={conf.integracoes ? 'alerta' : 'ok'}><strong>{conf.integracoes}</strong> integração(ões) agendada(s)</li>
              <li className={conf.pedidos ? 'alerta' : 'ok'}><strong>{conf.pedidos}</strong> pedido(s) de acesso pendente(s)</li>
              <li className="ok"><strong>{conf.empresas}</strong> empresa(s) ligadas à obra</li>
            </ul>

            {conf.colaboradores.length > 0 && (
              <details className="detalhe-dobravel">
                <summary>Ver colaboradores na obra</summary>
                {[...porEmpresa.entries()].map(([empresa, lista]) => (
                  <div key={empresa}>
                    <p className="sub"><strong>{empresa}</strong> ({lista.length})</p>
                    <ul className="lista-compacta">
                      {lista.map((c) => (
                        <li key={c.alocacao_id}>{c.colaborador}<small className="sub"> · {ROTULO_ALOCACAO[c.status] ?? c.status}</small></li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="linha-botoes">
                  <Link className="botao botao-secundario botao-pequeno" to={`/colaboradores?obra=${obra.id}`} onClick={aoFechar}>Abrir colaboradores da obra</Link>
                </p>
              </details>
            )}
            {conf.medicoes.length > 0 && (
              <details className="detalhe-dobravel">
                <summary>Ver medições sem aprovação</summary>
                <ul className="lista-compacta">
                  {conf.medicoes.map((m) => (
                    <li key={`${m.empresa}|${m.competencia}`}>{m.empresa}<small className="sub"> · {data(m.competencia).slice(3)} · {m.status.replace('_', ' ')}</small></li>
                  ))}
                </ul>
              </details>
            )}

            {!emEncerramento && (
              <div className="linha-botoes">
                <button type="button" className="botao" disabled={ocupado} onClick={() => executar('iniciar')}>Colocar em encerramento</button>
                <span className="sub">Ou conclua direto abaixo, se a obra já terminou.</span>
              </div>
            )}

            <form
              className="formulario formulario-largo caixa-destaque"
              onSubmit={(e) => {
                e.preventDefault();
                executar('concluir');
              }}
            >
              <h3 className="detalhe-subtitulo">Concluir o encerramento</h3>
              <div className="grade-2">
                <label className="campo">
                  <span>Data de encerramento</span>
                  <input type="date" value={dataFim} max={hojeIso()} onChange={(e) => setDataFim(e.target.value)} />
                </label>
              </div>
              <label className="campo">
                <span>Descrição do encerramento</span>
                <textarea rows={2} maxLength={500} placeholder="Ex.: obra entregue; últimas medições conferidas; colaboradores desligados ou transferidos" value={obs} onChange={(e) => setObs(e.target.value)} />
              </label>
              {pendente && (
                <label className="campo-opcao">
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
                  <span>Conferi as movimentações. Encerrar mesmo com {conf.colaboradores.length} colaborador(es) e {conf.medicoes.length} medição(ões) em aberto: as alocações serão encerradas.</span>
                </label>
              )}
              <div className="linha-botoes">
                <button type="submit" className="botao botao-perigo" disabled={ocupado || !dataFim || obs.trim().length < 5 || (pendente && !confirmo)}>
                  Concluir encerramento
                </button>
                {emEncerramento && (
                  <button type="button" className="botao botao-discreto" disabled={ocupado} onClick={() => executar('cancelar')}>
                    Cancelar encerramento (voltar a ativa)
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </Dialogo>
  );
}
