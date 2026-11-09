import { useEffect, useMemo, useRef, useState } from 'react';
import { Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { esquecerContagem } from '../../lib/cobrancas';
import {
  lerHistoricoRegras, lerHistoricoValidades, lerParametros, lerRegras, lerValidades, salvarParametro, salvarValidade,
  type MudancaRegra, type MudancaValidade, type Parametro, type Regras as RegrasCobranca, type ValidadeDocumento,
} from '../../lib/regras';
import { CAMPOS, exemploDoModelo, lerModelos, lerRevisoes, salvarModelo, type Modelo, type Revisao } from '../../lib/modelosEmail';

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

const GRUPOS = ['Medição mensal', 'Vencimento de documentos', 'Validade dos documentos', 'Integração', 'Envio automático (n8n)', 'Assinatura dos e-mails'];

// ---------------------------------------------------------------- Regras

export function Regras() {
  const [parametros, setParametros] = useState<Parametro[] | null>(null);
  const [validades, setValidades] = useState<ValidadeDocumento[]>([]);
  const [historico, setHistorico] = useState<{ regras: MudancaRegra[]; validades: MudancaValidade[] }>({ regras: [], validades: [] });
  const [regras, setRegras] = useState<RegrasCobranca | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const [p, v, hr, hv, r] = await Promise.all([lerParametros(), lerValidades(), lerHistoricoRegras(), lerHistoricoValidades(), lerRegras()]);
      setParametros(p);
      setValidades(v);
      setHistorico({ regras: hr, validades: hv });
      setRegras(r);
      esquecerContagem();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  if (erro) return <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>;
  if (!parametros || !regras) return <Carregando />;

  const rotulo = new Map(parametros.map((p) => [p.chave, p.rotulo ?? p.chave]));
  const nomeDoc = new Map(validades.map((v) => [v.codigo, v.nome]));
  const mudancas = [
    ...historico.regras.map((h) => ({ em: h.alterado_em, oQue: rotulo.get(h.chave) ?? h.chave, de: h.valor_anterior, para: h.valor_novo, quem: h.quem, motivo: null as string | null })),
    ...historico.validades.map((h) => ({ em: h.alterado_em, oQue: `Validade: ${nomeDoc.get(h.codigo) ?? h.codigo}`, de: h.valor_anterior, para: h.valor_novo, quem: h.quem, motivo: h.motivo })),
  ].sort((a, b) => b.em.localeCompare(a.em));

  return (
    <div className="regras">
      <div className="regras-resumo">
        <strong>Como fica a cobrança com as regras de hoje</strong>
        <ul>
          <li>
            Medição: lembrete no dia {regras.diaLembrete}, prazo no dia {regras.diaPrazo}, aviso de atraso no dia {regras.diaPrazo + 1} e pagamento retido depois do dia{' '}
            {regras.diaPrazo + regras.diasTolerancia} (ou do último dia do mês).
          </li>
          <li>
            Documentos dos liberados: aviso {regras.primeiroAviso} dias antes, {regras.segundoAviso} dias antes e no dia em que vencem.
          </li>
          <li>Integração: toda segunda-feira, com documento parado há {regras.diasParado} dias úteis ou mais.</li>
        </ul>
        <p className="sub">A mudança vale para o próximo cálculo das cobranças, no portal e no envio automático. Cada mudança fica no histórico, no fim da página.</p>
      </div>

      {GRUPOS.map((g) =>
        g === 'Validade dos documentos' ? (
          <Validades key={g} lista={validades} aoSalvar={carregar} />
        ) : (
          <section key={g} className="regras-grupo">
            <h2>{g}</h2>
            {parametros.filter((p) => p.grupo === g).map((p) => <LinhaRegra key={p.chave} p={p} aoSalvar={carregar} />)}
          </section>
        ),
      )}

      <section className="regras-grupo">
        <h2>Histórico de mudanças</h2>
        {mudancas.length === 0 && <p className="vazio">Nenhuma mudança registrada ainda.</p>}
        {mudancas.length > 0 && (
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Regra</th>
                  <th scope="col">De</th>
                  <th scope="col">Para</th>
                  <th scope="col">Quem</th>
                </tr>
              </thead>
              <tbody>
                {mudancas.slice(0, 50).map((m, i) => (
                  <tr key={i}>
                    <td>{quando(m.em)}</td>
                    <th scope="row">
                      {m.oQue}
                      {m.motivo && <small className="sub">Motivo: {m.motivo}</small>}
                    </th>
                    <td>{m.de || 'vazio'}</td>
                    <td>{m.para || 'vazio'}</td>
                    <td>{m.quem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function LinhaRegra({ p, aoSalvar }: { p: Parametro; aoSalvar: () => Promise<void> }) {
  const [valor, setValor] = useState(p.valor);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setValor(p.valor), [p.valor]);
  const mudou = valor.trim() !== p.valor;
  const id = `regra-${p.chave}`;

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await salvarParametro(p.chave, valor);
      setMsg({ tipo: 'ok', texto: 'Salvo.' });
      await aoSalvar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: mensagemDeErro(e as Error) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="regra">
      <div className="regra-texto">
        <label htmlFor={id}>{p.rotulo}</label>
        {p.descricao && <small>{p.descricao}</small>}
      </div>
      <div className="regra-campo">
        {p.tipo === 'sim_nao' ? (
          <select id={id} value={valor} onChange={(e) => { setValor(e.target.value); setMsg(null); }}>
            <option value="nao">Não</option>
            <option value="sim">Sim</option>
          </select>
        ) : (
          <input
            id={id}
            className={p.tipo === 'inteiro' ? 'regra-numero' : 'regra-texto-campo'}
            type={p.tipo === 'inteiro' ? 'number' : p.tipo === 'email' ? 'email' : 'text'}
            min={p.minimo ?? undefined}
            max={p.maximo ?? undefined}
            placeholder={p.tipo === 'empresas' ? 'todas, ou CNPJs separados por vírgula' : p.tipo === 'email' ? 'vazio: envio real' : undefined}
            value={valor}
            onChange={(e) => { setValor(e.target.value); setMsg(null); }}
          />
        )}
        {p.unidade && <span className="regra-unidade">{p.unidade}</span>}
        <button className="botao botao-secundario regra-salvar" type="button" style={{ visibility: mudou ? 'visible' : 'hidden' }} disabled={salvando} onClick={() => void salvar()}>
          Salvar
        </button>
      </div>
      {msg && <p className={msg.tipo === 'ok' ? 'regra-ok' : 'regra-erro'} role={msg.tipo === 'erro' ? 'alert' : 'status'}>{msg.texto}</p>}
    </div>
  );
}

// Validade dos exames, treinamentos e documentos da empresa: muda o vencimento calculado a partir da emissão.
function Validades({ lista, aoSalvar }: { lista: ValidadeDocumento[]; aoSalvar: () => Promise<void> }) {
  const colaborador = lista.filter((v) => v.grupo === 'colaborador');
  const outros = lista.filter((v) => v.grupo !== 'colaborador');
  return (
    <section className="regras-grupo">
      <h2>Validade dos documentos</h2>
      <p className="sub">
        Dias a partir da data de emissão. A mudança recalcula o vencimento de todos os documentos desse tipo, inclusive os já aprovados, e exige um motivo.
      </p>
      <h3 className="regras-subtitulo">Exames e treinamentos do colaborador</h3>
      {colaborador.map((v) => <LinhaValidade key={v.codigo} v={v} aoSalvar={aoSalvar} />)}
      {outros.length > 0 && <h3 className="regras-subtitulo">Documentos da empresa e da obra</h3>}
      {outros.map((v) => <LinhaValidade key={v.codigo} v={v} aoSalvar={aoSalvar} />)}
    </section>
  );
}

function LinhaValidade({ v, aoSalvar }: { v: ValidadeDocumento; aoSalvar: () => Promise<void> }) {
  const [dias, setDias] = useState(String(v.validade_dias));
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setDias(String(v.validade_dias)), [v.validade_dias]);
  const mudou = dias.trim() !== String(v.validade_dias);
  const n = Number(dias);
  const valido = Number.isInteger(n) && n >= 1 && n <= 3650 && motivo.trim().length >= 3;
  const id = `validade-${v.codigo}`;

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await salvarValidade(v.codigo, n, motivo);
      setMotivo('');
      setMsg({ tipo: 'ok', texto: 'Salvo.' });
      await aoSalvar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: mensagemDeErro(e as Error) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="regra">
      <div className="regra-texto">
        <label htmlFor={id}>{v.nome}</label>
        <small>{v.validade_dias >= 365 && v.validade_dias % 365 === 0 ? `Hoje: ${v.validade_dias / 365 === 1 ? '1 ano' : `${v.validade_dias / 365} anos`}` : `Hoje: ${v.validade_dias} dias`}</small>
      </div>
      <div className="regra-campo">
        <input id={id} className="regra-numero" type="number" min={1} max={3650} value={dias} onChange={(e) => { setDias(e.target.value); setMsg(null); }} />
        <span className="regra-unidade">dias</span>
        <button className="botao botao-secundario regra-salvar" type="button" style={{ visibility: mudou ? 'visible' : 'hidden' }} disabled={salvando || !valido} onClick={() => void salvar()}>
          Salvar
        </button>
      </div>
      {mudou && (
        <label className="campo regra-motivo">
          <span>Motivo da mudança</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: orientação da Segurança do Trabalho" />
        </label>
      )}
      {msg && <p className={msg.tipo === 'ok' ? 'regra-ok' : 'regra-erro'} role={msg.tipo === 'erro' ? 'alert' : 'status'}>{msg.texto}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- E-mails

export function ModelosEmail() {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [regras, setRegras] = useState<RegrasCobranca | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [alterado, setAlterado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const [m, r] = await Promise.all([lerModelos(), lerRegras()]);
      setModelos(m);
      setRegras(r);
      esquecerContagem();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  if (erro) return <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>;
  if (!modelos || !regras) return <Carregando />;
  const atual = modelos.find((m) => m.tipo === sel) ?? modelos[0];

  function escolher(tipo: string) {
    if (tipo === atual.tipo) return;
    if (alterado && !window.confirm('Há mudanças não salvas neste e-mail. Trocar mesmo assim?')) return;
    setAlterado(false);
    setSel(tipo);
  }

  return (
    <div className="modelos">
      <nav className="modelos-lista" aria-label="E-mails">
        {modelos.map((m) => (
          <button key={m.tipo} type="button" className="modelo-item" aria-current={m.tipo === atual.tipo ? 'true' : undefined} onClick={() => escolher(m.tipo)}>
            <strong>{m.nome}</strong>
            <small>Para: {m.para}</small>
            <span className="modelo-etiquetas">
              <span className="etiqueta">Rev. {m.revisao}</span>
              {!m.ativo && <span className="etiqueta etiqueta-alerta">Desligado</span>}
            </span>
          </button>
        ))}
      </nav>
      <FormModelo key={atual.tipo} m={atual} regras={regras} aoMudar={setAlterado} aoSalvar={async () => { setAlterado(false); await carregar(); }} />
    </div>
  );
}

function FormModelo({ m, regras, aoMudar, aoSalvar }: { m: Modelo; regras: RegrasCobranca; aoMudar: (v: boolean) => void; aoSalvar: () => Promise<void> }) {
  const [assunto, setAssunto] = useState(m.assunto);
  const [corpo, setCorpo] = useState(m.corpo);
  const [ativo, setAtivo] = useState(m.ativo);
  const [observacao, setObservacao] = useState('');
  const [revisoes, setRevisoes] = useState<Revisao[] | null>(null);
  const [verRevisoes, setVerRevisoes] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const texto = useRef<HTMLTextAreaElement>(null);
  const mudou = assunto !== m.assunto || corpo !== m.corpo || ativo !== m.ativo;

  useEffect(() => aoMudar(mudou), [mudou, aoMudar]);
  useEffect(() => {
    if (verRevisoes && !revisoes) lerRevisoes(m.tipo).then(setRevisoes).catch((e) => setMsg({ tipo: 'erro', texto: mensagemDeErro(e as Error) }));
  }, [verRevisoes, revisoes, m.tipo]);

  const dias = m.tipo === 'vencimento_segundo' ? regras.segundoAviso : regras.primeiroAviso;
  const exemplo = useMemo(() => exemploDoModelo({ assunto, corpo }, dias), [assunto, corpo, dias]);
  const desconhecidos = [...new Set((`${assunto} ${corpo}`.match(/\{[^{}]*\}/g) ?? []).filter((c) => !m.campos.includes(c)))];

  function inserir(campo: string) {
    const t = texto.current;
    if (!t) return setCorpo((c) => `${c}${campo}`);
    const ini = t.selectionStart ?? corpo.length;
    const fim = t.selectionEnd ?? corpo.length;
    setCorpo(corpo.slice(0, ini) + campo + corpo.slice(fim));
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(ini + campo.length, ini + campo.length);
    });
  }

  function usarRevisao(r: Revisao) {
    setAssunto(r.assunto);
    setCorpo(r.corpo);
    setAtivo(r.ativo);
    setObservacao(`Volta ao texto da Rev. ${r.revisao}`);
    setMsg({ tipo: 'ok', texto: `Texto da Rev. ${r.revisao} carregado. Confira e clique em Salvar para ele valer.` });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await salvarModelo(m.tipo, { assunto, corpo, ativo, observacao });
      await aoSalvar();
      setObservacao('');
      setRevisoes(null);
      setMsg({ tipo: 'ok', texto: 'Salvo. As próximas cobranças, no portal e no envio automático, já usam este texto.' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: mensagemDeErro(e as Error) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modelo-form">
      <div className="modelo-cabecalho">
        <h2>{m.nome}</h2>
        <p className="sub">
          Quando sai: {m.quando}. Para: {m.para}.
          <br />
          Em vigor: Rev. {m.revisao}, salva em {quando(m.atualizado_em)}.
        </p>
      </div>
      {msg && <Mensagem tipo={msg.tipo} aoFechar={() => setMsg(null)}>{msg.texto}</Mensagem>}

      <label className="opcao-linha">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Enviar este e-mail
      </label>
      {!ativo && <p className="aviso-modelo">Desligado: esta cobrança deixa de aparecer na aba Cobranças e não sai no envio automático.</p>}

      <label className="campo">
        <span>Assunto</span>
        <input value={assunto} onChange={(e) => setAssunto(e.target.value)} />
      </label>
      <label className="campo">
        <span>Texto</span>
        <textarea ref={texto} rows={18} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
      </label>

      <div className="modelo-campos">
        <span>Campos deste e-mail (clique para inserir no texto):</span>
        <div className="chips">
          {m.campos.map((c) => (
            <button key={c} type="button" className="chip" title={CAMPOS[c]?.descricao} onClick={() => inserir(c)}>
              {c}
            </button>
          ))}
        </div>
        <ul className="modelo-legenda">
          {m.campos.map((c) => (
            <li key={c}>
              <code>{c}</code> {CAMPOS[c]?.descricao}
            </li>
          ))}
        </ul>
      </div>
      {desconhecidos.length > 0 && (
        <p className="regra-erro" role="alert">
          {desconhecidos.join(', ')} não {desconhecidos.length === 1 ? 'é campo' : 'são campos'} deste e-mail. Use só os campos da lista.
        </p>
      )}

      <label className="campo">
        <span>O que mudou nesta revisão (opcional)</span>
        <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: prazo de conferência passou para 2 dias úteis" />
      </label>
      <div className="modelo-acoes">
        <button className="botao" type="button" disabled={salvando || !mudou || desconhecidos.length > 0 || !assunto.trim() || !corpo.trim()} onClick={() => void salvar()}>
          Salvar como Rev. {m.revisao + 1}
        </button>
        {mudou && (
          <button className="botao botao-discreto" type="button" onClick={() => { setAssunto(m.assunto); setCorpo(m.corpo); setAtivo(m.ativo); setObservacao(''); }}>
            Desfazer
          </button>
        )}
      </div>

      <section className="modelo-previa" aria-label="Exemplo do e-mail">
        <h3>Exemplo com dados fictícios</h3>
        <p className="modelo-previa-assunto">{exemplo.assunto}</p>
        <p className="modelo-previa-corpo">{exemplo.corpo}</p>
      </section>

      <details className="ajuda modelo-revisoes" open={verRevisoes} onToggle={(e) => setVerRevisoes((e.target as HTMLDetailsElement).open)}>
        <summary>Revisões deste e-mail</summary>
        {!revisoes && verRevisoes && <Carregando />}
        {revisoes && (
          <ol className="lista-revisoes">
            {revisoes.map((r) => (
              <li key={r.revisao}>
                <div>
                  <strong>Rev. {r.revisao}</strong> · {quando(r.salvo_em)} · {r.quem}
                  {!r.ativo && ' · desligado'}
                  {r.observacao && <small className="sub">{r.observacao}</small>}
                </div>
                {r.revisao !== m.revisao && (
                  <button className="botao botao-discreto" type="button" onClick={() => usarRevisao(r)}>
                    Usar este texto
                  </button>
                )}
                {r.revisao === m.revisao && <span className="etiqueta">Em vigor</span>}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
