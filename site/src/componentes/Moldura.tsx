import type { ReactNode } from 'react';

const ICONES = {
  pessoas: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  documento: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </>
  ),
  escudo: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
};

function Icone({ nome, tamanho = 22 }: { nome: keyof typeof ICONES; tamanho?: number }) {
  return (
    <svg aria-hidden="true" width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONES[nome]}
    </svg>
  );
}

// Moldura das telas sem login (entrar, senha, convite): painel da marca à esquerda (no celular, em cima)
// e o cartão do formulário ao lado, com o contato do suporte.
export function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="moldura">
      <aside className="moldura-marca">
        <img className="marca-logo" src={`${import.meta.env.BASE_URL}logo-emais-branco.png`} alt="Emais" />

        <div className="marca-texto">
          <p className="marca-selo">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Portal de Terceiros
          </p>
          <h1>Gestão e conformidade das obras</h1>
          <p className="marca-apoio">Sistema de gestão de terceiros do Grupo Emais.</p>
          <ul className="marca-modulos">
            <li><Icone nome="pessoas" /><span>Empresas e colaboradores</span></li>
            <li><Icone nome="documento" /><span>Documentos e vencimentos</span></li>
            <li><Icone nome="escudo" /><span>Integração e liberação</span></li>
          </ul>
        </div>

        <p className="marca-rodape">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Acesso restrito · Dados protegidos pela LGPD
        </p>
        <div className="faixa-obra" aria-hidden="true" />
      </aside>

      <main className="moldura-conteudo">
        <div className="moldura-cartao">{children}</div>
        <div className="moldura-suporte">
          <span><strong>Suporte:</strong> seg. a sex., 8h às 18h</span>
          <span>
            <a href="mailto:gente10@emais.com">gente10@emais.com</a>
            {' · '}
            <a href="https://wa.me/551735124716" target="_blank" rel="noreferrer">WhatsApp (17) 3512-4716</a>
          </span>
        </div>
        <p className="moldura-copyright">© {new Date().getFullYear()} Grupo Emais · Portal de Terceiros</p>
      </main>
    </div>
  );
}
