import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../componentes/Pagina';
import { Dialogo } from '../componentes/Dialogo';
import { Carregando } from '../componentes/Carregando';
import { useSessao } from '../lib/sessao';
import { mensagemDeErro } from '../lib/supabase';
import { data, hojeIso } from '../lib/formato';
import { lerObrasDoPainel, type ObraDoPainel } from '../lib/painelObra';
import {
  abrirFicha, competencia, lerAlojamentos, lerFornecedoresDaObra, lerLocadoras, lerMaquinas, lerModelos, lerNaoConformidadesDaObra,
  lerVistoriasCanteiro, salvarAlojamento, salvarLocadora, salvarMaquina, type Alojamento, type VistoriaResumo, type Fornecedor, type Locadora, type Maquina, type Modelo,
  type NaoConformidade, type Responsavel,
} from '../lib/seguranca';
import { SeloClassificacao } from './seguranca/comum';
import { Inspecoes } from './seguranca/Inspecoes';
import { PainelConformidade } from './seguranca/PainelConformidade';
import { PainelResumoObra } from './seguranca/ResumoObra';
import { ListaFormularios } from './seguranca/Formularios';
import { NovaInspecao } from './seguranca/NovaInspecao';
import { CadastroAlojamentos } from './seguranca/CadastroAlojamentos';

const CHAVE_OBRA = 'portal-terceiros:obra-seguranca';
const ABAS = [
  ['inspecoes', 'Inspeções'],
  ['alojamentos', 'Alojamentos'],
  ['maquinas', 'Máquinas'],
  ['locadoras', 'Locadoras'],
  ['formularios', 'Formulários'],
  ['cadastro', 'Cadastro'],
] as const;
type Aba = (typeof ABAS)[number][0];

type Contexto = {
  podeEditar: boolean;
  ehAdmin: boolean;
  fornecedores: Fornecedor[];
  locadoras: Locadora[];
  modelos: Modelo[];
};

export function Seguranca() {
  const { usuario } = useSessao();
  return usuario?.perfil === 'engenharia' ? <SegurancaResumo /> : <SegurancaCompleta />;
}

