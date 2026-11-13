import { useCallback, useEffect, useState } from 'react';
import { useSessao } from '../lib/sessao';
import { mensagemDeErro } from '../lib/supabase';
import { acompanharMensagens, enviarMensagem, lerMinhaConversa, marcarLida, naoLidas, type Conversa as TConversa, type Mensagem } from '../lib/ajuda';
import { Conversa } from './Conversa';

// Botão "Ajuda" no canto da tela para fornecedor, TST e engenharia: conversa com a Emais.
// Se ninguém da Emais ler em alguns minutos, o envio automático manda a mensagem por e-mail (e a resposta também).
export function AjudaChat() {
  const { usuario } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [conversa, setConversa] = useState<TConversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!usuario) return;
    const r = await lerMinhaConversa(usuario.id);
    setConversa(r.conversa);
    setMensagens(r.mensagens);
  }, [usuario]);

  useEffect(() => {
    carregar().catch(() => undefined);
  }, [carregar]);

  // Mensagem nova chega na hora; a conversa é criada na primeira mensagem, então escuta tudo o que o banco deixa ver.
  useEffect(() => {
    if (!usuario) return;
    return acompanharMensagens((m) => {
      setMensagens((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      if (!conversa) carregar().catch(() => undefined);
    }, conversa?.id);
  }, [usuario, conversa, carregar]);

  // Com o painel aberto, o que chega já conta como lido.
  const pendentes = aberto ? 0 : naoLidas(mensagens, conversa?.lida_usuario_em ?? null, true);
  useEffect(() => {
    if (!aberto || !conversa) return;
    const agora = new Date().toISOString();
    marcarLida()
      .then(() => setConversa((c) => (c ? { ...c, lida_usuario_em: agora } : c)))
      .catch(() => undefined);
  }, [aberto, conversa?.id, mensagens.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [aberto]);

  if (!usuario || usuario.perfil === 'admin') return null;

  return (
    <>
      <button type="button" className="ajuda-botao" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" />
        </svg>
        <span>Ajuda</span>
        {pendentes > 0 && <span className="contador" aria-label={`${pendentes} novas`}>{pendentes}</span>}
      </button>
      {aberto && (
        <section className="ajuda-painel" role="dialog" aria-label="Ajuda">
          <header className="ajuda-cabecalho">
            <div>
              <strong>Fale com a Emais</strong>
              <small>Tire dúvidas sobre documentos, colaboradores, obras e medição. Respondemos por aqui nos dias úteis; se você sair, a resposta também chega por e-mail.</small>
            </div>
            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setAberto(false)}>Fechar</button>
          </header>
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <Conversa
            mensagens={mensagens}
            meuLado="usuario"
            nomeOutroLado="Emais"
            vazio="Escreva sua dúvida abaixo. Se for sobre um colaborador ou documento, diga o nome para agilizar."
            aoEnviar={async (t) => {
              setErro(null);
              try {
                await enviarMensagem(t);
                await carregar();
              } catch (e) {
                setErro(mensagemDeErro(e as Error));
                throw e;
              }
            }}
          />
        </section>
      )}
    </>
  );
}
