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
  alterarAtivo, cadastrarEmpresa, copiarTexto, criarAcesso, editarAcesso, gerarLinkAcesso, lerAcessos, lerEmpresas, lerObras, linkOutlook,
  type Acesso, type EmpresaOpcao, type LinkAcesso, type Obra,
} from '../../lib/admin';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!t) return acessos;
    return acessos.filter((a) =>
      [a.nome, a.email, ...a.empresas.map((e) => e.razao_social), ...a.obras.map((o) => o.nome)].some((v) => v.toLowerCase().includes(t)),
    );
  }, [acessos, busca]);

  const semAcesso = empresas.filter((e) => !e.temAcesso).length;

  async function pedirLink(a: Acesso) {
    setErro(null);
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
    >
      <nav className="abas abas-botoes" aria-label="Acessos">
        {ABAS.map(([a, nome]) => (
          <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'usuarios' ? {} : { aba: a })}>
            {nome}
          </button>
        ))}
      </nav>
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
      </div>

      {!acessos && !erro && <Carregando />}
      {acessos && (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Perfil</th>
                <th scope="col">Empresas ou obras</th>
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
                  <td className="acoes">
                    <button className="botao botao-secundario botao-pequeno" type="button" disabled={ocupado === a.id} onClick={() => setEditando(a)}>
                      Editar
                    </button>
                    <button className="botao botao-secundario botao-pequeno" type="button" disabled={!a.ativo || ocupado === a.id} onClick={() => pedirLink(a)}>
                      Gerar link
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
                  <td colSpan={4} className="vazio-linha">Nenhum acesso encontrado.</td>
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
          setLink(l);
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
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setPerfil('fornecedor');
      setNome('');
      setEmail('');
      setSelEmpresas([]);
      setSelObras([]);
      setErro(null);
    }
  }, [aberto]);

  const valido =
    nome.trim().length >= 2 &&
    EMAIL_OK.test(email.trim()) &&
    (perfil !== 'fornecedor' || selEmpresas.length > 0) &&
    ((perfil !== 'tst' && perfil !== 'engenharia') || selObras.length > 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setErro(null);
    setEnviando(true);
    try {
      const l = await criarAcesso({
        nome: nome.trim(),
        email: email.trim(),
        perfil,
        empresas: perfil === 'fornecedor' ? selEmpresas : [],
        obras: perfil === 'tst' || perfil === 'engenharia' ? selObras : [],
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

        {(perfil === 'tst' || perfil === 'engenharia') && <SeletorObras perfil={perfil} obras={obras} selecionadas={selObras} aoMudar={setSelObras} />}

        {perfil === 'admin' && <p className="apoio">O administrativo vê todas as obras e é o único perfil que abre os arquivos enviados.</p>}

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>
            {enviando ? 'Criando' : 'Criar acesso e gerar link'}
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
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!acesso) return;
    setNome(acesso.nome);
    setEmail(acesso.email);
    setSelEmpresas(acesso.empresas.map((e) => e.id));
    setSelObras(acesso.obras.map((o) => o.id));
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
      const r = await editarAcesso({
        usuario_id: acesso.id,
        nome: nome.trim(),
        email: email.trim(),
        empresas: perfil === 'fornecedor' ? selEmpresas : [],
        obras: perfil === 'tst' || perfil === 'engenharia' ? selObras : [],
      });
      aoSalvar(
        r.trocou_email
          ? `Acesso de ${r.nome} atualizado. O login agora é ${r.email}; a senha continua a mesma. Se a pessoa ainda não entrou, use "Gerar link" para mandar um novo convite.`
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
          Envie o e-mail abaixo para <strong>{link.email}</strong>. O portal não dispara e-mail sozinho: o envio sai pelo seu Outlook.
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
