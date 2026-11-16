import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { Assinatura } from '../../componentes/Assinatura';
import { CampoFotos } from '../../componentes/CampoFotos';
import { useSessao } from '../../lib/sessao';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso, somarDias } from '../../lib/formato';
import {
  NOMES_STATUS_VISTORIA, colaboradoresAtivos, concluirVistoria, enviarImagem, excluirRascunho, gravarVistoria, lerAlojamento,
  lerFornecedoresDaObra, lerModelo, lerVistoria, linksDosArquivos, nomeDaObra, notaPrevia, reabrirVistoria,
  type AlojamentoComObra, type ColaboradorAtivo, type Fornecedor, type ItemVistoria, type Pessoa, type Vistoria,
} from '../../lib/seguranca';
import { baixarPdfVistoria } from '../../lib/pdfSeguranca';
import { Assinaturas, Fotos, SeloClassificacao, Voltar, caminhosDaVistoria, nomeResponsavel } from './comum';
import { NcsVistoria } from './NcsVistoria';

type Lista = 'funcionarios' | 'envolvidos';

export function VistoriaPagina() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const { usuario } = useSessao();
  const podeEditar = usuario?.perfil === 'admin' || usuario?.perfil === 'tst';

  const [v, setV] = useState<Vistoria | null>(null);
  const atual = useRef<Vistoria | null>(null);
  const [aloj, setAloj] = useState<AlojamentoComObra | null>(null);
  const [nomeModelo, setNomeModelo] = useState('');
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [colabs, setColabs] = useState<ColaboradorAtivo[] | null>(null);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState<null | 'salvar' | 'concluir'>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [assinando, setAssinando] = useState<{ lista: Lista; i: number } | null>(null);
  const [reabrindo, setReabrindo] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [baixando, setBaixando] = useState(false);

  async function carregar() {
    const x = await lerVistoria(id);
    // Canteiro não tem alojamento: o "local" é a própria obra, responsabilidade da Emais.
    const a: AlojamentoComObra = x.alojamento_id
      ? await lerAlojamento(x.alojamento_id)
      : { id: '', obra_id: x.obra_id, nome: 'Canteiro de obras', endereco: null, empresa_id: null, empresa_a_vincular: null, ativo: true, obra: { nome: await nomeDaObra(x.obra_id) } };
    lerModelo(x.modelo_codigo).then((m) => setNomeModelo(m?.nome ?? '')).catch(() => undefined);
    atual.current = x;
    setV(x);
    setAloj(a);
    setSujo(false);
    lerFornecedoresDaObra(a.obra_id).then(setFornecedores).catch(() => undefined);
    if (a.empresa_id && x.situacao === 'rascunho') colaboradoresAtivos(a.empresa_id).then(setColabs).catch(() => setColabs([]));
    if (!x.fotos_excluidas_em) setLinks(await linksDosArquivos(caminhosDaVistoria(x)));
  }

  useEffect(() => {
    carregar().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aviso do navegador ao sair com alteração não salva.
  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [sujo]);

  const editando = !!v && v.situacao === 'rascunho' && podeEditar;

  async function gravar(x: Vistoria) {
    await gravarVistoria(x.id, x);
    if (atual.current === x) setSujo(false);
  }

  // Muda a vistoria na tela; com gravarJa, grava em seguida (fotos e assinaturas, que já foram enviadas).
  function atualizar(fn: (x: Vistoria) => Vistoria, gravarJa = false) {
    const nova = fn(atual.current!);
    atual.current = nova;
    setV(nova);
    setSujo(true);
    if (gravarJa) gravar(nova).catch((e) => setErro(mensagemDeErro(e as Error)));
  }
  const mudarItem = (n: number, p: Partial<ItemVistoria>, gravarJa = false) =>
    atualizar((x) => ({ ...x, itens: x.itens.map((it, i) => (i === n ? { ...it, ...p } : it)) }), gravarJa);
  const mudarPessoa = (lista: Lista, i: number, p: Partial<Pessoa>, gravarJa = false) =>
    atualizar((x) => ({ ...x, [lista]: x[lista].map((pp, k) => (k === i ? { ...pp, ...p } : pp)) }), gravarJa);

  async function salvar() {
    setErro(null);
    setOk(null);
    setSalvando('salvar');
    try {
      await gravar(atual.current!);
      setOk('Vistoria salva. Dá para continuar depois.');
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setSalvando(null);
    }
  }

  async function concluir() {
    const x = atual.current!;
    const faltam = x.itens.filter((i) => !i.status).length;
    if (faltam) {
      setErro(`Faltam ${faltam} ${faltam === 1 ? 'item' : 'itens'} sem resposta.`);
      return;
    }
    setErro(null);
    setOk(null);
    setSalvando('concluir');
    try {
      await gravar(x);
      const r = await concluirVistoria(x.id);
      await carregar();
      setOk(`Vistoria concluída: ${r.classificacao ?? 'sem nota'}. Baixe o PDF para guardar com as fotos.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setSalvando(null);
    }
  }

  async function baixar() {
    if (!v || !aloj) return;
    setBaixando(true);
    setErro(null);
    try {
      if (editando && sujo) await gravar(atual.current!);
      await baixarPdfVistoria(atual.current!, {
        obra: aloj.obra.nome, alojamento: aloj.nome, endereco: aloj.endereco, responsavel: nomeResponsavel(aloj, fornecedores, []),
        canteiro: !v.alojamento_id, checklist: nomeModelo,
      });
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setBaixando(false);
    }
  }

  async function assinar(png: Blob) {
    const alvo = assinando!;
    try {
      const caminho = await enviarImagem(`vistoria/${id}/assinatura-${crypto.randomUUID()}.png`, png);
      setLinks((l) => ({ ...l, [caminho]: URL.createObjectURL(png) }));
      mudarPessoa(alvo.lista, alvo.i, { assinatura: caminho }, true);
      setAssinando(null);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      setAssinando(null);
    }
  }

  if (!v || !aloj)
    return (
      <Pagina titulo="Vistoria de alojamento">
        <Voltar />
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );

  const canteiro = !v.alojamento_id;
  const respondidos = v.itens.filter((i) => i.status).length;
  const previa = notaPrevia(v.itens);
  const responsavel = nomeResponsavel(aloj, fornecedores, []);

  return (
    <Pagina
      titulo={canteiro ? `Vistoria do canteiro${nomeModelo ? `: ${nomeModelo}` : ''}` : `Vistoria de ${aloj.nome}`}
      apoio={`${aloj.obra.nome}. Responsável: ${responsavel}.`}
      acoes={
        <div className="linha-botoes">
          <button type="button" className="botao botao-secundario" disabled={baixando} onClick={baixar}>
            {baixando ? 'Gerando PDF' : 'Baixar PDF'}
          </button>
          {v.situacao === 'concluida' && podeEditar && (
            <button type="button" className="botao botao-discreto" onClick={() => setReabrindo(true)}>Reabrir para corrigir</button>
          )}
        </div>
      }
    >
      <Voltar />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      {editando ? (
        <div className="form-inspecao">
          <section className="bloco">
            <div className="grade-3">
              <label className="campo">
                <span>Data</span>
                <input type="date" max={hojeIso()} value={v.data_vistoria} onChange={(e) => atualizar((x) => ({ ...x, data_vistoria: e.target.value }))} />
              </label>
              <label className="campo">
                <span>Horário</span>
                <input type="time" value={v.horario ?? ''} onChange={(e) => atualizar((x) => ({ ...x, horario: e.target.value }))} />
              </label>
              {!canteiro && <label className="campo">
                <span>Moradores no alojamento</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={v.qtd_funcionarios ?? ''}
                  onChange={(e) => atualizar((x) => ({ ...x, qtd_funcionarios: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </label>}
            </div>
          </section>

          <section className="bloco">
            <div className="barra-lista">
              <h2 className="bloco-titulo">{nomeModelo || 'Checklist'}</h2>
              <span className="sub">
                {respondidos} de {v.itens.length} respondidos{previa ? `. Até aqui: ${previa.classificacao}` : ''}
              </span>
            </div>
            <ol className="itens-inspecao">
              {v.itens.map((it, n) => (
                <li key={n} className={`item-inspecao${it.status === 'nao' ? ' item-inspecao-nao' : ''}${it.status ? '' : ' item-inspecao-aberto'}`}>
                  <p className="item-inspecao-texto">
                    <span className="item-inspecao-numero">{n + 1}</span>
                    {it.texto}
                  </p>
                  <div className="escolha" role="radiogroup" aria-label={`Resposta do item ${n + 1}`}>
                    {(['sim', 'nao', 'na'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={it.status === s}
                        className={`escolha-${s}`}
                        onClick={() => mudarItem(n, s === 'nao' && !it.prazo ? { status: s, prazo: somarDias(hojeIso(), 7) } : { status: s })}
                      >
                        {NOMES_STATUS_VISTORIA[s]}
                      </button>
                    ))}
                  </div>
                  {it.status === 'nao' && (
                    <div className="grade-recomendacao">
                      <label className="campo">
                        <span>O que precisa ser feito</span>
                        <textarea rows={2} value={it.recomendacao} onChange={(e) => mudarItem(n, { recomendacao: e.target.value })} />
                      </label>
                      <label className="campo">
                        <span>Prazo</span>
                        <input type="date" value={it.prazo ?? ''} onChange={(e) => mudarItem(n, { prazo: e.target.value || null })} />
                      </label>
                    </div>
                  )}
                  <CampoFotos
                    pasta={`vistoria/${id}/${n}`}
                    fotos={it.fotos ?? []}
                    links={links}
                    aoMudar={(fotos, novos) => {
                      setLinks((l) => ({ ...l, ...novos }));
                      mudarItem(n, { fotos }, true);
                    }}
                  />
                </li>
              ))}
            </ol>
          </section>

          {!canteiro && <section className="bloco">
            <h2 className="bloco-titulo">Moradores</h2>
            {aloj.empresa_id && colabs && colabs.length > 0 && (
              <>
                <p className="dica">Marque quem mora no alojamento (colaboradores ativos de {responsavel}).</p>
                <ul className="lista-marcar lista-curta">
                  {colabs.map((c) => {
                    const marcado = v.funcionarios.some((p) => p.colaborador_id === c.id);
                    return (
                      <li key={c.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() =>
                              atualizar((x) => ({
                                ...x,
                                funcionarios: marcado
                                  ? x.funcionarios.filter((p) => p.colaborador_id !== c.id)
                                  : [...x.funcionarios, { colaborador_id: c.id, nome: c.nome, cargo: c.funcao ?? undefined, assinatura: null }],
                                qtd_funcionarios: x.qtd_funcionarios ?? null,
                              }))
                            }
                          />
                          <span>
                            {c.nome}
                            {c.funcao && <small className="sub">{c.funcao.toLowerCase()}</small>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <ListaAssinaturas
              pessoas={v.funcionarios}
              links={links}
              comCargo={false}
              rotuloIncluir={aloj.empresa_id ? 'Incluir morador que não está na lista' : 'Incluir morador'}
              aoIncluir={() => atualizar((x) => ({ ...x, funcionarios: [...x.funcionarios, { colaborador_id: null, nome: '', assinatura: null }] }))}
              aoMudar={(i, p) => mudarPessoa('funcionarios', i, p)}
              aoRemover={(i) => atualizar((x) => ({ ...x, funcionarios: x.funcionarios.filter((_, k) => k !== i) }))}
              aoAssinar={(i) => setAssinando({ lista: 'funcionarios', i })}
            />
          </section>}

          <section className="bloco">
            <h2 className="bloco-titulo">Quem acompanhou a vistoria</h2>
            <ListaAssinaturas
              pessoas={v.envolvidos}
              links={links}
              comCargo
              rotuloIncluir="Incluir pessoa"
              aoIncluir={() => atualizar((x) => ({ ...x, envolvidos: [...x.envolvidos, { nome: '', cargo: '', assinatura: null }] }))}
              aoMudar={(i, p) => mudarPessoa('envolvidos', i, p)}
              aoRemover={(i) => atualizar((x) => ({ ...x, envolvidos: x.envolvidos.filter((_, k) => k !== i) }))}
              aoAssinar={(i) => setAssinando({ lista: 'envolvidos', i })}
            />
          </section>

          <div className="barra-acoes-fixa">
            <span className="sub">{sujo ? 'Alterações não salvas' : 'Tudo salvo'}</span>
            <div className="linha-botoes">
              <button type="button" className="botao botao-discreto" onClick={() => setExcluindo(true)}>Excluir</button>
              <button type="button" className="botao botao-secundario" disabled={!!salvando} onClick={salvar}>
                {salvando === 'salvar' ? 'Salvando' : 'Salvar'}
              </button>
              <button type="button" className="botao" disabled={!!salvando} onClick={concluir}>
                {salvando === 'concluir' ? 'Concluindo' : 'Concluir vistoria'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <LeituraVistoria v={v} links={links} responsavel={responsavel} canteiro={canteiro} />
          {v.situacao === 'concluida' && !canteiro && (
            <NcsVistoria
              v={v}
              empresaId={aloj.empresa_id}
              empresaNome={responsavel}
              podeEditar={podeEditar}
              aoMensagem={(tipo, texto) => (tipo === 'ok' ? (setErro(null), setOk(texto)) : (setOk(null), setErro(texto)))}
            />
          )}
        </>
      )}

      <Assinatura
        aberto={!!assinando}
        nome={assinando ? v[assinando.lista][assinando.i]?.nome ?? '' : ''}
        aoFechar={() => setAssinando(null)}
        aoConfirmar={assinar}
      />
      <Reabrir
        aberto={reabrindo}
        aoFechar={() => setReabrindo(false)}
        aoConfirmar={async (motivo) => {
          await reabrirVistoria(id, motivo);
          setReabrindo(false);
          await carregar();
          setOk('Vistoria reaberta. Corrija e conclua de novo. Até lá ela não aparece para o fornecedor.');
        }}
      />
      <Dialogo aberto={excluindo} titulo="Excluir esta vistoria?" aoFechar={() => setExcluindo(false)}>
        <div className="formulario formulario-largo">
          <p>A vistoria em edição de {data(v.data_vistoria)} será apagada, com as respostas. Não dá para desfazer.</p>
          <div className="linha-botoes">
            <button
              type="button"
              className="botao botao-perigo"
              onClick={async () => {
                try {
                  await excluirRascunho(id);
                  setSujo(false);
                  navegar('/seguranca', { replace: true });
                } catch (e) {
                  setExcluindo(false);
                  setErro(mensagemDeErro(e as Error));
                }
              }}
            >
              Excluir vistoria
            </button>
            <button type="button" className="botao botao-discreto" onClick={() => setExcluindo(false)}>Cancelar</button>
          </div>
        </div>
      </Dialogo>
    </Pagina>
  );
}

function ListaAssinaturas({
  pessoas, links, comCargo, rotuloIncluir, aoIncluir, aoMudar, aoRemover, aoAssinar,
}: {
  pessoas: Pessoa[];
  links: Record<string, string>;
  comCargo: boolean;
  rotuloIncluir: string;
  aoIncluir: () => void;
  aoMudar: (i: number, p: Partial<Pessoa>) => void;
  aoRemover: (i: number) => void;
  aoAssinar: (i: number) => void;
}) {
  return (
    <div className="lista-pessoas">
      {pessoas.map((p, i) => (
        <div key={i} className="pessoa-assina">
          <div className={comCargo ? 'grade-2' : undefined}>
            <label className="campo">
              <span>Nome</span>
              <input value={p.nome} readOnly={!!p.colaborador_id} onChange={(e) => aoMudar(i, { nome: e.target.value })} />
            </label>
            {comCargo && (
              <label className="campo">
                <span>Cargo</span>
                <input value={p.cargo ?? ''} onChange={(e) => aoMudar(i, { cargo: e.target.value })} />
              </label>
            )}
          </div>
          <div className="pessoa-assina-acoes">
            {p.assinatura && links[p.assinatura] ? (
              <img className="assinatura-previa" src={links[p.assinatura]} alt={`Assinatura de ${p.nome}`} />
            ) : (
              <span className="sub">sem assinatura</span>
            )}
            <button type="button" className="botao botao-secundario botao-pequeno" disabled={!p.nome.trim()} onClick={() => aoAssinar(i)}>
              {p.assinatura ? 'Assinar de novo' : 'Assinar'}
            </button>
            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoRemover(i)}>Tirar</button>
          </div>
        </div>
      ))}
      <button type="button" className="botao botao-discreto botao-pequeno" onClick={aoIncluir}>+ {rotuloIncluir}</button>
    </div>
  );
}

export function LeituraVistoria({ v, links, responsavel, canteiro = false }: { v: Vistoria; links: Record<string, string>; responsavel: string; canteiro?: boolean }) {
  return (
    <div className="vistoria">
      <dl className="vistoria-dados">
        <div><dt>Data</dt><dd>{data(v.data_vistoria)}{v.horario ? `, ${v.horario}` : ''}</dd></div>
        <div><dt>Responsável</dt><dd>{responsavel}</dd></div>
        {!canteiro && <div><dt>Moradores</dt><dd>{v.qtd_funcionarios ?? '-'}</dd></div>}
        <div>
          <dt>Resultado</dt>
          <dd>
            <SeloClassificacao v={v} />
            {v.pontuacao != null && v.situacao === 'concluida' && <span className="sub"> {Math.round(v.pontuacao * 100)}% dos itens aplicáveis em ordem</span>}
          </dd>
        </div>
      </dl>
      {v.situacao === 'concluida' && v.fotos_expiram_em && !v.fotos_excluidas_em && (
        <p className="aviso aviso-info">As fotos ficam no portal até {data(v.fotos_expiram_em)}. Baixe o PDF para guardar a vistoria com as fotos.</p>
      )}
      {v.fotos_excluidas_em && <p className="dica">As fotos desta vistoria foram excluídas em {data(v.fotos_excluidas_em)}. Ficou só a avaliação.</p>}
      <ol className="vistoria-itens">
        {v.itens.map((i, n) => (
          <li key={n} className={i.status === 'nao' ? 'vistoria-item-nao' : undefined}>
            <div className="vistoria-item-linha">
              <span>{i.texto}</span>
              <span className={`selo ${i.status === 'sim' ? 'selo-ok' : i.status === 'nao' ? 'selo-erro' : 'selo-fila'}`}>
                {i.status ? NOMES_STATUS_VISTORIA[i.status] : 'sem resposta'}
              </span>
            </div>
            {(i.recomendacao || i.prazo) && (
              <p className="sub">
                {i.recomendacao}
                {i.prazo ? `${i.recomendacao ? '. ' : ''}Prazo: ${data(i.prazo)}` : ''}
              </p>
            )}
            <Fotos caminhos={i.fotos ?? []} links={links} />
          </li>
        ))}
      </ol>
      <div className="duas-colunas">
        {!canteiro && <Assinaturas titulo="Moradores" pessoas={v.funcionarios} links={links} />}
        <Assinaturas titulo="Acompanharam a vistoria" pessoas={v.envolvidos} links={links} />
      </div>
    </div>
  );
}

function Reabrir({ aberto, aoFechar, aoConfirmar }: { aberto: boolean; aoFechar: () => void; aoConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    setMotivo('');
    setErro(null);
  }, [aberto]);
  return (
    <Dialogo aberto={aberto} titulo="Reabrir a vistoria" aoFechar={aoFechar}>
      <form
        className="formulario formulario-largo"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnviando(true);
          setErro(null);
          try {
            await aoConfirmar(motivo);
          } catch (er) {
            setErro(mensagemDeErro(er as Error));
          } finally {
            setEnviando(false);
          }
        }}
      >
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <p className="dica">A vistoria volta para edição e sai da tela do fornecedor até ser concluída de novo. Fica registrado quem reabriu e por quê.</p>
        <label className="campo">
          <span>O que vai ser corrigido</span>
          <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={5} />
        </label>
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={motivo.trim().length < 5 || enviando}>{enviando ? 'Reabrindo' : 'Reabrir'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
