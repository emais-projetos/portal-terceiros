import { useEffect, useMemo, useState } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { nomesPerfil } from '../../lib/sessao';
import { mensagemDeErro } from '../../lib/supabase';
import { NOMES_DEMO, ligarDemo, type ModoDemo } from '../../lib/demonstracao';
import { iniciarVerComo, lerVerComo, listarParaVerComo, type UsuarioVerComo } from '../../lib/verComo';

// "Ver como" (só o acesso master): abrir o portal como um usuário real, só para olhar, ou como um perfil
// de demonstração, com dados fictícios. Nada do que se faz aqui grava no banco.

const GRUPOS = [
  ['fornecedor', 'Fornecedores'],
  ['homologacao', 'Em homologação'],
  ['tst', 'TST'],
  ['engenharia', 'Engenharia'],
  ['suprimentos', 'Suprimentos'],
] as const;
type Grupo = (typeof GRUPOS)[number][0];

const grupoDe = (u: UsuarioVerComo): Grupo => (u.perfil === 'fornecedor' ? (u.em_homologacao ? 'homologacao' : 'fornecedor') : u.perfil);
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

const DEMOS: { modo: ModoDemo; texto: string }[] = [
  { modo: 'fornecedor', texto: 'Obras, o que falta, colaboradores, documentos da empresa e mensal trabalhista.' },
  { modo: 'homologacao', texto: 'Empresa nova preenchendo o F.31 e enviando os documentos.' },
  { modo: 'tst', texto: 'Painel da obra, colaboradores para validar, integração e segurança.' },
  { modo: 'engenharia', texto: 'Painel da obra com os faróis e o pagamento de cada empresa.' },
  { modo: 'suprimentos', texto: 'Homologação, cadastro de fornecedores e configuração do formulário.' },
];

export function VerComo() {
  const [usuarios, setUsuarios] = useState<UsuarioVerComo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Grupo>('fornecedor');
  const [busca, setBusca] = useState('');
  const [abrindo, setAbrindo] = useState<string | null>(null);

  useEffect(() => {
    // Sobrou de uma visualização que não foi encerrada pelo botão: limpa.
    if (lerVerComo()) window.localStorage.removeItem('portal-ver-como');
    listarParaVerComo().then(setUsuarios).catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const contagem = useMemo(() => {
    const m = new Map<Grupo, number>();
    (usuarios ?? []).forEach((u) => m.set(grupoDe(u), (m.get(grupoDe(u)) ?? 0) + 1));
    return m;
  }, [usuarios]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (usuarios ?? [])
      .filter((u) => grupoDe(u) === grupo)
      .filter((u) => !b || [u.nome, u.email, ...u.empresas, ...u.obras].some((t) => t.toLowerCase().includes(b)))
      .sort((a, b2) => Number(!a.ultimo_acesso) - Number(!b2.ultimo_acesso) || a.nome.localeCompare(b2.nome, 'pt-BR'));
  }, [usuarios, grupo, busca]);

  async function abrir(u: UsuarioVerComo) {
    setAbrindo(u.id);
    setErro(null);
    try {
      await iniciarVerComo(u.id);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      setAbrindo(null);
    }
  }

  return (
    <Pagina
      titulo="Ver como"
      apoio="Abra o portal como um usuário para ver exatamente o que ele vê, ou como um perfil de demonstração com dados fictícios. Em qualquer um dos dois, nada é gravado."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}

      <section className="bloco">
        <h2 className="bloco-titulo">Modo demonstração</h2>
        <p className="dica">Telas de cada perfil com empresas, obras e colaboradores inventados. Serve para conferir uma tela sem depender de um cadastro real.</p>
        <div className="cartoes cartoes-demo">
          {DEMOS.map((d) => (
            <button
              key={d.modo}
              type="button"
              className="cartao cartao-botao"
              onClick={() => {
                ligarDemo(d.modo);
                window.location.assign(import.meta.env.BASE_URL);
              }}
            >
              <span className="cartao-rotulo">{NOMES_DEMO[d.modo]}</span>
              <span className="sub">{d.texto}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Ver como um usuário</h2>
        <p className="dica">
          O portal abre com o menu, as obras, a empresa e as pendências da pessoa. Enviar, aprovar, salvar e excluir ficam bloqueados. Cada visualização fica registrada no histórico. Quem ainda não entrou no portal não pode ser aberto: use a demonstração.
        </p>
        <nav className="abas abas-botoes" aria-label="Perfis">
          {GRUPOS.map(([g, nome]) => (
            <button key={g} type="button" aria-current={grupo === g ? 'page' : undefined} onClick={() => setGrupo(g)}>
              {nome} <span className="sub">{contagem.get(g) ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="filtros">
          <label className="campo campo-busca">
            <span>Buscar</span>
            <input type="search" value={busca} placeholder="Nome, e-mail, empresa ou obra" onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
        {!usuarios ? (
          !erro && <Carregando />
        ) : lista.length === 0 ? (
          <p className="vazio">Ninguém encontrado neste perfil.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Usuário</th>
                  <th scope="col">{grupo === 'fornecedor' || grupo === 'homologacao' ? 'Empresa' : 'Obras'}</th>
                  <th scope="col">Último acesso</th>
                  <th scope="col"><span className="sr">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.nome}</strong>
                      <br />
                      <span className="sub">{u.email} · {nomesPerfil[u.perfil]}</span>
                    </td>
                    <td>{(u.perfil === 'fornecedor' ? u.empresas : u.perfil === 'suprimentos' ? ['Todas as obras'] : u.obras).join(', ') || '-'}</td>
                    <td>{u.ultimo_acesso ? dia(u.ultimo_acesso) : <span className="sub">Nunca entrou</span>}</td>
                    <td className="acoes">
                      <button type="button" className="botao botao-secundario botao-pequeno" disabled={!u.ultimo_acesso || !!abrindo} onClick={() => abrir(u)}>
                        {abrindo === u.id ? 'Abrindo' : 'Ver como'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Pagina>
  );
}
