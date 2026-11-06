// No servidor (função do Supabase), o mesmo módulo de regras do portal usa a chave de serviço no lugar do login.
// Este arquivo substitui site/src/lib/supabase.ts quando o código é empacotado para a função.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

declare const Deno: { env: { get(nome: string): string | undefined } };

export const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const enderecoDoSite = 'https://emais-projetos.github.io/portal-terceiros/';

export function mensagemDeErro(e: { message?: string } | null | undefined): string {
  return e?.message ?? 'Erro desconhecido';
}
