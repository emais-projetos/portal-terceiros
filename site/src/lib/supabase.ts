import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !chave) {
  throw new Error('Faltam VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY. Veja site/.env.exemplo.');
}

export const supabase = createClient(url, chave, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Endereço base do site (ex.: https://emais-projetos.github.io/portal-terceiros/), usado nos links enviados por e-mail.
export const enderecoDoSite = new URL(import.meta.env.BASE_URL, window.location.origin).toString();

// Traduz as mensagens de erro mais comuns do Supabase Auth.
export function mensagemDeErro(erro: { message?: string; status?: number } | null | undefined): string {
  const m = erro?.message ?? '';
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'Este acesso ainda não tem senha. Clique em Primeiro acesso ou esqueci a senha para receber um código.';
  if (/token has expired|otp.*(expired|invalid)|invalid.*(token|otp)/i.test(m)) return 'Código errado ou vencido. Confira o último e-mail que chegou ou peça outro código.';
  if (/rate limit|too many/i.test(m) || erro?.status === 429) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
  if (/password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (/same.*password|different from the old/i.test(m)) return 'A nova senha precisa ser diferente da atual.';
  if (/weak|should contain at least one character/i.test(m))
    return 'Senha fraca. Use pelo menos 10 caracteres, com letra maiúscula, letra minúscula, número e símbolo.';
  if (/fetch|network/i.test(m)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return m ? `Não foi possível concluir: ${m}` : 'Não foi possível concluir. Tente de novo.';
}
