import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { Assinatura } from '../../componentes/Assinatura';
import { useSessao } from '../../lib/sessao';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import {
  NOMES_STATUS_FICHA, competencia, enviarImagem, fecharFicha, lerFicha, lerFornecedoresDaObra, lerLocadoras, lerMaquina, lerModelos,
  linksDosArquivos, type Ficha, type Fornecedor, type Locadora, type MaquinaComObra, type Modelo,
} from '../../lib/seguranca';
import { baixarPdfFicha } from '../../lib/pdfSeguranca';
import { Fotos, Voltar, nomeResponsavel } from './comum';

const SIMBOLO = { ok: '✓', nc: '✕', na: '–' } as const;

export function ultimoDia(comp: string) {
  const [a, m] = comp.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

export function FichaPagina() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const local = useLocation();
  const { usuario } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const podeEditar = ehAdmin || usuario?.perfil === 'tst';

  const [f, setF] = useState<Ficha | null>(null);
  const [maq, setMaq] = useState<MaquinaComObra | null>(null);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [locadoras, setLocadoras] = useState<Locadora[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>((local.state as { ok?: string } | null)?.ok ?? null);
  const [escolhendoDia, setEscolhendoDia] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  async function carregar() {
    const x = await lerFicha(id);
    const m = await lerMaquina(x.maquina_id);
    setF(x);
    setMaq(m);
    Promise.all([lerModelos(), lerFornecedoresDaObra(m.obra_id), lerLocadoras()])
      .then(([mo, fo, lo]) => {
        setModelos(mo);
        setFornecedores(fo);
        setLocadoras(lo);
      })
      .catch(() => undefined);
    const caminhos = [
      ...Object.values(x.dias).flatMap((d) => [...(d.fotos ?? []), d.assinatura ?? '']),
      x.fechamento?.operador_assinatura ?? '',
      x.fechamento?.tst_assinatura ?? '',
    ].filter(Boolean);
    setLinks(await linksDosArquivos(caminhos));
  }

  useEffect(() => {
    carregar().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f || !maq)
    return (
      <Pagina titulo="Ficha da máquina">
        <Voltar />
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );

  const nomeMaquina = modelos.find((m) => m.codigo === maq.modelo_codigo)?.nome ?? maq.modelo_codigo.replace('maquina:', '');
  const responsavel = nomeResponsavel(maq, fornecedores, locadoras);
  const dias = Object.keys(f.dias).sort();
  const podeLancar = podeEditar && (!f.fechada_em || ehAdmin);
  const ocorrencias = dias.flatMap((d) => {
    const dia = f.dias[d];
    const nc = dia.statuses.map((s, i) => (s === 'nc' ? f.itens[i] : null)).filter(Boolean) as string[];
    return nc.length || dia.observacao || dia.fotos?.length ? [{ d, nc, obs: dia.observacao, fotos: dia.fotos ?? [] }] : [];
  });
  const linkDia = (d: string | number) => `/seguranca/ficha/${id}/dia/${Number(d)}`;

  async function baixar() {
    setBaixando(true);
    setErro(null);
    try {
      await baixarPdfFicha(f!, { obra: maq!.obra.nome, maquina: nomeMaquina, identificacao: maq!.identificacao, responsavel });
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Pagina
      titulo={`${nomeMaquina} ${maq.identificacao}`}
      apoio={`Checklist de ${competencia(f.competencia)}. ${maq.obra.nome}. Responsável: ${responsavel}.`}
      acoes={
        <div className="linha-botoes">
          {podeLancar && (
            <button type="button" className="botao" onClick={() => setEscolhendoDia(true)}>Preencher um dia</button>
          )}
          <button type="button" className="botao botao-secundario" disabled={baixando} onClick={baixar}>{baixando ? 'Gerando PDF' : 'Baixar PDF'}</button>
          {podeEditar && !f.fechada_em && dias.length > 0 && (
            <button type="button" className="botao botao-discreto" onClick={() => setFechando(true)}>Fechar o mês</button>
          )}
        </div>
      }
    >
      <Voltar />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="vistoria">
        <dl className="vistoria-dados">
          <div><dt>Mês</dt><dd>{competencia(f.competencia)}</dd></div>
          <div><dt>Dias com checklist</dt><dd>{dias.length} de {ultimoDia(f.competencia)}</dd></div>
          <div><dt>Não conformidades</dt><dd>{ocorrencias.reduce((s, o) => s + o.nc.length, 0)}</dd></div>
          <div>
            <dt>Fechamento</dt>
            <dd>{f.fechada_em && f.fechamento ? `Fechada em ${data(f.fechada_em)}` : 'Mês aberto'}</dd>
          </div>
        </dl>

        {dias.length === 0 ? (
          <p className="vazio">Nenhum dia preenchido neste mês.</p>
        ) : (
          <>
            <div className="tabela-rolagem">
              <table className="tabela grade-ficha">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    {dias.map((d) => (
                      <th key={d} scope="col">
                        {podeLancar ? <Link to={linkDia(d)} title={`Editar o dia ${Number(d)}`}>{Number(d)}</Link> : Number(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {f.itens.map((item, i) => (
                    <tr key={i}>
                      <th scope="row">{item}</th>
                      {dias.map((d) => {
                        const s = f.dias[d].statuses[i];
                        return (
                          <td key={d} className={s ? `ficha-${s}` : undefined} title={s ? NOMES_STATUS_FICHA[s] : 'Sem resposta'}>
                            {s ? SIMBOLO[s] : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Operador</th>
                    {dias.map((d) => <td key={d} className="ficha-operador">{f.dias[d].operador}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="legenda-ficha">✓ conforme, ✕ não conforme, – não se aplica. {podeLancar ? 'Toque no número do dia para editar.' : ''}</p>
          </>
        )}

        {ocorrencias.length > 0 && (
          <section>
            <h3 className="detalhe-subtitulo">Ocorrências</h3>
            <ul className="ocorrencias">
              {ocorrencias.map((o) => (
                <li key={o.d}>
                  <strong>Dia {Number(o.d)}</strong>
                  {o.nc.length > 0 && <span>. Não conforme: {o.nc.join('; ')}</span>}
                  {o.obs && <p className="sub">{o.obs}</p>}
                  <Fotos caminhos={o.fotos} links={links} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {f.fechamento && (
          <section>
            <h3 className="detalhe-subtitulo">Fechamento do mês</h3>
            <ul className="assinaturas">
              {[
                { nome: f.fechamento.operador_nome, cargo: 'Operador', a: f.fechamento.operador_assinatura },
                { nome: f.fechamento.tst_nome, cargo: 'Técnico de Segurança do Trabalho', a: f.fechamento.tst_assinatura },
              ].map((p) => (
                <li key={p.cargo}>
                  {p.a && links[p.a] ? <img src={links[p.a]} alt={`Assinatura de ${p.nome}`} /> : <span className="assinatura-vazia" />}
                  <span>{p.nome}<small className="sub">{p.cargo}</small></span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <EscolherDia
        aberto={escolhendoDia}
        competenciaFicha={f.competencia}
        preenchidos={dias}
        aoFechar={() => setEscolhendoDia(false)}
        aoEscolher={(d) => navegar(linkDia(d))}
      />
      <FecharMes
        aberto={fechando}
        ficha={f}
        tst={usuario?.nome ?? ''}
        aoFechar={() => setFechando(false)}
        aoFechado={async () => {
          setFechando(false);
          await carregar();
          setOk('Mês fechado. Baixe o PDF para guardar a ficha assinada.');
        }}
      />
    </Pagina>
  );
}

function EscolherDia({ aberto, competenciaFicha, preenchidos, aoFechar, aoEscolher }: { aberto: boolean; competenciaFicha: string; preenchidos: string[]; aoFechar: () => void; aoEscolher: (d: number) => void }) {
  const fim = `${competenciaFicha.slice(0, 8)}${String(ultimoDia(competenciaFicha)).padStart(2, '0')}`;
  const max = hojeIso() < fim ? hojeIso() : fim;
  const [dia, setDia] = useState(max);
  useEffect(() => setDia(max), [aberto, max]);
  const jaTem = preenchidos.includes(dia.slice(8, 10));
  return (
    <Dialogo aberto={aberto} titulo="Qual dia?" aoFechar={aoFechar}>
      <form className="formulario formulario-largo" onSubmit={(e) => { e.preventDefault(); if (dia) aoEscolher(Number(dia.slice(8, 10))); }}>
        <label className="campo">
          <span>Dia do checklist</span>
          <input type="date" min={competenciaFicha} max={max} value={dia} onChange={(e) => setDia(e.target.value)} required />
        </label>
        {jaTem && <p className="dica">Este dia já foi preenchido. Ao abrir, você edita o que foi lançado.</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!dia}>{jaTem ? 'Editar o dia' : 'Preencher'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function FecharMes({ aberto, ficha, tst, aoFechar, aoFechado }: { aberto: boolean; ficha: Ficha; tst: string; aoFechar: () => void; aoFechado: () => Promise<void> }) {
  const operadores = Object.values(ficha.dias).map((d) => d.operador).filter(Boolean);
  const maisFrequente = operadores.sort((a, b) => operadores.filter((x) => x === b).length - operadores.filter((x) => x === a).length)[0] ?? '';
  const [operador, setOperador] = useState('');
  const [nomeTst, setNomeTst] = useState('');
  const [assinaturas, setAssinaturas] = useState<{ operador?: string; tst?: string }>({});
  const [previas, setPrevias] = useState<{ operador?: string; tst?: string }>({});
  const [assinando, setAssinando] = useState<'operador' | 'tst' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setOperador(maisFrequente);
    setNomeTst(tst);
    setAssinaturas({});
    setPrevias({});
    setErro(null);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      await fecharFicha(ficha.id, { operador_nome: operador.trim(), operador_assinatura: assinaturas.operador ?? null, tst_nome: nomeTst.trim(), tst_assinatura: assinaturas.tst ?? null });
      await aoFechado();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Dialogo aberto={aberto && !assinando} titulo={`Fechar ${competencia(ficha.competencia)}`} aoFechar={aoFechar}>
        <div className="formulario formulario-largo">
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <p className="dica">Depois de fechado, o mês não recebe mais lançamentos (só o administrativo corrige).</p>
          {(['operador', 'tst'] as const).map((quem) => (
            <div key={quem} className="pessoa-assina">
              <label className="campo">
                <span>{quem === 'operador' ? 'Operador' : 'Técnico de Segurança do Trabalho'}</span>
                <input value={quem === 'operador' ? operador : nomeTst} onChange={(e) => (quem === 'operador' ? setOperador(e.target.value) : setNomeTst(e.target.value))} />
              </label>
              <div className="pessoa-assina-acoes">
                {previas[quem] ? <img className="assinatura-previa" src={previas[quem]} alt="Assinatura" /> : <span className="sub">sem assinatura</span>}
                <button type="button" className="botao botao-secundario botao-pequeno" disabled={(quem === 'operador' ? operador : nomeTst).trim().length < 3} onClick={() => setAssinando(quem)}>
                  {previas[quem] ? 'Assinar de novo' : 'Assinar'}
                </button>
              </div>
            </div>
          ))}
          <div className="linha-botoes">
            <button type="button" className="botao" disabled={enviando || operador.trim().length < 3 || nomeTst.trim().length < 3} onClick={confirmar}>
              {enviando ? 'Fechando' : 'Fechar o mês'}
            </button>
            <button type="button" className="botao botao-discreto" onClick={aoFechar}>Cancelar</button>
          </div>
        </div>
      </Dialogo>
      <Assinatura
        aberto={!!assinando}
        nome={assinando === 'operador' ? operador : nomeTst}
        aoFechar={() => setAssinando(null)}
        aoConfirmar={async (png) => {
          try {
            const caminho = await enviarImagem(`ficha/${ficha.id}/fechamento-${assinando}-${crypto.randomUUID()}.png`, png);
            setAssinaturas((s) => ({ ...s, [assinando!]: caminho }));
            setPrevias((s) => ({ ...s, [assinando!]: URL.createObjectURL(png) }));
          } catch (e) {
            setErro(mensagemDeErro(e as Error));
          }
          setAssinando(null);
        }}
      />
    </>
  );
}
