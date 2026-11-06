import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSessao, nomesPerfil } from '../lib/sessao';
import { contarAguardandoTst, contarEmAnalise } from '../lib/admin';
import { contarCobrancas } from '../lib/cobrancas';

export function Topo() {
  const { usuario, sair } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const ehTst = usuario?.perfil === 'tst';
  const { search, pathname } = useLocation();
  const [cobrancas, setCobrancas] = useState<number | null>(null);
  const naValidacao = search.includes('situacao=tst');
  const [naFila, setNaFila] = useState<number | null>(null);

  useEffect(() => {
    if (!ehAdmin && !ehTst) return;
    const contar = ehAdmin ? contarEmAnalise : contarAguardandoTst;
    contar().then(setNaFila).catch(() => setNaFila(null));
    const t = window.setInterval(() => contar().then(setNaFila).catch(() => undefined), 60000);
    return () => window.clearInterval(t);
  }, [ehAdmin, ehTst]);

  // E-mails de cobrança prontos no dia (calculado no máximo a cada 5 minutos).
  useEffect(() => {
    if (!ehAdmin || !usuario) return;
    contarCobrancas(usuario.nome).then(setCobrancas).catch(() => setCobrancas(null));
  }, [ehAdmin, usuario, pathname]);

  return (
    <header className="topo">
      <div className="topo-linha">
        <div className="topo-marca">
          <img src={`${import.meta.env.BASE_URL}icone.svg`} alt="" width={28} height={28} />
          <span>Portal de Terceiros</span>
        </div>
        {usuario && (
          <div className="topo-usuario">
            <span className="topo-nome">
              {usuario.nome}
              <small>{nomesPerfil[usuario.perfil]}</small>
            </span>
            <button className="botao botao-discreto" type="button" onClick={sair}>
              Sair
            </button>
          </div>
        )}
      </div>
      {ehTst && (
        <nav className="menu" aria-label="Seções do TST">
          <NavLink to="/" end>Painel da obra</NavLink>
          <NavLink to="/colaboradores?situacao=tst" className={({ isActive }) => (isActive && naValidacao ? 'active' : undefined)}>
            Para validar
            {naFila ? <span className="contador" aria-label={`${naFila} para validar`}>{naFila}</span> : null}
          </NavLink>
          <NavLink to="/integracoes">Integração</NavLink>
          <NavLink to="/colaboradores" end className={({ isActive }) => (isActive && !naValidacao ? 'active' : undefined)}>
            Colaboradores
          </NavLink>
        </nav>
      )}
      {usuario?.perfil === 'engenharia' && (
        <nav className="menu" aria-label="Seções da engenharia">
          <NavLink to="/" end>Painel da obra</NavLink>
        </nav>
      )}
      {usuario?.perfil === 'fornecedor' && (
        <nav className="menu" aria-label="Seções do fornecedor">
          <NavLink to="/" end>Obras</NavLink>
          <NavLink to="/pendencias">O que falta</NavLink>
          <NavLink to="/meus-colaboradores">Colaboradores</NavLink>
          <NavLink to="/documentos-empresa">Documentos da empresa</NavLink>
          <NavLink to="/medicao">Mensal trabalhista</NavLink>
        </nav>
      )}
      {ehAdmin && (
        <nav className="menu" aria-label="Seções do administrativo">
          <NavLink to="/" end>Obras</NavLink>
          <NavLink to="/painel-obra">Painel da obra</NavLink>
          <NavLink to="/analise">
            Análise de documentos
            {naFila ? <span className="contador" aria-label={`${naFila} na fila`}>{naFila}</span> : null}
          </NavLink>
          <NavLink to="/colaboradores">Colaboradores</NavLink>
          <NavLink to="/liberacao">Aviso de liberação</NavLink>
          <NavLink to="/integracoes">Integração</NavLink>
          <NavLink to="/medicao">Medição</NavLink>
          <NavLink to="/cobrancas">
            Cobranças
            {cobrancas ? <span className="contador" aria-label={`${cobrancas} e-mails prontos`}>{cobrancas}</span> : null}
          </NavLink>
          <NavLink to="/indicadores">Indicadores</NavLink>
          <NavLink to="/acessos">Acessos</NavLink>
        </nav>
      )}
      {ehAdmin && !!cobrancas && pathname !== '/cobrancas' && (
        <div className="faixa-aviso" role="status">
          <span>
            {cobrancas === 1 ? '1 e-mail de cobrança pronto' : `${cobrancas} e-mails de cobrança prontos`} para conferir e enviar pelo Outlook.
          </span>
          <Link className="botao botao-pequeno" to="/cobrancas">Ver cobranças</Link>
        </div>
      )}
    </header>
  );
}
