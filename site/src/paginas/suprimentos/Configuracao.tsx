import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Dialogo } from '../../componentes/Dialogo';
import { mensagemDeErro } from '../../lib/supabase';
import { data } from '../../lib/formato';
import {
  NOMES_FORMATO, configurarCampo, configurarDocumento, incluirItem, lerCamposHomologacao, lerHistoricoConfiguracao, lerTiposHomologacao, removerItem,
  type CampoHomologacao, type FormatoCampo, type MudancaConfiguracao, type TipoHomologacao,
} from '../../lib/homologacao';
import {
  lerResumoTipos, lerTiposFornecedor, nomeCurto, removerTipoFornecedor, salvarTipoFornecedor, type TipoFornecedor, type TipoFornecedorResumo,
} from '../../lib/tiposFornecedor';
import { lerResumoCategorias, removerCategoria, salvarCategoria, type CategoriaResumo } from '../../lib/categorias';
import { ModelosEmail } from '../admin/RegrasEmails';

const ABAS = [
  ['formulario', 'Formulário da homologação'],
  ['tipos', 'Tipos de fornecedor'],
  ['categorias', 'Categorias de serviço'],
  ['emails', 'E-mails'],
] as const;
type Aba = (typeof ABAS)[number][0];

// Configuração (Suprimentos): o que o fornecedor precisa preencher e enviar na homologação, e os textos dos e-mails.
export function Configuracao() {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'formulario';
  return (
    <Pagina
      titulo="Configuração"
      apoio="O que o fornecedor precisa preencher e enviar na homologação, os tipos de fornecedor com os documentos de cada um, as categorias de serviço e os textos dos e-mails da homologação."
      abas={
        <nav className="abas abas-botoes" aria-label="Configuração">
          {ABAS.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'formulario' ? {} : { aba: a })}>
              {nome}
            </button>
          ))}
        </nav>
      }
    >
      {aba === 'emails' ? <ModelosEmail /> : aba === 'tipos' ? <TiposFornecedorConfig /> : aba === 'categorias' ? <CategoriasConfig /> : <FormularioHomologacao />}
    </Pagina>
  );
}

type RascunhoDoc = { obrigatorio: boolean; validade: string; tipos: string[] };
type Rascunho = { campos: Record<string, boolean>; docs: Record<string, RascunhoDoc> };

