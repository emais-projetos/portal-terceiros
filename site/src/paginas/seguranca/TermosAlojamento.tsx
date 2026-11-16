import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Assinatura } from '../../componentes/Assinatura';
import { useSessao } from '../../lib/sessao';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import {
  colaboradoresAtivos, criarTermo, enviarImagem, lerAlojamento, lerFornecedoresDaObra, lerTermos,
  type AlojamentoComObra, type ColaboradorAtivo, type Termo,
} from '../../lib/seguranca';
import { TERMO, VERSAO_TERMO } from '../../lib/termoAlojamento';
import { baixarPdfTermo } from '../../lib/pdfSeguranca';
import { Voltar, nomeResponsavel } from './comum';

type Quem = 'colaborador' | 'representante';

// Termo de uso do alojamento: o colaborador assina na entrada, junto com o responsável da empresa.
export function TermosAlojamento() {
  const { id = '' } = useParams();
  const { usuario } = useSessao();
  const podeEditar = usuario?.perfil === 'admin' || usuario?.perfil === 'tst';
  const [aloj, setAloj] = useState<AlojamentoComObra | null>(null);
  const [empresa, setEmpresa] = useState('');
  const [termos, setTermos] = useState<Termo[] | null>(null);
  const [colabs, setColabs] = useState<ColaboradorAtivo[]>([]);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  // Formulário
  const [colaboradorId, setColaboradorId] = useState('');
  const [nome, setNome] = useState('');
  const [funcao, setFuncao] = useState('');
  const [ingresso, setIngresso] = useState(hojeIso());
  const [local, setLocal] = useState('');
  const [dia, setDia] = useState(hojeIso());
  const [representante, setRepresentante] = useState('');
  const [assinaturas, setAssinaturas] = useState<Partial<Record<Quem, { caminho: string; previa: string }>>>({});
  const [assinando, setAssinando] = useState<Quem | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const a = await lerAlojamento(id);
    setAloj(a);
    const [t, f] = await Promise.all([lerTermos(id), lerFornecedoresDaObra(a.obra_id).catch(() => [])]);
    setTermos(t);
    setEmpresa(nomeResponsavel(a, f, []));
    if (a.empresa_id && podeEditar) colaboradoresAtivos(a.empresa_id).then(setColabs).catch(() => undefined);
  }

  useEffect(() => {
    carregar().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function abrirNovo() {
    setColaboradorId('');
    setNome('');
    setFuncao('');
    setIngresso(hojeIso());
    setLocal(aloj?.obra.nome ?? '');
    setDia(hojeIso());
    setRepresentante('');
    setAssinaturas({});
    setErro(null);
    setNovo(true);
  }

  async function baixar(t: Termo) {
    setBaixando(t.id);
    try {
      await baixarPdfTermo(t, { obra: aloj!.obra.nome, alojamento: aloj!.nome, empresa });
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setBaixando(null);
    }
  }

  async function salvar() {
    if (!assinaturas.colaborador || !assinaturas.representante) return;
    setSalvando(true);
    setErro(null);
    try {
      const t = await criarTermo({
        alojamento_id: id,
        colaborador_id: colaboradorId || null,
        nome: nome.trim(),
        funcao: funcao.trim() || null,
        data_ingresso: ingresso || null,
        local: local.trim() || null,
        data: dia,
        assinatura: assinaturas.colaborador.caminho,
        representante_nome: representante.trim(),
        representante_assinatura: assinaturas.representante.caminho,
        versao: VERSAO_TERMO,
      });
      setNovo(false);
      await carregar();
      setOk(`Termo de ${t.nome} assinado. O PDF foi baixado.`);
      await baixar(t);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setSalvando(false);
    }
  }

  if (!aloj)
    return (
      <Pagina titulo="Termo de uso do alojamento">
        <Voltar para="/seguranca?aba=alojamentos" rotulo="Alojamentos" />
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );

  const completo = nome.trim().length >= 3 && representante.trim().length >= 3 && !!assinaturas.colaborador && !!assinaturas.representante && !!dia;

  return (
    <Pagina
      titulo={`Termos de uso: ${aloj.nome}`}
      apoio={`${aloj.obra.nome}. Responsável: ${empresa}.`}
      acoes={podeEditar && !novo ? <button type="button" className="botao" onClick={abrirNovo}>Novo termo</button> : undefined}
    >
      <Voltar para="/seguranca?aba=alojamentos" rotulo="Alojamentos" />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      {novo ? (
        <div className="form-inspecao">
          <section className="bloco">
            <h2 className="bloco-titulo">Colaborador</h2>
            {colabs.length > 0 && (
              <label className="campo">
                <span>Colaborador ativo de {empresa}</span>
                <select
                  value={colaboradorId}
                  onChange={(e) => {
                    const c = colabs.find((x) => x.id === e.target.value);
                    setColaboradorId(e.target.value);
                    if (c) {
                      setNome(c.nome);
                      setFuncao(c.funcao ?? '');
                    }
                  }}
                >
                  <option value="">Escolha ou digite o nome abaixo</option>
                  {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
            )}
            <div className="grade-2">
              <label className="campo">
                <span>Nome do colaborador</span>
                <input value={nome} readOnly={!!colaboradorId} onChange={(e) => setNome(e.target.value)} />
              </label>
              <label className="campo">
                <span>Função</span>
                <input value={funcao} onChange={(e) => setFuncao(e.target.value)} />
              </label>
              <label className="campo">
                <span>Data de ingresso no alojamento</span>
                <input type="date" value={ingresso} onChange={(e) => setIngresso(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="bloco">
            <h2 className="bloco-titulo">Regras do alojamento</h2>
            <div className="texto-termo">
              <p>{TERMO.introducao}</p>
              {TERMO.secoes.map((s) => (
                <div key={s.titulo}>
                  <h3>{s.titulo}</h3>
                  <ul>{s.itens.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
              <h3>Penalidades</h3>
              <p>{TERMO.penalidade}</p>
              <h3>Declaração</h3>
              <p>{TERMO.declaracao}</p>
            </div>
          </section>

          <section className="bloco">
            <h2 className="bloco-titulo">Assinaturas</h2>
            <div className="grade-2">
              <label className="campo">
                <span>Local</span>
                <input value={local} onChange={(e) => setLocal(e.target.value)} />
              </label>
              <label className="campo">
                <span>Data da assinatura</span>
                <input type="date" max={hojeIso()} value={dia} onChange={(e) => setDia(e.target.value)} />
              </label>
            </div>
            <div className="lista-pessoas">
              <div className="pessoa-assina">
                <strong>{nome || 'Colaborador'}</strong>
                <div className="pessoa-assina-acoes">
                  {assinaturas.colaborador ? <img className="assinatura-previa" src={assinaturas.colaborador.previa} alt="Assinatura do colaborador" /> : <span className="sub">sem assinatura</span>}
                  <button type="button" className="botao botao-secundario botao-pequeno" disabled={nome.trim().length < 3} onClick={() => setAssinando('colaborador')}>
                    {assinaturas.colaborador ? 'Assinar de novo' : 'Assinatura do colaborador'}
                  </button>
                </div>
              </div>
              <div className="pessoa-assina">
                <label className="campo">
                  <span>Responsável da empresa</span>
                  <input value={representante} onChange={(e) => setRepresentante(e.target.value)} />
                </label>
                <div className="pessoa-assina-acoes">
                  {assinaturas.representante ? <img className="assinatura-previa" src={assinaturas.representante.previa} alt="Assinatura do responsável" /> : <span className="sub">sem assinatura</span>}
                  <button type="button" className="botao botao-secundario botao-pequeno" disabled={representante.trim().length < 3} onClick={() => setAssinando('representante')}>
                    {assinaturas.representante ? 'Assinar de novo' : 'Assinatura do responsável'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="barra-acoes-fixa">
            <span className="sub">Depois de salvo, o termo não pode ser alterado.</span>
            <div className="linha-botoes">
              <button type="button" className="botao botao-discreto" onClick={() => setNovo(false)}>Cancelar</button>
              <button type="button" className="botao" disabled={!completo || salvando} onClick={salvar}>{salvando ? 'Salvando' : 'Salvar e baixar PDF'}</button>
            </div>
          </div>
        </div>
      ) : !termos ? (
        <Carregando />
      ) : termos.length === 0 ? (
        <p className="vazio">Nenhum termo assinado neste alojamento.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Colaborador</th>
                <th scope="col">Ingresso</th>
                <th scope="col">Assinado em</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {termos.map((t) => (
                <tr key={t.id}>
                  <th scope="row">{t.nome}{t.funcao && <small className="sub">{t.funcao.toLowerCase()}</small>}</th>
                  <td>{data(t.data_ingresso)}</td>
                  <td>{data(t.data)}</td>
                  <td className="acoes">
                    <button type="button" className="botao botao-discreto botao-pequeno" disabled={baixando === t.id} onClick={() => baixar(t)}>
                      {baixando === t.id ? 'Gerando PDF' : 'Baixar PDF'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Assinatura
        aberto={!!assinando}
        nome={assinando === 'colaborador' ? nome : representante}
        aoFechar={() => setAssinando(null)}
        aoConfirmar={async (png) => {
          try {
            const caminho = await enviarImagem(`termo/${id}/${assinando}-${crypto.randomUUID()}.png`, png);
            setAssinaturas((s) => ({ ...s, [assinando!]: { caminho, previa: URL.createObjectURL(png) } }));
          } catch (e) {
            setErro(mensagemDeErro(e as Error));
          }
          setAssinando(null);
        }}
      />
    </Pagina>
  );
}
