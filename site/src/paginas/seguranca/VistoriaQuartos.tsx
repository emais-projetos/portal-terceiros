import { useEffect, useMemo, useState } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { mensagemDeErro } from '../../lib/supabase';
import {
  MODELO_QUARTO, NOMES_CAMA, itemDoBeliche, itemDosOcupantes, lerModelo, lerMoradoresObra, lerQuartosAnteriores, novoItem,
  type Cama, type ItemVistoria, type MoradorObra, type Pessoa, type Quarto, type Vistoria,
} from '../../lib/seguranca';
import { ItemEdicao, ListaAssinaturas } from './ItensVistoria';

const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Quem corrige o item no alojamento na obra: limpeza e organização vão para as empresas do quarto; o resto é da Emais.
export function responsavelItemQuarto(it: ItemVistoria, moradores: Pessoa[]): string {
  if (!it.quarto || !itemDosOcupantes(it.texto)) return 'Emais (engenharia da obra)';
  const empresas = [...new Set(moradores.filter((p) => p.quarto === it.quarto && p.empresa).map((p) => p.empresa as string))];
  return empresas.length ? empresas.join(', ') : 'Emais (quarto sem morador de fornecedor)';
}

type Props = {
  v: Vistoria;
  obraId: string;
  alojamentoId: string;
  links: Record<string, string>;
  temItensEnviados: boolean;
  aoLinks: (novos: Record<string, string>) => void;
  atualizar: (fn: (x: Vistoria) => Vistoria, gravarJa?: boolean) => void;
  mudarItem: (n: number, p: Partial<ItemVistoria>, gravarJa?: boolean) => void;
  aoAssinar: (i: number) => void;
  aoErro: (m: string) => void;
};

