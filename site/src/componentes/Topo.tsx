import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSessao, nomesPerfil, type Perfil } from '../lib/sessao';
import { contarAguardandoTst, contarEmAnalise } from '../lib/admin';
import { contarCobrancas } from '../lib/cobrancas';
import { contarAtendimento } from '../lib/ajuda';
import { lerRegras } from '../lib/regras';

// Menu lateral fixo: fica parado ao rolar, pode ser recolhido (só ícones) e, no celular, abre por cima da tela.

const ICONES: Record<string, ReactNode> = {
  obras: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" />,
  painel: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  indicadores: <path d="M3 3v18h18M8 17v-6M13 17V7M18 17v-4" />,
  analise: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 15l2 2 4-4" />
    </>
  ),
  pendencias: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  colaboradores: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
    </>
  ),
  documentos: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  liberacao: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  integracao: (
    <>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  medicao: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-4" />
    </>
  ),
  cobrancas: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  ajuda: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" />,
  acessos: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  sair: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  recolher: <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />,
  abrir: <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  fechar: <path d="M6 6l12 12M18 6 6 18" />,
};

function Icone({ nome, tamanho = 20 }: { nome: string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONES[nome]}
    </svg>
  );
}

type Item = {
  to: string;
  rotulo: string;
  icone: string;
  contador?: number | null;
  end?: boolean;
  // Quando a rota sozinha não basta (ex.: Colaboradores x Para validar, que usam a mesma página).
  ativo?: (caminho: string, busca: string) => boolean;
  filhos?: { to: string; rotulo: string; ativo: (caminho: string, busca: string) => boolean }[];
};
type Grupo = { titulo: string | null; itens: Item[] };

const abaAcessos = (aba: string) => (caminho: string, busca: string) =>
  caminho.startsWith('/acessos') && (new URLSearchParams(busca).get('aba') ?? 'usuarios') === aba;

function gruposDoMenu(perfil: Perfil | undefined, naFila: number | null, cobrancas: number | null, atendimento: number | null = null): Grupo[] {
  const paraValidar = (_: string, busca: string) => busca.includes('situacao=tst');
  if (perfil === 'admin')
    return [
      {
        titulo: 'Acompanhamento',
        itens: [
          { to: '/', rotulo: 'Obras', icone: 'obras', end: true },
          { to: '/painel-obra', rotulo: 'Painel da obra', icone: 'painel' },
          { to: '/indicadores', rotulo: 'Indicadores', icone: 'indicadores' },
          { to: '/atendimento', rotulo: 'Atendimento', icone: 'ajuda', contador: atendimento },
        ],
      },
      {
        titulo: 'Documentos e liberação',
        itens: [
          { to: '/analise', rotulo: 'Análise de documentos', icone: 'analise', contador: naFila },
          { to: '/colaboradores', rotulo: 'Colaboradores', icone: 'colaboradores' },
          { to: '/liberacao', rotulo: 'Aviso de liberação', icone: 'liberacao' },
          { to: '/integracoes', rotulo: 'Integração', icone: 'integracao' },
        ],
      },
      {
        titulo: 'Medição e cobrança',
        itens: [
          { to: '/medicao', rotulo: 'Medição', icone: 'medicao' },
          { to: '/cobrancas', rotulo: 'Cobranças', icone: 'cobrancas', contador: cobrancas },
        ],
      },
      {
        titulo: 'Configuração',
        itens: [
          {
            to: '/acessos',
            rotulo: 'Acessos',
            icone: 'acessos',
            filhos: [
              { to: '/acessos', rotulo: 'Usuários', ativo: abaAcessos('usuarios') },
              { to: '/acessos?aba=regras', rotulo: 'Regras', ativo: abaAcessos('regras') },
              { to: '/acessos?aba=emails', rotulo: 'E-mails', ativo: abaAcessos('emails') },
            ],
          },
        ],
      },
    ];
  if (perfil === 'tst')
    return [
      {
        titulo: 'Segurança do Trabalho',
        itens: [
          { to: '/', rotulo: 'Painel da obra', icone: 'painel', end: true },
          { to: '/colaboradores?situacao=tst', rotulo: 'Para validar', icone: 'analise', contador: naFila, ativo: (c, b) => c === '/colaboradores' && paraValidar(c, b) },
          { to: '/integracoes', rotulo: 'Integração', icone: 'integracao' },
          { to: '/colaboradores', rotulo: 'Colaboradores', icone: 'colaboradores', ativo: (c, b) => c === '/colaboradores' && !paraValidar(c, b) },
        ],
      },
    ];
  if (perfil === 'engenharia') return [{ titulo: 'Engenharia', itens: [{ to: '/', rotulo: 'Painel da obra', icone: 'painel', end: true }] }];
  if (perfil === 'fornecedor')
    return [
      {
        titulo: 'Minha empresa',
        itens: [
          { to: '/', rotulo: 'Obras', icone: 'obras', end: true },
          { to: '/pendencias', rotulo: 'O que falta', icone: 'pendencias' },
          { to: '/meus-colaboradores', rotulo: 'Colaboradores', icone: 'colaboradores' },
          { to: '/documentos-empresa', rotulo: 'Documentos da empresa', icone: 'documentos' },
          { to: '/medicao', rotulo: 'Mensal trabalhista', icone: 'medicao' },
        ],
      },
    ];
  return [];
}

