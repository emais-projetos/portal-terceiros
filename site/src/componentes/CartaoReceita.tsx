import { receitaAtiva, type ConsultaReceita } from '../lib/receita';

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

// Resultado da consulta do CNPJ na Receita: situação em destaque, e o resto para conferência.
export function CartaoReceita({ consulta, nota }: { consulta: ConsultaReceita; nota?: string }) {
  const r = consulta.resultado;
  const ativa = receitaAtiva(r.situacao_receita);
  const extra = r.so_para_consulta ?? {};
  return (
    <div className={`aviso ${ativa ? 'aviso-info' : 'aviso-erro'} cartao-receita`} role={ativa ? undefined : 'alert'}>
      <p>
        {ativa ? (
          <>
            <strong>Receita: ATIVA</strong>
            {r.situacao_desde ? ` desde ${r.situacao_desde}` : ''}
          </>
        ) : (
          <strong>{r.aviso_para_o_suprimentos || `Receita: ${r.situacao_receita || 'situação não informada'}`}</strong>
        )}
      </p>
      <small className="sub">
        {[
          r.preenche_no_portal?.razao_social,
          extra.abertura && `aberta em ${extra.abertura}`,
          extra.cnae_principal,
          extra.porte && `porte ${extra.porte.toLowerCase()}`,
          extra.simples === 'Sim' ? 'Simples Nacional' : null,
          extra.mei === 'Sim' ? 'MEI' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </small>
      <small className="sub">
        Consulta de {quando(consulta.consultada_em)}
        {consulta.antiga ? ' (a Receita não respondeu agora; esta é a última consulta guardada)' : ''}
      </small>
      {nota && <small className="sub">{nota}</small>}
    </div>
  );
}
