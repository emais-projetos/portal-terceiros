import { useEffect, useRef, useState } from 'react';
import { Dialogo } from './Dialogo';

// Assinatura com o dedo (celular) ou o mouse. Devolve um PNG com fundo transparente.
export function Assinatura({ aberto, nome, aoFechar, aoConfirmar }: { aberto: boolean; nome: string; aoFechar: () => void; aoConfirmar: (png: Blob) => Promise<void> | void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vazio, setVazio] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Ajusta o tamanho real do desenho ao tamanho na tela (e à densidade do celular).
  useEffect(() => {
    if (!aberto) return;
    setVazio(true);
    const t = window.setTimeout(() => {
      const c = canvas.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * d);
      c.height = Math.round(r.height * d);
      const ctx = c.getContext('2d')!;
      ctx.scale(d, d);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1b2a33';
    }, 50);
    return () => window.clearTimeout(t);
  }, [aberto]);

  function ponto(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inicio(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    desenhando.current = true;
    ultimo.current = ponto(e);
    const ctx = canvas.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(ultimo.current.x, ultimo.current.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1b2a33';
    ctx.fill();
    setVazio(false);
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current || !ultimo.current) return;
    const p = ponto(e);
    const ctx = canvas.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
  }

  function fim() {
    desenhando.current = false;
    ultimo.current = null;
  }

  function limpar() {
    const c = canvas.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setVazio(true);
  }

  async function confirmar() {
    const c = canvas.current;
    if (!c || vazio) return;
    setSalvando(true);
    try {
      const png = await new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível gravar a assinatura.'))), 'image/png'));
      await aoConfirmar(png);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo={`Assinatura de ${nome || 'quem assina'}`} aoFechar={aoFechar}>
      {aberto && (
        <div className="formulario formulario-largo">
          <p className="dica">Assine com o dedo dentro do quadro. No celular, gire a tela para ter mais espaço.</p>
          <canvas
            ref={canvas}
            className="quadro-assinatura"
            onPointerDown={inicio}
            onPointerMove={mover}
            onPointerUp={fim}
            onPointerCancel={fim}
            onPointerLeave={fim}
            aria-label="Quadro para assinar"
          />
          <div className="linha-botoes">
            <button type="button" className="botao" disabled={vazio || salvando} onClick={confirmar}>{salvando ? 'Gravando' : 'Confirmar assinatura'}</button>
            <button type="button" className="botao botao-secundario" disabled={vazio || salvando} onClick={limpar}>Limpar</button>
            <button type="button" className="botao botao-discreto" onClick={aoFechar}>Cancelar</button>
          </div>
        </div>
      )}
    </Dialogo>
  );
}
