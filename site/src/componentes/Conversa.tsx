import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Mensagem } from '../lib/ajuda';

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Lista de mensagens e caixa de resposta. "meuLado" diz de que lado ficam as mensagens de quem está vendo.
export function Conversa({
  mensagens, meuLado, nomeOutroLado, vazio, aoEnviar, desabilitado,
}: {
  mensagens: Mensagem[];
  meuLado: 'emais' | 'usuario';
  nomeOutroLado: string;
  vazio: string;
  aoEnviar: (texto: string) => Promise<void>;
  desabilitado?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [mensagens.length]);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await aoEnviar(t);
      setTexto('');
    } catch {
      // O erro aparece na tela de quem chamou; o texto fica para tentar de novo.
    } finally {
      setEnviando(false);
    }
  }

  // Enter envia; Shift+Enter quebra a linha.
  function tecla(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  }

  return (
    <div className="chat">
      <div className="chat-mensagens" aria-live="polite">
        {mensagens.length === 0 && <p className="chat-vazio">{vazio}</p>}
        {mensagens.map((m) => {
          const minha = (m.da_emais ? 'emais' : 'usuario') === meuLado;
          return (
            <div key={m.id} className={`chat-linha ${minha ? 'chat-minha' : 'chat-outra'}${m.automatica ? ' chat-automatica' : ''}`}>
              <div className="chat-balao">
                {!minha && <span className="chat-autor">{m.da_emais ? 'Emais' : nomeOutroLado}</span>}
                <span className="chat-texto">{m.texto}</span>
                <span className="chat-hora">{quando(m.criado_em)}</span>
              </div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>
      <form className="chat-envio" onSubmit={enviar}>
        <label className="sr" htmlFor="chat-texto">Mensagem</label>
        <textarea
          id="chat-texto"
          rows={2}
          maxLength={4000}
          placeholder="Escreva a mensagem. Enter envia, Shift+Enter quebra a linha."
          value={texto}
          disabled={desabilitado}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={tecla}
        />
        <button className="botao" type="submit" disabled={!texto.trim() || enviando || desabilitado}>
          {enviando ? 'Enviando' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
