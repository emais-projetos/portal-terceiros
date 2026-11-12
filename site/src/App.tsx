import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useSessao, type Perfil } from './lib/sessao';
import { Entrar } from './paginas/Entrar';
import { EsqueciSenha } from './paginas/EsqueciSenha';
import { AceitarConvite } from './paginas/AceitarConvite';
import { NovaSenha } from './paginas/NovaSenha';
import { Inicio } from './paginas/Inicio';
import { AcessoBloqueado } from './paginas/AcessoBloqueado';
import { Acessos } from './paginas/admin/Acessos';
import { Analise } from './paginas/admin/Analise';
import { Colaboradores } from './paginas/admin/Colaboradores';
import { Liberacao } from './paginas/admin/Liberacao';
import { OQueFalta } from './paginas/fornecedor/OQueFalta';
import { MeusColaboradores } from './paginas/fornecedor/MeusColaboradores';
import { DocumentosEmpresa } from './paginas/fornecedor/DocumentosEmpresa';
import { Integracao } from './paginas/Integracao';
import { MedicaoFornecedor } from './paginas/fornecedor/Medicao';
import { Medicoes } from './paginas/admin/Medicoes';
import { Indicadores } from './paginas/admin/Indicadores';
import { Cobrancas } from './paginas/admin/Cobrancas';
import { PainelObra } from './paginas/PainelObra';
import { Carregando } from './componentes/Carregando';

export function App() {
  const { recuperandoSenha } = useSessao();
  const navegar = useNavigate();

  // Quem chega pelo link de redefinição de senha vai direto para a tela de nova senha.
  useEffect(() => {
    if (recuperandoSenha) navegar('/nova-senha', { replace: true });
  }, [recuperandoSenha, navegar]);

  return (
    <Routes>
      <Route path="/entrar" element={<SoForaDoLogin><Entrar /></SoForaDoLogin>} />
      <Route path="/esqueci-senha" element={<SoForaDoLogin><EsqueciSenha /></SoForaDoLogin>} />
      <Route path="/nova-senha" element={<NovaSenha />} />
      <Route path="/acesso" element={<AceitarConvite />} />
      <Route path="/" element={<ComLogin><Inicio /></ComLogin>} />
      <Route path="/painel-obra" element={<SoPerfil perfil={['admin', 'tst', 'engenharia']}><PainelObra /></SoPerfil>} />
      <Route path="/analise" element={<SoAdmin><Analise /></SoAdmin>} />
      <Route path="/colaboradores" element={<SoPerfil perfil={['admin', 'tst']}><Colaboradores /></SoPerfil>} />
      <Route path="/liberacao" element={<SoAdmin><Liberacao /></SoAdmin>} />
      <Route path="/integracoes" element={<SoPerfil perfil={['admin', 'tst']}><Integracao /></SoPerfil>} />
      <Route path="/cobrancas" element={<SoAdmin><Cobrancas /></SoAdmin>} />
      <Route path="/indicadores" element={<SoAdmin><Indicadores /></SoAdmin>} />
      <Route path="/acessos" element={<SoAdmin><Acessos /></SoAdmin>} />
      <Route path="/pendencias" element={<SoPerfil perfil="fornecedor"><OQueFalta /></SoPerfil>} />
      <Route path="/meus-colaboradores" element={<SoPerfil perfil="fornecedor"><MeusColaboradores /></SoPerfil>} />
      <Route path="/documentos-empresa" element={<SoPerfil perfil="fornecedor"><DocumentosEmpresa /></SoPerfil>} />
      <Route path="/medicao" element={<SoPerfil perfil={['admin', 'fornecedor']}><MedicaoPorPerfil /></SoPerfil>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ComLogin({ children }: { children: ReactNode }) {
  const { situacao } = useSessao();
  if (situacao === 'carregando') return <Carregando />;
  if (situacao === 'fora') return <Navigate to="/entrar" replace />;
  if (situacao === 'sem_cadastro' || situacao === 'inativo') return <AcessoBloqueado motivo={situacao} />;
  return <>{children}</>;
}

// As telas também são protegidas no banco; aqui só evitamos mostrar a tela a quem não é do perfil.
function SoPerfil({ perfil, children }: { perfil: Perfil | Perfil[]; children: ReactNode }) {
  const { usuario } = useSessao();
  const aceitos = Array.isArray(perfil) ? perfil : [perfil];
  return (
    <ComLogin>
      {usuario && aceitos.includes(usuario.perfil) ? children : <Navigate to="/" replace />}
    </ComLogin>
  );
}

// A mesma rota serve aos dois perfis: o fornecedor envia, o administrativo confere.
function MedicaoPorPerfil() {
  const { usuario } = useSessao();
  return usuario?.perfil === 'admin' ? <Medicoes /> : <MedicaoFornecedor />;
}

function SoAdmin({ children }: { children: ReactNode }) {
  return <SoPerfil perfil="admin">{children}</SoPerfil>;
}

function SoForaDoLogin({ children }: { children: ReactNode }) {
  const { situacao, recuperandoSenha } = useSessao();
  if (situacao === 'carregando') return <Carregando />;
  if (situacao !== 'fora' && !recuperandoSenha) return <Navigate to="/" replace />;
  return <>{children}</>;
}
