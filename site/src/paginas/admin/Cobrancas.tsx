import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { useSessao } from '../../lib/sessao';
import { data, hojeIso } from '../../lib/formato';
import { copiarTexto, linkOutlook } from '../../lib/admin';
import { Farol, SeloFrente } from '../../componentes/Farois';
import type { Cor } from '../../lib/farois';
import { guardarAssinatura, guardarDestinatariosObra, montarFila, registrarCobrancas, titulosGrupo, type Assinatura, type Cobranca, type Fila, type TipoCobranca } from '../../lib/cobrancas';

const ORDEM: TipoCobranca[] = ['lembrete_medicao', 'notificacao_medicao', 'cobranca_medicao', 'retencao_obra', 'vencimento_documento', 'integracao_documentos'];
const LIMITE_LINK = 1900;

export function Cobrancas() {
  const { usuario } = useSessao();
  const [fila, setFila] = useState<Fila | null>(null);
  const [para, setPara] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [feitas, setFeitas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const f = await montarFila(usuario?.nome ?? '');
      setFila(f);
      setPara(new Map(f.cobrancas.map((c) => [c.chave, c.para])));
      setFeitas(new Set());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [usuario?.nome]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const abertas = useMemo(() => (fila?.cobrancas ?? []).filter((c) => !feitas.has(c.chave)), [fila, feitas]);

  async function registrar(lista: Cobranca[], situacao: 'aberta_no_outlook' | 'dispensada') {
    setErro(null);
    try {
      for (const c of lista) {
        if (c.obraId && situacao === 'aberta_no_outlook') await guardarDestinatariosObra(c.obraId, para.get(c.chave) ?? '');
      }
      await registrarCobrancas(lista, situacao, para);
      setFeitas((s) => new Set([...s, ...lista.map((c) => c.chave)]));
      setOk(
        situacao === 'dispensada'
          ? `${lista.length === 1 ? 'Cobrança dispensada' : `${lista.length} cobranças dispensadas`}. ${lista.length === 1 ? 'Ela não volta' : 'Elas não voltam'} para a lista.`
          : `E-mail para ${lista[0].titulo} aberto no Outlook. Confira e clique em enviar.`,
      );
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  // Uma linha por fornecedor (medição, documentos e integração juntos) e uma por obra (aviso de retenção).
  const grupos = useMemo(() => agrupar(abertas), [abertas]);

  // Filtros: por tipo (contagem de linhas em cada botão) e busca pelo nome do fornecedor ou da obra.
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const porFiltro = useMemo(() => {
    const m = new Map<Filtro, Grupo[]>();
    for (const f of FILTROS) {
      const doTipo = f.tipos ? abertas.filter((c) => f.tipos!.includes(c.tipo)) : abertas;
      const gs = f.tipos ? agrupar(doTipo) : grupos;
      m.set(f.id, f.id === 'urgentes' ? gs.filter((g) => g.urgente) : gs);
    }
    return m;
  }, [abertas, grupos]);
  const termo = semAcento(busca.trim());
  const visiveis = (porFiltro.get(filtro) ?? []).filter((g) => !termo || semAcento(g.titulo).includes(termo));
  const fornecedores = visiveis.filter((g) => g.tipo === 'fornecedor');
  const obras = visiveis.filter((g) => g.tipo === 'obra');
  const [aberta, setAberta] = useState<string | null>(null);

  const linha = (g: Grupo) => (
    <LinhaCobranca
      key={g.id}
      grupo={g}
      aberta={aberta === g.id}
      aoAlternar={() => setAberta(aberta === g.id ? null : g.id)}
      para={para}
      aoMudarPara={(valor) => setPara((m) => { const n = new Map(m); g.cobrancas.forEach((c) => n.set(c.chave, valor)); return n; })}
      aoAbrir={(c) => registrar([c], 'aberta_no_outlook')}
      aoDispensar={(lista) => registrar(lista, 'dispensada')}
      aoCopiar={(c) => copiarTexto(c.corpo).then(() => setOk('Texto copiado.')).catch(() => setErro('O navegador não deixou copiar. Abra "Ver o texto", selecione e copie.'))}
    />
  );

  return (
    <Pagina
      titulo="Cobranças do dia"
      apoio="Uma linha por fornecedor com tudo o que há para cobrar dele. Clique no fornecedor para ver cada e-mail, conferir e abrir no Outlook. O que foi aberto ou dispensado sai da lista."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!fila && !erro && <Carregando />}

      {fila && (
        <>
          <div className="resumo-farois">
            <div className="resumo-farol resumo-vermelho">
              <span className="resumo-rotulo">Urgente</span>
              <strong>{grupos.filter((g) => g.urgente).length}</strong>
              <span>pagamento retido, aviso à obra ou documento já vencido</span>
            </div>
            <div className="resumo-farol resumo-amarelo">
              <span className="resumo-rotulo">Lembretes e avisos</span>
              <strong>{grupos.filter((g) => !g.urgente).length}</strong>
              <span>prazo da medição, documentos vencendo e integração</span>
            </div>
            <div className="resumo-farol resumo-verde">
              <span className="resumo-rotulo">E-mails prontos hoje</span>
              <strong>{abertas.length}</strong>
              <span>{data(hojeIso())}. Próxima rodada da medição: {data(fila.proxima)}</span>
            </div>
          </div>

          <div className="calendario-cobrancas">
            <details className="ajuda">
              <summary>Calendário das cobranças</summary>
              <p>
                Medição: lembrete no dia {fila.regras.diaLembrete}, prazo no dia {fila.regras.diaPrazo}, notificação de atraso no dia seguinte com tolerância de{' '}
                {fila.regras.diasTolerancia} dias, e retenção com aviso à obra depois disso. Documentos dos liberados: {fila.regras.primeiroAviso} dias antes,{' '}
                {fila.regras.segundoAviso} dias antes e quando vencem. Integração: toda segunda-feira. Os dias e os textos dos e-mails ficam em Acessos, nas abas Regras e
                E-mails.
              </p>
            </details>
            <EditarAssinatura
              atual={fila.assinatura}
              aoSalvar={async (a) => {
                setErro(null);
                try {
                  await guardarAssinatura(a);
                  setOk('Assinatura atualizada.');
                  await carregar();
                } catch (e) {
                  setErro(mensagemDeErro(e as Error));
                }
              }}
            />
            <details className="ajuda">
              <summary>O botão não abre o Outlook do computador?</summary>
              <p>
                O botão abre o programa de e-mail padrão do Windows. Para ser o Outlook: Configurações &gt; Aplicativos &gt; Aplicativos padrão &gt; Outlook, e em
                MAILTO escolha Outlook. Se abrir o Gmail no navegador, remova o Gmail em chrome://settings/handlers (no Edge, edge://settings/content/handlers).
              </p>
            </details>
          </div>

          {abertas.length > 0 && (
            <>
              <div className="filtros filtros-cobrancas">
                <div className="chips" role="group" aria-label="Filtrar cobranças">
                  {FILTROS.map((f) => (
                    <button key={f.id} type="button" className="chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
                      {f.rotulo} <span className="chip-numero">{porFiltro.get(f.id)?.length ?? 0}</span>
                    </button>
                  ))}
                </div>
                <label className="campo campo-compacto campo-busca">
                  <span className="sr">Buscar</span>
                  <input type="search" placeholder="Buscar fornecedor ou obra" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </label>
              </div>
              {visiveis.length === 0 && (
                <p className="vazio">
                  Nenhuma cobrança com este filtro.{' '}
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => { setFiltro('todos'); setBusca(''); }}>
                    Ver todas
                  </button>
                </p>
              )}
            </>
          )}

          {fornecedores.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">
                Fornecedores <span className="sub">{fornecedores.length}</span>
              </h2>
              <ul className="lista-farois">{fornecedores.map(linha)}</ul>
            </section>
          )}

          {obras.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">
                Avisos de retenção para as obras <span className="sub">{obras.length}</span>
              </h2>
              <p className="dica">{titulosGrupo(fila.regras).retencao_obra.apoio}</p>
              <ul className="lista-farois">{obras.map(linha)}</ul>
            </section>
          )}

          {abertas.length === 0 && (
            <p className="vazio">Tudo em dia por aqui. Os próximos e-mails aparecem sozinhos quando chegar a data.</p>
          )}
        </>
      )}
    </Pagina>
  );
}

