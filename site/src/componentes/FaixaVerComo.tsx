import { useState } from 'react';
import { nomesPerfil, useSessao } from '../lib/sessao';
import { NOMES_DEMO } from '../lib/demonstracao';

// Aviso fixo enquanto o master está no "Ver como": de quem é a tela e o botão para voltar ao próprio acesso.
export function FaixaVerComo() {
  const { demo, verComo, sair } = useSessao();
  const [saindo, setSaindo] = useState(false);
  if (!demo && !verComo) return null;
  const texto = demo
    ? <>Demonstração: <strong>{NOMES_DEMO[demo]}</strong>, dados fictícios</>
    : <>Vendo como <strong>{verComo!.alvo.nome}</strong> ({nomesPerfil[verComo!.alvo.perfil]}), somente leitura</>;
  return (
    <div className="faixa-ver-como" role="status">
      <span>{texto}</span>
      <button
        type="button"
        className="botao botao-pequeno"
        disabled={saindo}
        onClick={() => {
          setSaindo(true);
          sair().catch(() => setSaindo(false));
        }}
      >
        {saindo ? 'Voltando' : 'Voltar para o meu acesso'}
      </button>
    </div>
  );
}