// Alojamento na obra: um bloco por quarto (moradores, tipo de cama e checklist) e as áreas comuns no fim.
export function EdicaoQuartos({ v, obraId, alojamentoId, links, temItensEnviados, aoLinks, atualizar, mudarItem, aoAssinar, aoErro }: Props) {
  const [moradoresObra, setMoradoresObra] = useState<MoradorObra[] | null>(null);
  const [anteriores, setAnteriores] = useState<Awaited<ReturnType<typeof lerQuartosAnteriores>>>([]);
  const [itensQuarto, setItensQuarto] = useState<string[] | null>(null);
  const [incluindo, setIncluindo] = useState(false);
  const [tirando, setTirando] = useState<string | null>(null);

  useEffect(() => {
    lerMoradoresObra(obraId, null).then(setMoradoresObra).catch((e) => aoErro(mensagemDeErro(e as Error)));
    lerQuartosAnteriores(alojamentoId, v.id).then(setAnteriores).catch(() => setAnteriores([]));
    lerModelo(MODELO_QUARTO).then((m) => setItensQuarto(m?.itens ?? [])).catch((e) => aoErro(mensagemDeErro(e as Error)));
  }, [obraId, alojamentoId, v.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const comuns = v.itens.map((it, n) => ({ it, n })).filter((x) => !x.it.quarto);

  function incluirQuarto(nome: string) {
    const anterior = anteriores.find((q) => sem(q.nome) === sem(nome));
    const liberados = new Set((moradoresObra ?? []).map((m) => m.id));
    // Quem estava no quarto na vistoria anterior e continua liberado na obra (ou foi incluído à mão) já vem marcado.
    const herdados = (anterior?.moradores ?? [])
      .filter((p) => !p.colaborador_id || liberados.has(p.colaborador_id))
      .map((p): Pessoa => ({ colaborador_id: p.colaborador_id ?? null, nome: p.nome, empresa_id: p.empresa_id ?? null, empresa: p.empresa ?? null, quarto: nome, assinatura: null }));
    const cama = anterior?.cama ?? '';
    atualizar((x) => {
      const jaMarcados = new Set(herdados.map((p) => p.colaborador_id).filter(Boolean));
      const posComuns = x.itens.findIndex((it) => !it.quarto);
      const novos = (itensQuarto ?? []).map((t) => ({ ...novoItem(t, nome), ...(cama === 'simples' && itemDoBeliche(t) ? { status: 'na' as const, auto_na: true } : {}) }));
      const itens = posComuns < 0 ? [...x.itens, ...novos] : [...x.itens.slice(0, posComuns), ...novos, ...x.itens.slice(posComuns)];
      return {
        ...x,
        quartos: [...x.quartos, { nome, cama }],
        itens,
        // Cada colaborador fica em um quarto só: se já estava em outro nesta vistoria, sai de lá.
        funcionarios: [...x.funcionarios.filter((p) => !p.colaborador_id || !jaMarcados.has(p.colaborador_id)), ...herdados],
      };
    });
    setIncluindo(false);
  }

  function mudarCama(nome: string, cama: Cama | '') {
    atualizar((x) => ({
      ...x,
      quartos: x.quartos.map((q) => (q.nome === nome ? { ...q, cama } : q)),
      itens: x.itens.map((it) => {
        if (it.quarto !== nome || !itemDoBeliche(it.texto)) return it;
        if (cama === 'simples') return { ...it, status: 'na', auto_na: true, recomendacao: '', prazo: null };
        return it.auto_na ? { ...it, status: null, auto_na: false } : it;
      }),
    }));
  }

  function renomear(antigo: string, novo: string) {
    atualizar((x) => ({
      ...x,
      quartos: x.quartos.map((q) => (q.nome === antigo ? { ...q, nome: novo } : q)),
      itens: x.itens.map((it) => (it.quarto === antigo ? { ...it, quarto: novo } : it)),
      funcionarios: x.funcionarios.map((p) => (p.quarto === antigo ? { ...p, quarto: novo } : p)),
    }));
  }

  function tirarQuarto(nome: string) {
    atualizar((x) => ({
      ...x,
      quartos: x.quartos.filter((q) => q.nome !== nome),
      itens: x.itens.filter((it) => it.quarto !== nome),
      funcionarios: x.funcionarios.filter((p) => p.quarto !== nome),
    }));
    setTirando(null);
  }

  function marcarMorador(quarto: string, m: MoradorObra, marcar: boolean) {
    atualizar((x) => ({
      ...x,
      funcionarios: marcar
        ? [...x.funcionarios.filter((p) => p.colaborador_id !== m.id), { colaborador_id: m.id, nome: m.nome, cargo: m.funcao ?? undefined, empresa_id: m.empresa_id, empresa: m.empresa, quarto, assinatura: null }]
        : x.funcionarios.filter((p) => !(p.colaborador_id === m.id && p.quarto === quarto)),
    }));
  }

  const mudarPessoa = (i: number, p: Partial<Pessoa>, gravarJa = false) =>
    atualizar((x) => ({ ...x, funcionarios: x.funcionarios.map((pp, k) => (k === i ? { ...pp, ...p } : pp)) }), gravarJa);

  return (
    <>
      {v.quartos.length === 0 && (
        <section className="bloco">
          <p className="vazio">Nenhum quarto incluído ainda. Use "+ Incluir quarto" para cada quarto que vai vistoriar hoje.</p>
        </section>
      )}

      {v.quartos.map((q) => {
        const itens = v.itens.map((it, n) => ({ it, n })).filter((x) => x.it.quarto === q.nome);
        const visiveis = itens.filter((x) => !(q.cama === 'simples' && itemDoBeliche(x.it.texto)));
        const moradores = v.funcionarios.map((p, i) => ({ p, i })).filter((x) => x.p.quarto === q.nome);
        const respondidos = itens.filter((x) => x.it.status).length;
        return (
          <section key={q.nome} className="bloco bloco-quarto">
            <div className="barra-lista">
              <h2 className="bloco-titulo">{q.nome}</h2>
              <span className="sub">{respondidos} de {itens.length} respondidos</span>
            </div>
            <div className="grade-2">
              <label className="campo">
                <span>Nome do quarto</span>
                <input
                  defaultValue={q.nome}
                  onBlur={(e) => {
                    const novo = e.target.value.trim();
                    if (!novo || novo === q.nome) return void (e.target.value = q.nome);
                    if (v.quartos.some((o) => sem(o.nome) === sem(novo))) {
                      aoErro(`Já existe ${novo} nesta vistoria.`);
                      e.target.value = q.nome;
                      return;
                    }
                    renomear(q.nome, novo);
                  }}
                />
              </label>
              <label className="campo">
                <span>Tipo de cama</span>
                <select value={q.cama} onChange={(e) => mudarCama(q.nome, e.target.value as Cama | '')}>
                  <option value="">Escolha</option>
                  {(Object.keys(NOMES_CAMA) as Cama[]).map((c) => <option key={c} value={c}>{NOMES_CAMA[c]}</option>)}
                </select>
              </label>
            </div>
            {q.cama === 'simples' && <p className="dica">Sem beliche: o item da proteção do beliche fica como "não se aplica".</p>}

            <h3 className="detalhe-subtitulo">Quem está usando o quarto</h3>
            <EscolherMoradores
              quarto={q.nome}
              moradoresObra={moradoresObra}
              funcionarios={v.funcionarios}
              aoMarcar={(m, marcar) => marcarMorador(q.nome, m, marcar)}
            />

            <ol className="itens-inspecao">
              {visiveis.map(({ it, n }, k) => (
                <ItemEdicao
                  key={n}
                  it={it}
                  n={n}
                  numero={k + 1}
                  idVistoria={v.id}
                  links={links}
                  responsavel={responsavelItemQuarto(it, v.funcionarios)}
                  aoMudar={(p, gravarJa) => mudarItem(n, p, gravarJa)}
                  aoLinks={aoLinks}
                />
              ))}
            </ol>

            <h3 className="detalhe-subtitulo">Assinaturas do quarto</h3>
            <ListaAssinaturas
              pessoas={moradores}
              links={links}
              comCargo={false}
              comPresenca
              rotuloIncluir="Incluir nome à mão (quem não está no portal)"
              aoIncluir={() => atualizar((x) => ({ ...x, funcionarios: [...x.funcionarios, { colaborador_id: null, nome: '', quarto: q.nome, assinatura: null }] }))}
              aoMudar={(i, p) => mudarPessoa(i, p, 'ausente' in p || 'nao_assina' in p)}
              aoRemover={(i) => atualizar((x) => ({ ...x, funcionarios: x.funcionarios.filter((_, k) => k !== i) }))}
              aoAssinar={aoAssinar}
            />
            {!temItensEnviados && (
              <div className="linha-botoes">
                <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setTirando(q.nome)}>Tirar este quarto da vistoria</button>
              </div>
            )}
          </section>
        );
      })}

      {!temItensEnviados && (
        <div className="linha-botoes">
          <button type="button" className="botao botao-secundario" disabled={!itensQuarto || !moradoresObra} onClick={() => setIncluindo(true)}>+ Incluir quarto</button>
        </div>
      )}
      {temItensEnviados && <p className="dica">Esta vistoria já tem itens enviados para correção, então os quartos não mudam. Para outro quarto, faça uma vistoria nova.</p>}

      <section className="bloco">
        <div className="barra-lista">
          <h2 className="bloco-titulo">Áreas comuns (banheiros, chuveiros e refeição)</h2>
          <span className="sub">{comuns.filter((x) => x.it.status).length} de {comuns.length} respondidos</span>
        </div>
        <p className="dica">A proporção de chuveiros conta todos os moradores dos quartos: {v.funcionarios.length} nesta vistoria.</p>
        <ol className="itens-inspecao">
          {comuns.map(({ it, n }, k) => (
            <ItemEdicao
              key={n}
              it={it}
              n={n}
              numero={k + 1}
              idVistoria={v.id}
              links={links}
              responsavel="Emais (engenharia da obra)"
              aoMudar={(p, gravarJa) => mudarItem(n, p, gravarJa)}
              aoLinks={aoLinks}
            />
          ))}
        </ol>
      </section>

      <IncluirQuarto
        aberto={incluindo}
        existentes={v.quartos}
        anteriores={anteriores}
        aoFechar={() => setIncluindo(false)}
        aoConfirmar={incluirQuarto}
      />
      <Dialogo aberto={!!tirando} titulo={`Tirar ${tirando ?? ''} da vistoria?`} aoFechar={() => setTirando(null)}>
        <div className="formulario formulario-largo">
          <p>As respostas, as fotos e os moradores marcados neste quarto saem da vistoria.</p>
          <div className="linha-botoes">
            <button type="button" className="botao botao-perigo" onClick={() => tirando && tirarQuarto(tirando)}>Tirar o quarto</button>
            <button type="button" className="botao botao-discreto" onClick={() => setTirando(null)}>Cancelar</button>
          </div>
        </div>
      </Dialogo>
    </>
  );
}

// Lista dos colaboradores liberados na obra, com busca. Quem já está em outro quarto aparece com o nome do quarto.
export function EscolherMoradores({
  quarto, moradoresObra, funcionarios, aoMarcar,
}: {
  quarto: string | null;
  moradoresObra: MoradorObra[] | null;
  funcionarios: Pessoa[];
  aoMarcar: (m: MoradorObra, marcar: boolean) => void;
}) {
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const b = sem(busca);
    return (moradoresObra ?? []).filter((m) => !b || sem(`${m.nome} ${m.empresa}`).includes(b));
  }, [moradoresObra, busca]);
  if (!moradoresObra) return <p className="sub">Carregando os colaboradores da obra</p>;
  if (!moradoresObra.length) return <p className="dica">Nenhum colaborador liberado nesta obra. Inclua o nome à mão.</p>;
  const ondeEsta = (id: string) => funcionarios.find((p) => p.colaborador_id === id)?.quarto ?? null;
  const marcados = funcionarios.filter((p) => p.colaborador_id && (quarto === null || p.quarto === quarto)).length;
  return (
    <div className="escolher-moradores">
      <label className="campo">
        <span>Buscar colaborador liberado na obra ({marcados} {marcados === 1 ? 'marcado' : 'marcados'})</span>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou empresa" />
      </label>
      <ul className="lista-marcar lista-curta">
        {lista.map((m) => {
          const esta = funcionarios.some((p) => p.colaborador_id === m.id);
          const onde = ondeEsta(m.id);
          const aqui = esta && (quarto === null || onde === quarto);
          return (
            <li key={m.id}>
              <label>
                <input type="checkbox" checked={aqui} onChange={() => aoMarcar(m, !aqui)} />
                <span>
                  {m.nome}
                  <small className="sub">
                    {m.empresa}
                    {m.funcao ? `, ${m.funcao.toLowerCase()}` : ''}
                    {esta && !aqui && onde ? `. Está no ${onde}` : ''}
                  </small>
                </span>
              </label>
            </li>
          );
        })}
        {lista.length === 0 && <li className="sub">Ninguém com esse nome.</li>}
      </ul>
    </div>
  );
}

