import { useEffect, useMemo, useState } from 'react';
import { Barras, Cartao, Colunas } from '../../componentes/Graficos';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import {
  classificar, indicadoresAlojamento, indicadoresCanteiro, indicadoresMaquinas, lerDadosIndicadores, lerMetas, type FichaIndicador, type VistoriaIndicador,
} from '../../lib/indicadoresSeguranca';
import type { Alojamento, Fornecedor, Maquina, NaoConformidade } from '../../lib/seguranca';

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
export function PainelConformidade({
  obraId, alojamentos, maquinas, fornecedores, ncs, temCanteiro,
}: {
  temCanteiro: boolean;
  obraId: string;
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

  useEffect(() => {
    setDados(null);
    setErro(null);
    lerDadosIndicadores(obraId, desde).then(setDados).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [obraId, desde]);

  const aloj = useMemo(() => (dados ? indicadoresAlojamento(dados.vistorias, alojamentos, fornecedores, ncs, desde) : null), [dados, alojamentos, fornecedores, ncs, desde]);
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

      {aloj && (
        <section className="bloco">
          <h2 className="bloco-titulo">Alojamentos</h2>
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
          <h2 className="bloco-titulo">Canteiro</h2>
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
          <h2 className="bloco-titulo">Máquinas</h2>
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
