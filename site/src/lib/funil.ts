import { supabase } from './supabase';
import { diasUteis } from './indicadores';

// Funil da homologação: etapa atual de cada fornecedor, tempo em cada etapa (dias úteis) e devoluções.

export type EventoFunil = { acao: 'homologacao_enviada' | 'homologacao_devolvida' | 'homologada' | 'homologacao_reprovada' | 'portal_liberado'; em: string; texto: string | null };

export type ItemFunil = {
  empresa_id: string;
  razao_social: string;
  situacao: 'convidada' | 'enviada' | 'devolvida' | 'homologada' | 'reprovada';
  tipos: string[];
  situacao_fornecedor: string;
  convidada_em: string;
  atualizado_em: string | null;
  enviada_em: string | null;
  decidida_em: string | null;
  homologada_em: string | null;
  liberado_em: string | null;
  primeiro_documento_em: string | null;
  eventos: EventoFunil[];
  documentos_devolvidos: { documento: string; motivo: string; em: string }[];
};

export type Etapa = 'convidado' | 'preenchendo' | 'enviado' | 'devolvido' | 'homologado' | 'liberado' | 'reprovado';

export const ETAPAS: { etapa: Etapa; nome: string; comQuem: 'fornecedor' | 'suprimentos' | null; explica: string }[] = [
  { etapa: 'convidado', nome: 'Convidado', comQuem: 'fornecedor', explica: 'Recebeu o convite e ainda não preencheu nada.' },
  { etapa: 'preenchendo', nome: 'Preenchendo', comQuem: 'fornecedor', explica: 'Já salvou dados ou enviou documentos, mas não mandou para análise.' },
  { etapa: 'enviado', nome: 'Em análise', comQuem: 'suprimentos', explica: 'Enviado para o Suprimentos conferir.' },
  { etapa: 'devolvido', nome: 'Devolvido para correção', comQuem: 'fornecedor', explica: 'O Suprimentos pediu correções.' },
  { etapa: 'homologado', nome: 'Homologado', comQuem: 'suprimentos', explica: 'Aprovado, falta o contrato e a liberação do portal.' },
  { etapa: 'liberado', nome: 'Liberado no portal', comQuem: null, explica: 'Tem contrato e acesso ao portal.' },
  { etapa: 'reprovado', nome: 'Reprovado', comQuem: null, explica: 'Não aprovado pelo Suprimentos.' },
];

export const NOME_ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.etapa, e.nome])) as Record<Etapa, string>;

export async function lerFunil(): Promise<ItemFunil[]> {
  const { data, error } = await supabase.rpc('funil_homologacao');
  if (error) throw error;
  return (data ?? []) as ItemFunil[];
}

const ultimo = (x: ItemFunil, acao: EventoFunil['acao']) => [...x.eventos].reverse().find((e) => e.acao === acao)?.em ?? null;
const primeiro = (x: ItemFunil, acao: EventoFunil['acao']) => x.eventos.find((e) => e.acao === acao)?.em ?? null;

// Mexeu no formulário depois do convite (salvou dados) ou mandou algum documento.
const comecou = (x: ItemFunil) =>
  !!x.primeiro_documento_em || (!!x.atualizado_em && new Date(x.atualizado_em).getTime() - new Date(x.convidada_em).getTime() > 60_000);

export function etapaAtual(x: ItemFunil): Etapa {
  if (x.situacao === 'reprovada') return 'reprovado';
  if (x.situacao === 'homologada') return x.liberado_em ? 'liberado' : 'homologado';
  if (x.situacao === 'enviada') return 'enviado';
  if (x.situacao === 'devolvida') return 'devolvido';
  return comecou(x) ? 'preenchendo' : 'convidado';
}

// Desde quando está na etapa atual. Preenchendo conta da última vez que mexeu.
export function desde(x: ItemFunil, etapa: Etapa): string {
  switch (etapa) {
    case 'preenchendo':
      return [x.atualizado_em, x.primeiro_documento_em].filter(Boolean).sort().reverse()[0] ?? x.convidada_em;
    case 'enviado':
      return x.enviada_em ?? ultimo(x, 'homologacao_enviada') ?? x.convidada_em;
    case 'devolvido':
      return ultimo(x, 'homologacao_devolvida') ?? x.decidida_em ?? x.convidada_em;
    case 'homologado':
      return x.homologada_em ?? x.decidida_em ?? x.convidada_em;
    case 'liberado':
      return x.liberado_em ?? x.convidada_em;
    case 'reprovado':
      return x.decidida_em ?? ultimo(x, 'homologacao_reprovada') ?? x.convidada_em;
    default:
      return x.convidada_em;
  }
}

export type Tempos = { convite_envio: number[]; analise: number[]; correcao: number[]; homologado_portal: number[]; total: number[]; rodadas: number[] };

// Tempos de cada passagem já concluída, em dias úteis.
export function tempos(lista: ItemFunil[]): Tempos {
  const t: Tempos = { convite_envio: [], analise: [], correcao: [], homologado_portal: [], total: [], rodadas: [] };
  for (const x of lista) {
    const env1 = primeiro(x, 'homologacao_enviada');
    if (env1) t.convite_envio.push(diasUteis(x.convidada_em, env1));
    const ev = x.eventos;
    ev.forEach((e, i) => {
      const prox = ev.slice(i + 1);
      if (e.acao === 'homologacao_enviada') {
        const decisao = prox.find((p) => p.acao === 'homologacao_devolvida' || p.acao === 'homologada' || p.acao === 'homologacao_reprovada');
        if (decisao) t.analise.push(diasUteis(e.em, decisao.em));
      }
      if (e.acao === 'homologacao_devolvida') {
        const reenvio = prox.find((p) => p.acao === 'homologacao_enviada');
        if (reenvio) t.correcao.push(diasUteis(e.em, reenvio.em));
      }
    });
    const homolog = x.homologada_em ?? primeiro(x, 'homologada');
    if (homolog) {
      t.total.push(diasUteis(x.convidada_em, homolog));
      t.rodadas.push(Math.max(1, ev.filter((e) => e.acao === 'homologacao_enviada').length));
      if (x.liberado_em) t.homologado_portal.push(diasUteis(homolog, x.liberado_em));
    }
  }
  return t;
}

export const media = (l: number[]) => (l.length ? l.reduce((s, n) => s + n, 0) / l.length : null);

// Até onde cada um chegou (para o funil acumulado).
export function chegou(x: ItemFunil) {
  const e = etapaAtual(x);
  const enviou = !!x.enviada_em || x.eventos.some((v) => v.acao === 'homologacao_enviada') || ['enviado', 'devolvido', 'homologado', 'liberado', 'reprovado'].includes(e);
  const homologou = !!x.homologada_em || e === 'homologado' || e === 'liberado';
  return {
    convidado: true,
    comecou: enviou || e !== 'convidado',
    enviou,
    homologou,
    liberou: !!x.liberado_em,
  };
}