function IncluirQuarto({
  aberto, existentes, anteriores, aoFechar, aoConfirmar,
}: {
  aberto: boolean;
  existentes: Quarto[];
  anteriores: { nome: string; moradores: Pessoa[] }[];
  aoFechar: () => void;
  aoConfirmar: (nome: string) => void;
}) {
  const [nome, setNome] = useState('');
  useEffect(() => setNome(''), [aberto]);
  const repetido = existentes.some((q) => sem(q.nome) === sem(nome));
  const anterior = anteriores.find((q) => sem(q.nome) === sem(nome));
  const sugestoes = anteriores.filter((q) => !existentes.some((e) => sem(e.nome) === sem(q.nome)));
  return (
    <Dialogo aberto={aberto} titulo="Incluir quarto" aoFechar={aoFechar}>
      <form
        className="formulario formulario-largo"
        onSubmit={(e) => {
          e.preventDefault();
          if (nome.trim() && !repetido) aoConfirmar(anterior?.nome ?? nome.trim());
        }}
      >
        {sugestoes.length > 0 && (
          <div className="campo">
            <span>Quartos das vistorias anteriores</span>
            <div className="linha-botoes">
              {sugestoes.map((q) => (
                <button key={q.nome} type="button" className={`botao botao-pequeno ${sem(nome) === sem(q.nome) ? '' : 'botao-secundario'}`} onClick={() => setNome(q.nome)}>
                  {q.nome}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="campo">
          <span>Nome do quarto</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Quarto 1" autoFocus />
        </label>
        {repetido && <p className="aviso aviso-alerta">Este quarto já está na vistoria.</p>}
        {anterior && anterior.moradores.length > 0 && (
          <p className="dica">
            Na última vistoria: {anterior.moradores.map((p) => p.nome).join(', ')}. Eles já vêm marcados; ajuste quem saiu ou entrou.
          </p>
        )}
        <div className="linha-botoes">
          <button type="submit" className="botao" disabled={!nome.trim() || repetido}>Incluir</button>
          <button type="button" className="botao botao-discreto" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
