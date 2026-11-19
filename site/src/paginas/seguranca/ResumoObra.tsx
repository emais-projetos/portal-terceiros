import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Barras, Cartao, Colunas } from '../../componentes/Graficos';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import { classificar } from '../../lib/indicadoresSeguranca';
import { lerResumoObra, type AcaoObra, type BlocoResumo, type ResumoObra } from '../../lib/seguranca';
import { SeletorPeriodo, inicioPeriodo, mesCurto, mesesDesde, porcento } from './PainelConformidade';
import { seloNc } from './NcsVistoria';

const pendente = (a: AcaoObra) => a.situacao === 'aberta' || a.situacao === 'reaberta';

function porMes(b: BlocoResumo, desde: string) {
  return mesesDesde(desde).map((m) => {
    const x = b.meses.find((y) => y.mes === m);
    return {
      rotulo: mesCurto(m),
      valor: x?.pct ?? null,
      dica: x ? `${x.qtd} ${x.qtd === 1 ? 'vistoria' : 'vistorias'} (${classificar(x.pct ?? 0)})` : 'Sem vistoria concluída',
    };
  });
}

function useResumoObra(obraId: string, desde: string) {
  const [r, setR] = useState<ResumoObra | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setR(null);
    setErro(null);
    // As pendências da Emais têm lista própria (PendenciasEmais); aqui ficam só as dos fornecedores.
    lerResumoObra(obraId, desde).then((x) => setR({ ...x, acoes: (x.acoes ?? []).filter((a) => !a.emais) })).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [obraId, desde]);
  return { r, erro };
}

// Engenharia: painel visual da obra. Só conformidade, itens que mais falham e as correções em aberto dos fornecedores.
export function PainelResumoObra({ obraId }: { obraId: string }) {
  const [meses, setMeses] = useState(3);
  const desde = inicioPeriodo(meses);
  const { r, erro } = useResumoObra(obraId, desde);

  return (
    <>
      <div className="filtros">
        <SeletorPeriodo meses={meses} aoMudar={setMeses} />
        <p className="dica">
          Desde {data(desde)}. Conformidade = itens "Sim" sobre os itens aplicáveis.
          {r ? ` Metas: alojamento ${r.metas.alojamento}%, canteiro ${r.metas.canteiro}%.` : ''}
        </p>
      </div>
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      {!r && !erro && <Carregando />}
      {r && <ConteudoResumo r={r} desde={desde} />}
    </>
  );
}