// ---------------------------------------------------------------- Filtros

type Filtro = 'todos' | 'urgentes' | 'medicao' | 'documentos' | 'integracao' | 'obras';

// Com tipos, a linha do fornecedor mostra só os e-mails daquele tipo (e "Dispensar tudo" vale só para eles).
const FILTROS: { id: Filtro; rotulo: string; tipos?: TipoCobranca[] }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'urgentes', rotulo: 'Urgentes' },
  { id: 'medicao', rotulo: 'Medição', tipos: ['lembrete_medicao', 'notificacao_medicao', 'cobranca_medicao'] },
  { id: 'documentos', rotulo: 'Documentos', tipos: ['vencimento_documento'] },
  { id: 'integracao', rotulo: 'Integração', tipos: ['integracao_documentos'] },
  { id: 'obras', rotulo: 'Avisos às obras', tipos: ['retencao_obra'] },
];

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ---------------------------------------------------------------- Agrupamento

type Frente = 'Medição' | 'Documentos' | 'Integração';

type Grupo = {
  id: string;
  tipo: 'fornecedor' | 'obra';
  titulo: string;
  urgente: boolean;
  frentes: { nome: Frente; cor: Cor }[];
  cobrancas: Cobranca[];
};

const frenteDe = (t: TipoCobranca): Frente => (t === 'vencimento_documento' ? 'Documentos' : t === 'integracao_documentos' ? 'Integração' : 'Medição');
const ORDEM_FRENTES: Frente[] = ['Medição', 'Documentos', 'Integração'];

