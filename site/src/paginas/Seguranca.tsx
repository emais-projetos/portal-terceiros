import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../componentes/Pagina';
import { Dialogo } from '../componentes/Dialogo';
import { Carregando } from '../componentes/Carregando';
import { useSessao } from '../lib/sessao';
import { mensagemDeErro } from '../lib/supabase';
import { data } from '../lib/formato';
import { lerObrasDoPainel, type ObraDoPainel } from '../lib/painelObra';
import {
  NOMES_STATUS_FICHA, NOMES_STATUS_VISTORIA, competencia, lerAlojamentos, lerFicha, lerFornecedoresDaObra, lerLocadoras,
  lerMaquinas, lerModelos, lerNaoConformidadesDaObra, lerVistoria, linksDosArquivos, salvarAlojamento, salvarLocadora,
  salvarMaquina, type Alojamento, type Ficha, type Fornecedor, type Locadora, type Maquina, type Modelo, type NaoConformidade,
  type Responsavel, type Vistoria,
} from '../lib/seguranca';

const CHAVE_OBRA = 'portal-terceiros:obra-seguranca';
const ABAS = [
  ['alojamentos', 'Alojamentos'],
  ['maquinas', 'Máquinas'],
  ['locadoras', 'Locadoras'],
] as const;
type Aba = (typeof ABAS)[number][0];

type Contexto = {
  podeEditar: boolean;
  fornecedores: Fornecedor[];
  locadoras: Locadora[];
  modelos: Modelo[];
};

export function Seguranca() {
  const { usuario } = useSessao();
  const podeEditar = usuario?.perfil === 'admin' || usuario?.perfil === 'tst';
  const [params, setParams] = useSearchParams();
  const aba = (ABAS.find(([a]) => a === params.get('aba'))?.[0] ?? 'alojamentos') as Aba;

  const [obras, setObras] = useState<ObraDoPainel[] | null>(null);
  const [obra, setObra] = useState('');
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [locadoras, setLocadoras] = useState<Locadora[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [alojamentos, setAlojamentos] = useState<Alojamento[] | null>(null);
  const [maquinas, setMaquinas] = useState<Maquina[] | null>(null);
  const [ncs, setNcs] = useState<NaoConformidade[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([lerObrasDoPainel(), lerModelos(), lerLocadoras()])
      .then(([o, m, l]) => {
        setObras(o);
        setModelos(m);
        setLocadoras(l);
        let guardada = '';
        try {
          guardada = window.localStorage.getItem(CHAVE_OBRA) ?? '';
        } catch {
          guardada = '';
        }
        setObra(o.some((x) => x.id === guardada) ? guardada : o.length === 1 ? o[0].id : '');
      })
      .catch((e) => setErro(mensagemDeErro(e as Error)));
  }, []);

  async function carregarObra(o: string) {
    try {
      const [a, m, f] = await Promise.all([lerAlojamentos(o), lerMaquinas(o), lerFornecedoresDaObra(o)]);
      setAlojamentos(a);
      setMaquinas(m);
      setFornecedores(f);
      setNcs(await lerNaoConformidadesDaObra(a.map((x) => x.id)));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    setAlojamentos(null);
    setMaquinas(null);
    if (!obra) return;
    try {
      window.localStorage.setItem(CHAVE_OBRA, obra);
    } catch {
      // segue sem lembrar a obra
    }
    carregarObra(obra);
  }, [obra]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx: Contexto = { podeEditar, fornecedores, locadoras, modelos };
  const pendentes = (alojamentos?.filter((a) => a.empresa_a_vincular).length ?? 0) + (maquinas?.filter((m) => m.empresa_a_vincular).length ?? 0);

  async function recarregar(mensagem: string) {
    setOk(mensagem);
    setErro(null);
    await Promise.all([carregarObra(obra), lerLocadoras().then(setLocadoras)]);
  }

  return (
    <Pagina
      titulo="Segurança da obra"
      apoio="Vistorias de alojamento, fichas mensais das máquinas e a quem cada uma pertence."
      abas={
        <nav className="abas abas-botoes" aria-label="Segurança da obra">
          {ABAS.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'alojamentos' ? {} : { aba: a })}>
              {nome}
            </button>
          ))}
        </nav>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!obras && !erro && <Carregando />}

      {aba !== 'locadoras' && obras && (
        <div className="filtros">
          <label className="campo">
            <span>Obra</span>
            <select value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Escolha a obra</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </label>
        </div>
      )}
      {aba !== 'locadoras' && obras?.length === 0 && <p className="vazio">Nenhuma obra ligada ao seu acesso.</p>}

      {aba !== 'locadoras' && obra && pendentes > 0 && (
        <div className="aviso aviso-alerta aviso-faixa" role="status">
          <span>
            {pendentes === 1 ? '1 cadastro veio' : `${pendentes} cadastros vieram`} do ObraCheck com uma empresa que não existe no portal.
            {podeEditar ? ' Abra o item marcado como "a vincular" e escolha o responsável.' : ' O TST da obra escolhe o responsável.'}
          </span>
        </div>
      )}

      {aba === 'alojamentos' && obra && (alojamentos ? (
        <Alojamentos lista={alojamentos} ncs={ncs} ctx={ctx} aoSalvar={recarregar} aoErro={setErro} />
      ) : <Carregando />)}
      {aba === 'maquinas' && obra && (maquinas ? (
        <Maquinas lista={maquinas} ctx={ctx} aoSalvar={recarregar} aoErro={setErro} />
      ) : <Carregando />)}
      {aba === 'locadoras' && obras && <Locadoras lista={locadoras} podeEditar={podeEditar} aoSalvar={recarregar} />}
    </Pagina>
  );
}

