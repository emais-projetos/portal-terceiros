import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ModelosEmail, Regras } from './RegrasEmails';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro, enderecoDoSite } from '../../lib/supabase';
import { nomesPerfil, useSessao, type Perfil } from '../../lib/sessao';
import { formatarCnpj } from '../../lib/consultas';
import { cnpjValido, soDigitos } from '../../lib/formato';
import {
  alterarAtivo, cadastrarEmpresa, copiarTexto, criarAcesso, editarAcesso, enviarAcesso, gerarLinkAcesso, lerAcessos, lerEmpresas, lerEnvioAutomatico,
  lerObras, ligarEmpresasObras, linkOutlook,
  type Acesso, type EmpresaOpcao, type LinkAcesso, type Obra,
} from '../../lib/admin';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

const FILTROS = [
  ['todos', 'Todos'],
  ['nunca', 'Nunca entraram'],
  ['sem_convite', 'Nunca entraram e sem convite enviado'],
  ['erro', 'Convite com erro'],
] as const;
type Filtro = (typeof FILTROS)[number][0];

// Situação do acesso: o último convite pelo envio automático e se a pessoa já entrou.
function SituacaoAcesso({ a }: { a: Acesso }) {
  const c = a.convite;
  const entrou = a.ultimo_login ? <small className="sub">Último acesso em {dia(a.ultimo_login)}</small> : <small className="sub">Nunca entrou</small>;
  if (!c) return entrou;
  const nome = c.tipo === 'primeiro_acesso' ? 'Convite' : 'Nova senha';
  let selo;
  if (c.situacao_envio === 'aguardando' || c.situacao_envio === 'enviando') selo = <span className="selo-envio selo-fila">{nome} na fila: sai em até 10 minutos</span>;
  else if (c.situacao_envio === 'erro') selo = <span className="selo-envio selo-erro">{nome} não saiu: {c.envio_erro}</span>;
  else if (c.usado_em) selo = <span className="selo-envio selo-ok">{nome} usado em {hora(c.usado_em)}</span>;
  else if (c.expira_em && new Date(c.expira_em) < new Date()) selo = <span className="selo-envio selo-erro">{nome} vencido em {dia(c.expira_em)}, sem uso</span>;
  else if (c.envio_teste) selo = <span className="selo-envio selo-teste">{nome} enviado em modo de teste para {c.envio_para} ({hora(c.enviado_em!)})</span>;
  else selo = <span className="selo-envio selo-ok">{nome} enviado em {hora(c.enviado_em!)}</span>;
  return (
    <>
      {selo}
      {entrou}
    </>
  );
}

const ABAS = [
  ['usuarios', 'Usuários'],
  ['regras', 'Regras'],
  ['emails', 'E-mails'],
] as const;
type Aba = (typeof ABAS)[number][0];