// Nome curto do e-mail dentro da linha do fornecedor.
const rotuloTipo: Record<TipoCobranca, string> = {
  lembrete_medicao: 'Medição: lembrete do prazo',
  notificacao_medicao: 'Medição: notificação de atraso',
  cobranca_medicao: 'Medição: pagamento retido',
  retencao_obra: 'Aviso de retenção para a engenharia',
  vencimento_documento: 'Documentos vencendo',
  integracao_documentos: 'Integração: colaboradores sem liberação',
};

function agrupar(lista: Cobranca[]): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const c of lista) {
    const ehObra = c.tipo === 'retencao_obra';
    const id = ehObra ? `obra|${c.obraId ?? c.chave}` : `empresa|${c.registros[0]?.empresa_id ?? c.titulo}`;
    const g = mapa.get(id) ?? { id, tipo: ehObra ? 'obra' : 'fornecedor', titulo: c.titulo, urgente: false, frentes: [], cobrancas: [] };
    g.cobrancas.push(c);
    g.urgente ||= !!c.urgente;
    mapa.set(id, g);
  }
  for (const g of mapa.values()) {
    g.cobrancas.sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));
    if (g.tipo === 'fornecedor') {
      g.frentes = ORDEM_FRENTES.flatMap((nome) => {
        const doTipo = g.cobrancas.filter((c) => frenteDe(c.tipo) === nome);
        return doTipo.length ? [{ nome, cor: (doTipo.some((c) => c.urgente) ? 'vermelho' : 'amarelo') as Cor }] : [];
      });
    }
  }
  return [...mapa.values()].sort((a, b) => Number(b.urgente) - Number(a.urgente) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

// ---------------------------------------------------------------- Linha

function LinhaCobranca({
  grupo, aberta, aoAlternar, para, aoMudarPara, aoAbrir, aoDispensar, aoCopiar,
}: {
  grupo: Grupo;
  aberta: boolean;
  aoAlternar: () => void;
  para: Map<string, string>;
  aoMudarPara: (valor: string) => void;
  aoAbrir: (c: Cobranca) => void;
  aoDispensar: (lista: Cobranca[]) => void;
  aoCopiar: (c: Cobranca) => void;
}) {
  const idDetalhe = `cobranca-${grupo.id.replace(/[^a-z0-9]/gi, '')}`;
  const destino = para.get(grupo.cobrancas[0].chave) ?? '';
  const semEmail = !destino.includes('@');
  const ehObra = grupo.tipo === 'obra';
  const n = grupo.cobrancas.length;
  const resumo = grupo.cobrancas.map((c) => (ehObra ? c.resumo : `${frenteDe(c.tipo)}: ${c.resumo}`)).join(' · ');
  const cor: Cor = grupo.urgente ? 'vermelho' : 'amarelo';

  return (
    <li className={`linha-farol${aberta ? ' linha-farol-aberta' : ''}`}>
      <button type="button" className="linha-farol-botao" aria-expanded={aberta} aria-controls={idDetalhe} onClick={aoAlternar}>
        <Farol cor={cor} grande rotulo={grupo.urgente ? 'Urgente' : 'Lembrete'} />
        <span className="linha-farol-texto">
          <strong>{grupo.titulo}</strong>
          <span className="linha-farol-manchete">{resumo}</span>
          {semEmail && <small className="campo-erro">{ehObra ? 'Sem destinatário da engenharia' : 'Sem e-mail cadastrado'}</small>}
        </span>
        <span className="linha-farol-frentes">
          {grupo.frentes.map((f) => (
            <SeloFrente key={f.nome} nome={f.nome} cor={f.cor} />
          ))}
          <span className="contagem-emails">{n === 1 ? '1 e-mail' : `${n} e-mails`}</span>
        </span>
      </button>

      {aberta && (
        <div className="linha-farol-detalhe" id={idDetalhe}>
          <div className="cobranca-para">
            <label className="campo campo-compacto">
              <span>Para</span>
              <input
                type="text"
                value={destino}
                placeholder={ehObra ? 'e-mail da engenharia da obra' : 'e-mail do fornecedor'}
                aria-invalid={semEmail}
                onChange={(e) => aoMudarPara(e.target.value)}
              />
              {semEmail && (
                <small className="campo-erro">
                  {ehObra ? 'Informe quem recebe nesta obra. Fica guardado para os próximos meses.' : 'Empresa sem e-mail cadastrado. Informe para abrir.'}
                </small>
              )}
            </label>
            {n > 1 && (
              <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoDispensar(grupo.cobrancas)}>
                Dispensar {ehObra ? 'todos desta obra' : 'tudo deste fornecedor'}
              </button>
            )}
          </div>

          <ul className="tarefas">
            {grupo.cobrancas.map((c) => {
              const link = linkOutlook(destino, c.assunto, c.corpo);
              return (
                <li key={c.chave} className="tarefa tarefa-cobranca">
                  <span className="tarefa-texto">
                    <Farol cor={c.urgente ? 'vermelho' : 'amarelo'} />
                    <span>
                      <strong>{ehObra ? `Medição: ${c.resumo}` : rotuloTipo[c.tipo]}</strong>
                      {!ehObra && c.resumo}
                      <span className="cobranca-assunto-linha">Assunto: {c.assunto}</span>
                    </span>
                  </span>
                  <span className="linha-botoes">
                    {semEmail ? (
                      <button type="button" className="botao botao-pequeno" disabled>Abrir no Outlook</button>
                    ) : (
                      <a className="botao botao-pequeno" href={link} onClick={() => aoAbrir(c)}>
                        Abrir no Outlook
                      </a>
                    )}
                    <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => aoCopiar(c)}>
                      Copiar texto
                    </button>
                    <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoDispensar([c])}>
                      Dispensar
                    </button>
                  </span>
                  <details className="cobranca-ver">
                    <summary>Ver o texto</summary>
                    <pre className="cobranca-texto">{c.corpo}</pre>
                    {link.length > LIMITE_LINK && <small className="dica">Texto longo: se o Outlook abrir o e-mail cortado, use "Copiar texto" e cole.</small>}
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

function EditarAssinatura({ atual, aoSalvar }: { atual: Assinatura; aoSalvar: (a: Assinatura) => void }) {
  const [setor, setSetor] = useState(atual.setor);
  const [contato, setContato] = useState(atual.contato);
  useEffect(() => {
    setSetor(atual.setor);
    setContato(atual.contato);
  }, [atual]);
  return (
    <details className="ajuda">
      <summary>Assinatura dos e-mails: {atual.setor}{atual.contato ? `, ${atual.contato}` : ''}</summary>
      <form
        className="em-linha"
        onSubmit={(e) => {
          e.preventDefault();
          aoSalvar({ setor, contato });
        }}
      >
        <label className="campo campo-compacto">
          <span>Setor</span>
          <input type="text" value={setor} onChange={(e) => setSetor(e.target.value)} />
        </label>
        <label className="campo campo-compacto campo-busca">
          <span>E-mail e telefone</span>
          <input type="text" value={contato} onChange={(e) => setContato(e.target.value)} placeholder="gente10@emais.com | (17) 3512-4716" />
        </label>
        <button className="botao botao-secundario" type="submit">Salvar</button>
      </form>
      <p>O nome de quem abre o e-mail entra acima do setor.</p>
    </details>
  );
}
