import { useEffect, useMemo, useState } from 'react';
import { Barras, Cartao, Colunas } from '../../componentes/Graficos';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import {
  classificar, indicadoresAlojamento, indicadoresCanteiro, indicadoresMaquinas, lerDadosIndicadores, lerMetas, type FichaIndicador, type VistoriaIndicador,
} from '../../lib/indicadoresSeguranca';
import type { Alojamento, Fornecedor, Maquina, NaoConformidade } from '../../lib/seguranca';
import type { ObraDoPainel } from '../../lib/painelObra';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
export const porcento = (v: number) => `${Math.round(v)}%`;

export function inicioPeriodo(meses: number) {
  const [a, m] = hojeIso().split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 - (meses - 1), 1));
  return d.toISOString().slice(0, 10);
}

// Meses do período (AAAA-MM), do mais antigo ao atual, para o gráfico mostrar também os meses sem vistoria.
export function mesesDesde(desde: string): string[] {
  const fim = hojeIso().slice(0, 7);
  const r: string[] = [];
  let [a, m] = desde.split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    const k = `${a}-${String(m).padStart(2, '0')}`;
    r.push(k);
    if (k >= fim) break;
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return r;
}

export function SeletorPeriodo({ meses, aoMudar }: { meses: number; aoMudar: (m: number) => void }) {
  return (
    <label className="campo">
      <span>Período</span>
      <select value={meses} onChange={(e) => aoMudar(Number(e.target.value))}>
        <option value={1}>Este mês</option>
        <option value={3}>Últimos 3 meses</option>
        <option value={6}>Últimos 6 meses</option>
        <option value={12}>Últimos 12 meses</option>
      </select>
    </label>
  );
}