// Nome do grupo da página aberta, mostrado acima do título.
export function grupoDaPagina(perfil: Perfil | undefined, caminho: string, busca: string): string | null {
  for (const g of gruposDoMenu(perfil, null, null))
    for (const i of g.itens) {
      const rota = i.to.split('?')[0];
      const bate = i.ativo ? i.ativo(caminho, busca) : i.end ? caminho === rota : caminho === rota || caminho.startsWith(`${rota}/`);
      if (bate) return g.titulo;
    }
  return null;
}

const CHAVE_RECOLHIDO = 'portal-menu-recolhido';

function lerRecolhido(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_RECOLHIDO) === 'sim';
  } catch {
    return false;
  }
}

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .filter((_, i, l) => i === 0 || i === l.length - 1)
    .join('')
    .toUpperCase();

export function Topo() {
  const { usuario, sair } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const ehTst = usuario?.perfil === 'tst';
  const { search, pathname } = useLocation();
  const [cobrancas, setCobrancas] = useState<number | null>(null);
  const [naFila, setNaFila] = useState<number | null>(null);
  const [atendimento, setAtendimento] = useState<number | null>(null);
  const [recolhido, setRecolhido] = useState(lerRecolhido);
  const [aberto, setAberto] = useState(false); // celular

  useEffect(() => {
    if (!ehAdmin && !ehTst) return;
    const contar = ehAdmin ? contarEmAnalise : contarAguardandoTst;
    contar().then(setNaFila).catch(() => setNaFila(null));
    const t = window.setInterval(() => contar().then(setNaFila).catch(() => undefined), 60000);
    return () => window.clearInterval(t);
  }, [ehAdmin, ehTst]);

  // Conversas da Ajuda sem leitura e pedidos de obra esperando resposta.
  useEffect(() => {
    if (!ehAdmin) return;
    const contar = () => contarAtendimento().then(setAtendimento).catch(() => undefined);
    contar();
    const t = window.setInterval(contar, 60000);
    return () => window.clearInterval(t);
  }, [ehAdmin, pathname]);

  // Prazos da medição usados nas telas (Acessos > Regras).
  useEffect(() => {
    if (usuario) lerRegras().catch(() => undefined);
  }, [usuario]);

  // E-mails de cobrança prontos no dia (calculado no máximo a cada 5 minutos).
  useEffect(() => {
    if (!ehAdmin || !usuario) return;
    contarCobrancas(usuario.nome).then(setCobrancas).catch(() => setCobrancas(null));
  }, [ehAdmin, usuario, pathname]);

  // No celular, o menu fecha ao trocar de página.
  useEffect(() => setAberto(false), [pathname, search]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [aberto]);

  function alternarRecolhido() {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      window.localStorage.setItem(CHAVE_RECOLHIDO, novo ? 'sim' : 'nao');
    } catch {
      // Sem armazenamento no navegador: vale só nesta visita.
    }
  }

  const grupos = gruposDoMenu(usuario?.perfil, naFila, cobrancas, atendimento);
  const estaAtivo = (i: Item) => (i.ativo ? i.ativo(pathname, search) : undefined);

  return (
    <>
      <div className="barra-celular">
        <button type="button" className="barra-celular-botao" aria-label="Abrir menu" aria-expanded={aberto} onClick={() => setAberto(true)}>
          <Icone nome="menu" tamanho={22} />
        </button>
        <span className="barra-celular-nome">Portal de Terceiros</span>
        {ehAdmin && !!cobrancas && <span className="contador">{cobrancas}</span>}
      </div>
      {aberto && <div className="menu-fundo" aria-hidden="true" onClick={() => setAberto(false)} />}

      <aside className={`menu-lateral${recolhido ? ' recolhido' : ''}${aberto ? ' aberto' : ''}`} aria-label="Menu do portal">
        <div className="menu-marca">
          <img src={`${import.meta.env.BASE_URL}icone.svg`} alt="" width={34} height={34} />
          <span className="menu-marca-texto">
            <strong>Portal de Terceiros</strong>
            <small>Grupo Emais</small>
          </span>
          <button type="button" className="menu-fechar" aria-label="Fechar menu" onClick={() => setAberto(false)}>
            <Icone nome="fechar" />
          </button>
        </div>

        <nav className="menu-grupos">
          {grupos.map((g, gi) => (
            <div key={g.titulo ?? gi} className="menu-grupo">
              {g.titulo && <span className="menu-grupo-titulo">{g.titulo}</span>}
              {g.itens.map((i) => {
                const forcado = estaAtivo(i);
                const mostrarFilhos = !!i.filhos && pathname.startsWith(i.to);
                return (
                  <div key={i.to + i.rotulo}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      title={recolhido ? i.rotulo : undefined}
                      aria-label={recolhido ? `${i.rotulo}${i.contador ? `, ${i.contador}` : ''}` : undefined}
                      className={({ isActive }) => `menu-item${(forcado ?? isActive) ? ' ativo' : ''}`}
                    >
                      <Icone nome={i.icone} />
                      <span className="menu-item-rotulo">{i.rotulo}</span>
                      {i.contador ? <span className="contador">{i.contador}</span> : null}
                    </NavLink>
                    {mostrarFilhos && (
                      <div className="menu-filhos">
                        {i.filhos!.map((f) => (
                          <NavLink key={f.rotulo} to={f.to} className={() => `menu-filho${f.ativo(pathname, search) ? ' ativo' : ''}`}>
                            {f.rotulo}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {usuario && (
          <div className="menu-pe">
            <div className="menu-usuario">
              <span className="menu-avatar" title={usuario.nome}>{iniciais(usuario.nome)}</span>
              <span className="menu-usuario-texto">
                <strong>{usuario.nome}</strong>
                <small>{nomesPerfil[usuario.perfil]}</small>
              </span>
              <button type="button" className="menu-icone" aria-label="Sair" title="Sair" onClick={sair}>
                <Icone nome="sair" tamanho={18} />
              </button>
            </div>
            <button type="button" className="menu-recolher" onClick={alternarRecolhido} aria-label={recolhido ? 'Abrir menu' : 'Recolher menu'} title={recolhido ? 'Abrir menu' : undefined}>
              <Icone nome={recolhido ? 'abrir' : 'recolher'} tamanho={18} />
              <span>Recolher menu</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
