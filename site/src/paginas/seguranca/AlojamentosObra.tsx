import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cartao } from '../../componentes/Graficos';
import { data, diasAte, hojeIso, somarDias } from '../../lib/formato';
import { lerMetas } from '../../lib/indicadoresSeguranca';
import {
  lerAlojamentos, lerFornecedoresDaObra, lerNaoConformidadesDaObra, type Alojamento, type Fornecedor, type NaoConformidade,
} from '../../lib/seguranca';
import { SeloClassificacao, nomeResponsavel } from './comum';

// Painel da obra: retrato atual dos alojamentos (última vistoria de cada um) contra a meta de conformidade.
export function AlojamentosObra({ obraId }: { obraId: string }) {
  const [dados, setDados] = useState<{ alojamentos: Alojamento[]; fornecedores: Fornecedor[]; ncs: NaoConformidade[]; meta: number } | null>(null);

  useEffect(() => {
    setDados(null);
    (async () => {
      const [alojamentos, fornecedores, metas] = await Promise.all([lerAlojamentos(obraId), lerFornecedoresDaObra(obraId), lerMetas()]);
      const ncs = await lerNaoConformidadesDaObra(alojamentos.map((a) => a.id));
      setDados({ alojamentos: alojamentos.filter((a) => a.ativo), fornecedores, ncs, meta: metas.alojamento });
    })().catch(() => setDados({ alojamentos: [], fornecedores: [], ncs: [], meta: 90 }));
  }, [obraId]);

  if (!dados || dados.alojamentos.length === 0) return null;
  const { alojamentos, fornecedores, ncs, meta } = dados;

  const linhas = alojamentos
    .map((a) => {
      const ultima = a.vistorias.find((v) => v.situacao === 'concluida');
      const idsVistorias = new Set(a.vistorias.map((v) => v.id));
      const pend = ncs.filter((n) => idsVistorias.has(n.vistoria_id) && (n.situacao === 'aberta' || n.situacao === 'reaberta'));
      return {
        a,
        ultima,
        pct: ultima?.pontuacao != null ? Math.round(ultima.pontuacao * 100) : null,
        pend: pend.length,
        vencidas: pend.filter((n) => diasAte(n.prazo) < 0).length,
        responsavel: nomeResponsavel(a, fornecedores, []),
      };
    })
    .sort((x, y) => (x.pct ?? -1) - (y.pct ?? -1) || x.a.nome.localeCompare(y.a.nome, 'pt-BR'));

  const comNota = linhas.filter((l) => l.pct !== null);
  const media = comNota.length ? Math.round(comNota.reduce((s, l) => s + (l.pct ?? 0), 0) / comNota.length) : null;
  const abaixo = comNota.filter((l) => (l.pct ?? 0) < meta).length;
  const abertas = ncs.filter((n) => n.situacao === 'aberta' || n.situacao === 'reaberta');
  const vencidas = abertas.filter((n) => diasAte(n.prazo) < 0).length;
  const paraAvaliar = ncs.filter((n) => n.situacao === 'respondida').length;
  const limite = somarDias(hojeIso(), -30);
  const semVistoria = linhas.filter((l) => !l.ultima || l.ultima.data_vistoria < limite).length;

  return (
    <section className="bloco">
      <div className="barra-lista">
        <h2 className="bloco-titulo">Alojamentos</h2>
        <Link to="/seguranca" className="link-forte">Abrir Segurança da obra ›</Link>
      </div>
      <div className="cartoes">
        <Cartao
          rotulo="Conformidade dos alojamentos"
          valor={media === null ? 'Sem vistoria' : `${media}%`}
          alerta={media !== null && media < meta}
          apoio={`Meta: ${meta}%. Média da última vistoria de cada alojamento.`}
        />
        <Cartao
          rotulo="Abaixo da meta"
          valor={`${abaixo} de ${comNota.length}`}
          alerta={abaixo > 0}
          apoio={semVistoria ? `${semVistoria} sem vistoria nos últimos 30 dias.` : 'Todos vistoriados nos últimos 30 dias.'}
        />
        <Cartao
          rotulo="Itens a regularizar"
          valor={String(abertas.length)}
          alerta={vencidas > 0}
          apoio={`${vencidas} com prazo vencido. ${paraAvaliar} ${paraAvaliar === 1 ? 'resposta esperando' : 'respostas esperando'} avaliação.`}
        />
      </div>
      <ul className="lista-inspecoes">
        {linhas.map((l) => {
          const conteudo = (
            <>
              <span className="inspecao-data">
                {l.ultima ? data(l.ultima.data_vistoria) : '-'}
                <small>{l.ultima ? 'última vistoria' : 'sem vistoria'}</small>
              </span>
              <span className="inspecao-local">
                <strong>{l.a.nome}</strong>
                <small>{l.responsavel}</small>
                {l.pend > 0 && (
                  <small className="texto-alerta">
                    {l.pend} {l.pend === 1 ? 'item a regularizar' : 'itens a regularizar'}
                    {l.vencidas ? `, ${l.vencidas} vencido${l.vencidas === 1 ? '' : 's'}` : ''}
                  </small>
                )}
              </span>
              <span className="inspecao-situacao">
                {l.ultima && <SeloClassificacao v={l.ultima} />}
                {l.pct !== null && <small className={`sub${l.pct < meta ? ' texto-erro' : ''}`}> {l.pct}%</small>}
              </span>
            </>
          );
          return (
            <li key={l.a.id}>
              {l.ultima ? (
                <Link to={`/seguranca/vistoria/${l.ultima.id}`} className="inspecao-linha">
                  {conteudo}
                  <span className="inspecao-abrir" aria-hidden="true">Abrir ›</span>
                </Link>
              ) : (
                <div className="inspecao-linha">{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