// Painel da aba Inspeções: conformidade dos alojamentos (indicador principal) e das máquinas.
// Com várias obras ("Todas as obras"), mostra o total e uma tabela por obra; clicar na obra abre o painel dela.
export function PainelConformidade({
  obraId, obras, aoEscolherObra, alojamentos, maquinas, fornecedores, ncs, temCanteiro,
}: {
  temCanteiro: boolean;
  obraId: string | string[];
  obras?: ObraDoPainel[];
  aoEscolherObra?: (id: string) => void;
  alojamentos: Alojamento[];
  maquinas: Maquina[];
  fornecedores: Fornecedor[];
  ncs: NaoConformidade[];
}) {
  const [meses, setMeses] = useState(3);
  const desde = inicioPeriodo(meses);
  const [dados, setDados] = useState<{ vistorias: VistoriaIndicador[]; fichas: FichaIndicador[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [metas, setMetas] = useState({ alojamento: 90, canteiro: 85 });

  useEffect(() => {
    lerMetas().then(setMetas).catch(() => undefined);
  }, []);

  const chave = Array.isArray(obraId) ? obraId.join(',') : obraId;
  useEffect(() => {
    setDados(null);
    setErro(null);
    lerDadosIndicadores(obraId, desde).then(setDados).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [chave, desde]); // eslint-disable-line react-hooks/exhaustive-deps

  const varias = !!obras && obras.length > 1;
  const nomeObra = useMemo(() => new Map((obras ?? []).map((o) => [o.id, o.nome])), [obras]);
  // Com várias obras, o nome do alojamento leva a obra junto nos gráficos.
  const alojNomes = useMemo(
    () => (varias ? alojamentos.map((a) => ({ ...a, nome: `${a.nome} (${nomeObra.get(a.obra_id) ?? 'obra'})` })) : alojamentos),
    [varias, alojamentos, nomeObra],
  );
  const aloj = useMemo(() => (dados ? indicadoresAlojamento(dados.vistorias, alojNomes, fornecedores, ncs, desde) : null), [dados, alojNomes, fornecedores, ncs, desde]);
  const porObra = useMemo(() => {
    if (!dados || !varias || !obras) return null;
    const obraDoAloj = new Map(alojamentos.map((a) => [a.id, a.obra_id]));
    const obraDaMaq = new Map(maquinas.map((m) => [m.id, m.obra_id]));
    return obras
      .map((o) => {
        const al = alojamentos.filter((a) => a.obra_id === o.id);
        const mq = maquinas.filter((m) => m.obra_id === o.id);
        const a = indicadoresAlojamento(
          dados.vistorias.filter((v) => v.obra_id === o.id),
          al,
          fornecedores,
          ncs.filter((n) => obraDoAloj.get(n.seg_vistorias?.alojamento_id ?? '') === o.id),
          desde,
        );
        const m = indicadoresMaquinas(dados.fichas.filter((f) => obraDaMaq.get(f.maquina_id) === o.id), mq, desde);
        const c = indicadoresCanteiro(dados.vistorias.filter((v) => v.obra_id === o.id), desde);
        return { obra: o, a, m, c };
      })
      .sort((x, y) => (x.a.conformidade ?? 999) - (y.a.conformidade ?? 999) || x.obra.nome.localeCompare(y.obra.nome, 'pt-BR'));
  }, [dados, varias, obras, alojamentos, maquinas, fornecedores, ncs, desde]);
  const cant = useMemo(() => (dados ? indicadoresCanteiro(dados.vistorias, desde) : null), [dados, desde]);
  const maq = useMemo(() => (dados ? indicadoresMaquinas(dados.fichas, maquinas, desde) : null), [dados, maquinas, desde]);

  return (
    <>
      <div className="filtros">
        <label className="campo">
          <span>Período</span>
          <select value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            <option value={1}>Este mês</option>
            <option value={3}>Últimos 3 meses</option>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
          </select>
        </label>
        <p className="dica">
          Desde {data(desde)}. Conformidade = itens "Sim" sobre os itens aplicáveis ("Não se aplica" fica fora), a mesma regra da nota da vistoria.
          Metas em Regras: alojamento {metas.alojamento}%, canteiro {metas.canteiro}%.
        </p>
      </div>
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      {!dados && !erro && <Carregando />}

      {porObra && (
        <section className="bloco">
          <h2 className="bloco-titulo">Por obra</h2>
          <p className="dica">Total das {porObra.length} obras abaixo. Clique na obra para ver o painel dela, as inspeções e os cadastros.</p>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Obra</th>
                  <th scope="col">Alojamentos</th>
                  <th scope="col">Vistoriados</th>
                  <th scope="col">Itens a regularizar</th>
                  <th scope="col">Máquinas</th>
                  <th scope="col">Checklist no mês</th>
                </tr>
              </thead>
              <tbody>
                {porObra.map(({ obra, a, m, c }) => (
                  <tr key={obra.id} className="linha-clicavel" onClick={() => aoEscolherObra?.(obra.id)}>
                    <th scope="row">
                      <button type="button" className="link-forte botao-link" onClick={(e) => { e.stopPropagation(); aoEscolherObra?.(obra.id); }}>{obra.nome}</button>
                      {c.concluidas > 0 && <small className="sub">canteiro {c.conformidade === null ? '-' : porcento(c.conformidade)}</small>}
                    </th>
                    <td>
                      {a.conformidade === null ? (
                        <span className="sub">sem vistoria</span>
                      ) : (
                        <span className={`selo ${a.conformidade < metas.alojamento ? 'selo-erro' : 'selo-ok'}`}>{porcento(a.conformidade)}</span>
                      )}
                      {a.concluidas > 0 && <small className="sub"> {a.concluidas} {a.concluidas === 1 ? 'vistoria' : 'vistorias'}</small>}
                    </td>
                    <td>
                      {a.ativos ? `${a.vistoriados} de ${a.ativos}` : <span className="sub">sem alojamento</span>}
                      {a.semVistoria30 > 0 && <small className="sub texto-alerta">{a.semVistoria30} sem vistoria há 30 dias</small>}
                    </td>
                    <td>
                      {a.ncsAbertas}
                      {a.ncsVencidas > 0 && <small className="sub texto-erro">{a.ncsVencidas} {a.ncsVencidas === 1 ? 'vencido' : 'vencidos'}</small>}
                    </td>
                    <td>{m.conformidade === null ? <span className="sub">sem checklist</span> : porcento(m.conformidade)}</td>
                    <td>{m.ativas ? `${m.comChecklistNoMes} de ${m.ativas}` : <span className="sub">sem máquina</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {aloj && (
        <section className="bloco">
          <h2 className="bloco-titulo">Alojamentos{varias ? ': todas as obras' : ''}</h2>
          <div className="cartoes">
            <Cartao
              rotulo="Conformidade das vistorias"
              valor={aloj.conformidade === null ? 'Sem vistoria' : porcento(aloj.conformidade)}
              alerta={aloj.conformidade !== null && aloj.conformidade < metas.alojamento}
              apoio={aloj.conformidade === null ? `Nenhuma vistoria concluída no período. Meta: ${metas.alojamento}%.` : `Meta: ${metas.alojamento}%. ${classificar(aloj.conformidade)}, média de ${aloj.concluidas} ${aloj.concluidas === 1 ? 'vistoria concluída' : 'vistorias concluídas'}.`}
            />
            <Cartao
              rotulo="Alojamentos vistoriados"
              valor={`${aloj.vistoriados} de ${aloj.ativos}`}
              alerta={aloj.semVistoria30 > 0}
              apoio={aloj.semVistoria30 ? `${aloj.semVistoria30} sem vistoria nos últimos 30 dias.` : 'Todos vistoriados nos últimos 30 dias.'}
            />
            <Cartao
              rotulo="Itens a regularizar"
              valor={String(aloj.ncsAbertas)}
              alerta={aloj.ncsVencidas > 0}
              apoio={`${aloj.ncsVencidas} com prazo vencido. ${aloj.ncsParaAvaliar} ${aloj.ncsParaAvaliar === 1 ? 'resposta esperando' : 'respostas esperando'} avaliação.`}
            />
            <Cartao rotulo="Vistorias em andamento" valor={String(aloj.emAndamento)} apoio="Começadas e ainda não concluídas." />
          </div>
          <div className="duas-colunas graficos">
            <Colunas
              titulo="Conformidade por mês"
              dados={aloj.meses.map((m) => ({
                rotulo: mesCurto(m.mes),
                valor: m.pct,
                dica: m.qtd ? `${m.qtd} ${m.qtd === 1 ? 'vistoria' : 'vistorias'}, ${m.sim} de ${m.aplicaveis} itens em ordem (${classificar(m.pct)})` : 'Sem vistoria concluída',
              }))}
              formatar={porcento}
              maximo={100}
              meta={metas.alojamento}
              rotuloMeta={`meta ${metas.alojamento}%`}
              vazio="-"
            />
            <Barras
              titulo="Conformidade por alojamento (última vistoria)"
              dados={aloj.porAlojamento.map((a) => ({ rotulo: a.nome, valor: a.pct, dica: `${classificar(a.pct)}, vistoria de ${data(a.data)}${a.pct < metas.alojamento ? ', abaixo da meta' : ''}` }))}
              formatar={porcento}
            />
            <Barras
              titulo="Conformidade por responsável"
              dados={aloj.porResponsavel.map((r) => ({ rotulo: r.nome, valor: r.pct, dica: `${r.qtd} ${r.qtd === 1 ? 'vistoria' : 'vistorias'}` }))}
              formatar={porcento}
            />
            <Barras
              titulo='Perguntas com mais "Não"'
              dados={aloj.maisReprovadas.map((p) => ({ rotulo: p.texto, valor: p.qtd }))}
              formatar={(v) => `${v}x`}
            />
          </div>
        </section>
      )}

      {cant && (temCanteiro || cant.concluidas > 0 || cant.emAndamento > 0) && (
        <section className="bloco">
          <h2 className="bloco-titulo">Canteiro{varias ? ': todas as obras' : ''}</h2>
          <div className="cartoes">
            <Cartao
              rotulo="Conformidade das vistorias"
              valor={cant.conformidade === null ? 'Sem vistoria' : porcento(cant.conformidade)}
              alerta={cant.conformidade !== null && cant.conformidade < metas.canteiro}
              apoio={cant.conformidade === null ? `Nenhuma vistoria concluída no período. Meta: ${metas.canteiro}%.` : `Meta: ${metas.canteiro}%. ${classificar(cant.conformidade)}, média de ${cant.concluidas} ${cant.concluidas === 1 ? 'vistoria' : 'vistorias'}.`}
            />
            <Cartao rotulo="Última vistoria" valor={cant.ultima ? data(cant.ultima) : 'Nenhuma'} apoio={`${cant.emAndamento} em andamento.`} />
          </div>
          <div className="duas-colunas graficos">
            <Colunas
              titulo="Conformidade do canteiro por mês"
              dados={cant.meses.map((m) => ({
                rotulo: mesCurto(m.mes),
                valor: m.pct,
                dica: m.qtd ? `${m.qtd} ${m.qtd === 1 ? 'vistoria' : 'vistorias'}, ${m.sim} de ${m.aplicaveis} itens em ordem` : 'Sem vistoria concluída',
              }))}
              formatar={porcento}
              maximo={100}
              meta={metas.canteiro}
              rotuloMeta={`meta ${metas.canteiro}%`}
              vazio="-"
            />
            <Barras titulo='Perguntas com mais "Não"' dados={cant.maisReprovadas.map((p) => ({ rotulo: p.texto, valor: p.qtd }))} formatar={(v) => `${v}x`} />
          </div>
        </section>
      )}

      {maq && (
        <section className="bloco">
          <h2 className="bloco-titulo">Máquinas{varias ? ': todas as obras' : ''}</h2>
          <div className="cartoes">
            <Cartao
              rotulo="Conformidade dos checklists"
              valor={maq.conformidade === null ? 'Sem checklist' : porcento(maq.conformidade)}
              alerta={maq.naoConformes > 0 && maq.conformidade !== null && maq.conformidade < 100}
              apoio={`${maq.dias} ${maq.dias === 1 ? 'checklist diário' : 'checklists diários'} no período.`}
            />
            <Cartao
              rotulo="Máquinas com checklist neste mês"
              valor={`${maq.comChecklistNoMes} de ${maq.ativas}`}
              alerta={maq.comChecklistNoMes < maq.ativas}
              apoio="Máquinas ativas na obra com pelo menos um dia lançado."
            />
            <Cartao rotulo="Não conformidades" valor={String(maq.naoConformes)} alerta={maq.naoConformes > 0} apoio="Itens marcados como não conforme no período." />
          </div>
          <div className="duas-colunas graficos">
            <Colunas
              titulo="Conformidade dos checklists por mês"
              dados={maq.meses.map((m) => ({ rotulo: mesCurto(m.mes), valor: m.pct, dica: m.dias ? `${m.dias} dias lançados, ${m.nc} não conformes` : 'Sem checklist' }))}
              formatar={porcento}
              maximo={100}
              vazio="-"
            />
            <Barras titulo="Itens mais marcados como não conforme" dados={maq.maisReprovadas.map((p) => ({ rotulo: p.texto, valor: p.qtd }))} formatar={(v) => `${v}x`} />
          </div>
        </section>
      )}
    </>
  );
}