// Engenharia: só o painel visual (conformidade, itens que mais falham e correções em aberto).
function SegurancaResumo() {
  const [obras, setObras] = useState<ObraDoPainel[] | null>(null);
  const [obra, setObra] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    lerObrasDoPainel()
      .then((o) => {
        setObras(o);
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

  function escolher(o: string) {
    setObra(o);
    try {
      window.localStorage.setItem(CHAVE_OBRA, o);
    } catch {
      // segue sem lembrar a obra
    }
  }

  return (
    <Pagina titulo="Segurança da obra" apoio="Conformidade das inspeções, itens que mais aparecem como não conformes e correções em aberto dos fornecedores.">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {!obras && !erro && <Carregando />}
      {obras && (
        <div className="filtros">
          <label className="campo">
            <span>Obra</span>
            <select value={obra} onChange={(e) => escolher(e.target.value)}>
              <option value="">Escolha a obra</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </label>
        </div>
      )}
      {obra && <PainelResumoObra obraId={obra} />}
    </Pagina>
  );
}

function SegurancaCompleta() {
  const { usuario } = useSessao();
  const podeEditar = usuario?.perfil === 'admin' || usuario?.perfil === 'tst';
  const [params, setParams] = useSearchParams();
  const ehAdmin = usuario?.perfil === 'admin';
  const abas = ABAS.filter(([a]) => (a !== 'formularios' && a !== 'cadastro') || ehAdmin);
  const aba = (abas.find(([a]) => a === params.get('aba'))?.[0] ?? 'inspecoes') as Aba;
  const semObra = aba === 'locadoras' || aba === 'formularios' || aba === 'cadastro';

  const [obras, setObras] = useState<ObraDoPainel[] | null>(null);
  const [obra, setObra] = useState('');
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [locadoras, setLocadoras] = useState<Locadora[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [alojamentos, setAlojamentos] = useState<Alojamento[] | null>(null);
  const [maquinas, setMaquinas] = useState<Maquina[] | null>(null);
  const [canteiro, setCanteiro] = useState<VistoriaResumo[]>([]);
  const [ncs, setNcs] = useState<NaoConformidade[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [nova, setNova] = useState(false);

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
      const [a, m, f, c] = await Promise.all([lerAlojamentos(o), lerMaquinas(o), lerFornecedoresDaObra(o), lerVistoriasCanteiro(o)]);
      setCanteiro(c);
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

  const ctx: Contexto = { podeEditar, ehAdmin, fornecedores, locadoras, modelos };
  const pendentes = (alojamentos?.filter((a) => a.empresa_a_vincular).length ?? 0) + (maquinas?.filter((m) => m.empresa_a_vincular).length ?? 0);

  async function recarregar(mensagem: string) {
    setOk(mensagem);
    setErro(null);
    await Promise.all([carregarObra(obra), lerLocadoras().then(setLocadoras)]);
  }

  return (
    <Pagina
      titulo="Segurança da obra"
      apoio="Vistorias de alojamento, checklist das máquinas e a quem cada uma pertence."
      acoes={
        podeEditar && !semObra && obra && alojamentos && maquinas ? (
          <button type="button" className="botao" onClick={() => setNova(true)}>Realizar inspeção</button>
        ) : undefined
      }
      abas={
        <nav className="abas abas-botoes" aria-label="Segurança da obra">
          {abas.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'inspecoes' ? {} : { aba: a })}>
              {nome}
            </button>
          ))}
        </nav>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!obras && !erro && <Carregando />}

      {!semObra && obras && (
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
      {!semObra && obras?.length === 0 && <p className="vazio">Nenhuma obra ligada ao seu acesso.</p>}

      {!semObra && obra && pendentes > 0 && (
        <div className="aviso aviso-alerta aviso-faixa" role="status">
          <span>
            {pendentes === 1 ? '1 cadastro veio' : `${pendentes} cadastros vieram`} do ObraCheck com uma empresa que não existe no portal.
            {podeEditar ? ' Abra o item marcado como "a vincular" e escolha o responsável.' : ' O TST da obra escolhe o responsável.'}
          </span>
        </div>
      )}

      {aba === 'inspecoes' && obra && (alojamentos && maquinas ? (
        <>
        <PainelConformidade obraId={obra} alojamentos={alojamentos} maquinas={maquinas} fornecedores={fornecedores} ncs={ncs} temCanteiro={modelos.some((m) => m.grupo === 'canteiro')} />
        <Inspecoes alojamentos={alojamentos} maquinas={maquinas} canteiro={canteiro} modelos={modelos} fornecedores={fornecedores} locadoras={locadoras} podeIniciar={podeEditar} aoIniciar={() => setNova(true)} />
        </>
      ) : <Carregando />)}
      {aba === 'alojamentos' && obra && (alojamentos ? (
        <Alojamentos lista={alojamentos} ncs={ncs} ctx={ctx} aoSalvar={recarregar} />
      ) : <Carregando />)}
      {aba === 'maquinas' && obra && (maquinas ? (
        <Maquinas lista={maquinas} ctx={ctx} aoSalvar={recarregar} />
      ) : <Carregando />)}
      {aba === 'locadoras' && obras && <Locadoras lista={locadoras} podeEditar={podeEditar} aoSalvar={recarregar} />}
      {aba === 'formularios' && ehAdmin && <ListaFormularios />}
      {aba === 'cadastro' && ehAdmin && obras && <CadastroAlojamentos obras={obras} />}

      {obra && alojamentos && maquinas && (
        <NovaInspecao
          aberto={nova}
          obraId={obra}
          obraNome={obras?.find((o) => o.id === obra)?.nome ?? ''}
          alojamentos={alojamentos}
          maquinas={maquinas}
          modelos={modelos}
          fornecedores={fornecedores}
          locadoras={locadoras}
          tst={usuario?.nome ?? ''}
          ehAdmin={ehAdmin}
          aoFechar={() => setNova(false)}
        />
      )}
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

function Alojamentos({ lista, ncs, ctx, aoSalvar }: { lista: Alojamento[]; ncs: NaoConformidade[]; ctx: Contexto; aoSalvar: (m: string) => Promise<void> }) {
  const [editando, setEditando] = useState<Alojamento | null>(null);
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
                        <Link key={v.id} className="botao botao-secundario botao-pequeno" to={`/seguranca/vistoria/${v.id}`} title="Abrir a vistoria">
                          {data(v.data_vistoria)}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="acoes">
                    <div className="acoes-coluna">
                      <Link className="botao botao-secundario botao-pequeno" to={`/seguranca/alojamento/${a.id}/termos`}>Termos de uso</Link>
                      {(ctx.ehAdmin || (ctx.podeEditar && a.empresa_a_vincular)) && (
                        <button type="button" className={`botao botao-pequeno${a.empresa_a_vincular ? ' botao-secundario' : ' botao-discreto'}`} onClick={() => setEditando(a)}>
                          {a.empresa_a_vincular ? 'Vincular' : 'Editar cadastro'}
                        </button>
                      )}
                    </div>
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
    </section>
  );
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
          <input value={nome} onChange={(e) => setNome(e.target.value)} required disabled={!ctx.ehAdmin} />
        </label>
        <label className="campo">
          <span>Endereço</span>
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)} disabled={!ctx.ehAdmin} />
        </label>
        {!ctx.ehAdmin && <p className="dica">Nome e endereço são padronizados pelo administrativo. Se estiverem errados, peça a correção.</p>}
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

function Maquinas({ lista, ctx, aoSalvar }: { lista: Maquina[]; ctx: Contexto; aoSalvar: (m: string) => Promise<void> }) {
  const [editando, setEditando] = useState<Maquina | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const navegar = useNavigate();

  // "Preencher hoje": abre (ou cria) a ficha do mês e vai direto para o checklist do dia.
  async function preencherHoje(m: Maquina) {
    setAbrindo(m.id);
    setErro(null);
    try {
      const hoje = hojeIso();
      const fichaId = await abrirFicha(m.id, hoje);
      navegar(`/seguranca/ficha/${fichaId}/dia/${Number(hoje.slice(8, 10))}`);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      setAbrindo(null);
    }
  }
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
      <p className="dica">Toque no mês para ver ou editar o checklist. "Editar cadastro" muda só a identificação e de quem é a máquina.</p>
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      <div className="tabela-rolagem">
        <table className="tabela tabela-lista">
          <thead>
            <tr>
              <th scope="col">Máquina</th>
              <th scope="col">Responsável</th>
              <th scope="col">Checklists</th>
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
                        <Link key={f.id} className="botao botao-secundario botao-pequeno" to={`/seguranca/ficha/${f.id}`} title="Abrir o checklist do mês">
                          {competencia(f.competencia)}
                          {f.fechada_em ? ' (fechado)' : ''}
                        </Link>
                      ))}
                    {!m.fichas.length && <span className="sub">sem checklist</span>}
                  </div>
                </td>
                <td className="acoes">
                  <div className="acoes-coluna">
                    {ctx.podeEditar && m.ativo && (
                      <button type="button" className="botao botao-pequeno" disabled={abrindo === m.id} onClick={() => preencherHoje(m)}>
                        {abrindo === m.id ? 'Abrindo' : 'Preencher hoje'}
                      </button>
                    )}
                    {ctx.podeEditar && (
                      <button type="button" className={`botao botao-pequeno${m.empresa_a_vincular ? ' botao-secundario' : ' botao-discreto'}`} onClick={() => setEditando(m)}>
                        {m.empresa_a_vincular ? 'Vincular' : 'Editar cadastro'}
                      </button>
                    )}
                  </div>
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
