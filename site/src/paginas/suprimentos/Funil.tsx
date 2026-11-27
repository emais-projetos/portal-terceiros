import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Barras, Cartao } from '../../componentes/Graficos';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import { diasUteis } from '../../lib/indicadores';
import { lerTiposFornecedor, type TipoFornecedor } from '../../lib/tiposFornecedor';
import { ETAPAS, NOME_ETAPA, chegou, desde, etapaAtual, lerFunil, media, tempos, type Etapa, type ItemFunil } from '../../lib/funil';

// Funil da homologação: quantos estão em cada etapa, quanto tempo cada passagem leva, quem está parado e o que mais volta.

const PERIODOS = [
  ['90', 'Últimos 90 dias'],
  ['180', 'Últimos 6 meses'],
  ['365', 'Últimos 12 meses'],
  ['tudo', 'Desde o início'],
] as const;
const LIMITES = [5, 10, 15];
const EM_ANDAMENTO: Etapa[] = ['convidado', 'preenchendo', 'enviado', 'devolvido', 'homologado'];

const ler = (chave: string, padrao: string) => {
  try {
    return window.localStorage.getItem(chave) ?? padrao;
  } catch {
    return padrao;
  }
};
const guardar = (chave: string, valor: string) => {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento: só não lembra */
  }
};