export function Acessos() {
  const { usuario } = useSessao();
  const [params, setParams] = useSearchParams();
  const aba: Aba = ABAS.some(([a]) => a === params.get('aba')) ? (params.get('aba') as Aba) : 'usuarios';
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [link, setLink] = useState<LinkAcesso | null>(null);
  const [envio, setEnvio] = useState<Acesso | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [editando, setEditando] = useState<Acesso | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  async function carregar() {
    try {
      const [a, e, o] = await Promise.all([lerAcessos(), lerEmpresas(), lerObras()]);
      setAcessos(a);
      setEmpresas(e);
      setObras(o);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!acessos) return [];
    return acessos.filter((a) => {
      if (filtro === 'nunca' && (a.ultimo_login || !a.ativo)) return false;
      if (filtro === 'sem_convite' && (a.ultimo_login || !a.ativo || (a.convite && a.convite.situacao_envio !== 'erro'))) return false;
      if (filtro === 'erro' && a.convite?.situacao_envio !== 'erro') return false;
      return !t || [a.nome, a.email, ...a.empresas.map((e) => e.razao_social), ...a.obras.map((o) => o.nome)].some((v) => v.toLowerCase().includes(t));
    });
  }, [acessos, busca, filtro]);

  const semAcesso = empresas.filter((e) => !e.temAcesso).length;

  async function pedirLink(a: Acesso) {
    setErro(null);
    setEnvio(null);
    setOcupado(a.id);
    try {
      setLink(await gerarLinkAcesso(a.id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  async function trocarAtivo(a: Acesso) {
    if (a.id === usuario?.id) return;
    setErro(null);
    setOcupado(a.id);
    try {
      await alterarAtivo(a.id, !a.ativo);
      setOk(a.ativo ? `Acesso de ${a.nome} desativado.` : `Acesso de ${a.nome} reativado.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Pagina
      titulo="Acessos"
      apoio={
        aba === 'regras'
          ? 'Prazos das cobranças, validade dos documentos, envio automático e assinatura dos e-mails.'
          : aba === 'emails'
            ? 'Os textos das cobranças. Os dados entram sozinhos nos campos entre chaves, e cada mudança salva vira uma nova revisão.'
            : `Quem entra no portal. ${semAcesso > 0 ? `${semAcesso} empresas ainda não têm acesso.` : 'Todas as empresas já têm acesso.'}`
      }
      acoes={aba === 'usuarios' ? <button className="botao" type="button" onClick={() => setNovoAberto(true)}>Novo acesso</button> : undefined}
      abas={
        <nav className="abas abas-botoes" aria-label="Acessos">
          {ABAS.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'usuarios' ? {} : { aba: a })}>
              {nome}
            </button>
          ))}
        </nav>
      }
    >
      {aba === 'regras' && <Regras />}
      {aba === 'emails' && <ModelosEmail />}
      {aba === 'usuarios' && (
        <>
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="filtros">
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Nome, e-mail, empresa ou obra" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className="campo">
          <span>Mostrar</span>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            {FILTROS.map(([f, nome]) => (
              <option key={f} value={f}>{nome}</option>
            ))}
          </select>
        </label>
      </div>
      {acessos && filtro !== 'todos' && <p className="sub">{filtrados.length} {filtrados.length === 1 ? 'acesso' : 'acessos'}</p>}

      {!acessos && !erro && <Carregando />}
      {acessos && (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Perfil</th>
                <th scope="col">Empresas ou obras</th>
                <th scope="col">Acesso</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((a) => (
                <tr key={a.id} className={a.ativo ? undefined : 'linha-inativa'}>
                  <th scope="row">
                    {a.nome}
                    <small className="sub">{a.email}</small>
                  </th>
                  <td>
                    {nomesPerfil[a.perfil]}
                    {!a.ativo && <small className="sub">Desativado</small>}
                  </td>
                  <td className="quebra">
                    {a.perfil === 'fornecedor' && a.empresas.map((e) => e.razao_social).join(', ')}
                    {(a.perfil === 'tst' || a.perfil === 'engenharia') && a.obras.map((o) => o.nome).join(', ')}
                    {a.perfil === 'admin' && <span className="sub">Todas</span>}
                  </td>
                  <td className="quebra">
                    <SituacaoAcesso a={a} />
                  </td>
                  <td className="acoes">
                    <button className="botao botao-secundario botao-pequeno" type="button" disabled={ocupado === a.id} onClick={() => setEditando(a)}>
                      Editar
                    </button>
                    <button className="botao botao-secundario botao-pequeno" type="button" disabled={!a.ativo || ocupado === a.id} onClick={() => setEnvio(a)}>
                      Enviar acesso
                    </button>
                    {a.id !== usuario?.id && (
                      <button className="botao botao-discreto botao-pequeno" type="button" disabled={ocupado === a.id} onClick={() => trocarAtivo(a)}>
                        {a.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={5} className="vazio-linha">Nenhum acesso encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <EditarAcesso
        acesso={editando}
        empresas={empresas}
        obras={obras}
        aoNovaEmpresa={(e) => setEmpresas((l) => [...l, e].sort((a, b) => a.razao_social.localeCompare(b.razao_social, 'pt-BR')))}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (msg) => {
          setEditando(null);
          setOk(msg);
          await carregar();
        }}
      />
      <NovoAcesso
        aberto={novoAberto}
        empresas={empresas}
        obras={obras}
        aoNovaEmpresa={(e) => setEmpresas((l) => [...l, e].sort((a, b) => a.razao_social.localeCompare(b.razao_social, 'pt-BR')))}
        aoFechar={() => setNovoAberto(false)}
        aoCriar={async (l) => {
          setNovoAberto(false);
          if (l.convite_id) setOk(`Acesso de ${l.nome} criado. O convite para ${l.email} sai pelo envio automático em até 10 minutos (dias úteis, das 7h às 19h).`);
          else {
            if (l.convite_erro) setErro(`Acesso criado, mas o convite não entrou na fila: ${l.convite_erro}`);
            setLink(l);
          }
          await carregar();
        }}
      />
      <ConfirmarEnvio
        acesso={envio}
        aoFechar={() => setEnvio(null)}
        aoGerarLink={(a) => pedirLink(a)}
        aoEnviar={async (msg) => {
          setEnvio(null);
          setOk(msg);
          await carregar();
        }}
      />
      <EnvioDoLink link={link} empresas={acessos?.find((a) => a.id === link?.usuario_id)?.empresas ?? []} aoFechar={() => setLink(null)} />
        </>
      )}
    </Pagina>
  );
}

function NovoAcesso({
  aberto, empresas, obras, aoNovaEmpresa, aoFechar, aoCriar,
}: {
  aberto: boolean;
  empresas: EmpresaOpcao[];
  obras: Obra[];
  aoNovaEmpresa: (e: EmpresaOpcao) => void;
  aoFechar: () => void;
  aoCriar: (l: LinkAcesso) => void;
}) {
  const [perfil, setPerfil] = useState<Perfil>('fornecedor');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [selEmpresas, setSelEmpresas] = useState<string[]>([]);
  const [selObras, setSelObras] = useState<string[]>([]);
  const [obrasForn, setObrasForn] = useState<string[]>([]);
  const [enviarConvite, setEnviarConvite] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setEnviarConvite(true);
      setPerfil('fornecedor');
      setNome('');
      setEmail('');
      setSelEmpresas([]);
      setSelObras([]);
      setObrasForn([]);
      setErro(null);
    }
  }, [aberto]);

  const valido =
    nome.trim().length >= 2 &&
    EMAIL_OK.test(email.trim()) &&
    (perfil !== 'fornecedor' || (selEmpresas.length > 0 && todasComObra(empresas, selEmpresas, obrasForn))) &&
    ((perfil !== 'tst' && perfil !== 'engenharia') || selObras.length > 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setErro(null);
    setEnviando(true);
    try {
      if (perfil === 'fornecedor') await ligarEmpresasObras(selEmpresas, obrasForn);
      const l = await criarAcesso({
        nome: nome.trim(),
        email: email.trim(),
        perfil,
        empresas: perfil === 'fornecedor' ? selEmpresas : [],
        obras: perfil === 'tst' || perfil === 'engenharia' ? selObras : [],
        enviar: enviarConvite,
      });
      aoCriar(l);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Novo acesso" aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <fieldset className="opcoes">
          <legend>Perfil</legend>
          {(['fornecedor', 'tst', 'engenharia', 'admin'] as Perfil[]).map((p) => (
            <label key={p} className="opcao">
              <input type="radio" name="perfil" value={p} checked={perfil === p} onChange={() => setPerfil(p)} />
              <span>{nomesPerfil[p]}</span>
            </label>
          ))}
        </fieldset>

        <div className="grade-2">
          <label className="campo">
            <span>{perfil === 'fornecedor' ? 'Nome do responsável ou da empresa' : 'Nome'}</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
          </label>
          <label className="campo">
            <span>E-mail de acesso</span>
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
        </div>

        {perfil === 'fornecedor' && (
          <SeletorEmpresas
            empresas={empresas}
            obras={obras}
            selecionadas={selEmpresas}
            aoMudar={setSelEmpresas}
            aoNovaEmpresa={(e) => {
              aoNovaEmpresa(e);
              setSelEmpresas((l) => [...l, e.id]);
            }}
          />
        )}
        {perfil === 'fornecedor' && <ObrasDoFornecedor empresas={empresas} selecionadas={selEmpresas} obras={obras} marcadas={obrasForn} aoMudar={setObrasForn} />}

        {(perfil === 'tst' || perfil === 'engenharia') && <SeletorObras perfil={perfil} obras={obras} selecionadas={selObras} aoMudar={setSelObras} />}

        {perfil === 'admin' && <p className="apoio">O administrativo vê todas as obras e é o único perfil que abre os arquivos enviados.</p>}

        <label className="opcao">
          <input type="checkbox" checked={enviarConvite} onChange={(e) => setEnviarConvite(e.target.checked)} />
          <span>Enviar o convite por e-mail pelo envio automático (desmarque para gerar o link e mandar pelo Outlook)</span>
        </label>

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>
            {enviando ? 'Criando' : enviarConvite ? 'Criar acesso e enviar convite' : 'Criar acesso e gerar link'}
          </button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function alternar(lista: string[], id: string) {
  return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
}

// Cada empresa escolhida precisa atuar em pelo menos uma obra (as que já tem ou as marcadas agora).
function todasComObra(empresas: EmpresaOpcao[], selecionadas: string[], marcadas: string[]) {
  if (marcadas.length > 0) return true;
  return selecionadas.every((id) => (empresas.find((e) => e.id === id)?.obras.length ?? 0) > 0);
}

// Obras onde o fornecedor vai atuar. As obras em que a empresa já atua aparecem marcadas e não saem por aqui.
function ObrasDoFornecedor({
  empresas, selecionadas, obras, marcadas, aoMudar,
}: {
  empresas: EmpresaOpcao[];
  selecionadas: string[];
  obras: Obra[];
  marcadas: string[];
  aoMudar: (l: string[]) => void;
}) {
  const escolhidas = empresas.filter((e) => selecionadas.includes(e.id));
  const faltaObra = escolhidas.length > 0 && !todasComObra(empresas, selecionadas, marcadas);
  return (
    <div className="campo">
      <span>Obras onde vai atuar</span>
      <small className="dica">
        Marque uma ou mais. Vale para todas as empresas escolhidas acima. As obras em que a empresa já atua aparecem marcadas.
      </small>
      <ul className="lista-marcar lista-curta" aria-label="Obras onde o fornecedor vai atuar">
        {obras.map((o) => {
          const jaAtuam = escolhidas.filter((e) => e.obras.includes(o.id));
          const todas = escolhidas.length > 0 && jaAtuam.length === escolhidas.length;
          return (
            <li key={o.id}>
              <label>
                <input type="checkbox" disabled={todas} checked={todas || marcadas.includes(o.id)} onChange={() => aoMudar(alternar(marcadas, o.id))} />
                <span>
                  {o.nome}
                  {todas && <small className="sub">já atua</small>}
                  {!todas && jaAtuam.length > 0 && <small className="sub">já atua: {jaAtuam.map((e) => e.razao_social).join(', ')}</small>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {faltaObra && <small className="campo-erro">Escolha pelo menos uma obra para a empresa.</small>}
    </div>
  );
}

// Lista de empresas para ligar ao acesso. "proprias" são as do próprio acesso (na edição), que podem ficar marcadas.
function SeletorEmpresas({
  empresas, obras, selecionadas, proprias = [], aoMudar, aoNovaEmpresa,
}: {
  empresas: EmpresaOpcao[];
  obras: Obra[];
  selecionadas: string[];
  proprias?: string[];
  aoMudar: (l: string[]) => void;
  aoNovaEmpresa: (e: EmpresaOpcao) => void;
}) {
  const [filtro, setFiltro] = useState('');
  const [cadastrando, setCadastrando] = useState(false);
  const lista = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    const d = t.replace(/\D/g, '');
    // As marcadas ficam no topo, para não sumirem no meio da lista.
    return empresas
      .filter((e) => !t || e.razao_social.toLowerCase().includes(t) || (d && e.cnpj.includes(d)))
      .sort((a, b) => Number(selecionadas.includes(b.id)) - Number(selecionadas.includes(a.id)));
  }, [empresas, filtro, selecionadas]);

  return (
    <div className="campo">
      <span>Empresas que este acesso representa</span>
      <small className="dica">Cada empresa tem um único acesso. Um escritório de contabilidade pode responder por várias.</small>
      <div className="em-linha">
        <input type="search" placeholder="Buscar por nome ou CNPJ" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        {!cadastrando && (
          <button type="button" className="botao botao-secundario" onClick={() => setCadastrando(true)}>
            Cadastrar empresa nova
          </button>
        )}
      </div>
      {cadastrando && (
        <NovaEmpresa
          empresas={empresas}
          obras={obras}
          cnpjInicial={soDigitos(filtro).length === 14 ? soDigitos(filtro) : ''}
          aoCancelar={() => setCadastrando(false)}
          aoCriar={(e) => {
            setCadastrando(false);
            setFiltro('');
            aoNovaEmpresa(e);
          }}
        />
      )}
      <ul className="lista-marcar" aria-label="Empresas">
        {lista.map((e) => {
          const ocupada = e.temAcesso && !proprias.includes(e.id);
          return (
            <li key={e.id}>
              <label className={ocupada ? 'desativada' : undefined}>
                <input type="checkbox" disabled={ocupada} checked={selecionadas.includes(e.id)} onChange={() => aoMudar(alternar(selecionadas, e.id))} />
                <span>
                  {e.razao_social}
                  <small className="sub">
                    {formatarCnpj(e.cnpj)}
                    {ocupada ? ', já tem acesso' : ''}
                  </small>
                </span>
              </label>
            </li>
          );
        })}
        {lista.length === 0 && <li className="sub">Nenhuma empresa encontrada. Se for um fornecedor novo, use "Cadastrar empresa nova".</li>}
      </ul>
    </div>
  );
}

function SeletorObras({ perfil, obras, selecionadas, aoMudar }: { perfil: Perfil; obras: Obra[]; selecionadas: string[]; aoMudar: (l: string[]) => void }) {
  return (
    <div className="campo">
      <span>{perfil === 'tst' ? 'Obras sob responsabilidade' : 'Obras que a engenharia acompanha'}</span>
      <small className="dica">
        {perfil === 'tst'
          ? 'Marque todas as obras pelas quais o TST responde. Ele valida os colaboradores e registra a integração só nelas.'
          : 'Só leitura: vê a integração, a conformidade documental e a medição das obras marcadas. Não vê CPF nem arquivos.'}
      </small>
      <ul className="lista-marcar lista-curta" aria-label="Obras">
        {obras.map((o) => (
          <li key={o.id}>
            <label>
              <input type="checkbox" checked={selecionadas.includes(o.id)} onChange={() => aoMudar(alternar(selecionadas, o.id))} />
              <span>{o.nome}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Fornecedor que ainda não está na base: cadastra a empresa e as obras onde vai trabalhar.
function NovaEmpresa({
  empresas, obras, cnpjInicial, aoCancelar, aoCriar,
}: {
  empresas: EmpresaOpcao[];
  obras: Obra[];
  cnpjInicial: string;
  aoCancelar: () => void;
  aoCriar: (e: EmpresaOpcao) => void;
}) {
  const [razao, setRazao] = useState('');
  const [cnpj, setCnpj] = useState(cnpjInicial ? formatarCnpj(cnpjInicial) : '');
  const [emailContato, setEmailContato] = useState('');
  const [selObras, setSelObras] = useState<string[]>([]);
  const [sub, setSub] = useState(false);
  const [principal, setPrincipal] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const digitos = soDigitos(cnpj);
  const cnpjOk = cnpjValido(digitos);
  const existente = empresas.find((e) => e.cnpj === digitos);
  const emailOk = !emailContato.trim() || EMAIL_OK.test(emailContato.trim());
  const valido = razao.trim().length >= 3 && cnpjOk && !existente && emailOk && selObras.length > 0 && (!sub || !!principal);

  async function salvar() {
    if (!valido) return;
    setErro(null);
    setEnviando(true);
    try {
      const e = await cadastrarEmpresa({
        razao_social: razao.trim().replace(/\s+/g, ' ').toUpperCase(),
        cnpj: digitos,
        email_contato: emailContato.trim().toLowerCase() || null,
        obras: selObras,
        subcontratada: sub,
        empresa_principal_id: sub ? principal : null,
      });
      aoCriar(e);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  // Não é um <form>: fica dentro do formulário do acesso. Enter aqui cadastra a empresa, não o acesso.
  return (
    <div
      className="caixa formulario formulario-largo"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          salvar();
        }
      }}
    >
      <h3 className="detalhe-subtitulo">Cadastrar empresa nova</h3>
      <div className="grade-2">
        <label className="campo">
          <span>Razão social</span>
          <input value={razao} onChange={(e) => setRazao(e.target.value)} autoComplete="off" />
        </label>
        <label className="campo">
          <span>CNPJ</span>
          <input inputMode="numeric" placeholder="00.000.000/0000-00" value={cnpj} aria-invalid={digitos.length === 14 && !cnpjOk} onChange={(e) => setCnpj(e.target.value)} />
          {digitos.length === 14 && !cnpjOk && <small className="campo-erro">CNPJ inválido. Confira os números.</small>}
          {existente && <small className="campo-erro">Este CNPJ já está cadastrado: {existente.razao_social}. Procure na lista.</small>}
        </label>
      </div>
      <label className="campo">
        <span>E-mail de contato da empresa (opcional)</span>
        <input type="email" inputMode="email" value={emailContato} onChange={(e) => setEmailContato(e.target.value)} autoComplete="off" />
        <small className="dica">Usado nas cobranças de documentos e medição. Se ficar em branco, vale o e-mail do acesso.</small>
        {!emailOk && <small className="campo-erro">E-mail inválido.</small>}
      </label>
      <div className="campo">
        <span>Obras onde vai trabalhar</span>
        <ul className="lista-marcar lista-curta" aria-label="Obras da empresa">
          {obras.map((o) => (
            <li key={o.id}>
              <label>
                <input type="checkbox" checked={selObras.includes(o.id)} onChange={() => setSelObras((l) => alternar(l, o.id))} />
                <span>{o.nome}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <label className="opcao">
        <input type="checkbox" checked={sub} onChange={(e) => setSub(e.target.checked)} />
        <span>É subcontratada de outra empresa (pede o contrato entre as partes)</span>
      </label>
      {sub && (
        <label className="campo">
          <span>Empresa principal</span>
          <select value={principal} onChange={(e) => setPrincipal(e.target.value)}>
            <option value="">Escolha a empresa</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.razao_social}</option>
            ))}
          </select>
        </label>
      )}
      {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
      <div className="linha-botoes">
        <button type="button" className="botao" disabled={!valido || enviando} onClick={salvar}>
          {enviando ? 'Cadastrando' : 'Cadastrar empresa'}
        </button>
        <button type="button" className="botao botao-discreto" onClick={aoCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

function EditarAcesso({
  acesso, empresas, obras, aoNovaEmpresa, aoFechar, aoSalvar,
}: {
  acesso: Acesso | null;
  empresas: EmpresaOpcao[];
  obras: Obra[];
  aoNovaEmpresa: (e: EmpresaOpcao) => void;
  aoFechar: () => void;
  aoSalvar: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [selEmpresas, setSelEmpresas] = useState<string[]>([]);
  const [selObras, setSelObras] = useState<string[]>([]);
  const [obrasForn, setObrasForn] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!acesso) return;
    setNome(acesso.nome);
    setEmail(acesso.email);
    setSelEmpresas(acesso.empresas.map((e) => e.id));
    setSelObras(acesso.obras.map((o) => o.id));
    setObrasForn([]);
    setErro(null);
  }, [acesso]);

  if (!acesso) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const perfil = acesso.perfil;
  const trocaEmail = email.trim().toLowerCase() !== acesso.email.toLowerCase();
  const valido =
    nome.trim().length >= 2 &&
    EMAIL_OK.test(email.trim()) &&
    (perfil !== 'fornecedor' || selEmpresas.length > 0) &&
    ((perfil !== 'tst' && perfil !== 'engenharia') || selObras.length > 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido || !acesso) return;
    setErro(null);
    setEnviando(true);
    try {
      if (perfil === 'fornecedor') await ligarEmpresasObras(selEmpresas, obrasForn);
      const r = await editarAcesso({
        usuario_id: acesso.id,
        nome: nome.trim(),
        email: email.trim(),
        empresas: perfil === 'fornecedor' ? selEmpresas : [],
        obras: perfil === 'tst' || perfil === 'engenharia' ? selObras : [],
      });
      aoSalvar(
        r.trocou_email
          ? `Acesso de ${r.nome} atualizado. O login agora é ${r.email}; a senha continua a mesma. Se a pessoa ainda não entrou, use "Enviar acesso" para mandar um novo convite.`
          : `Acesso de ${r.nome} atualizado.`,
      );
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto titulo={`Editar acesso: ${acesso.nome}`} aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <p className="apoio">Perfil: {nomesPerfil[perfil]}. Para trocar o perfil, desative este acesso e crie outro.</p>
        <div className="grade-2">
          <label className="campo">
            <span>{perfil === 'fornecedor' ? 'Nome do responsável ou da empresa' : 'Nome'}</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
          </label>
          <label className="campo">
            <span>E-mail de acesso</span>
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            {trocaEmail && <small className="dica">O login passa a ser o novo e-mail. A senha não muda.</small>}
          </label>
        </div>

        {perfil === 'fornecedor' && (
          <SeletorEmpresas
            empresas={empresas}
            obras={obras}
            selecionadas={selEmpresas}
            proprias={acesso.empresas.map((e) => e.id)}
            aoMudar={setSelEmpresas}
            aoNovaEmpresa={(e) => {
              aoNovaEmpresa(e);
              setSelEmpresas((l) => [...l, e.id]);
            }}
          />
        )}
        {perfil === 'fornecedor' && <ObrasDoFornecedor empresas={empresas} selecionadas={selEmpresas} obras={obras} marcadas={obrasForn} aoMudar={setObrasForn} />}
        {(perfil === 'tst' || perfil === 'engenharia') && <SeletorObras perfil={perfil} obras={obras} selecionadas={selObras} aoMudar={setSelObras} />}
        {perfil === 'admin' && <p className="dica">O administrativo vê todas as obras.</p>}

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>{enviando ? 'Salvando' : 'Salvar alterações'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function EnvioDoLink({ link, empresas, aoFechar }: { link: LinkAcesso | null; empresas: { razao_social: string }[]; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  useEffect(() => setCopiado(null), [link]);
  if (!link) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;

  const primeiroNome = link.nome.split(' ')[0];
  const motivo =
    link.perfil === 'fornecedor'
      ? `É por ele que ${empresas.length === 1 ? `a ${empresas[0].razao_social}` : 'as suas empresas'} vai cadastrar os colaboradores e enviar a documentação para as obras da Emais.`
      : link.perfil === 'tst'
        ? 'É por ele que você vai consultar os colaboradores das suas obras e dar a validação final da segurança do trabalho.'
        : link.perfil === 'engenharia'
          ? 'É por ele que você vai acompanhar, nas suas obras, a integração dos terceiros, a situação dos documentos e a medição de cada empresa, com quem está liberado para pagamento.'
        : 'É por ele que você vai conferir a documentação dos terceiros e liberar os colaboradores para as obras.';
  const assunto = link.primeiro_acesso ? 'Seu acesso ao Portal de Terceiros da Emais' : 'Nova senha do Portal de Terceiros da Emais';
  const corpo = link.primeiro_acesso
    ? `Olá, ${primeiroNome},\n\nSeu acesso ao Portal de Terceiros do Grupo Emais foi criado. ${motivo}\n\nPara criar sua senha, abra o link abaixo. Ele só pode ser usado uma vez e vale por tempo limitado; se não funcionar, responda este e-mail que mandamos outro.\n\n${link.link}\n\nDepois, entre sempre por ${enderecoDoSite} com o e-mail ${link.email}.\n\nAtenciosamente,\nGente e Gestão\nGrupo Emais`
    : `Olá, ${primeiroNome},\n\nSegue o link para criar uma nova senha no Portal de Terceiros do Grupo Emais. Ele só pode ser usado uma vez e vale por tempo limitado.\n\n${link.link}\n\nDepois, entre por ${enderecoDoSite} com o e-mail ${link.email}.\n\nAtenciosamente,\nGente e Gestão\nGrupo Emais`;

  async function copiar(texto: string, qual: string) {
    try {
      await copiarTexto(texto);
      setCopiado(qual);
    } catch {
      setCopiado('falhou');
    }
  }

  return (
    <Dialogo aberto titulo={link.primeiro_acesso ? 'Acesso criado' : 'Link de nova senha'} aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        <p className="apoio">
          Envie o e-mail abaixo para <strong>{link.email}</strong> pelo seu Outlook. Este link do Supabase vence em pouco tempo; para um link
          que dure mais, use Enviar acesso, que manda pelo envio automático.
        </p>
        <div className="previa-email">
          <p><span className="sub">Assunto</span> {assunto}</p>
          <pre>{corpo}</pre>
        </div>
        <div className="linha-botoes">
          <a className="botao" href={linkOutlook(link.email, assunto, corpo)}>Abrir no Outlook</a>
          <button className="botao botao-secundario" type="button" onClick={() => copiar(corpo, 'texto')}>Copiar texto</button>
          <button className="botao botao-discreto" type="button" onClick={() => copiar(link.link, 'link')}>Copiar só o link</button>
        </div>
        {copiado === 'texto' && <p className="aviso aviso-ok" role="status">Texto copiado.</p>}
        {copiado === 'link' && <p className="aviso aviso-ok" role="status">Link copiado.</p>}
        {copiado === 'falhou' && <p className="aviso aviso-erro" role="alert">O navegador não deixou copiar. Selecione o texto e copie com Ctrl+C.</p>}
      </div>
    </Dialogo>
  );
}

function ConfirmarEnvio({
  acesso, aoFechar, aoGerarLink, aoEnviar,
}: {
  acesso: Acesso | null;
  aoFechar: () => void;
  aoGerarLink: (a: Acesso) => void;
  aoEnviar: (mensagem: string) => void;
}) {
  const [cfg, setCfg] = useState<{ testePara: string; pausado: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!acesso) return;
    setErro(null);
    setCfg(null);
    lerEnvioAutomatico().then(setCfg).catch(() => setCfg({ testePara: '', pausado: false }));
  }, [acesso]);

  if (!acesso) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const primeiro = !acesso.ultimo_login;
  const naFila = acesso.convite && (acesso.convite.situacao_envio === 'aguardando' || acesso.convite.situacao_envio === 'enviando');

  async function enviar() {
    if (!acesso) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await enviarAcesso(acesso.id);
      aoEnviar(
        `${r.convite.tipo === 'primeiro_acesso' ? 'Convite' : 'Link de nova senha'} para ${r.email} na fila. ` +
          (cfg?.testePara ? `Modo de teste ligado: vai para ${cfg.testePara}.` : 'Sai pelo envio automático em até 10 minutos (dias úteis, das 7h às 19h).'),
      );
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto titulo={primeiro ? `Enviar convite: ${acesso.nome}` : `Enviar nova senha: ${acesso.nome}`} aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        <p className="apoio">
          {primeiro
            ? <>Vai para <strong>{acesso.email}</strong> o e-mail de primeiro acesso, com o link para criar a senha.</>
            : <>Esta pessoa já entrou no portal. Vai para <strong>{acesso.email}</strong> o e-mail com o link para criar uma nova senha.</>}{' '}
          O texto é o de Acessos &gt; E-mails, e o link vale pelos dias definidos em Acessos &gt; Regras.
        </p>
        {naFila && <p className="aviso">Já existe um envio na fila para esta pessoa. Enviar de novo troca o anterior.</p>}
        {acesso.convite?.situacao_envio === 'enviado' && !acesso.convite.usado_em && (
          <p className="sub">O link enviado em {hora(acesso.convite.enviado_em!)} deixa de valer quando sair o novo.</p>
        )}
        {cfg?.testePara && <p className="aviso">Modo de teste ligado em Acessos &gt; Regras: o e-mail vai para {cfg.testePara}, com o destinatário real no assunto.</p>}
        {cfg?.pausado && <p className="aviso">O envio automático está pausado em Acessos &gt; Regras. O e-mail fica na fila até voltar.</p>}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="button" disabled={enviando || !cfg} onClick={enviar}>{enviando ? 'Enviando' : 'Enviar pelo envio automático'}</button>
          <button className="botao botao-secundario" type="button" disabled={enviando} onClick={() => aoGerarLink(acesso)}>Gerar link para o Outlook</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </div>
    </Dialogo>
  );
}
