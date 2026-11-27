import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Consulta do CNPJ na Receita (função consultar-cnpj, que chama o fluxo do n8n). Só Suprimentos e administrativo.

export type CamposReceita = Partial<Record<
  'razao_social' | 'nome_fantasia' | 'ramo' | 'cep' | 'endereco' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'estado' | 'telefone' | 'email_empresa' | 'inscricao_estadual',
  string
>>;

export type ResultadoReceita = {
  cnpj: string;
  consulta: Record<string, string>;
  situacao_receita: string;
  situacao_desde: string;
  aviso_para_o_suprimentos: string;
  preenche_no_portal: CamposReceita;
  campos_vazios: string[];
  so_para_consulta: {
    abertura?: string;
    natureza_juridica?: string;
    porte?: string;
    capital_social?: number | null;
    simples?: string;
    mei?: string;
    cnae_principal?: string;
    cnaes_secundarios?: string[];
    quantidade_de_socios?: number | null;
  };
  divergencias_entre_fontes?: { campo: string; brasilapi: string; cnpj_ws: string }[];
};

export type ConsultaReceita = {
  resultado: ResultadoReceita;
  consultada_em: string;
  cache: boolean;
  antiga?: boolean;
  ja_cadastrado: { empresa_id: string; razao_social: string } | null;
};

// Resumo guardado no cadastro (fornecedores_cadastro).
export type ReceitaGuardada = {
  situacao: string | null;
  consultada_em: string;
  aviso: string | null;
  situacao_desde: string | null;
  abertura: string | null;
  cnae: string | null;
};

export const receitaAtiva = (situacao: string | null | undefined) => (situacao ?? '').toUpperCase() === 'ATIVA';

export async function consultarReceita(cnpj: string): Promise<ConsultaReceita> {
  const { data, error } = await supabase.functions.invoke('consultar-cnpj', { body: { cnpj } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detalhe = await error.context.json().catch(() => null);
      throw new Error(detalhe?.erro ?? 'Não foi possível consultar a Receita agora.');
    }
    throw new Error('Não foi possível consultar a Receita agora.');
  }
  return data as ConsultaReceita;
}

export const ROTULOS_RECEITA: Record<keyof CamposReceita, string> = {
  razao_social: 'Razão social',
  nome_fantasia: 'Nome fantasia',
  ramo: 'Ramo de atividade',
  cep: 'CEP',
  endereco: 'Endereço',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  cidade: 'Cidade',
  estado: 'Estado',
  telefone: 'Telefone',
  email_empresa: 'E-mail',
  inscricao_estadual: 'Inscrição estadual',
};
