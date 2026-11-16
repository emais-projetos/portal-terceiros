import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data } from '../../lib/formato';
import { NOMES_GRUPO, lerRevisoes, lerTodosModelos, salvarModelo, type Modelo, type Revisao } from '../../lib/seguranca';
import { Voltar } from './comum';

const ORDEM_GRUPO: Modelo['grupo'][] = ['alojamento', 'canteiro', 'maquina'];

// Aba Formulários (administrativo): lista os checklists com a versão em uso.
export function ListaFormularios() {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    lerTodosModelos().then(setModelos).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, []);

  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!modelos) return <Carregando />;

  return (
    <section className="bloco">
      <div className="barra-lista">
        <p className="apoio">
          Perguntas dos checklists. Cada alteração vira uma revisão com motivo, autor e data. As inspeções já feitas guardam as perguntas da época.
        </p>
        <Link className="botao botao-pequeno" to="/seguranca/formulario/novo">Novo formulário</Link>
      </div>
      {ORDEM_GRUPO.map((g) => {
        const lista = modelos.filter((m) => m.grupo === g);
        return (
          <div key={g} className="grupo-formularios">
            <h2 className="bloco-titulo">{g === 'maquina' ? 'Máquinas' : g === 'canteiro' ? 'Canteiro' : 'Alojamento'}</h2>
            {lista.length === 0 ? (
              <p className="vazio">
                {g === 'canteiro' ? 'Nenhum checklist de canteiro ainda. Ao cadastrar, a opção Canteiro passa a aparecer em Realizar inspeção.' : 'Nenhum formulário.'}
              </p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela tabela-lista tabela-compacta">
                  <thead>
                    <tr>
                      <th scope="col">Formulário</th>
                      <th scope="col">Perguntas</th>
                      <th scope="col">Versão</th>
                      <th scope="col">Atualizado em</th>
                      <th scope="col"><span className="sr">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((m) => (
                      <tr key={m.codigo} className={m.ativo ? undefined : 'linha-inativa'}>
                        <th scope="row">
                          {m.nome}
                          {!m.ativo && <small className="sub">desativado</small>}
                        </th>
                        <td>{m.itens.length}</td>
                        <td>v{m.versao}</td>
                        <td>{data(m.atualizado_em)}</td>
                        <td className="acoes">
                          <Link className="botao botao-secundario botao-pequeno" to={`/seguranca/formulario/${encodeURIComponent(m.codigo)}`}>Revisar</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

type Pergunta = { chave: string; texto: string };
const nova = (texto = ''): Pergunta => ({ chave: crypto.randomUUID(), texto });

// Revisão de um formulário: editar, incluir, excluir e reordenar perguntas, com o histórico abaixo.
export function FormularioPagina() {
  const { codigo: param = 'novo' } = useParams();
  const codigo = param === 'novo' ? null : decodeURIComponent(param);
  const navegar = useNavigate();
  const local = useLocation();
  const [modelo, setModelo] = useState<Modelo | null>(null);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [carregado, setCarregado] = useState(!codigo);
  const [nome, setNome] = useState('');
  const [grupo, setGrupo] = useState<Modelo['grupo']>('canteiro');
  const [ativo, setAtivo] = useState(true);
  const [perguntas, setPerguntas] = useState<Pergunta[]>([nova()]);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>((local.state as { ok?: string } | null)?.ok ?? null);
  const [aberta, setAberta] = useState<string | null>(null);

  async function carregar(c: string) {
    const todos = await lerTodosModelos();
    const m = todos.find((x) => x.codigo === c) ?? null;
    if (!m) throw new Error('Formulário não encontrado.');
    setModelo(m);
    setNome(m.nome);
    setGrupo(m.grupo);
    setAtivo(m.ativo);
    setPerguntas(m.itens.map((t) => nova(t)));
    setMotivo('');
    setRevisoes(await lerRevisoes(c));
    setCarregado(true);
  }

  useEffect(() => {
    if (codigo) carregar(codigo).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [codigo]); // eslint-disable-line react-hooks/exhaustive-deps

  const itens = perguntas.map((p) => p.texto.trim()).filter(Boolean);
  const mudou = !modelo || modelo.nome !== nome.trim() || modelo.ativo !== ativo || JSON.stringify(modelo.itens) !== JSON.stringify(itens);
  const repetidas = new Set(itens.map((t) => t.toLowerCase())).size !== itens.length;

  function mover(i: number, d: -1 | 1) {
    setPerguntas((l) => {
      const c = [...l];
      const j = i + d;
      if (j < 0 || j >= c.length) return l;
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const r = await salvarModelo({ codigo, grupo, nome: nome.trim(), itens, ativo, motivo: motivo.trim() });
      const msg = codigo ? `Revisão v${r.versao} salva. As próximas inspeções já usam as perguntas novas.` : 'Formulário criado.';
      if (!codigo) navegar(`/seguranca/formulario/${encodeURIComponent(r.codigo)}`, { replace: true, state: { ok: msg } });
      else {
        await carregar(codigo);
        setOk(msg);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setSalvando(false);
    }
  }

  if (!carregado)
    return (
      <Pagina titulo="Formulário">
        <Voltar para="/seguranca?aba=formularios" rotulo="Formulários" />
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );

  return (
    <Pagina
      titulo={codigo ? `Revisar: ${modelo?.nome}` : 'Novo formulário'}
      apoio={codigo ? `${NOMES_GRUPO[grupo]}. Versão em uso: v${modelo?.versao}.` : 'Checklist novo para as inspeções da obra.'}
    >
      <Voltar para="/seguranca?aba=formularios" rotulo="Formulários" />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="form-inspecao">
        <section className="bloco">
          <div className="grade-2">
            <label className="campo">
              <span>Nome do formulário</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Canteiro de obras (NR-18)" />
            </label>
            {codigo ? (
              <div className="campo">
                <span>Tipo</span>
                <p className="valor-fixo">{NOMES_GRUPO[grupo]}</p>
              </div>
            ) : (
              <label className="campo">
                <span>Tipo</span>
                <select value={grupo} onChange={(e) => setGrupo(e.target.value as Modelo['grupo'])}>
                  <option value="canteiro">Canteiro</option>
                  <option value="maquina">Máquina (novo tipo de máquina)</option>
                  <option value="alojamento">Alojamento</option>
                </select>
              </label>
            )}
          </div>
          <label className="opcao">
            <input type="checkbox" checked={!ativo} onChange={(e) => setAtivo(!e.target.checked)} />
            <span>Formulário desativado (não aparece para novas inspeções)</span>
          </label>
          {codigo && (
            <p className="dica">
              A revisão vale para as próximas inspeções. As que já foram feitas guardam as perguntas da época
              {grupo === 'maquina' ? ', e a ficha do mês em andamento segue com as perguntas antigas até o mês virar' : ''}.
            </p>
          )}
        </section>

        <section className="bloco">
          <div className="barra-lista">
            <h2 className="bloco-titulo">Perguntas ({itens.length})</h2>
          </div>
          <ol className="editor-perguntas">
            {perguntas.map((p, i) => (
              <li key={p.chave}>
                <span className="item-inspecao-numero">{i + 1}</span>
                <textarea
                  rows={2}
                  value={p.texto}
                  aria-label={`Pergunta ${i + 1}`}
                  onChange={(e) => setPerguntas((l) => l.map((x) => (x.chave === p.chave ? { ...x, texto: e.target.value } : x)))}
                />
                <div className="editor-perguntas-acoes">
                  <button type="button" className="botao botao-discreto botao-pequeno" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                  <button type="button" className="botao botao-discreto botao-pequeno" aria-label="Descer" disabled={i === perguntas.length - 1} onClick={() => mover(i, 1)}>↓</button>
                  <button
                    type="button"
                    className="botao botao-discreto botao-pequeno"
                    disabled={perguntas.length === 1}
                    onClick={() => setPerguntas((l) => l.filter((x) => x.chave !== p.chave))}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setPerguntas((l) => [...l, nova()])}>+ Incluir pergunta</button>
          {repetidas && <p className="texto-erro">Há perguntas repetidas.</p>}
        </section>

        {revisoes.length > 0 && (
          <section className="bloco">
            <h2 className="bloco-titulo">Histórico de revisões</h2>
            <ul className="lista-revisoes-form">
              {revisoes.map((r, k) => {
                const anterior = revisoes[k + 1];
                const ant = new Set(anterior?.itens ?? []);
                const atual = new Set(r.itens);
                const incluidas = anterior ? r.itens.filter((t) => !ant.has(t)) : [];
                const excluidas = anterior ? anterior.itens.filter((t) => !atual.has(t)) : [];
                const aberto = aberta === r.id;
                return (
                  <li key={r.id}>
                    <button type="button" className="revisao-cabecalho" aria-expanded={aberto} onClick={() => setAberta(aberto ? null : r.id)}>
                      <strong>v{r.versao}</strong>
                      <span>
                        {data(r.criado_em)}
                        {r.autor?.nome ? `, ${r.autor.nome}` : ''}
                        <small className="sub">{r.motivo}</small>
                      </span>
                      <span className="sub">
                        {r.itens.length} perguntas
                        {anterior ? `. ${incluidas.length} incluídas, ${excluidas.length} excluídas` : ''}
                        {anterior && anterior.nome !== r.nome ? '. Nome alterado' : ''}
                        {anterior && anterior.ativo !== r.ativo ? (r.ativo ? '. Reativado' : '. Desativado') : ''}
                      </span>
                    </button>
                    {aberto && (
                      <div className="revisao-detalhe">
                        {anterior && (incluidas.length > 0 || excluidas.length > 0) && (
                          <ul className="revisao-diferencas">
                            {incluidas.map((t) => <li key={`+${t}`} className="revisao-incluida">+ {t}</li>)}
                            {excluidas.map((t) => <li key={`-${t}`} className="revisao-excluida">− {t}</li>)}
                          </ul>
                        )}
                        <ol>
                          {r.itens.map((t) => <li key={t}>{t}</li>)}
                        </ol>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="barra-acoes-fixa">
          <label className="campo campo-motivo">
            <span className="sr">Motivo da revisão</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={codigo ? 'Motivo da revisão (obrigatório)' : 'Origem do formulário (obrigatório)'} />
          </label>
          <div className="linha-botoes">
            <Link className="botao botao-discreto" to="/seguranca?aba=formularios">Cancelar</Link>
            <button
              type="button"
              className="botao"
              disabled={salvando || !mudou || repetidas || itens.length === 0 || nome.trim().length < 3 || motivo.trim().length < 5}
              onClick={salvar}
            >
              {salvando ? 'Salvando' : codigo ? 'Salvar revisão' : 'Criar formulário'}
            </button>
          </div>
        </div>
      </div>
    </Pagina>
  );
}
