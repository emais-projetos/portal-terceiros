import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Topo, grupoDaPagina } from './Topo';
import { useSessao } from '../lib/sessao';

// Estrutura das telas com login: menu lateral fixo e, à direita, o cabeçalho da página (título, ações e abas),
// que fica preso no topo ao rolar.
export function Pagina({ titulo, apoio, acoes, abas, children }: { titulo: string; apoio?: ReactNode; acoes?: ReactNode; abas?: ReactNode; children: ReactNode }) {
  const { usuario } = useSessao();
  const { pathname, search } = useLocation();
  const grupo = grupoDaPagina(usuario?.perfil, pathname, search);
  return (
    <div className="pagina">
      <Topo />
      <main className="area">
        <header className={`cabecalho-fixo${abas ? ' com-abas' : ''}`}>
          <div className="cabecalho-interno">
            <section className="cabecalho cabecalho-com-acoes">
              <div>
                {grupo && <span className="cabecalho-grupo">{grupo}</span>}
                <h1>{titulo}</h1>
                {apoio && <p className="apoio">{apoio}</p>}
              </div>
              {acoes && <div className="cabecalho-acoes">{acoes}</div>}
            </section>
            {abas}
          </div>
        </header>
        <div className="conteudo">{children}</div>
      </main>
    </div>
  );
}

export function Mensagem({ tipo, children, aoFechar }: { tipo: 'ok' | 'erro'; children: ReactNode; aoFechar?: () => void }) {
  return (
    <div className={`aviso aviso-${tipo} aviso-faixa`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <span>{children}</span>
      {aoFechar && (
        <button type="button" className="botao botao-discreto" onClick={aoFechar}>
          Fechar
        </button>
      )}
    </div>
  );
}
