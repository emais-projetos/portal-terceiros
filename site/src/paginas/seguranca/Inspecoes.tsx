import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { data, hojeIso } from '../../lib/formato';
import { competencia, type Alojamento, type Fornecedor, type Locadora, type Maquina, type Modelo, type VistoriaResumo } from '../../lib/seguranca';
import { SeloClassificacao, nomeResponsavel } from './comum';

type Linha = {
  chave: string;
  quando: string;
  data: string;
  tipo: 'Alojamento' | 'Máquina' | 'Canteiro';
  local: string;
  detalhe: string;
  responsavel: string;
  situacao: ReactNode;
  link: string;
  aviso?: string;
};

// Todas as inspeções da obra numa lista só, as mais recentes primeiro.
export function Inspecoes({
  alojamentos, maquinas, canteiro, modelos, fornecedores, locadoras, podeIniciar, aoIniciar,
}: {
  alojamentos: Alojamento[];
  maquinas: Maquina[];
  canteiro: VistoriaResumo[];
  modelos: Modelo[];
  fornecedores: Fornecedor[];
  locadoras: Locadora[];
  podeIniciar: boolean;
  aoIniciar: () => void;
}) {
  const [filtro, setFiltro] = useState<'todas' | 'Alojamento' | 'Máquina' | 'Canteiro'>('todas');
  const dias = (v: { situacao: string; fotos_expiram_em: string | null; fotos_excluidas_em: string | null }) => {
    if (v.fotos_excluidas_em) return 'sem fotos (ficou só a avaliação)';
    if (v.situacao !== 'concluida' || !v.fotos_expiram_em) return undefined;
    const d = Math.round((Date.parse(v.fotos_expiram_em.slice(0, 10)) - Date.parse(hojeIso())) / 864e5);
    if (d > 7) return undefined;
    return d <= 0 ? 'as fotos saem hoje: baixe o PDF' : `as fotos saem em ${d} ${d === 1 ? 'dia' : 'dias'}: baixe o PDF`;
  };
  const [busca, setBusca] = useState('');
  const nomeModelo = (c: string) => modelos.find((m) => m.codigo === c)?.nome ?? c.replace('maquina:', '');

  const linhas: Linha[] = [
    ...alojamentos.flatMap((a) =>
      a.vistorias.map((v) => ({
        chave: v.id,
        quando: v.data_vistoria,
        data: data(v.data_vistoria),
        tipo: 'Alojamento' as const,
        local: a.nome,
        detalhe: 'Vistoria de alojamento',
        responsavel: nomeResponsavel(a, fornecedores, locadoras),
        situacao: <SeloClassificacao v={v} />,
        link: `/seguranca/vistoria/${v.id}`,
        aviso: dias(v),
      })),
    ),
    ...canteiro.map((v) => ({
      chave: v.id,
      quando: v.data_vistoria,
      data: data(v.data_vistoria),
      tipo: 'Canteiro' as const,
      local: modelos.find((m) => m.codigo === v.modelo_codigo)?.nome ?? 'Canteiro de obras',
      detalhe: 'Vistoria do canteiro',
      responsavel: 'Emais',
      situacao: <SeloClassificacao v={v} />,
      link: `/seguranca/vistoria/${v.id}`,
      aviso: dias(v),
    })),
    ...maquinas.flatMap((m) =>
      m.fichas.map((f) => ({
        chave: f.id,
        quando: f.competencia,
        data: competencia(f.competencia),
        tipo: 'Máquina' as const,
        local: `${nomeModelo(m.modelo_codigo)} ${m.identificacao}`,
        detalhe: 'Checklist do mês',
        responsavel: nomeResponsavel(m, fornecedores, locadoras),
        situacao: f.fechada_em ? <span className="selo selo-ok">mês fechado</span> : <span className="selo selo-fila">mês aberto</span>,
        link: `/seguranca/ficha/${f.id}`,
        aviso: fotosFicha(f.competencia, f.fotos_excluidas_em),
      })),
    ),
  ]
    .filter((l) => filtro === 'todas' || l.tipo === filtro)
    .filter((l) => !busca.trim() || `${l.local} ${l.responsavel}`.toLowerCase().includes(busca.trim().toLowerCase()))
    .sort((a, b) => b.quando.localeCompare(a.quando) || a.local.localeCompare(b.local, 'pt-BR'));

  return (
    <section className="bloco">
      <div className="filtros">
        <div className="chips chips-filtro" role="group" aria-label="Tipo de inspeção">
          {(['todas', 'Alojamento', 'Máquina', ...(canteiro.length ? (['Canteiro'] as const) : [])] as const).map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={filtro === t} onClick={() => setFiltro(t)}>
              {t === 'todas' ? 'Todas' : t === 'Alojamento' ? 'Alojamentos' : t === 'Máquina' ? 'Máquinas' : 'Canteiro'}
            </button>
          ))}
        </div>
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Alojamento, máquina ou responsável" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>
      {linhas.length === 0 ? (
        <div className="vazio">
          <p>Nenhuma inspeção encontrada.</p>
          {podeIniciar && <button type="button" className="botao" onClick={aoIniciar}>Realizar inspeção</button>}
        </div>
      ) : (
        <ul className="lista-inspecoes">
          {linhas.map((l) => (
            <li key={l.chave}>
              <Link to={l.link} className="inspecao-linha">
                <span className="inspecao-data">
                  {l.data}
                  <small>{l.tipo}</small>
                </span>
                <span className="inspecao-local">
                  <strong>{l.local}</strong>
                  <small>{l.detalhe}. {l.responsavel}</small>
                  {l.aviso && <small className="texto-alerta">{l.aviso}</small>}
                </span>
                <span className="inspecao-situacao">{l.situacao}</span>
                <span className="inspecao-abrir" aria-hidden="true">Abrir ›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Fotos da ficha saem N dias depois do fim do mês (mesmo prazo das vistorias). Aviso na última semana.
export function fotosFicha(comp: string, excluidas: string | null, dias = 30): string | undefined {
  if (excluidas) return 'sem fotos (ficou só o checklist)';
  const [a, m] = comp.split('-').map(Number);
  const fim = new Date(Date.UTC(a, m, 0));
  const sai = new Date(fim.getTime() + dias * 864e5).toISOString().slice(0, 10);
  const d = Math.round((Date.parse(sai) - Date.parse(hojeIso())) / 864e5);
  if (d > 7) return undefined;
  return d <= 0 ? 'as fotos saem hoje: baixe o PDF' : `as fotos saem em ${d} ${d === 1 ? 'dia' : 'dias'}: baixe o PDF`;
}

export function dataSaidaFotosFicha(comp: string, dias = 30): string {
  const [a, m] = comp.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0) + dias * 864e5).toISOString().slice(0, 10);
}