function ConteudoResumo({ r, desde }: { r: ResumoObra; desde: string }) {
  const { alojamento: aloj, canteiro: cant, maquinas: maq, metas } = r;
  const abertas = r.acoes.filter(pendente);
  const vencidas = abertas.filter((a) => diasAte(a.prazo) < 0).length;
  const emAvaliacao = r.acoes.length - abertas.length;
  const abaixo = aloj.por_alojamento.filter((a) => a.pct !== null && a.pct < metas.alojamento).length;

  return (
    <>
      <section className="bloco">
        <h2 className="bloco-titulo">Conformidade</h2>
        <div className="cartoes">
          <Cartao
            rotulo="Alojamentos"
            valor={aloj.conformidade === null ? 'Sem vistoria' : porcento(aloj.conformidade)}
            alerta={aloj.conformidade !== null && aloj.conformidade < metas.alojamento}
            apoio={`Meta: ${metas.alojamento}%. ${aloj.vistorias} ${aloj.vistorias === 1 ? 'vistoria' : 'vistorias'} no período, ${abaixo} ${abaixo === 1 ? 'alojamento abaixo' : 'alojamentos abaixo'} da meta.`}
          />
          {cant.vistorias > 0 && (
            <Cartao
              rotulo="Canteiro"
              valor={cant.conformidade === null ? '-' : porcento(cant.conformidade)}
              alerta={cant.conformidade !== null && cant.conformidade < metas.canteiro}
              apoio={`Meta: ${metas.canteiro}%. ${cant.vistorias} ${cant.vistorias === 1 ? 'vistoria' : 'vistorias'} no período.`}
            />
          )}
          {maq.dias > 0 && (
            <Cartao
              rotulo="Máquinas"
              valor={maq.conformidade === null ? '-' : porcento(maq.conformidade)}
              alerta={maq.nao_conformes > 0}
              apoio={`${maq.dias} ${maq.dias === 1 ? 'checklist diário' : 'checklists diários'}, ${maq.nao_conformes} ${maq.nao_conformes === 1 ? 'item não conforme' : 'itens não conformes'}.`}
            />
          )}
          <Cartao
            rotulo="Correções em aberto"
            valor={String(abertas.length)}
            alerta={vencidas > 0}
            apoio={`${vencidas} com prazo vencido. ${emAvaliacao} ${emAvaliacao === 1 ? 'respondida, em avaliação' : 'respondidas, em avaliação'} pelo TST.`}
          />
        </div>
        <div className="duas-colunas graficos">
          <Colunas
            titulo="Alojamentos: conformidade por mês"
            dados={porMes(aloj, desde)}
            formatar={porcento}
            maximo={100}
            meta={metas.alojamento}
            rotuloMeta={`meta ${metas.alojamento}%`}
            vazio="-"
          />
          <Barras
            titulo="Conformidade por alojamento (última vistoria)"
            dados={aloj.por_alojamento.filter((a) => a.pct !== null).map((a) => ({ rotulo: a.nome, valor: a.pct ?? 0, dica: `${classificar(a.pct ?? 0)}, ${data(a.data)}` }))}
            formatar={porcento}
          />
          {cant.vistorias > 0 && (
            <Colunas
              titulo="Canteiro: conformidade por mês"
              dados={porMes(cant, desde)}
              formatar={porcento}
              maximo={100}
              meta={metas.canteiro}
              rotuloMeta={`meta ${metas.canteiro}%`}
              vazio="-"
            />
          )}
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Itens que mais aparecem como não conformes</h2>
        {aloj.mais_nao.length + cant.mais_nao.length + maq.mais_nc.length === 0 ? (
          <p className="vazio">Nenhuma não conformidade no período.</p>
        ) : (
          <div className="duas-colunas graficos">
            {aloj.mais_nao.length > 0 && (
              <Barras titulo="Alojamentos" dados={aloj.mais_nao.map((p) => ({ rotulo: p.texto, valor: p.qtd }))} formatar={(v) => `${v}x`} />
            )}
            {cant.mais_nao.length > 0 && (
              <Barras titulo="Canteiro" dados={cant.mais_nao.map((p) => ({ rotulo: p.texto, valor: p.qtd }))} formatar={(v) => `${v}x`} />
            )}
            {maq.mais_nc.length > 0 && (
              <Barras titulo="Máquinas" dados={maq.mais_nc.map((p) => ({ rotulo: p.texto, valor: p.qtd }))} formatar={(v) => `${v}x`} />
            )}
          </div>
        )}
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Correções abertas dos fornecedores {r.acoes.length > 0 && <span className="contador">{r.acoes.length}</span>}</h2>
        {r.acoes.length === 0 ? (
          <p className="vazio">Nenhuma correção em aberto.</p>
        ) : (
          <ul className="lista-ncs">
            {r.acoes.map((a, i) => {
              const dias = diasAte(a.prazo);
              return (
                <li key={i}>
                  <div className="vistoria-item-linha">
                    <span>
                      <strong>{a.fornecedor}</strong>
                      <small className="sub"> {a.alojamento}{a.quarto ? `, ${a.quarto}` : ''}</small>
                    </span>
                    {seloNc(a.situacao)}
                  </div>
                  <p className="nc-descricao">{a.descricao}</p>
                  <p className={`sub${pendente(a) && dias < 0 ? ' texto-erro' : ''}`}>
                    Prazo: {data(a.prazo)}
                    {pendente(a) ? (dias < 0 ? ` (vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'})` : dias === 0 ? ' (vence hoje)' : '') : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

// Painel da obra (engenharia): só os números dos alojamentos, sem abrir vistoria.
export function ResumoAlojamentosObra({ obraId }: { obraId: string }) {
  const desde = inicioPeriodo(3);
  const { r } = useResumoObra(obraId, desde);
  if (!r || (r.alojamento.alojamentos_ativos === 0 && r.acoes.length === 0)) return null;
  const { alojamento: aloj, metas } = r;
  const abertas = r.acoes.filter(pendente);
  const vencidas = abertas.filter((a) => diasAte(a.prazo) < 0).length;
  const comNota = aloj.por_alojamento.filter((a) => a.pct !== null);
  const abaixo = comNota.filter((a) => (a.pct ?? 0) < metas.alojamento).length;

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Alojamentos</h2>
        <Link to="/seguranca" className="link-forte">Ver indicadores ›</Link>
      </div>
      <div className="cartoes">
        <Cartao
          rotulo="Conformidade dos alojamentos"
          valor={aloj.conformidade === null ? 'Sem vistoria' : porcento(aloj.conformidade)}
          alerta={aloj.conformidade !== null && aloj.conformidade < metas.alojamento}
          apoio={`Meta: ${metas.alojamento}%. Últimos 3 meses.`}
        />
        <Cartao rotulo="Abaixo da meta" valor={`${abaixo} de ${comNota.length}`} alerta={abaixo > 0} apoio={`${aloj.alojamentos_ativos} ${aloj.alojamentos_ativos === 1 ? 'alojamento ativo' : 'alojamentos ativos'} na obra.`} />
        <Cartao rotulo="Correções em aberto" valor={String(abertas.length)} alerta={vencidas > 0} apoio={`${vencidas} com prazo vencido.`} />
      </div>
    </section>
  );
}
