import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemDeErro } from '../lib/supabase';
import { useSessao } from '../lib/sessao';
import { Moldura } from '../componentes/Moldura';

// Primeiro acesso ou esqueci a senha: a pessoa digita o e-mail de acesso, recebe um código (gerado no Supabase e
// enviado pelo n8n) e, com o código certo, vai para a criação da senha. E-mail sem acesso recebe a mesma resposta.
export function EsqueciSenha() {
  const { iniciarRecuperacao, concluirRecuperacao } = useSessao();
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const emailLimpo = email.trim().toLowerCase();
  const codigoLimpo = codigo.replace(/\D/g, '');

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault();
    setErro(null);
    setAviso(null);
    setEnviando(true);
    const { error } = await supabase.functions.invoke('enviar-codigo', { body: { email: emailLimpo } });
    setEnviando(false);
    if (error) {
      const r = (error as { context?: Response }).context;
      const j = r && typeof r.json === 'function' ? await r.json().catch(() => null) : null;
      setErro(j?.erro ?? 'Não foi possível enviar o código agora. Tente de novo em instantes.');
      return;
    }
    if (etapa === 'codigo') setAviso('Enviamos um novo código. Use o mais recente: o anterior deixou de valer.');
    setCodigo('');
    setEtapa('codigo');
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (codigoLimpo.length < 6) return;
    setErro(null);
    setAviso(null);
    setConferindo(true);
    // Marca antes de confirmar: a sessão que chega com o código vai direto para a criação da senha.
    iniciarRecuperacao();
    const { error } = await supabase.auth.verifyOtp({ email: emailLimpo, token: codigoLimpo, type: 'email' });
    setConferindo(false);
    if (error) {
      concluirRecuperacao();
      setErro(mensagemDeErro(error));
    }
  }

  function outroEmail() {
    setEtapa('email');
    setCodigo('');
    setErro(null);
    setAviso(null);
  }

  if (etapa === 'codigo') {
    return (
      <Moldura>
        <form className="formulario" onSubmit={confirmar} noValidate>
          <h2>Digite o código</h2>
          <p className="apoio">
            Se <strong>{emailLimpo}</strong> tiver acesso ao portal, chega em instantes um e-mail com o código. Se não
            aparecer, olhe a caixa de spam ou de lixo eletrônico.
          </p>

          <label className="campo">
            <span>Código recebido no e-mail</span>
            <input
              className="campo-codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            />
          </label>

          {aviso && <p className="aviso aviso-ok" role="status">{aviso}</p>}
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

          <button className="botao botao-largo" type="submit" disabled={conferindo || codigoLimpo.length < 6}>
            {conferindo ? 'Conferindo' : 'Continuar'}
          </button>

          <div className="acoes-codigo">
            <button className="link botao-link" type="button" disabled={enviando} onClick={() => pedirCodigo()}>
              {enviando ? 'Enviando' : 'Enviar outro código'}
            </button>
            <button className="link botao-link" type="button" onClick={outroEmail}>Usar outro e-mail</button>
          </div>

          <p className="formulario-nota">
            Não chegou? Confira se digitou o e-mail cadastrado pela Emais para o acesso. Se mesmo assim não chegar, fale
            com o Gente e Gestão da Emais.
          </p>
        </form>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <form className="formulario" onSubmit={pedirCodigo} noValidate>
        <h2>Primeiro acesso ou esqueci a senha</h2>
        <p className="apoio">
          Digite o e-mail de acesso cadastrado pela Emais. Vamos mandar um código para você criar a sua senha.
        </p>

        <label className="campo">
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="nome@suaempresa.com.br"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <button className="botao botao-largo" type="submit" disabled={enviando || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)}>
          {enviando ? 'Enviando' : 'Receber código'}
        </button>

        <Link className="link link-centro" to="/entrar">Voltar para a entrada</Link>
      </form>
    </Moldura>
  );
}
