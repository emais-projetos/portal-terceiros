// Notificações: tudo o que está esperando alguém, num lugar só e para todos os perfis.
// O banco monta a lista (minhas_notificacoes) já filtrada pelo que cada perfil pode ver; "comigo" marca o que é para quem está logado agir.
import { supabase } from './supabase';

export type TipoNotificacao = 'validar_sst' | 'homologacao' | 'registrar_contrato' | 'liberar_portal' | 'pedido_obra' | 'ajuda';
export type Vez = 'admin' | 'suprimentos' | 'fornecedor' | 'voce';

export type Notificacao = {
  chave: string;
  tipo: TipoNotificacao;
  titulo: string;
  detalhe: string | null;
  empresa_id: string | null;
  empresa: string | null;
  obra: string | null;
  desde: string;
  vez: Vez;
  comigo: boolean;
  ref: string | null;
  extra: {
    documento?: string;
    data_emissao?: string | null;
    vencimento?: string | null;
    validade_dias?: number | null;
    arquivos?: { caminho: string; nome?: string }[];
    obra_id?: string;
    numero_contrato?: string | null;
    codigo_bp?: string | null;
    obras_ids?: string[];
    remetente?: string;
    perfil?: string;
  } | null;
};

export const NOMES_TIPO: Record<TipoNotificacao, string> = {
  validar_sst: 'Validar documento de SST',
  homologacao: 'Homologação para analisar',
  registrar_contrato: 'Registrar contrato',
  liberar_portal: 'Liberar portal',
  pedido_obra: 'Pedido de obra',
  ajuda: 'Ajuda',
};

export const NOMES_VEZ: Record<Vez, string> = {
  admin: 'Administrativo',
  suprimentos: 'Suprimentos',
  fornecedor: 'Fornecedor',
  voce: 'Você',
};

export async function lerNotificacoes(): Promise<Notificacao[]> {
  const { data, error } = await supabase.rpc('minhas_notificacoes');
  if (error) throw error;
  return (data ?? []) as Notificacao[];
}

export async function contarNotificacoes(): Promise<number> {
  return (await lerNotificacoes()).filter((n) => n.comigo).length;
}

// Abre o painel da Ajuda (canto da tela) de qualquer lugar do portal.
export function abrirAjuda() {
  window.dispatchEvent(new CustomEvent('portal-abrir-ajuda'));
}
