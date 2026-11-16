import { Link } from 'react-router-dom';
import type { Fornecedor, Locadora, Pessoa, Vistoria } from '../../lib/seguranca';

export function nomeResponsavel(r: { empresa_id: string | null; locadora_id?: string | null; empresa_a_vincular: string | null }, fornecedores: Fornecedor[], locadoras: Locadora[]): string {
  if (r.empresa_a_vincular) return `A vincular (no ObraCheck: ${r.empresa_a_vincular})`;
  if (r.empresa_id) return fornecedores.find((f) => f.id === r.empresa_id)?.nome ?? 'Fornecedor';
  if (r.locadora_id) return `${locadoras.find((l) => l.id === r.locadora_id)?.nome ?? 'Locadora'} (locadora)`;
  return 'Emais';
}

export function SeloClassificacao({ v }: { v: Pick<Vistoria, 'classificacao' | 'situacao'> }) {
  if (v.situacao === 'rascunho') return <span className="selo selo-fila">em andamento</span>;
  const cor = v.classificacao === 'Ótimo' || v.classificacao === 'Bom' ? 'selo-ok' : v.classificacao === 'Regular' ? 'selo-teste' : 'selo-erro';
  return <span className={`selo ${cor}`}>{v.classificacao}</span>;
}

export function Voltar({ para = '/seguranca', rotulo = 'Segurança da obra' }: { para?: string; rotulo?: string }) {
  return (
    <Link to={para} className="link-voltar">
      ← {rotulo}
    </Link>
  );
}

export function Fotos({ caminhos, links }: { caminhos: string[]; links: Record<string, string> }) {
  if (!caminhos.length) return null;
  return (
    <div className="fotos-miniaturas">
      {caminhos.map((c) =>
        links[c] ? (
          <a key={c} href={links[c]} target="_blank" rel="noreferrer">
            <img src={links[c]} alt="Foto do item" loading="lazy" />
          </a>
        ) : (
          <span key={c} className="foto-indisponivel">foto</span>
        ),
      )}
    </div>
  );
}

export function Assinaturas({ titulo, pessoas, links }: { titulo: string; pessoas: Pessoa[]; links: Record<string, string> }) {
  if (!pessoas.length) return null;
  return (
    <div>
      <h3 className="detalhe-subtitulo">{titulo}</h3>
      <ul className="assinaturas">
        {pessoas.map((p, i) => (
          <li key={i}>
            {p.assinatura && links[p.assinatura] ? <img src={links[p.assinatura]} alt={`Assinatura de ${p.nome}`} /> : <span className="assinatura-vazia" />}
            <span>
              {p.nome || 'Sem nome'}
              {p.cargo && <small className="sub">{p.cargo}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Junta caminhos de fotos e assinaturas e pede os links (10 minutos) de uma vez.
export function caminhosDaVistoria(v: Pick<Vistoria, 'itens' | 'funcionarios' | 'envolvidos'>) {
  return [...v.itens.flatMap((i) => i.fotos ?? []), ...v.funcionarios.map((p) => p.assinatura ?? ''), ...v.envolvidos.map((p) => p.assinatura ?? '')].filter(Boolean);
}
