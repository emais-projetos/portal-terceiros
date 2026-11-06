import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largura?: 'normal' | 'larga';
};

// Janela sobre a tela, com o <dialog> nativo do navegador (Esc fecha, o foco fica dentro).
// Clicar fora não fecha: num formulário, isso apagava o que já tinha sido digitado.
export function Dialogo({ aberto, titulo, aoFechar, children, largura = 'normal' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // Quando quem fecha é o próprio código (aberto virou false), não avisamos aoFechar de novo.
  const fechandoPorCodigo = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) {
      fechandoPorCodigo.current = true;
      d.close();
    }
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className={`dialogo dialogo-${largura}`}
      onClose={() => {
        if (fechandoPorCodigo.current) {
          fechandoPorCodigo.current = false;
          return;
        }
        aoFechar();
      }}
      aria-labelledby="dialogo-titulo"
    >
      {aberto && (
        <div className="dialogo-conteudo">
          <header className="dialogo-cabecalho">
            <h2 id="dialogo-titulo">{titulo}</h2>
            <button type="button" className="botao botao-discreto" onClick={aoFechar}>
              Fechar
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
