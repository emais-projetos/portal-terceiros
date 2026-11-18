import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, mensagemDeErro } from '../lib/supabase';
import { useSessao } from '../lib/sessao';
import { Moldura } from '../componentes/Moldura';
import { Carregando } from '../componentes/Carregando';

// Mesma regra configurada no Supabase (Authentication > Sign In / Providers > Email).
const TAMANHO_MINIMO = 10;
const REGRAS: [string, (s: string) => boolean][] = [
  [`pelo menos ${TAMANHO_MINIMO} caracteres`, (s) => s.length >= TAMANHO_MINIMO],
  ['uma letra maiúscula', (s) => /[A-Z]/.test(s)],
  ['uma letra minúscula', (s) => /[a-z]/.test(s)],
  ['um número', (s) => /\d/.test(s)],
  ['um símbolo (ex.: ! @ # $ %)', (s) => /[^A-Za-z0-9]/.test(s)],
];

export function NovaSenha() {
  const { situacao, sessao, concluirRecuperacao } = useSessao();
  const navegar = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (situacao === 'carregando' && !sessao) return <Carregando />;

  if (!sessao) {
    return (
      <Moldura>
        <div className="formulario">
          <h2>Link vencido</h2>
          <p className="apoio">
            O link para criar a senha já foi usado ou passou do prazo. Peça um novo e abra no mesmo aparelho.
          </p>
          <Link className="botao" to="/esqueci-senha">Pedir novo link</Link>
        </div>
      </Moldura>
    );
  }

  const faltam = REGRAS.filter(([, ok]) => !ok(senha));
  const fraca = senha.length > 0 && faltam.length > 0;
  const diferente = confirmacao.length > 0 && confirmacao !== senha;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (faltam.length > 0 || senha !== confirmacao) return;
    setErro(null);
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    concluirRecuperacao();
    navegar('/', { replace: true });
  }

  return (
    <Moldura>
      <form className="formulario" onSubmit={salvar} noValidate>
        <h2>Crie sua senha</h2>
        <p className="apoio">
          Acesso de {sessao.user.email}. A senha precisa ter pelo menos {TAMANHO_MINIMO} caracteres, com letra maiúscula, letra minúscula, número e
          símbolo.
        </p>

        <label className="campo">
          <span>Nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={senha}
            aria-invalid={fraca}
            aria-describedby="regras-senha"
            onChange={(e) => setSenha(e.target.value)}
          />
          <ul className="regras-senha" id="regras-senha">
            {REGRAS.map(([rotulo, ok]) => (
              <li key={rotulo} className={ok(senha) ? 'ok' : ''}>
                {ok(senha) ? '✓' : '·'} {rotulo}
              </li>
            ))}
          </ul>
        </label>

        <label className="campo">
          <span>Repita a senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            aria-invalid={diferente}
            onChange={(e) => setConfirmacao(e.target.value)}
          />
          {diferente && <small className="campo-erro">As duas senhas não estão iguais.</small>}
        </label>

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <button
          className="botao"
          type="submit"
          disabled={salvando || faltam.length > 0 || senha !== confirmacao}
        >
          {salvando ? 'Salvando' : 'Salvar senha'}
        </button>
      </form>
    </Moldura>
  );
}