const mesmosTipos = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function FormularioHomologacao() {
  const [campos, setCampos] = useState<CampoHomologacao[] | null>(null);
  const [tipos, setTipos] = useState<TipoHomologacao[]>([]);
  const [tiposF, setTiposF] = useState<TipoFornecedor[]>([]);
  const [params, setParams] = useSearchParams();
  const filtroTipo = params.get('tipo') ?? '';
  const [historico, setHistorico] = useState<MudancaConfiguracao[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho>({ campos: {}, docs: {} });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [incluindo, setIncluindo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [c, t, h, tf] = await Promise.all([lerCamposHomologacao(), lerTiposHomologacao(true), lerHistoricoConfiguracao(), lerTiposFornecedor(true)]);
      setCampos(c.filter((x) => x.ativo));
      setTipos(t.filter((x) => x.ativo));
      setTiposF(tf);
      setHistorico(h);
      setRascunho({
        campos: Object.fromEntries(c.filter((x) => x.ativo).map((x) => [x.campo, x.obrigatorio])),
        docs: Object.fromEntries(
          t.filter((x) => x.ativo).map((x) => [x.codigo, { obrigatorio: x.obrigatorio, validade: x.validade_dias ? String(x.validade_dias) : '', tipos: x.tipos_fornecedor ?? [] }]),
        ),
      });
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const secoes = useMemo(() => {
    const mapa = new Map<string, CampoHomologacao[]>();
    for (const c of campos ?? []) mapa.set(c.secao, [...(mapa.get(c.secao) ?? []), c]);
    return [...mapa.entries()];
  }, [campos]);

  const camposMudados = (campos ?? []).filter((c) => !c.fixo && rascunho.campos[c.campo] !== c.obrigatorio);
  const docsMudados = tipos.filter((t) => {
    const r = rascunho.docs[t.codigo];
    return r && (r.obrigatorio !== t.obrigatorio || (r.validade.trim() ? Number(r.validade) : null) !== t.validade_dias || !mesmosTipos(r.tipos, t.tipos_fornecedor ?? []));
  });
  const docsVisiveis = filtroTipo ? tipos.filter((t) => (rascunho.docs[t.codigo]?.tipos ?? t.tipos_fornecedor ?? []).includes(filtroTipo)) : tipos;
  const validadeInvalida = tipos.some((t) => {
    const v = rascunho.docs[t.codigo]?.validade.trim();
    return !!v && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 3650);
  });
  const mudancas = camposMudados.length + docsMudados.length;

  async function salvar() {
    setErro(null);
    setOk(null);
    setSalvando(true);
    try {
      for (const c of camposMudados) await configurarCampo(c.campo, rascunho.campos[c.campo]);
      for (const t of docsMudados) {
        const r = rascunho.docs[t.codigo];
        await configurarDocumento(t.codigo, r.obrigatorio, r.validade.trim() ? Number(r.validade) : null, mesmosTipos(r.tipos, t.tipos_fornecedor ?? []) ? null : r.tipos);
      }
      setOk(`${mudancas === 1 ? '1 alteração salva' : `${mudancas} alterações salvas`}. Vale para os próximos envios dos fornecedores.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function remover(codigo: string, nome: string) {
    if (!window.confirm(`Remover "${nome}" do formulário? Os fornecedores deixam de ver este item. O que já foi respondido ou enviado continua guardado.`)) return;
    setErro(null);
    setOk(null);
    try {
      await removerItem(codigo);
      setOk(`"${nome}" removido do formulário.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  if (!campos && !erro) return <Carregando />;

  return (
    <>
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="barra-lista">
        <p className="apoio">
          Precisa pedir algo que não está no F.31? Inclua uma pergunta (texto, data ou número) ou um documento para anexar.
          {mudancas > 0 && ' Salve ou desfaça as alterações antes de incluir.'}
        </p>
        <button type="button" className="botao" disabled={mudancas > 0 || salvando} onClick={() => setIncluindo(true)}>Incluir item</button>
      </div>

      <section className="bloco">
        <h2 className="bloco-titulo">Dados do F.31</h2>
        <p className="apoio">
          Marque o que o fornecedor é obrigado a preencher antes de enviar a homologação. Os campos sem marcação continuam no formulário, mas podem ficar em branco.
        </p>
        <div className="grade-2">
          {secoes.map(([secao, lista]) => (
            <fieldset key={secao} className="campo-grupo">
              <legend>{secao}</legend>
              <div className="opcoes opcoes-empilhadas">
                {lista.map((c) => (
                  <label key={c.campo} className="opcao">
                    <input
                      type="checkbox"
                      checked={c.fixo || !!rascunho.campos[c.campo]}
                      disabled={c.fixo || salvando}
                      onChange={(e) => setRascunho((r) => ({ ...r, campos: { ...r.campos, [c.campo]: e.target.checked } }))}
                    />
                    <span>
                      {c.rotulo}
                      {c.fixo && <small className="sub"> sempre obrigatório</small>}
                      {c.personalizado && <small className="sub"> {NOMES_FORMATO[c.formato]}</small>}
                    </span>
                    {c.personalizado && (
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno"
                        disabled={mudancas > 0 || salvando}
                        onClick={(e) => {
                          e.preventDefault();
                          remover(c.campo, c.rotulo);
                        }}
                      >
                        Remover
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Documentos</h2>
        <p className="apoio">
          Obrigatório: sem ele o fornecedor não consegue enviar a homologação. Validade: dias a partir da data de emissão; em branco, o documento não vence.
          A validade nova vale para os próximos envios; o vencimento dos documentos já enviados não muda.
          Nas colunas dos tipos, marque para quem o documento é pedido: o fornecedor só vê os documentos do(s) tipo(s) dele.
        </p>
        <div className="filtros">
          <label className="campo">
            <span>Ver os documentos de</span>
            <select value={filtroTipo} onChange={(e) => setParams(e.target.value ? { tipo: e.target.value } : {})}>
              <option value="">Todos os tipos</option>
              {tiposF.map((tf) => <option key={tf.codigo} value={tf.codigo}>{tf.nome}</option>)}
            </select>
          </label>
        </div>
        <div className="tabela-rolagem">
          <table className="tabela tabela-compacta tabela-tipos-doc">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Obrigatório</th>
                <th scope="col">Validade (dias)</th>
                {tiposF.map((tf) => (
                  <th key={tf.codigo} scope="col" className="col-tipo" title={tf.nome}>{nomeCurto(tf)}</th>
                ))}
                <th scope="col"><span className="sr">Remover</span></th>
              </tr>
            </thead>
            <tbody>
              {docsVisiveis.map((t) => {
                const r = rascunho.docs[t.codigo] ?? { obrigatorio: t.obrigatorio, validade: '', tipos: t.tipos_fornecedor ?? [] };
                const v = r.validade.trim();
                const invalida = !!v && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 3650);
                return (
                  <tr key={t.codigo}>
                    <th scope="row">
                      {t.nome}
                      {t.tipo_portal && <small className="sub">Aprovado aqui, entra também em Documentos da empresa</small>}
                      {t.personalizado && <small className="sub">Incluído pelo Suprimentos</small>}
                      {r.tipos.length === 0 && <small className="texto-alerta">Não é pedido a nenhum tipo</small>}
                    </th>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${t.nome}: obrigatório`}
                        checked={r.obrigatorio}
                        disabled={salvando}
                        onChange={(e) => setRascunho((x) => ({ ...x, docs: { ...x.docs, [t.codigo]: { ...r, obrigatorio: e.target.checked } } }))}
                      />
                    </td>
                    <td>
                      <label className="campo campo-compacto campo-validade">
                        <span className="sr">{t.nome}: validade em dias</span>
                        <input
                          inputMode="numeric"
                          placeholder="Não vence"
                          value={r.validade}
                          maxLength={4}
                          disabled={salvando}
                          aria-invalid={invalida}
                          onChange={(e) => setRascunho((x) => ({ ...x, docs: { ...x.docs, [t.codigo]: { ...r, validade: e.target.value } } }))}
                        />
                      </label>
                      {invalida && <small className="campo-erro">Use de 1 a 3650 dias.</small>}
                    </td>
                    {tiposF.map((tf) => (
                      <td key={tf.codigo} className="col-tipo">
                        <input
                          type="checkbox"
                          aria-label={`${t.nome}: pedir para ${tf.nome}`}
                          checked={r.tipos.includes(tf.codigo)}
                          disabled={salvando}
                          onChange={(e) =>
                            setRascunho((x) => ({
                              ...x,
                              docs: {
                                ...x.docs,
                                [t.codigo]: { ...r, tipos: e.target.checked ? [...r.tipos, tf.codigo] : r.tipos.filter((c) => c !== tf.codigo) },
                              },
                            }))
                          }
                        />
                      </td>
                    ))}
                    <td className="acoes">
                      {t.personalizado && (
                        <button type="button" className="botao botao-discreto botao-pequeno" disabled={mudancas > 0 || salvando} onClick={() => remover(t.codigo, t.nome)}>
                          Remover
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="linha-botoes">
        <button type="button" className="botao" disabled={mudancas === 0 || validadeInvalida || salvando} onClick={salvar}>
          {salvando ? 'Salvando' : mudancas ? `Salvar ${mudancas === 1 ? '1 alteração' : `${mudancas} alterações`}` : 'Salvar alterações'}
        </button>
        {mudancas > 0 && !salvando && (
          <button type="button" className="botao botao-discreto" onClick={carregar}>Desfazer</button>
        )}
      </div>

      <IncluirItem
        aberto={incluindo}
        tiposF={tiposF}
        aoFechar={() => setIncluindo(false)}
        aoIncluir={async (msg) => {
          setIncluindo(false);
          setOk(msg);
          await carregar();
        }}
      />

      {historico.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Histórico de alterações</h2>
          <ul className="lista-simples">
            {historico.map((h, i) => (
              <li key={i}>
                <span>
                  <strong>{h.detalhe.rotulo ?? h.detalhe.nome}</strong>
                  {' '}{descreverMudanca(h)}
                  <small className="sub">{data(h.em)}{h.quem ? ` por ${h.quem}` : ''}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const simNao = (v: boolean) => (v ? 'sim' : 'não');

function descreverMudanca(h: MudancaConfiguracao): string {
  const d = h.detalhe;
  if (h.acao === 'item_homologacao_incluido') {
    const partes = [`incluído (${NOMES_FORMATO[d.formato ?? 'texto'].toLowerCase()}`, d.obrigatorio === true ? 'obrigatório' : 'opcional'];
    if (typeof d.validade_dias === 'number') partes.push(`validade de ${d.validade_dias} dias`);
    if (Array.isArray(d.tipos)) partes.push(`para ${d.tipos.join(', ')}`);
    return `${partes.join(', ')})`;
  }
  if (h.acao === 'item_homologacao_removido') return 'removido do formulário';
  if (h.acao === 'tipo_fornecedor_incluido') {
    return `tipo incluído (colaboradores na obra: ${simNao(d.colaboradores === true)}, mensal: ${simNao(d.mensal === true)}${d.copiou_de ? `, documentos de ${d.copiou_de}` : ''})`;
  }
  if (h.acao === 'tipo_fornecedor_removido') return 'tipo removido';
  if (h.acao === 'categoria_servico_incluida') return 'categoria incluída';
  if (h.acao === 'categoria_servico_alterada') return `categoria renomeada${d.nome_antes ? ` (antes "${d.nome_antes}")` : ''}`;
  if (h.acao === 'categoria_servico_removida') return 'categoria removida';
  if (h.acao === 'tipo_fornecedor_alterado') {
    const p: string[] = [];
    if (d.nome_antes) p.push(`antes "${d.nome_antes}"`);
    if (d.descricao_mudou) p.push('descrição alterada');
    const c = d.colaboradores;
    if (c && typeof c === 'object' && c.de !== c.para) p.push(c.para ? 'passou a ter colaboradores na obra' : 'deixou de ter colaboradores na obra');
    const m = d.mensal;
    if (m && typeof m === 'object' && m.de !== m.para) p.push(m.para ? 'passou a entregar o mensal trabalhista' : 'deixou de entregar o mensal trabalhista');
    return `tipo alterado${p.length ? `: ${p.join(', ')}` : ''}`;
  }
  const partes: string[] = [];
  const o = d.obrigatorio;
  if (o && typeof o === 'object' && o.de !== o.para) partes.push(o.para ? 'passou a ser obrigatório' : 'deixou de ser obrigatório');
  const v = d.validade_dias;
  if (v && typeof v === 'object' && v.de !== v.para) {
    const txt = (n: number | null) => (n ? `${n} dias` : 'sem vencimento');
    partes.push(`validade de ${txt(v.de)} para ${txt(v.para)}`);
  }
  const t = d.tipos;
  if (t && !Array.isArray(t)) {
    if (t.entrou?.length) partes.push(`passou a ser pedido para ${t.entrou.join(', ')}`);
    if (t.saiu?.length) partes.push(`deixou de ser pedido para ${t.saiu.join(', ')}`);
  }
  return partes.join(', ');
}

function IncluirItem({
  aberto,
  tiposF,
  aoFechar,
  aoIncluir,
}: {
  aberto: boolean;
  tiposF: TipoFornecedor[];
  aoFechar: () => void;
  aoIncluir: (msg: string) => Promise<void>;
}) {
  const [pergunta, setPergunta] = useState('');
  const [pedirPara, setPedirPara] = useState<string[]>([]);
  const [formato, setFormato] = useState<FormatoCampo | 'anexo'>('texto');
  const [obrigatorio, setObrigatorio] = useState(true);
  const [validade, setValidade] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setPergunta('');
    setFormato('texto');
    setObrigatorio(true);
    setValidade('');
    setPedirPara(tiposF.map((t) => t.codigo));
    setErro(null);
  }, [aberto, tiposF]);

  const v = validade.trim();
  const validadeOk = formato !== 'anexo' || !v || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 3650);
  const pronto = pergunta.trim().length >= 3 && validadeOk && (formato !== 'anexo' || pedirPara.length > 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      await incluirItem(pergunta.trim(), formato, obrigatorio, formato === 'anexo' && v ? Number(v) : null, pedirPara);
      await aoIncluir(`"${pergunta.trim()}" incluído no formulário. Os fornecedores já veem na próxima vez que abrirem a homologação.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Incluir item no formulário" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar} noValidate>
        <label className="campo">
          <span>{formato === 'anexo' ? 'Nome do documento' : 'Pergunta'}</span>
          <input
            value={pergunta}
            maxLength={200}
            placeholder={formato === 'anexo' ? 'Ex.: Certificado ISO 9001' : 'Ex.: Quantos funcionários registrados a empresa tem?'}
            onChange={(e) => setPergunta(e.target.value)}
          />
        </label>
        <div className="campo">
          <span>Formato da resposta</span>
          <div className="opcoes">
            {(['texto', 'data', 'numero', 'anexo'] as const).map((f) => (
              <label key={f} className="opcao">
                <input type="radio" name="formato-item" checked={formato === f} onChange={() => setFormato(f)} />
                <span>{NOMES_FORMATO[f]}</span>
              </label>
            ))}
          </div>
          {formato === 'anexo' && <small className="dica">O documento entra na lista de documentos, com data de emissão, e o Suprimentos aprova ou devolve como os demais.</small>}
        </div>
        {formato === 'anexo' && (
          <label className="campo campo-validade">
            <span>Validade em dias (opcional)</span>
            <input inputMode="numeric" maxLength={4} placeholder="Não vence" value={validade} aria-invalid={!validadeOk} onChange={(e) => setValidade(e.target.value)} />
            {!validadeOk && <small className="campo-erro">Use de 1 a 3650 dias.</small>}
          </label>
        )}
        {formato === 'anexo' && (
          <fieldset className="campo-grupo">
            <legend>Pedir para</legend>
            <div className="opcoes opcoes-empilhadas">
              {tiposF.map((t) => (
                <label key={t.codigo} className="opcao">
                  <input
                    type="checkbox"
                    checked={pedirPara.includes(t.codigo)}
                    onChange={(e) => setPedirPara((l) => (e.target.checked ? [...l, t.codigo] : l.filter((c) => c !== t.codigo)))}
                  />
                  <span>{t.nome}</span>
                </label>
              ))}
            </div>
            {pedirPara.length === 0 && <small className="campo-erro">Escolha pelo menos um tipo.</small>}
          </fieldset>
        )}
        <label className="opcao">
          <input type="checkbox" checked={obrigatorio} onChange={(e) => setObrigatorio(e.target.checked)} />
          <span>Obrigatório para enviar a homologação</span>
        </label>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!pronto || enviando}>{enviando ? 'Incluindo' : 'Incluir item'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- Tipos de fornecedor

function TiposFornecedorConfig() {
  const [tipos, setTipos] = useState<TipoFornecedorResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editando, setEditando] = useState<TipoFornecedorResumo | 'novo' | null>(null);
  const [, setParams] = useSearchParams();

  const carregar = useCallback(async () => {
    try {
      setTipos(await lerResumoTipos());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function remover(t: TipoFornecedorResumo) {
    if (!window.confirm(`Remover o tipo "${t.nome}"? Ele sai da lista de documentos e não pode mais ser escolhido no cadastro.`)) return;
    setErro(null);
    setOk(null);
    try {
      await removerTipoFornecedor(t.codigo);
      setOk(`Tipo "${t.nome}" removido.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  if (!tipos && !erro) return <Carregando />;

  return (
    <>
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="barra-lista">
        <p className="apoio">
          O tipo define o que o fornecedor faz no portal: se cadastra colaboradores para a integração e se entrega o mensal trabalhista.
          Um fornecedor pode ter mais de um tipo; vale o que qualquer um deles pedir. Os documentos de cada tipo ficam em Formulário da homologação.
        </p>
        <button type="button" className="botao" onClick={() => setEditando('novo')}>Incluir tipo</button>
      </div>

      <div className="tabela-rolagem">
        <table className="tabela tabela-lista">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Colaboradores na obra</th>
              <th scope="col">Mensal trabalhista</th>
              <th scope="col">Documentos</th>
              <th scope="col">Fornecedores</th>
              <th scope="col"><span className="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {(tipos ?? []).map((t) => (
              <tr key={t.codigo}>
                <td>
                  <strong>{t.nome}</strong>
                  {t.descricao && <small className="sub">{t.descricao}</small>}
                  {t.personalizado && <small className="sub">Incluído pelo Suprimentos</small>}
                </td>
                <td>{t.colaboradores ? 'Sim' : 'Não'}</td>
                <td>{t.mensal ? 'Sim' : 'Não'}</td>
                <td>
                  <button type="button" className="botao-link" onClick={() => setParams({ tipo: t.codigo })}>
                    {t.documentos === 1 ? '1 documento' : `${t.documentos} documentos`}
                  </button>
                  <small className="sub">{t.obrigatorios === 1 ? '1 obrigatório' : `${t.obrigatorios} obrigatórios`}</small>
                </td>
                <td>{t.fornecedores}</td>
                <td className="acoes">
                  <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setEditando(t)}>Editar</button>
                  {t.personalizado && (
                    <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => remover(t)}>Remover</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditarTipo
        tipo={editando}
        tipos={tipos ?? []}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (msg) => {
          setEditando(null);
          setOk(msg);
          await carregar();
        }}
      />
    </>
  );
}

function EditarTipo({
  tipo,
  tipos,
  aoFechar,
  aoSalvar,
}: {
  tipo: TipoFornecedorResumo | 'novo' | null;
  tipos: TipoFornecedorResumo[];
  aoFechar: () => void;
  aoSalvar: (msg: string) => Promise<void>;
}) {
  const novo = tipo === 'novo';
  const atual = tipo && tipo !== 'novo' ? tipo : null;
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [colaboradores, setColaboradores] = useState(true);
  const [mensal, setMensal] = useState(true);
  const [copiarDe, setCopiarDe] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!tipo) return;
    setNome(atual?.nome ?? '');
    setDescricao(atual?.descricao ?? '');
    setColaboradores(atual?.colaboradores ?? true);
    setMensal(atual?.mensal ?? false);
    setCopiarDe(novo ? (tipos.find((t) => t.codigo === 'servico_tecnico')?.codigo ?? tipos[0]?.codigo ?? '') : '');
    setErro(null);
  }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudaExigencia = atual && atual.fornecedores > 0 && (atual.colaboradores !== colaboradores || atual.mensal !== mensal);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await salvarTipoFornecedor({ codigo: atual?.codigo ?? null, nome: nome.trim(), descricao: descricao.trim(), colaboradores, mensal: colaboradores && mensal, copiarDe: novo ? copiarDe || null : null });
      await aoSalvar(novo ? `Tipo "${nome.trim()}" incluído. Confira os documentos dele em Formulário da homologação.` : `Tipo "${nome.trim()}" salvo.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={!!tipo} titulo={novo ? 'Incluir tipo de fornecedor' : 'Editar tipo de fornecedor'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar} noValidate>
        <label className="campo">
          <span>Nome</span>
          <input value={nome} maxLength={80} placeholder="Ex.: Transporte de material" onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo">
          <span>Descrição (opcional)</span>
          <input value={descricao} maxLength={300} placeholder="O que entra neste tipo" onChange={(e) => setDescricao(e.target.value)} />
        </label>
        <label className="opcao">
          <input type="checkbox" checked={colaboradores} onChange={(e) => setColaboradores(e.target.checked)} />
          <span>
            Tem colaboradores na obra
            <small className="sub">Cadastra as pessoas, envia os documentos delas e faz a integração de segurança.</small>
          </span>
        </label>
        <label className="opcao">
          <input type="checkbox" checked={colaboradores && mensal} disabled={!colaboradores} onChange={(e) => setMensal(e.target.checked)} />
          <span>
            Entrega o mensal trabalhista
            <small className="sub">Holerites, ponto, FGTS e demais itens da medição de quem trabalhou na obra no mês.</small>
          </span>
        </label>
        {novo && (
          <label className="campo">
            <span>Começar com os documentos de</span>
            <select value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)}>
              {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
              <option value="">Nenhum (marco depois)</option>
            </select>
            <small className="dica">Depois de incluir, ajuste a lista em Formulário da homologação.</small>
          </label>
        )}
        {mudaExigencia && (
          <p className="aviso aviso-alerta">
            Vale para {atual.fornecedores === 1 ? 'o fornecedor' : `os ${atual.fornecedores} fornecedores`} deste tipo a partir de agora
            {atual.mensal && !(colaboradores && mensal) ? ': eles deixam de ser cobrados pelo mensal trabalhista' : ''}.
          </p>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={nome.trim().length < 3 || enviando}>{enviando ? 'Salvando' : novo ? 'Incluir tipo' : 'Salvar'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- Categorias de serviço

function CategoriasConfig() {
  const [lista, setLista] = useState<CategoriaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editando, setEditando] = useState<CategoriaResumo | 'nova' | null>(null);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLista(await lerResumoCategorias());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function remover(c: CategoriaResumo) {
    const aviso = c.fornecedores
      ? ` Ela sai também ${c.fornecedores === 1 ? 'do fornecedor que estava' : `dos ${c.fornecedores} fornecedores que estavam`} com ela.`
      : '';
    if (!window.confirm(`Remover a categoria "${c.nome}"?${aviso}`)) return;
    setErro(null);
    setOk(null);
    try {
      await removerCategoria(c.codigo);
      setOk(`Categoria "${c.nome}" removida.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  if (!lista && !erro) return <Carregando />;
  const t = busca.trim().toLowerCase();
  const visiveis = (lista ?? []).filter((c) => !t || c.nome.toLowerCase().includes(t));

  return (
    <>
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      <div className="barra-lista">
        <p className="apoio">
          O fornecedor marca as categorias dos serviços que presta no F.31, e o Suprimentos ajusta no cadastro. Elas viram o filtro de categoria na lista de fornecedores.
          Renomear vale para todos que já estão na categoria.
        </p>
        <button type="button" className="botao" onClick={() => setEditando('nova')}>Incluir categoria</button>
      </div>
      <div className="filtros">
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" value={busca} placeholder="Nome da categoria" onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>
      <p className="dica">{visiveis.length} de {(lista ?? []).length} categorias.</p>
      <div className="tabela-rolagem">
        <table className="tabela tabela-lista">
          <thead>
            <tr>
              <th scope="col">Categoria</th>
              <th scope="col">Fornecedores</th>
              <th scope="col"><span className="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((c) => (
              <tr key={c.codigo}>
                <th scope="row">{c.nome}</th>
                <td>{c.fornecedores}</td>
                <td className="acoes">
                  <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setEditando(c)}>Renomear</button>
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => remover(c)}>Remover</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EditarCategoria
        categoria={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (msg) => {
          setEditando(null);
          setOk(msg);
          await carregar();
        }}
      />
    </>
  );
}

function EditarCategoria({ categoria, aoFechar, aoSalvar }: { categoria: CategoriaResumo | 'nova' | null; aoFechar: () => void; aoSalvar: (msg: string) => Promise<void> }) {
  const nova = categoria === 'nova';
  const atual = categoria && categoria !== 'nova' ? categoria : null;
  const [nome, setNome] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!categoria) return;
    setNome(atual?.nome ?? '');
    setErro(null);
  }, [categoria]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await salvarCategoria(atual?.codigo ?? null, nome.trim());
      await aoSalvar(nova ? `Categoria "${nome.trim()}" incluída.` : `Categoria renomeada para "${nome.trim()}".`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={!!categoria} titulo={nova ? 'Incluir categoria de serviço' : 'Renomear categoria'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar} noValidate>
        <label className="campo">
          <span>Nome</span>
          <input value={nome} maxLength={80} placeholder="Ex.: Impermeabilização" onChange={(e) => setNome(e.target.value)} />
          {atual && atual.fornecedores > 0 && <small className="dica">Vale para {atual.fornecedores === 1 ? 'o fornecedor' : `os ${atual.fornecedores} fornecedores`} que já estão nela.</small>}
        </label>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={nome.trim().length < 3 || enviando}>{enviando ? 'Salvando' : nova ? 'Incluir categoria' : 'Salvar'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