const dias = (v: number | null) => (v === null ? '-' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${v === 1 ? 'dia útil' : 'dias úteis'}`);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

export function FunilHomologacao() {
  const [lista, setLista] = useState<ItemFunil[] | null>(null);
  const [tiposF, setTiposF] = useState<TipoFornecedor[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(() => ler('funil-periodo', 'tudo'));
  const [tipo, setTipo] = useState('');
  const [limite, setLimite] = useState(() => Number(ler('funil-limite', '5')) || 5);
  const hoje = hojeIso();

  useEffect(() => {
    Promise.all([lerFunil(), lerTiposFornecedor()])
      .then(([l, t]) => {
        setLista(l);
        setTiposF(t);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const filtrada = useMemo(() => {
    const corte = periodo === 'tudo' ? null : Date.now() - Number(periodo) * 86400000;
    return (lista ?? []).filter((x) => (!corte || new Date(x.convidada_em).getTime() >= corte) && (!tipo || (x.tipos ?? []).includes(tipo)));
  }, [lista, periodo, tipo]);

  const calc = useMemo(() => {
    const comEtapa = filtrada.map((x) => {
      const etapa = etapaAtual(x);
      const em = desde(x, etapa);
      return { x, etapa, em, dias: diasUteis(em, hoje) };
    });
    const porEtapa = new Map<Etapa, typeof comEtapa>();
    comEtapa.forEach((c) => porEtapa.set(c.etapa, [...(porEtapa.get(c.etapa) ?? []), c]));
    const parados = comEtapa
      .filter((c) => EM_ANDAMENTO.includes(c.etapa) && c.x.situacao_fornecedor !== 'inativo' && c.dias >= limite)
      .sort((a, b) => b.dias - a.dias);
    const ch = filtrada.map(chegou);
    const conta = (k: keyof ReturnType<typeof chegou>) => ch.filter((c) => c[k]).length;
    const funil = {
      convidado: conta('convidado'),
      comecou: conta('comecou'),
      enviou: conta('enviou'),
      homologou: conta('homologou'),
      liberou: conta('liberou'),
    };
    const t = tempos(filtrada);
    const decididos = comEtapa.filter((c) => ['homologado', 'liberado', 'reprovado'].includes(c.etapa)).length;
    const docs = new Map<string, number>();
    filtrada.forEach((x) => x.documentos_devolvidos.forEach((d) => docs.set(d.documento, (docs.get(d.documento) ?? 0) + 1)));
    const devolucoes = filtrada
      .flatMap((x) => x.eventos.filter((e) => e.acao === 'homologacao_devolvida' || e.acao === 'homologacao_reprovada').map((e) => ({ x, e })))
      .sort((a, b) => b.e.em.localeCompare(a.e.em))
      .slice(0, 10);
    return { comEtapa, porEtapa, parados, funil, t, decididos, docs, devolucoes };
  }, [filtrada, limite, hoje]);

  if (!lista && !erro) return <Pagina titulo="Funil da homologação"><Carregando /></Pagina>;

  const { porEtapa, parados, funil, t, decididos, docs, devolucoes } = calc;
  const andamento = EM_ANDAMENTO.reduce((s, e) => s + (porEtapa.get(e)?.length ?? 0), 0);
  const homologados = (porEtapa.get('homologado')?.length ?? 0) + (porEtapa.get('liberado')?.length ?? 0);

  return (
    <Pagina
      titulo="Funil da homologação"
      apoio="Do convite à liberação no portal: quantos estão em cada etapa, quanto tempo cada passagem leva, quem está parado e o que mais volta para correção. Tempos em dias úteis."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}

      <div className="filtros">
        <label className="campo">
          <span>Convidados em</span>
          <select value={periodo} onChange={(e) => { setPeriodo(e.target.value); guardar('funil-periodo', e.target.value); }}>
            {PERIODOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Tipo de fornecedor</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {tiposF.map((x) => <option key={x.codigo} value={x.codigo}>{x.nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Parado há</span>
          <select value={limite} onChange={(e) => { setLimite(Number(e.target.value)); guardar('funil-limite', e.target.value); }}>
            {LIMITES.map((n) => <option key={n} value={n}>{n} dias úteis ou mais</option>)}
          </select>
        </label>
      </div>

      {filtrada.length === 0 ? (
        <p className="vazio">Nenhum fornecedor convidado no filtro escolhido.</p>
      ) : (
        <>
          <div className="cartoes">
            <Cartao rotulo="Em andamento" valor={String(andamento)} apoio={`de ${filtrada.length} convidados`} />
            <Cartao rotulo="Parados" valor={String(parados.length)} apoio={`há ${limite} dias úteis ou mais`} alerta={parados.length > 0} />
            <Cartao rotulo="Convite até homologar" valor={dias(media(t.total))} apoio={t.total.length ? `média de ${t.total.length} homologados` : 'nenhum homologado ainda'} />
            <Cartao rotulo="Aprovação" valor={pct(homologados, decididos)} apoio={decididos ? `${homologados} de ${decididos} decididos` : 'nenhum decidido ainda'} />
          </div>

          <div className="graficos grade-2">
            <Barras
              titulo="Até onde chegaram"
              formatar={(v) => String(v)}
              dados={[
                { rotulo: 'Convidados', valor: funil.convidado },
                { rotulo: 'Começaram a preencher', valor: funil.comecou, dica: `${pct(funil.comecou, funil.convidado)} dos convidados` },
                { rotulo: 'Enviaram para análise', valor: funil.enviou, dica: `${pct(funil.enviou, funil.comecou)} dos que começaram` },
                { rotulo: 'Homologados', valor: funil.homologou, dica: `${pct(funil.homologou, funil.enviou)} dos que enviaram` },
                { rotulo: 'Liberados no portal', valor: funil.liberou, dica: `${pct(funil.liberou, funil.homologou)} dos homologados` },
              ]}
              detalhe={<p className="grafico-nota">Cada barra conta quem chegou pelo menos até aquela etapa. Passe o mouse para ver a passagem de uma etapa para a outra.</p>}
            />
            <Barras
              titulo="Tempo médio de cada passagem (dias úteis)"
              formatar={(v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              dados={(
                [
                  ['Convite até o primeiro envio', t.convite_envio, 'envios'],
                  ['Análise do Suprimentos', t.analise, 'análises'],
                  ['Correção pelo fornecedor', t.correcao, 'correções'],
                  ['Homologado até o portal', t.homologado_portal, 'liberações'],
                ] as [string, number[], string][]
              )
                .filter(([, l]) => l.length > 0)
                .map(([rotulo, l, o]) => ({ rotulo, valor: media(l) ?? 0, dica: `média de ${l.length} ${o}` }))}
              detalhe={
                <p className="grafico-nota">
                  Só passagens já concluídas. {t.rodadas.length ? `Os homologados precisaram, em média, de ${(media(t.rodadas) ?? 1).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} envio(s).` : ''}
                </p>
              }
            />
          </div>

          <section className="bloco">
            <h2 className="bloco-titulo">Agora em cada etapa</h2>
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Etapa</th>
                    <th scope="col">Fornecedores</th>
                    <th scope="col">Parados</th>
                    <th scope="col">Com quem está</th>
                  </tr>
                </thead>
                <tbody>
                  {ETAPAS.map((e) => {
                    const l = porEtapa.get(e.etapa) ?? [];
                    const p = parados.filter((c) => c.etapa === e.etapa).length;
                    return (
                      <tr key={e.etapa}>
                        <th scope="row">
                          {e.nome}
                          <small className="sub">{e.explica}</small>
                        </th>
                        <td className="num" data-rotulo="Fornecedores">{l.length}</td>
                        <td className="num" data-rotulo="Parados">{EM_ANDAMENTO.includes(e.etapa) ? (p ? <span className="texto-alerta">{p}</span> : 0) : '-'}</td>
                        <td data-rotulo="Com quem está">{e.comQuem === 'fornecedor' ? 'Fornecedor' : e.comQuem === 'suprimentos' ? 'Suprimentos' : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bloco">
            <h2 className="bloco-titulo">Parados há {limite} dias úteis ou mais</h2>
            {parados.length === 0 ? (
              <p className="vazio">Ninguém parado.</p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela tabela-lista">
                  <thead>
                    <tr>
                      <th scope="col">Fornecedor</th>
                      <th scope="col">Etapa</th>
                      <th scope="col">Desde</th>
                      <th scope="col">Dias úteis</th>
                      <th scope="col">Com quem está</th>
                      <th scope="col"><span className="sr">Abrir</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parados.map((c) => (
                      <tr key={c.x.empresa_id}>
                        <th scope="row">{c.x.razao_social}</th>
                        <td className="num" data-rotulo="Etapa">{NOME_ETAPA[c.etapa]}</td>
                        <td className="num" data-rotulo="Desde">{data(c.em.slice(0, 10))}</td>
                        <td className="num" data-rotulo="Dias úteis">{c.dias}</td>
                        <td data-rotulo="Com quem está">{ETAPAS.find((e) => e.etapa === c.etapa)?.comQuem === 'fornecedor' ? 'Fornecedor' : 'Suprimentos'}</td>
                        <td className="acoes">
                          <Link className="botao botao-secundario botao-pequeno" to={`/homologacao?empresa=${c.x.empresa_id}`}>Abrir</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="graficos grade-2 graficos-fim">
            <Barras
              titulo="Documentos mais devolvidos"
              formatar={(v) => String(v)}
              dados={[...docs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([rotulo, valor]) => ({ rotulo, valor }))}
            />
            <figure className="grafico">
              <figcaption className="grafico-titulo">Últimas devoluções e reprovações</figcaption>
              {devolucoes.length === 0 ? (
                <p className="dica">Nenhuma no filtro escolhido.</p>
              ) : (
                <ul className="lista-simples">
                  {devolucoes.map(({ x, e }, i) => (
                    <li key={i}>
                      <span>
                        <strong>{x.razao_social}</strong>: {e.acao === 'homologacao_reprovada' ? 'reprovado' : 'devolvido'}
                        {e.texto ? `, "${e.texto}"` : ''}
                        <small className="sub">{data(e.em.slice(0, 10))}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </figure>
          </div>
        </>
      )}
    </Pagina>
  );
}