// ---------------------------------------------------------------- Quem responde

function NomeResponsavel({ empresaId, locadoraId, aVincular, ctx }: { empresaId: string | null; locadoraId?: string | null; aVincular: string | null; ctx: Contexto }) {
  if (aVincular)
    return (
      <span>
        <span className="etiqueta etiqueta-alerta">a vincular</span> <span className="sub">no ObraCheck: {aVincular}</span>
      </span>
    );
  if (empresaId) return <>{ctx.fornecedores.find((f) => f.id === empresaId)?.nome ?? 'Fornecedor'}</>;
  if (locadoraId)
    return (
      <>
        {ctx.locadoras.find((l) => l.id === locadoraId)?.nome ?? 'Locadora'} <span className="sub">locadora</span>
      </>
    );
  return <>Emais</>;
}

function OpcoesFornecedor({ fornecedores, atual }: { fornecedores: Fornecedor[]; atual: string | null }) {
  return (
    <>
      <option value="">Escolha o fornecedor</option>
      {fornecedores
        .filter((f) => f.ativo_na_obra || f.id === atual)
        .map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome}
            {f.ativo_na_obra ? '' : ' (fora da obra)'}
          </option>
        ))}
    </>
  );
}

// ---------------------------------------------------------------- Alojamentos

function Alojamentos({ lista, ncs, ctx, aoSalvar, aoErro }: { lista: Alojamento[]; ncs: NaoConformidade[]; ctx: Contexto; aoSalvar: (m: string) => Promise<void>; aoErro: (m: string) => void }) {
  const [editando, setEditando] = useState<Alojamento | null>(null);
  const [vistoria, setVistoria] = useState<{ id: string; alojamento: Alojamento } | null>(null);
  const ordenada = [...lista].sort((a, b) => Number(!!b.empresa_a_vincular) - Number(!!a.empresa_a_vincular) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const abertasPorVistoria = useMemo(() => {
    const m = new Map<string, number>();
    ncs.filter((n) => n.situacao === 'aberta' || n.situacao === 'reaberta' || n.situacao === 'respondida').forEach((n) => m.set(n.vistoria_id, (m.get(n.vistoria_id) ?? 0) + 1));
    return m;
  }, [ncs]);

  if (!lista.length) return <p className="vazio">Nenhum alojamento cadastrado nesta obra.</p>;

  return (
    <section className="bloco">
      <div className="tabela-rolagem">
        <table className="tabela tabela-lista">
          <thead>
            <tr>
              <th scope="col">Alojamento</th>
              <th scope="col">Responsável</th>
              <th scope="col">Última vistoria</th>
              <th scope="col">Vistorias</th>
              <th scope="col"><span className="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {ordenada.map((a) => {
              const ultima = a.vistorias[0];
              const pendencias = a.vistorias.reduce((s, v) => s + (abertasPorVistoria.get(v.id) ?? 0), 0);
              return (
                <tr key={a.id} className={a.ativo ? undefined : 'linha-inativa'}>
                  <th scope="row">
                    {a.nome}
                    {a.endereco && <small className="sub">{a.endereco}</small>}
                    {!a.ativo && <small className="sub">desativado</small>}
                  </th>
                  <td><NomeResponsavel empresaId={a.empresa_id} aVincular={a.empresa_a_vincular} ctx={ctx} /></td>
                  <td>
                    {ultima ? (
                      <>
                        {data(ultima.data_vistoria)} <SeloClassificacao v={ultima} />
                        {pendencias > 0 && <small className="sub texto-alerta">{pendencias} {pendencias === 1 ? 'item a regularizar' : 'itens a regularizar'}</small>}
                      </>
                    ) : (
                      <span className="sub">sem vistoria</span>
                    )}
                  </td>
                  <td>
                    <div className="linha-botoes">
                      {a.vistorias.map((v) => (
                        <button key={v.id} type="button" className="botao botao-discreto botao-pequeno" onClick={() => setVistoria({ id: v.id, alojamento: a })}>
                          {data(v.data_vistoria)}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="acoes">
                    {ctx.podeEditar && (
                      <button type="button" className={`botao botao-pequeno${a.empresa_a_vincular ? '' : ' botao-secundario'}`} onClick={() => setEditando(a)}>
                        {a.empresa_a_vincular ? 'Vincular' : 'Editar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <EditarAlojamento
        alojamento={editando}
        ctx={ctx}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (m) => {
          setEditando(null);
          await aoSalvar(m);
        }}
      />
      <VerVistoria alvo={vistoria} ctx={ctx} aoFechar={() => setVistoria(null)} aoErro={aoErro} />
    </section>
  );
}

function SeloClassificacao({ v }: { v: Pick<Vistoria, 'classificacao' | 'situacao'> }) {
  if (v.situacao === 'rascunho') return <span className="selo selo-fila">em andamento</span>;
  const cor = v.classificacao === 'Ótimo' || v.classificacao === 'Bom' ? 'selo-ok' : v.classificacao === 'Regular' ? 'selo-teste' : 'selo-erro';
  return <span className={`selo ${cor}`}>{v.classificacao}</span>;
}

function EditarAlojamento({ alojamento, ctx, aoFechar, aoSalvar }: { alojamento: Alojamento | null; ctx: Contexto; aoFechar: () => void; aoSalvar: (m: string) => Promise<void> }) {
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [tipo, setTipo] = useState<'' | 'emais' | 'fornecedor'>('');
  const [empresa, setEmpresa] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alojamento) return;
    setNome(alojamento.nome);
    setEndereco(alojamento.endereco ?? '');
    setTipo(alojamento.empresa_a_vincular ? '' : alojamento.empresa_id ? 'fornecedor' : 'emais');
    setEmpresa(alojamento.empresa_id ?? '');
    setAtivo(alojamento.ativo);
    setErro(null);
  }, [alojamento]);

  if (!alojamento) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const valido = nome.trim().length > 0 && (tipo === 'emais' || (tipo === 'fornecedor' && !!empresa));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarAlojamento(alojamento!.id, { nome, endereco, empresaId: tipo === 'fornecedor' ? empresa : null, ativo });
      await aoSalvar(`Alojamento ${nome.trim()} salvo.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialogo aberto titulo={alojamento.empresa_a_vincular ? `Vincular ${alojamento.nome}` : `Editar ${alojamento.nome}`} aoFechar={aoFechar}>
      <form className="formulario formulario-largo" onSubmit={salvar}>
        {alojamento.empresa_a_vincular && (
          <p className="aviso aviso-info">No ObraCheck este alojamento estava como <strong>{alojamento.empresa_a_vincular}</strong>, que não existe no portal.</p>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <label className="campo">
          <span>Nome do alojamento</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <label className="campo">
          <span>Endereço</span>
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)} />
        </label>
        <fieldset className="campo-grupo opcoes-empilhadas">
          <legend>Quem responde pelo alojamento</legend>
          <label className="opcao">
            <input type="radio" name="resp-aloj" checked={tipo === 'fornecedor'} onChange={() => setTipo('fornecedor')} />
            <span>Fornecedor da obra</span>
          </label>
          {tipo === 'fornecedor' && (
            <label className="campo">
              <span className="sr">Fornecedor</span>
              <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                <OpcoesFornecedor fornecedores={ctx.fornecedores} atual={alojamento.empresa_id} />
              </select>
            </label>
          )}
          <label className="opcao">
            <input type="radio" name="resp-aloj" checked={tipo === 'emais'} onChange={() => setTipo('emais')} />
            <span>Emais</span>
          </label>
        </fieldset>
        {tipo === 'fornecedor' && (
          <p className="dica">O fornecedor passa a ver no portal as vistorias concluídas deste alojamento e responde os itens a regularizar.</p>
        )}
        <label className="opcao">
          <input type="checkbox" checked={!ativo} onChange={(e) => setAtivo(!e.target.checked)} />
          <span>Alojamento desativado (não recebe novas vistorias)</span>
        </label>
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || salvando}>{salvando ? 'Salvando' : 'Salvar'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function VerVistoria({ alvo, ctx, aoFechar, aoErro }: { alvo: { id: string; alojamento: Alojamento } | null; ctx: Contexto; aoFechar: () => void; aoErro: (m: string) => void }) {
  const [v, setV] = useState<Vistoria | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    setV(null);
    setLinks({});
    if (!alvo) return;
    lerVistoria(alvo.id)
      .then(async (x) => {
        setV(x);
        const caminhos = [
          ...x.itens.flatMap((i) => i.fotos ?? []),
          ...x.funcionarios.map((p) => p.assinatura ?? ''),
          ...x.envolvidos.map((p) => p.assinatura ?? ''),
        ];
        if (!x.fotos_excluidas_em) setLinks(await linksDosArquivos(caminhos));
      })
      .catch((e) => {
        aoFechar();
        aoErro(mensagemDeErro(e as Error));
      });
  }, [alvo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alvo) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const a = alvo.alojamento;

  return (
    <Dialogo aberto titulo={`Vistoria de ${a.nome}`} aoFechar={aoFechar} largura="larga">
      {!v ? (
        <Carregando />
      ) : (
        <div className="vistoria">
          <dl className="vistoria-dados">
            <div><dt>Data</dt><dd>{data(v.data_vistoria)}{v.horario ? `, ${v.horario}` : ''}</dd></div>
            <div><dt>Responsável</dt><dd><NomeResponsavel empresaId={a.empresa_id} aVincular={a.empresa_a_vincular} ctx={ctx} /></dd></div>
            <div><dt>Moradores</dt><dd>{v.qtd_funcionarios ?? '-'}</dd></div>
            <div>
              <dt>Resultado</dt>
              <dd>
                <SeloClassificacao v={v} />
                {v.pontuacao != null && <span className="sub"> {Math.round(v.pontuacao * 100)}% dos itens aplicáveis em ordem</span>}
              </dd>
            </div>
          </dl>
          {v.situacao === 'concluida' && v.fotos_expiram_em && !v.fotos_excluidas_em && (
            <p className="dica">As fotos ficam no portal até {data(v.fotos_expiram_em)}. Depois disso só ficam no PDF da vistoria.</p>
          )}
          {v.fotos_excluidas_em && <p className="dica">As fotos desta vistoria foram excluídas em {data(v.fotos_excluidas_em)}.</p>}

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
                {i.fotos?.length > 0 && <Fotos caminhos={i.fotos} links={links} />}
              </li>
            ))}
          </ol>

          {(v.funcionarios.length > 0 || v.envolvidos.length > 0) && (
            <div className="duas-colunas">
              <Assinaturas titulo="Moradores" pessoas={v.funcionarios} links={links} />
              <Assinaturas titulo="Acompanharam a vistoria" pessoas={v.envolvidos} links={links} />
            </div>
          )}
        </div>
      )}
    </Dialogo>
  );
}

function Fotos({ caminhos, links }: { caminhos: string[]; links: Record<string, string> }) {
  return (
    <div className="fotos-miniaturas">
      {caminhos.map((c) =>
        links[c] ? (
          <a key={c} href={links[c]} target="_blank" rel="noreferrer">
            <img src={links[c]} alt="Foto do item" loading="lazy" />
          </a>
        ) : (
          <span key={c} className="foto-indisponivel">foto</span>
        ),
      )}
    </div>
  );
}

function Assinaturas({ titulo, pessoas, links }: { titulo: string; pessoas: { nome: string; cargo?: string; assinatura: string | null }[]; links: Record<string, string> }) {
  if (!pessoas.length) return <div />;
  return (
    <div>
      <h3 className="detalhe-subtitulo">{titulo}</h3>
      <ul className="assinaturas">
        {pessoas.map((p, i) => (
          <li key={i}>
            {p.assinatura && links[p.assinatura] ? <img src={links[p.assinatura]} alt={`Assinatura de ${p.nome}`} /> : <span className="assinatura-vazia" />}
            <span>
              {p.nome || 'Sem nome'}
              {p.cargo && <small className="sub">{p.cargo}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Máquinas

function Maquinas({ lista, ctx, aoSalvar, aoErro }: { lista: Maquina[]; ctx: Contexto; aoSalvar: (m: string) => Promise<void>; aoErro: (m: string) => void }) {
  const [editando, setEditando] = useState<Maquina | null>(null);
  const [ficha, setFicha] = useState<{ id: string; maquina: Maquina } | null>(null);
  const nomeModelo = (c: string) => ctx.modelos.find((m) => m.codigo === c)?.nome ?? c.replace('maquina:', '');
  const ordenada = [...lista].sort(
    (a, b) =>
      Number(!!b.empresa_a_vincular) - Number(!!a.empresa_a_vincular) ||
      nomeModelo(a.modelo_codigo).localeCompare(nomeModelo(b.modelo_codigo), 'pt-BR') ||
      a.identificacao.localeCompare(b.identificacao, 'pt-BR'),
  );

  if (!lista.length) return <p className="vazio">Nenhuma máquina cadastrada nesta obra.</p>;

  return (
    <section className="bloco">
      <div className="tabela-rolagem">
        <table className="tabela tabela-lista">
          <thead>
            <tr>
              <th scope="col">Máquina</th>
              <th scope="col">Responsável</th>
              <th scope="col">Fichas mensais</th>
              <th scope="col"><span className="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {ordenada.map((m) => (
              <tr key={m.id} className={m.ativo ? undefined : 'linha-inativa'}>
                <th scope="row">
                  {nomeModelo(m.modelo_codigo)}
                  <small className="sub">{m.identificacao}{m.ativo ? '' : ', desativada'}</small>
                </th>
                <td><NomeResponsavel empresaId={m.empresa_id} locadoraId={m.locadora_id} aVincular={m.empresa_a_vincular} ctx={ctx} /></td>
                <td>
                  <div className="linha-botoes">
                    {[...m.fichas]
                      .sort((a, b) => b.competencia.localeCompare(a.competencia))
                      .map((f) => (
                        <button key={f.id} type="button" className="botao botao-discreto botao-pequeno" onClick={() => setFicha({ id: f.id, maquina: m })}>
                          {competencia(f.competencia)}
                          {f.fechada_em ? ' (fechada)' : ''}
                        </button>
                      ))}
                  </div>
                </td>
                <td className="acoes">
                  {ctx.podeEditar && (
                    <button type="button" className={`botao botao-pequeno${m.empresa_a_vincular ? '' : ' botao-secundario'}`} onClick={() => setEditando(m)}>
                      {m.empresa_a_vincular ? 'Vincular' : 'Editar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditarMaquina
        maquina={editando}
        nomeModelo={nomeModelo}
        ctx={ctx}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (msg) => {
          setEditando(null);
          await aoSalvar(msg);
        }}
      />
      <VerFicha alvo={ficha} nomeModelo={nomeModelo} ctx={ctx} aoFechar={() => setFicha(null)} aoErro={aoErro} />
    </section>
  );
}

function EditarMaquina({ maquina, nomeModelo, ctx, aoFechar, aoSalvar }: { maquina: Maquina | null; nomeModelo: (c: string) => string; ctx: Contexto; aoFechar: () => void; aoSalvar: (m: string) => Promise<void> }) {
  const [identificacao, setIdentificacao] = useState('');
  const [tipo, setTipo] = useState<'' | Responsavel['tipo']>('');
  const [empresa, setEmpresa] = useState('');
  const [locadora, setLocadora] = useState('');
  const [nova, setNova] = useState<{ nome: string; cnpj: string; telefone: string } | null>(null);
  const [ativo, setAtivo] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!maquina) return;
    setIdentificacao(maquina.identificacao);
    setTipo(maquina.empresa_a_vincular ? '' : maquina.empresa_id ? 'fornecedor' : maquina.locadora_id ? 'locadora' : 'emais');
    setEmpresa(maquina.empresa_id ?? '');
    setLocadora(maquina.locadora_id ?? '');
    setNova(null);
    setAtivo(maquina.ativo);
    setErro(null);
  }, [maquina]);

  if (!maquina) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const locadoraOk = nova ? nova.nome.trim().length > 1 : !!locadora;
  const valido =
    identificacao.trim().length > 0 &&
    (tipo === 'emais' || (tipo === 'fornecedor' && !!empresa) || (tipo === 'locadora' && locadoraOk));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setSalvando(true);
    setErro(null);
    try {
      let r: Responsavel = { tipo: 'emais' };
      if (tipo === 'fornecedor') r = { tipo, id: empresa };
      if (tipo === 'locadora') {
        const id = nova ? (await salvarLocadora(nova)).id : locadora;
        r = { tipo, id };
      }
      await salvarMaquina(maquina!.id, identificacao, r, ativo);
      await aoSalvar(`${nomeModelo(maquina!.modelo_codigo)} ${identificacao.trim()} salva.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialogo aberto titulo={`${maquina.empresa_a_vincular ? 'Vincular' : 'Editar'} ${nomeModelo(maquina.modelo_codigo)}`} aoFechar={aoFechar}>
      <form className="formulario formulario-largo" onSubmit={salvar}>
        {maquina.empresa_a_vincular && (
          <p className="aviso aviso-info">No ObraCheck esta máquina estava como <strong>{maquina.empresa_a_vincular}</strong>, que não existe no portal.</p>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <label className="campo">
          <span>Identificação (placa, frota ou número de série)</span>
          <input value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} required />
        </label>
        <fieldset className="campo-grupo opcoes-empilhadas">
          <legend>De quem é a máquina</legend>
          <label className="opcao">
            <input type="radio" name="resp-maq" checked={tipo === 'fornecedor'} onChange={() => setTipo('fornecedor')} />
            <span>De um terceiro da obra</span>
          </label>
          {tipo === 'fornecedor' && (
            <label className="campo">
              <span className="sr">Fornecedor</span>
              <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                <OpcoesFornecedor fornecedores={ctx.fornecedores} atual={maquina.empresa_id} />
              </select>
            </label>
          )}
          <label className="opcao">
            <input type="radio" name="resp-maq" checked={tipo === 'locadora'} onChange={() => setTipo('locadora')} />
            <span>De uma locadora de equipamentos</span>
          </label>
          {tipo === 'locadora' && !nova && (
            <div className="em-linha">
              <label className="campo">
                <span className="sr">Locadora</span>
                <select value={locadora} onChange={(e) => setLocadora(e.target.value)}>
                  <option value="">Escolha a locadora</option>
                  {ctx.locadoras
                    .filter((l) => l.ativo || l.id === maquina.locadora_id)
                    .map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </label>
              <button
                type="button"
                className="botao botao-secundario botao-pequeno"
                onClick={() => setNova({ nome: maquina.empresa_a_vincular ?? '', cnpj: '', telefone: '' })}
              >
                Cadastrar locadora
              </button>
            </div>
          )}
          {tipo === 'locadora' && nova && (
            <div className="caixa">
              <label className="campo">
                <span>Nome da locadora</span>
                <input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} autoFocus />
              </label>
              <div className="grade-2">
                <label className="campo">
                  <span>CNPJ (opcional)</span>
                  <input value={nova.cnpj} onChange={(e) => setNova({ ...nova, cnpj: e.target.value })} inputMode="numeric" />
                </label>
                <label className="campo">
                  <span>Telefone (opcional)</span>
                  <input value={nova.telefone} onChange={(e) => setNova({ ...nova, telefone: e.target.value })} inputMode="tel" />
                </label>
              </div>
              <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setNova(null)}>Escolher uma já cadastrada</button>
            </div>
          )}
          <label className="opcao">
            <input type="radio" name="resp-maq" checked={tipo === 'emais'} onChange={() => setTipo('emais')} />
            <span>Da Emais</span>
          </label>
        </fieldset>
        <label className="opcao">
          <input type="checkbox" checked={!ativo} onChange={(e) => setAtivo(!e.target.checked)} />
          <span>Máquina saiu da obra (não recebe novas fichas)</span>
        </label>
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || salvando}>{salvando ? 'Salvando' : 'Salvar'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

const SIMBOLO_FICHA = { ok: '✓', nc: '✕', na: '–' } as const;

function VerFicha({ alvo, nomeModelo, ctx, aoFechar, aoErro }: { alvo: { id: string; maquina: Maquina } | null; nomeModelo: (c: string) => string; ctx: Contexto; aoFechar: () => void; aoErro: (m: string) => void }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    setF(null);
    setLinks({});
    if (!alvo) return;
    lerFicha(alvo.id)
      .then(async (x) => {
        setF(x);
        setLinks(await linksDosArquivos(Object.values(x.dias).flatMap((d) => d.fotos ?? [])));
      })
      .catch((e) => {
        aoFechar();
        aoErro(mensagemDeErro(e as Error));
      });
  }, [alvo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alvo) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const m = alvo.maquina;
  const dias = f ? Object.keys(f.dias).sort() : [];
  const ocorrencias = f
    ? dias.flatMap((d) => {
        const dia = f.dias[d];
        const nc = dia.statuses.map((s, i) => (s === 'nc' ? f.itens[i] : null)).filter(Boolean) as string[];
        return nc.length || dia.observacao || dia.fotos?.length ? [{ d, nc, obs: dia.observacao, fotos: dia.fotos ?? [] }] : [];
      })
    : [];

  return (
    <Dialogo aberto titulo={`${nomeModelo(m.modelo_codigo)} ${m.identificacao}${f ? `, ${competencia(f.competencia)}` : ''}`} aoFechar={aoFechar} largura="larga">
      {!f ? (
        <Carregando />
      ) : (
        <div className="vistoria">
          <dl className="vistoria-dados">
            <div><dt>Responsável</dt><dd><NomeResponsavel empresaId={m.empresa_id} locadoraId={m.locadora_id} aVincular={m.empresa_a_vincular} ctx={ctx} /></dd></div>
            <div><dt>Dias com checklist</dt><dd>{dias.length}</dd></div>
            <div>
              <dt>Fechamento</dt>
              <dd>{f.fechada_em && f.fechamento ? `Operador ${f.fechamento.operador_nome}, TST ${f.fechamento.tst_nome}` : 'Ficha aberta'}</dd>
            </div>
          </dl>
          {dias.length === 0 ? (
            <p className="vazio">Nenhum dia preenchido nesta ficha.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela grade-ficha">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    {dias.map((d) => <th key={d} scope="col">{Number(d)}</th>)}
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
                            {s ? SIMBOLO_FICHA[s] : ''}
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
          )}
          <p className="legenda-ficha">✓ conforme, ✕ não conforme, – não se aplica</p>
          {ocorrencias.length > 0 && (
            <>
              <h3 className="detalhe-subtitulo">Ocorrências</h3>
              <ul className="ocorrencias">
                {ocorrencias.map((o) => (
                  <li key={o.d}>
                    <strong>Dia {Number(o.d)}</strong>
                    {o.nc.length > 0 && <span>. Não conforme: {o.nc.join('; ')}</span>}
                    {o.obs && <p className="sub">{o.obs}</p>}
                    {o.fotos.length > 0 && <Fotos caminhos={o.fotos} links={links} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Dialogo>
  );
}

// ---------------------------------------------------------------- Locadoras

function Locadoras({ lista, podeEditar, aoSalvar }: { lista: Locadora[]; podeEditar: boolean; aoSalvar: (m: string) => Promise<void> }) {
  const [editando, setEditando] = useState<Partial<Locadora> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!editando?.nome?.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarLocadora({ id: editando.id, nome: editando.nome, cnpj: editando.cnpj ?? '', telefone: editando.telefone ?? '', ativo: editando.ativo ?? true });
      setEditando(null);
      await aoSalvar(`Locadora ${editando.nome.trim()} salva.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="bloco">
      <div className="barra-lista">
        <p className="apoio">Empresas que alugam máquinas para a obra e não são fornecedores cadastrados no portal.</p>
        {podeEditar && (
          <button type="button" className="botao botao-pequeno" onClick={() => { setErro(null); setEditando({ nome: '', cnpj: '', telefone: '', ativo: true }); }}>
            Cadastrar locadora
          </button>
        )}
      </div>
      {lista.length === 0 ? (
        <p className="vazio">Nenhuma locadora cadastrada. Ao vincular uma máquina, dá para cadastrar a locadora na hora.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Locadora</th>
                <th scope="col">CNPJ</th>
                <th scope="col">Telefone</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.id} className={l.ativo ? undefined : 'linha-inativa'}>
                  <th scope="row">{l.nome}{!l.ativo && <small className="sub">desativada</small>}</th>
                  <td>{l.cnpj ?? ''}</td>
                  <td>{l.telefone ?? ''}</td>
                  <td className="acoes">
                    {podeEditar && (
                      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => { setErro(null); setEditando(l); }}>Editar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialogo aberto={!!editando} titulo={editando?.id ? `Editar ${editando.nome}` : 'Cadastrar locadora'} aoFechar={() => setEditando(null)}>
        {editando && (
          <form className="formulario formulario-largo" onSubmit={salvar}>
            {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
            <label className="campo">
              <span>Nome da locadora</span>
              <input value={editando.nome ?? ''} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} required autoFocus />
            </label>
            <div className="grade-2">
              <label className="campo">
                <span>CNPJ (opcional)</span>
                <input value={editando.cnpj ?? ''} onChange={(e) => setEditando({ ...editando, cnpj: e.target.value })} inputMode="numeric" />
              </label>
              <label className="campo">
                <span>Telefone (opcional)</span>
                <input value={editando.telefone ?? ''} onChange={(e) => setEditando({ ...editando, telefone: e.target.value })} inputMode="tel" />
              </label>
            </div>
            {editando.id && (
              <label className="opcao">
                <input type="checkbox" checked={!editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: !e.target.checked })} />
                <span>Locadora desativada (some da lista de escolha)</span>
              </label>
            )}
            <div className="linha-botoes">
              <button className="botao" type="submit" disabled={!editando.nome?.trim() || salvando}>{salvando ? 'Salvando' : 'Salvar'}</button>
              <button className="botao botao-discreto" type="button" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </form>
        )}
      </Dialogo>
    </section>
  );
}
