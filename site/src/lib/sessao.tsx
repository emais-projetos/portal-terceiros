import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Perfil = 'admin' | 'tst' | 'engenharia' | 'fornecedor';

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
};

// carregando: ainda lendo a sessão; fora: sem login; sem_cadastro: tem login mas não está em public.usuarios;
// inativo: cadastro desativado pelo administrativo; ok: pode usar o portal.
export type Situacao = 'carregando' | 'fora' | 'sem_cadastro' | 'inativo' | 'ok';

type ValorSessao = {
  situacao: Situacao;
  sessao: Session | null;
  usuario: Usuario | null;
  recuperandoSenha: boolean;
  iniciarRecuperacao: () => void;
  concluirRecuperacao: () => void;
  sair: () => Promise<void>;
};

const Contexto = createContext<ValorSessao | null>(null);

export const nomesPerfil: Record<Perfil, string> = {
  admin: 'Administrativo',
  tst: 'TST da obra',
  engenharia: 'Engenharia da obra',
  fornecedor: 'Fornecedor',
};

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [sessaoLida, setSessaoLida] = useState(false);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('carregando');
  const [recuperandoSenha, setRecuperandoSenha] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperandoSenha(true);
      setSessao(novaSessao);
      setSessaoLida(true);
    });
    supabase.auth.getSession().then(({ data: d }) => {
      setSessao(d.session);
      setSessaoLida(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = sessao?.user.id ?? null;

  useEffect(() => {
    if (!sessaoLida) return;
    if (!uid) {
      setUsuario(null);
      setSituacao('fora');
      return;
    }
    let cancelado = false;
    setSituacao('carregando');
    supabase
      .from('usuarios')
      .select('id, nome, email, perfil, ativo')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error || !data) {
          setUsuario(null);
          setSituacao('sem_cadastro');
          return;
        }
        setUsuario(data as Usuario);
        setSituacao(data.ativo ? 'ok' : 'inativo');
      });
    return () => {
      cancelado = true;
    };
  }, [sessaoLida, uid]);

  const valor: ValorSessao = {
    situacao,
    sessao,
    usuario,
    recuperandoSenha,
    // Primeiro acesso por código: a sessão que chega com o código vai direto para a criação da senha.
    iniciarRecuperacao: () => setRecuperandoSenha(true),
    concluirRecuperacao: () => setRecuperandoSenha(false),
    sair: async () => {
      await supabase.auth.signOut();
      setRecuperandoSenha(false);
    },
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSessao precisa estar dentro de ProvedorSessao');
  return v;
}
