import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { desligarDemo, lerModoDemo, usuarioDemo, type ModoDemo } from './demonstracao';
import { lerVerComo, type VerComoSalvo } from './verComo';

export type Perfil = 'admin' | 'tst' | 'engenharia' | 'fornecedor' | 'suprimentos';

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  master?: boolean;
};

// carregando: ainda lendo a sessão; fora: sem login; sem_cadastro: tem login mas não está em public.usuarios;
// inativo: cadastro desativado pelo administrativo; ok: pode usar o portal.
export type Situacao = 'carregando' | 'fora' | 'sem_cadastro' | 'inativo' | 'ok';

type ValorSessao = {
  situacao: Situacao;
  sessao: Session | null;
  usuario: Usuario | null;
  recuperandoSenha: boolean;
  // Fornecedor: 'fechado' enquanto nenhuma empresa dele tem o portal liberado (só vê a Homologação);
  // 'aberto' com o portal liberado e homologação feita pelo portal (vê também a aba Homologação, para renovar certidões).
  homologacao: 'nenhuma' | 'fechado' | 'aberto';
  // "Ver como" (só o acesso master): demonstração com dados fictícios ou a sessão de outro usuário, só leitura.
  master: boolean;
  demo: ModoDemo | null;
  verComo: VerComoSalvo | null;
  atualizarHomologacao: () => void;
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
  suprimentos: 'Suprimentos',
};

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [sessaoLida, setSessaoLida] = useState(false);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('carregando');
  const [recuperandoSenha, setRecuperandoSenha] = useState(false);
  const [homologacao, setHomologacao] = useState<ValorSessao['homologacao']>('nenhuma');
  const [versaoHomologacao, setVersaoHomologacao] = useState(0);
  const [real, setReal] = useState<Usuario | null>(null);

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
      setReal(null);
      setUsuario(null);
      setSituacao('fora');
      return;
    }
    let cancelado = false;
    setSituacao('carregando');
    supabase
      .from('usuarios')
      .select('id, nome, email, perfil, ativo, master')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error || !data) {
          setUsuario(null);
          setSituacao('sem_cadastro');
          return;
        }
        // Demonstração: só para o master; as telas passam a ser as do perfil escolhido, com dados fictícios.
        const modo = lerModoDemo();
        if (modo && !(data.master && data.ativo)) desligarDemo();
        if (modo && data.master && data.ativo) {
          setReal(data as Usuario);
          setUsuario(usuarioDemo(modo) as unknown as Usuario);
          setHomologacao(modo === 'homologacao' ? 'fechado' : 'nenhuma');
          setSituacao('ok');
          return;
        }
        setReal(data as Usuario);
        if (data.perfil !== 'fornecedor' || !data.ativo) {
          setHomologacao('nenhuma');
          setUsuario(data as Usuario);
          setSituacao(data.ativo ? 'ok' : 'inativo');
          return;
        }
        // Fornecedor: confere se a empresa ainda está na homologação, antes de mostrar o menu.
        supabase.rpc('minha_homologacao').then(({ data: h }) => {
          if (cancelado) return;
          const lista = (h ?? []) as { liberado: boolean; situacao: string }[];
          setHomologacao(lista.length === 0 ? 'nenhuma' : lista.every((x) => !x.liberado) ? 'fechado' : lista.some((x) => x.situacao === 'homologada') ? 'aberto' : 'nenhuma');
          setUsuario(data as Usuario);
          setSituacao('ok');
        });
      });
    return () => {
      cancelado = true;
    };
  }, [sessaoLida, uid, versaoHomologacao]);

  const valor: ValorSessao = {
    situacao,
    sessao,
    usuario,
    recuperandoSenha,
    homologacao,
    master: !!real?.master && !lerModoDemo(),
    demo: real?.master ? lerModoDemo() : null,
    verComo: (() => {
      const v = lerVerComo();
      return v && usuario && v.alvo.id === usuario.id ? v : null;
    })(),
    atualizarHomologacao: () => setVersaoHomologacao((v) => v + 1),
    // Primeiro acesso por código: a sessão que chega com o código vai direto para a criação da senha.
    iniciarRecuperacao: () => setRecuperandoSenha(true),
    concluirRecuperacao: () => setRecuperandoSenha(false),
    sair: async () => {
      // Dentro do "Ver como", sair é voltar para o próprio acesso.
      if (lerModoDemo() && real?.master) {
        desligarDemo();
        window.location.assign(import.meta.env.BASE_URL + 'ver-como');
        return;
      }
      const v = lerVerComo();
      if (v && usuario && v.alvo.id === usuario.id) {
        const { voltarDoVerComo } = await import('./verComo');
        await voltarDoVerComo();
        return;
      }
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
