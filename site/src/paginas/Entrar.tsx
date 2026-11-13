import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemDeErro } from '../lib/supabase';
import { Moldura } from '../componentes/Moldura';

export function Entrar() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) setErro(mensagemDeErro(error));
  }

  return (
    <Moldura>
      <form className="formulario" onSubmit={entrar} noValidate>
        <div className="formulario-cabecalho">
          <h2>Acesso ao sistema</h2>
          <p className="apoio">Use o e-mail e a senha cadastrados pela Emais.</p>
        </div>

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

        <div className="campo">
          <label htmlFor="senha">Senha</label>
          <div className="campo-senha">
            <input
              id="senha"
              type={verSenha ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            <button
              type="button"
              className="campo-senha-botao"
              aria-pressed={verSenha}
              aria-controls="senha"
              onClick={() => setVerSenha((v) => !v)}
            >
              {verSenha ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <button className="botao botao-largo" type="submit" disabled={enviando || !email || !senha}>
          {enviando ? 'Entrando' : 'Entrar'}
        </button>

        <Link className="link link-centro" to="/esqueci-senha">Esqueci minha senha</Link>

        <p className="formulario-nota">
          <strong>Primeiro acesso?</strong> Crie sua senha pelo convite enviado ao seu e-mail.
        </p>
      </form>
    </Moldura>
  );
}
