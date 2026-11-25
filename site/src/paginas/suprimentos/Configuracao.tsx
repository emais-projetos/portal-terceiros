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
import { ModelosEmail } from '../admin/RegrasEmails';

const ABAS = [
  ['formulario', 'Formulário da homologação'],
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
      apoio="O que o fornecedor precisa preencher e enviar na homologação e os textos dos e-mails da homologação."
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
      {aba === 'emails' ? <ModelosEmail /> : <FormularioHomologacao />}
    </Pagina>
  );
}

type Rascunho = { campos: Record<string, boolean>; docs: Record<string, { obrigatorio: boolean; validade: string }> };

function FormularioHomologacao() {
  const [campos, setCampos] = useState<CampoHomologacao[] | null>(null);
  const [tipos, setTipos] = useState<TipoHomologacao[]>([]);
  const [historico, setHistorico] = useState<MudancaConfiguracao[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho>({ campos: {}, docs: {} });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [incluindo, setIncluindo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [c, t, h] = await Promise.all([lerCamposHomologacao(), lerTiposHomologacao(true), lerHistoricoConfiguracao()]);
      setCampos(c.filter((x) => x.ativo));
      setTipos(t.filter((x) => x.ativo));
      setHistorico(h);
      setRascunho({
        campos: Object.fromEntries(c.filter((x) => x.ativo).map((x) => [x.campo, x.obrigatorio])),
        docs: Object.fromEntries(t.filter((x) => x.ativo).map((x) => [x.codigo, { obrigatorio: x.obrigatorio, validade: x.validade_dias ? String(x.validade_dias) : '' }])),
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
    return r && (r.obrigatorio !== t.obrigatorio || (r.validade.trim() ? Number(r.validade) : null) !== t.validade_dias);
  });
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
        await configurarDocumento(t.codigo, r.obrigatorio, r.validade.trim() ? Number(r.validade) : null);
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
        </p>
        <div className="tabela-rolagem">
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Obrigatório</th>
                <th scope="col">Validade (dias)</th>
                <th scope="col"><span className="sr">Remover</span></th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => {
                const r = rascunho.docs[t.codigo] ?? { obrigatorio: t.obrigatorio, validade: '' };
                const v = r.validade.trim();
                const invalida = !!v && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 3650);
                return (
                  <tr key={t.codigo}>
                    <th scope="row">
                      {t.nome}
                      {t.tipo_portal && <small className="sub">Aprovado aqui, entra também em Documentos da empresa</small>}
                      {t.personalizado && <small className="sub">Incluído pelo Suprimentos</small>}
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

function descreverMudanca(h: MudancaConfiguracao): string {
  const d = h.detalhe;
  if (h.acao === 'item_homologacao_incluido') {
    const partes = [`incluído (${NOMES_FORMATO[d.formato ?? 'texto'].toLowerCase()}`, d.obrigatorio === true ? 'obrigatório' : 'opcional'];
    if (typeof d.validade_dias === 'number') partes.push(`validade de ${d.validade_dias} dias`);
    return `${partes.join(', ')})`;
  }
  if (h.acao === 'item_homologacao_removido') return 'removido do formulário';
  const partes: string[] = [];
  const o = d.obrigatorio;
  if (o && typeof o === 'object' && o.de !== o.para) partes.push(o.para ? 'passou a ser obrigatório' : 'deixou de ser obrigatório');
  const v = d.validade_dias;
  if (v && typeof v === 'object' && v.de !== v.para) {
    const txt = (n: number | null) => (n ? `${n} dias` : 'sem vencimento');
    partes.push(`validade de ${txt(v.de)} para ${txt(v.para)}`);
  }
  return partes.join(', ');
}

function IncluirItem({ aberto, aoFechar, aoIncluir }: { aberto: boolean; aoFechar: () => void; aoIncluir: (msg: string) => Promise<void> }) {
  const [pergunta, setPergunta] = useState('');
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
    setErro(null);
  }, [aberto]);

  const v = validade.trim();
  const validadeOk = formato !== 'anexo' || !v || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 3650);
  const pronto = pergunta.trim().length >= 3 && validadeOk;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      await incluirItem(pergunta.trim(), formato, obrigatorio, formato === 'anexo' && v ? Number(v) : null);
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
