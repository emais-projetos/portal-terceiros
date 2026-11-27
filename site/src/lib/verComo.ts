import { FunctionsHttpError } from '@supabase/supabase-js';
import { enderecoDoSite, supabase } from './supabase';
import type { Perfil } from './sessao';

// "Ver como" um usuário (só o acesso master): a função ver-como abre uma sessão da pessoa, que o banco trata
// como somente leitura. A sessão do master fica guardada neste navegador para voltar depois.

const CHAVE = 'portal-ver-como';

export type VerComoSalvo = {
  alvo: { id: string; nome: string; perfil: Perfil };
  master: { access_token: string; refresh_token: string };
  iniciado_em: string;
};

export type UsuarioVerComo = {
  id: string;
  nome: string;
  email: string;
  perfil: Exclude<Perfil, 'admin'>;
  ultimo_acesso: string | null;
  empresas: string[];
  em_homologacao: boolean;
  obras: string[];
};

export function lerVerComo(): VerComoSalvo | null {
  try {
    const v = window.localStorage.getItem(CHAVE);
    return v ? (JSON.parse(v) as VerComoSalvo) : null;
  } catch {
    return null;
  }
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ver-como', { body: corpo });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detalhe = await error.context.json().catch(() => null);
      throw new Error(detalhe?.erro ?? 'Não foi possível concluir.');
    }
    throw error;
  }
  return data as T;
}

export async function listarParaVerComo(): Promise<UsuarioVerComo[]> {
  return (await chamar<{ usuarios: UsuarioVerComo[] }>({ acao: 'listar' })).usuarios;
}

export async function iniciarVerComo(usuarioId: string) {
  const { data: atual } = await supabase.auth.getSession();
  if (!atual.session) throw new Error('Entre de novo no portal.');
  const r = await chamar<{ access_token: string; refresh_token: string; usuario: VerComoSalvo['alvo'] }>({ acao: 'iniciar', usuario_id: usuarioId });
  const salvo: VerComoSalvo = {
    alvo: r.usuario,
    master: { access_token: atual.session.access_token, refresh_token: atual.session.refresh_token },
    iniciado_em: new Date().toISOString(),
  };
  window.localStorage.setItem(CHAVE, JSON.stringify(salvo));
  const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
  if (error) {
    window.localStorage.removeItem(CHAVE);
    await supabase.auth.setSession(salvo.master).catch(() => undefined);
    throw error;
  }
  window.location.assign(enderecoDoSite);
}

// Encerra a sessão de visualização (o servidor revoga) e volta para a sessão do master.
export async function voltarDoVerComo() {
  const salvo = lerVerComo();
  await chamar({ acao: 'encerrar' }).catch(() => undefined);
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  window.localStorage.removeItem(CHAVE);
  if (salvo) await supabase.auth.setSession(salvo.master).catch(() => undefined);
  window.location.assign(`${enderecoDoSite}ver-como`);
}
