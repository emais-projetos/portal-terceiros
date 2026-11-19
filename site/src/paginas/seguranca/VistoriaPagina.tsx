import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { Assinatura } from '../../componentes/Assinatura';
import { useSessao } from '../../lib/sessao';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import {
  NOMES_CAMA, NOMES_STATUS_VISTORIA, concluirVistoria, enviarImagem, excluirRascunho, gravarVistoria, lerAlojamento,
  lerFornecedoresDaObra, lerModelo, lerMoradoresObra, lerNcsDaVistoria, lerVistoria, linksDosArquivos, nomeDaObra, notaPrevia, reabrirVistoria,
  type AlojamentoComObra, type Fornecedor, type ItemVistoria, type MoradorObra, type Pessoa, type Vistoria,
} from '../../lib/seguranca';
import { baixarPdfVistoria } from '../../lib/pdfSeguranca';
import { Assinaturas, Fotos, SeloClassificacao, Voltar, caminhosDaVistoria, nomeResponsavel } from './comum';
import { NcsVistoria } from './NcsVistoria';
import { ItemEdicao, ListaAssinaturas, situacaoMorador } from './ItensVistoria';
import { EdicaoQuartos, EscolherMoradores, responsavelItemQuarto } from './VistoriaQuartos';

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
  const [colabs, setColabs] = useState<MoradorObra[] | null>(null);
  const [temItensEnviados, setTemItensEnviados] = useState(false);
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
      : { id: '', obra_id: x.obra_id, nome: 'Canteiro de obras', endereco: null, tipo: 'padrao', empresa_id: null, empresa_a_vincular: null, ativo: true, obra: { nome: await nomeDaObra(x.obra_id) } };
    lerModelo(x.modelo_codigo).then((m) => setNomeModelo(m?.nome ?? '')).catch(() => undefined);
    atual.current = x;
    setV(x);
    setAloj(a);
    setSujo(false);
    lerFornecedoresDaObra(a.obra_id).then(setFornecedores).catch(() => undefined);
    if (x.alojamento_id && a.tipo !== 'obra' && x.situacao === 'rascunho') lerMoradoresObra(a.obra_id, a.empresa_id).then(setColabs).catch(() => setColabs([]));
    if (x.situacao === 'rascunho') lerNcsDaVistoria(x.id).then((l) => setTemItensEnviados(l.length > 0)).catch(() => undefined);
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
    const semCama = x.quartos.find((q) => !q.cama);
    if (semCama) {
      setErro(`Informe o tipo de cama do ${semCama.nome}.`);
      return;
    }
    if (x.funcionarios.some((p) => !p.nome.trim())) {
      setErro('Há morador sem nome. Preencha ou tire da lista.');
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
        canteiro: !v.alojamento_id, checklist: aloj.tipo === 'obra' ? 'Alojamento na obra: quartos e áreas comuns' : nomeModelo, naObra: aloj.tipo === 'obra',
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
  const naObra = aloj.tipo === 'obra';
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
              {!canteiro && !naObra && <label className="campo">
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

          {naObra ? (
            <EdicaoQuartos
              v={v}
              obraId={aloj.obra_id}
              alojamentoId={aloj.id}
              links={links}
              temItensEnviados={temItensEnviados}
              aoLinks={(novos) => setLinks((l) => ({ ...l, ...novos }))}
              atualizar={atualizar}
              mudarItem={mudarItem}
              aoAssinar={(i) => setAssinando({ lista: 'funcionarios', i })}
              aoErro={setErro}
            />
          ) : (
            <section className="bloco">
              <div className="barra-lista">
                <h2 className="bloco-titulo">{nomeModelo || 'Checklist'}</h2>
                <span className="sub">
                  {respondidos} de {v.itens.length} respondidos{previa ? `. Até aqui: ${previa.classificacao}` : ''}
                </span>
              </div>
              <ol className="itens-inspecao">
                {v.itens.map((it, n) => (
                  <ItemEdicao
                    key={n}
                    it={it}
                    n={n}
                    numero={n + 1}
                    idVistoria={id}
                    links={links}
                    aoMudar={(p, gravarJa) => mudarItem(n, p, gravarJa)}
                    aoLinks={(novos) => setLinks((l) => ({ ...l, ...novos }))}
                  />
                ))}
              </ol>
            </section>
          )}
          {naObra && previa && <p className="sub">Nota até aqui (todos os quartos e as áreas comuns): {previa.classificacao}, {respondidos} de {v.itens.length} respondidos.</p>}

          {!canteiro && !naObra && <section className="bloco">
            <h2 className="bloco-titulo">Moradores</h2>
            <p className="dica">
              Marque quem mora no alojamento: colaboradores liberados na obra{aloj.empresa_id ? ` de ${responsavel}` : ''}.
            </p>
            <EscolherMoradores
              quarto={null}
              moradoresObra={colabs}
              funcionarios={v.funcionarios}
              aoMarcar={(m, marcar) =>
                atualizar((x) => ({
                  ...x,
                  funcionarios: marcar
                    ? [...x.funcionarios, { colaborador_id: m.id, nome: m.nome, cargo: m.funcao ?? undefined, empresa_id: m.empresa_id, empresa: m.empresa, assinatura: null }]
                    : x.funcionarios.filter((p) => p.colaborador_id !== m.id),
                }))
              }
            />
            <ListaAssinaturas
              pessoas={v.funcionarios.map((p, i) => ({ p, i }))}
              links={links}
              comCargo={false}
              comPresenca
              rotuloIncluir="Incluir nome à mão (quem não está no portal)"
              aoIncluir={() => atualizar((x) => ({ ...x, funcionarios: [...x.funcionarios, { colaborador_id: null, nome: '', assinatura: null }] }))}
              aoMudar={(i, p) => mudarPessoa('funcionarios', i, p, 'ausente' in p || 'nao_assina' in p)}
              aoRemover={(i) => atualizar((x) => ({ ...x, funcionarios: x.funcionarios.filter((_, k) => k !== i) }))}
              aoAssinar={(i) => setAssinando({ lista: 'funcionarios', i })}
            />
          </section>}

          <section className="bloco">
            <h2 className="bloco-titulo">Quem acompanhou a vistoria</h2>
            <ListaAssinaturas
              pessoas={v.envolvidos.map((p, i) => ({ p, i }))}
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
          <LeituraVistoria v={v} links={links} responsavel={responsavel} canteiro={canteiro} naObra={naObra} />
          {v.situacao === 'concluida' && (
            <NcsVistoria
              v={v}
              naObra={naObra}
              empresaId={aloj.empresa_id}
              empresaNome={responsavel}
              fornecedores={fornecedores}
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

function ItemLeitura({ i, links, responsavel }: { i: ItemVistoria; links: Record<string, string>; responsavel?: string }) {
  return (
    <li className={i.status === 'nao' ? 'vistoria-item-nao' : undefined}>
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
      {i.status === 'nao' && responsavel && <p className="sub">Corrige: {responsavel}</p>}
      <Fotos caminhos={i.fotos ?? []} links={links} />
    </li>
  );
}

function MoradoresLeitura({ pessoas, links, titulo }: { pessoas: Pessoa[]; links: Record<string, string>; titulo: string }) {
  return <Assinaturas titulo={titulo} pessoas={pessoas.map((p) => ({ ...p, cargo: [p.empresa, situacaoMorador(p)].filter(Boolean).join('. ') || p.cargo }))} links={links} />;
}

export function LeituraVistoria({ v, links, responsavel, canteiro = false, naObra = false }: { v: Vistoria; links: Record<string, string>; responsavel: string; canteiro?: boolean; naObra?: boolean }) {
  const comuns = v.itens.filter((i) => !i.quarto);
  return (
    <div className="vistoria">
      <dl className="vistoria-dados">
        <div><dt>Data</dt><dd>{data(v.data_vistoria)}{v.horario ? `, ${v.horario}` : ''}</dd></div>
        <div><dt>Responsável</dt><dd>{responsavel}</dd></div>
        {!canteiro && <div><dt>Moradores</dt><dd>{v.qtd_funcionarios ?? (naObra ? v.funcionarios.length : '-')}</dd></div>}
        {naObra && <div><dt>Quartos</dt><dd>{v.quartos.length}</dd></div>}
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
      {naObra ? (
        <>
          {v.quartos.map((q) => {
            const itens = v.itens.filter((i) => i.quarto === q.nome && !i.auto_na);
            const nota = notaPrevia(itens);
            return (
              <section key={q.nome} className="bloco-quarto-leitura">
                <h3 className="detalhe-subtitulo">
                  {q.nome}
                  <small className="sub"> {q.cama ? NOMES_CAMA[q.cama] : 'tipo de cama não informado'}{nota ? `. ${nota.classificacao}, ${Math.round(nota.pontuacao * 100)}%` : ''}</small>
                </h3>
                <ol className="vistoria-itens">
                  {itens.map((i, k) => <ItemLeitura key={k} i={i} links={links} responsavel={responsavelItemQuarto(i, v.funcionarios)} />)}
                </ol>
                <MoradoresLeitura titulo={`Moradores do ${q.nome}`} pessoas={v.funcionarios.filter((p) => p.quarto === q.nome)} links={links} />
              </section>
            );
          })}
          <section className="bloco-quarto-leitura">
            <h3 className="detalhe-subtitulo">Áreas comuns</h3>
            <ol className="vistoria-itens">
              {comuns.map((i, k) => <ItemLeitura key={k} i={i} links={links} responsavel="Emais (engenharia da obra)" />)}
            </ol>
          </section>
          <Assinaturas titulo="Acompanharam a vistoria" pessoas={v.envolvidos} links={links} />
        </>
      ) : (
        <>
          <ol className="vistoria-itens">
            {v.itens.map((i, n) => <ItemLeitura key={n} i={i} links={links} />)}
          </ol>
          <div className="duas-colunas">
            {!canteiro && <MoradoresLeitura titulo="Moradores" pessoas={v.funcionarios} links={links} />}
            <Assinaturas titulo="Acompanharam a vistoria" pessoas={v.envolvidos} links={links} />
          </div>
        </>
      )}
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
