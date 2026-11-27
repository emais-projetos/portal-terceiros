import { useEffect, useState, type FormEvent } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { copiarTexto, enviarAcesso, gerarLinkAcesso, linkOutlook, mudarAtivoAcesso, type Acesso, type LinkAcesso } from '../../lib/admin';
import { EnvioDoLink } from '../admin/Acessos';
import { data as dataBr } from '../../lib/formato';
import { mensagemDeErro } from '../../lib/supabase';
import { cnpjValido, hojeIso, somarDias, soDigitos, tamanhoArquivo } from '../../lib/formato';
import {
  cadastrarFornecedor, registrarContrato, lerObrasAtivas, formatarCnpj, salvarCadastroFornecedor, trocarEmailAcesso,
  criarAcessoFornecedor, lerConvite, marcarEnviadoOutlook, reenviarConvite, lerAcessosPorEmpresa, tirarEmpresaDoAcesso, vincularEmpresaAoAcesso,
  lerFornecedoresCadastro, mudarSituacaoFornecedor, NOMES_SITUACAO_FORNECEDOR, SELO_SITUACAO_FORNECEDOR,
  type ContratoFornecedor, type ConviteFila, type DadosF31, type FornecedorCadastro, type ObraSimples, type SituacaoFornecedor,
} from '../../lib/homologacao';
import { definirTiposFornecedor, lerTiposFornecedor, type TipoFornecedor } from '../../lib/tiposFornecedor';

// Janelas do Suprimentos: cadastrar fornecedor novo (manda o convite da homologação) e registrar o contrato assinado.

function useObras(aberto: boolean) {
  const [obras, setObras] = useState<ObraSimples[]>([]);
  useEffect(() => {
    if (aberto) lerObrasAtivas().then(setObras).catch(() => setObras([]));
  }, [aberto]);
  return obras;
}

function EscolherObras({ obras, marcadas, aoMudar }: { obras: ObraSimples[]; marcadas: string[]; aoMudar: (l: string[]) => void }) {
  return (
    <div className="opcoes opcoes-empilhadas lista-rolagem">
      {obras.map((o) => (
        <label key={o.id} className="opcao">
          <input
            type="checkbox"
            checked={marcadas.includes(o.id)}
            onChange={(e) => aoMudar(e.target.checked ? [...marcadas, o.id] : marcadas.filter((x) => x !== o.id))}
          />
          <span>{o.nome}</span>
        </label>
      ))}
      {obras.length === 0 && <span className="dica">Nenhuma obra ativa.</span>}
    </div>
  );
}

function useTiposFornecedor(aberto: boolean) {
  const [tipos, setTipos] = useState<TipoFornecedor[]>([]);
  useEffect(() => {
    if (aberto) lerTiposFornecedor().then(setTipos).catch(() => setTipos([]));
  }, [aberto]);
  return tipos;
}

function oQueOTipoPede(t: TipoFornecedor): string {
  if (!t.colaboradores) return 'Só documentos da empresa';
  return t.mensal ? 'Colaboradores, integração e mensal trabalhista' : 'Colaboradores e integração, sem mensal trabalhista';
}

// Tipo(s) do fornecedor: pode marcar mais de um; vale o que qualquer um pedir.
export function EscolherTipos({ tipos, marcados, aoMudar }: { tipos: TipoFornecedor[]; marcados: string[]; aoMudar: (l: string[]) => void }) {
  return (
    <fieldset className="campo-grupo">
      <legend>Tipo de fornecedor</legend>
      <div className="opcoes opcoes-empilhadas">
        {tipos.map((t) => (
          <label key={t.codigo} className="opcao">
            <input
              type="checkbox"
              checked={marcados.includes(t.codigo)}
              onChange={(e) => aoMudar(e.target.checked ? [...marcados, t.codigo] : marcados.filter((x) => x !== t.codigo))}
            />
            <span>
              {t.nome}
              <small className="sub">{oQueOTipoPede(t)}{t.descricao ? `. ${t.descricao}` : ''}</small>
            </span>
          </label>
        ))}
      </div>
      {marcados.length === 0 && <small className="campo-erro">Escolha pelo menos um tipo.</small>}
      {marcados.length > 1 && <small className="dica">Com mais de um tipo, o fornecedor envia os documentos de todos e faz o que qualquer um deles pedir.</small>}
    </fieldset>
  );
}

export function NovoFornecedor({ aberto, aoFechar, aoCadastrar }: { aberto: boolean; aoFechar: () => void; aoCadastrar: (msg: string, empresaId: string) => void }) {
  const obras = useObras(aberto);
  const tiposF = useTiposFornecedor(aberto);
  const [tipos, setTipos] = useState<string[]>(['mao_de_obra']);
  const [razao, setRazao] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [contato, setContato] = useState('');
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ empresaId: string; msg: string } | null>(null);
  const [acessos, setAcessos] = useState<Acesso[]>([]);

  useEffect(() => {
    if (!aberto) return;
    lerAcessosPorEmpresa().then((r) => setAcessos(r.lista)).catch(() => setAcessos([]));
    setFeito(null);
    setRazao('');
    setCnpj('');
    setEmail('');
    setContato('');
    setMarcadas([]);
    setTipos(['mao_de_obra']);
    setErro(null);
  }, [aberto]);

  const cnpjOk = cnpjValido(cnpj);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pronto = razao.trim().length >= 3 && cnpjOk && emailOk && tipos.length > 0;
  const existente = emailOk ? acessos.find((a) => a.email.toLowerCase() === email.trim().toLowerCase()) ?? null : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await cadastrarFornecedor({ razao: razao.trim(), cnpj: soDigitos(cnpj), email: email.trim().toLowerCase(), contato: contato.trim(), obras: marcadas, tipos, acessoExistente: existente });
      setFeito({
        empresaId: r.empresaId,
        msg: r.aviso ?? (existente
          ? `${razao.trim()} cadastrado no acesso de ${existente.nome} (${existente.email}), que agora cuida de ${existente.empresas.length + 1} empresas. O convite da homologação vai para esse e-mail.`
          : `${razao.trim()} cadastrado. O convite para preencher a homologação vai para ${email.trim().toLowerCase()}.`),
      });
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Novo fornecedor" aoFechar={() => (feito ? aoCadastrar(feito.msg, feito.empresaId) : aoFechar())} largura="larga">
      {feito ? (
        <div className="formulario formulario-largo">
          <p className={`aviso ${feito.msg.includes('mas') ? 'aviso-alerta' : 'aviso-ok'}`}>{feito.msg}</p>
          <ConviteOutlook empresaId={feito.empresaId} />
          <div className="linha-botoes">
            <button type="button" className="botao" onClick={() => aoCadastrar(feito.msg, feito.empresaId)}>Concluir</button>
          </div>
        </div>
      ) : (
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <p className="apoio">
          O fornecedor recebe um e-mail com o endereço do portal. No primeiro acesso ele cria a senha com um código enviado para o mesmo e-mail,
          preenche os dados do F.31 e envia os documentos.
        </p>
        <div className="grade-2">
          <label className="campo">
            <span>Razão social</span>
            <input value={razao} maxLength={200} onChange={(e) => setRazao(e.target.value)} />
          </label>
          <label className="campo">
            <span>CNPJ</span>
            <input value={cnpj} inputMode="numeric" maxLength={18} aria-invalid={!!cnpj && !cnpjOk} onChange={(e) => setCnpj(e.target.value)} onBlur={() => cnpjOk && setCnpj(formatarCnpj(cnpj))} />
            {!!cnpj && !cnpjOk && <small className="campo-erro">CNPJ inválido.</small>}
          </label>
          <label className="campo">
            <span>E-mail do fornecedor</span>
            <input type="email" value={email} maxLength={200} aria-invalid={!!email && !emailOk} onChange={(e) => setEmail(e.target.value)} />
            {existente ? (
              <small className="texto-alerta">
                Este e-mail já é o login de {existente.nome}, que cuida de {existente.empresas.map((x) => x.razao_social).join(', ') || 'nenhuma empresa'}. A empresa nova entra nesse mesmo acesso.
              </small>
            ) : (
              <small className="dica">Vira o login do fornecedor no portal. Se for o e-mail de um login que já existe, a empresa entra nesse acesso.</small>
            )}
          </label>
          <label className="campo">
            <span>Pessoa de contato</span>
            <input value={contato} maxLength={200} onChange={(e) => setContato(e.target.value)} />
          </label>
        </div>
        <EscolherTipos tipos={tiposF} marcados={tipos} aoMudar={setTipos} />
        <div className="campo">
          <span>Obras previstas</span>
          <small className="dica">Só para referência. A obra é liberada de fato quando o contrato for registrado.</small>
          <EscolherObras obras={obras} marcadas={marcadas} aoMudar={setMarcadas} />
        </div>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!pronto || enviando}>{enviando ? 'Cadastrando' : 'Cadastrar e enviar convite'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
      )}
    </Dialogo>
  );
}

export type PedidoContrato = {
  empresaId: string;
  empresaNome: string;
  codigoBp: string | null;
  contrato: ContratoFornecedor | null;
  obrasIniciais: string[];
  numeroInicial?: string | null;
  titulo?: string;
};

export function RegistrarContrato({ pedido, aoFechar, aoRegistrar }: { pedido: PedidoContrato | null; aoFechar: () => void; aoRegistrar: (msg: string) => void }) {
  const obras = useObras(!!pedido);
  const [numero, setNumero] = useState('');
  const [bp, setBp] = useState('');
  const [inicio, setInicio] = useState('');
  const [termino, setTermino] = useState('');
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pedido) return;
    const c = pedido.contrato;
    setNumero(c?.numero ?? pedido.numeroInicial ?? '');
    setBp(c?.codigo_bp ?? pedido.codigoBp ?? '');
    setInicio(c?.inicio ?? hojeIso());
    setTermino(c?.termino ?? somarDias(hojeIso(), 365));
    setMarcadas(c ? c.obras.map((o) => o.id) : pedido.obrasIniciais);
    setArquivo(null);
    setErro(null);
  }, [pedido]);

  const temArquivo = !!arquivo || !!pedido?.contrato?.arquivo;
  const datasOk = !!inicio && !!termino && termino >= inicio;
  const pronto = numero.trim() && bp.trim() && datasOk && marcadas.length > 0 && temArquivo;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pedido || !pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      await registrarContrato({
        empresaId: pedido.empresaId,
        contratoId: pedido.contrato?.id ?? null,
        numero: numero.trim(),
        bp: bp.trim(),
        inicio,
        termino,
        obras: marcadas,
        arquivo,
        arquivoAtual: pedido.contrato ? { caminho: pedido.contrato.arquivo, nome: pedido.contrato.arquivo_nome } : null,
      });
      aoRegistrar(pedido.contrato ? `Contrato ${numero.trim()} atualizado.` : `Contrato ${numero.trim()} registrado para ${pedido.empresaNome}.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={!!pedido} titulo={pedido ? pedido.titulo ?? (pedido.contrato ? `Contrato ${pedido.contrato.numero}` : 'Registrar contrato') : ''} aoFechar={aoFechar} largura="larga">
      {pedido && (
        <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
          <p className="apoio">
            <strong>{pedido.empresaNome}</strong>. As obras marcadas ficam liberadas para o fornecedor com este contrato. Um contrato pode valer para mais de uma obra.
          </p>
          <div className="grade-2">
            <label className="campo">
              <span>Número do contrato (SAP)</span>
              <input value={numero} maxLength={60} onChange={(e) => setNumero(e.target.value)} />
            </label>
            <label className="campo">
              <span>Código do BP (SAP)</span>
              <input value={bp} maxLength={30} onChange={(e) => setBp(e.target.value)} />
            </label>
            <label className="campo campo-data">
              <span>Início</span>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </label>
            <label className="campo campo-data">
              <span>Término</span>
              <input type="date" value={termino} aria-invalid={!!termino && !!inicio && termino < inicio} onChange={(e) => setTermino(e.target.value)} />
              {!!termino && !!inicio && termino < inicio && <small className="campo-erro">O término não pode ser antes do início.</small>}
              <small className="dica">O portal avisa 30 dias antes do término. Contrato vencido não trava a obra, mas aparece em A regularizar.</small>
            </label>
          </div>
          <div className="campo">
            <span>Obras do contrato</span>
            <EscolherObras obras={obras} marcadas={marcadas} aoMudar={setMarcadas} />
          </div>
          <div className="campo">
            <span>Contrato assinado (PDF)</span>
            {pedido.contrato?.arquivo && !arquivo && <small className="dica">Atual: {pedido.contrato.arquivo_nome}. Escolha outro só se quiser trocar.</small>}
            <label className="area-arquivo">
              <input type="file" accept=".pdf,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
              <span>{arquivo ? `${arquivo.name} (${tamanhoArquivo(arquivo.size)})` : 'Escolher o PDF do contrato'}</span>
            </label>
          </div>
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={!pronto || enviando}>{enviando ? 'Salvando' : pedido.contrato ? 'Salvar contrato' : 'Registrar contrato'}</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

export function PedirMotivo({ aberto, titulo, apoio, botao, minimo = 3, rotulo = 'Motivo', aoFechar, aoConfirmar }: {
  aberto: boolean;
  rotulo?: string;
  titulo: string;
  apoio: string;
  botao: string;
  minimo?: number;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setMotivo('');
    setErro(null);
  }, [aberto]);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < minimo) return;
    setEnviando(true);
    setErro(null);
    try {
      await aoConfirmar(motivo.trim());
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Dialogo aberto={aberto} titulo={titulo} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar}>
        <p className="apoio">{apoio}</p>
        <label className="campo">
          <span>{rotulo}</span>
          <textarea rows={3} value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={motivo.trim().length < minimo || enviando}>{enviando ? 'Salvando' : botao}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

// Campos que o Suprimentos edita no cadastro. CNPJ e e-mail de acesso ficam com o administrativo (Acessos).
const GRUPOS_CADASTRO: { titulo: string; campos: [keyof DadosF31, string, { max?: number; tipo?: string; dica?: string }?][] }[] = [
  { titulo: 'Dados da empresa', campos: [['nome_fantasia', 'Nome fantasia'], ['ramo', 'Ramo de atividade'], ['praca', 'Praça de atuação'], ['inscricao_estadual', 'Inscrição estadual'], ['inscricao_municipal', 'Inscrição municipal']] },
  { titulo: 'Endereço', campos: [['cep', 'CEP', { max: 9 }], ['endereco', 'Endereço'], ['numero', 'Número', { max: 20 }], ['complemento', 'Complemento'], ['bairro', 'Bairro'], ['cidade', 'Cidade'], ['estado', 'Estado', { max: 2, dica: 'Sigla, ex.: SP' }]] },
  { titulo: 'Contato', campos: [['contato', 'Pessoa de contato'], ['telefone', 'Telefone', { tipo: 'tel', max: 20 }], ['celular', 'Celular', { tipo: 'tel', max: 20 }], ['email_empresa', 'E-mail da empresa', { tipo: 'email' }]] },
  { titulo: 'Dados bancários', campos: [['banco', 'Banco'], ['agencia', 'Agência', { max: 20 }], ['conta', 'Conta', { max: 30 }]] },
];

export function EditarCadastro({ fornecedor, acesso: acessoAtual = null, acessos = [], aoFechar, aoSalvar }: {
  fornecedor: FornecedorCadastro | null; acesso?: Acesso | null; acessos?: Acesso[]; aoFechar: () => void; aoSalvar: (msg: string) => void;
}) {
  const tiposF = useTiposFornecedor(!!fornecedor);
  const [tipos, setTipos] = useState<string[]>([]);
  const [razao, setRazao] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [emails, setEmails] = useState('');
  const [dados, setDados] = useState<Partial<DadosF31>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!fornecedor) return;
    setRazao(fornecedor.razao_social);
    setCnpj(formatarCnpj(fornecedor.cnpj));
    setEmails(fornecedor.emails_contato ?? '');
    setDados({ ...fornecedor.dados });
    setTipos(fornecedor.tipos?.length ? fornecedor.tipos : ['mao_de_obra']);
    setErro(null);
  }, [fornecedor]);

  const cnpjOk = cnpjValido(cnpj) || soDigitos(cnpj) === fornecedor?.cnpj;
  const pronto = razao.trim().length >= 3 && cnpjOk && tipos.length > 0;
  const tiposAntes = fornecedor?.tipos?.length ? fornecedor.tipos : ['mao_de_obra'];
  const tiposMudaram = tipos.length !== tiposAntes.length || tipos.some((t) => !tiposAntes.includes(t));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!fornecedor || !pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      const saida: Partial<DadosF31> = {};
      for (const g of GRUPOS_CADASTRO) for (const [c] of g.campos) (saida as Record<string, string>)[c] = String(dados[c] ?? '').trim();
      if (tiposMudaram) await definirTiposFornecedor(fornecedor.empresa_id, tipos);
      await salvarCadastroFornecedor(fornecedor.empresa_id, razao.trim(), soDigitos(cnpj), emails, saida);
      aoSalvar('Cadastro atualizado.');
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={!!fornecedor} titulo="Editar cadastro" aoFechar={aoFechar} largura="larga">
      {fornecedor && (
        <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
          <p className="apoio">Tudo o que for salvo aqui aparece na hora para o administrativo, para o fornecedor e nos e-mails do portal.</p>
          <AcessoDaEmpresa fornecedor={fornecedor} acesso={acessoAtual} acessos={acessos} aoMudar={aoSalvar} />
          <SituacaoDoFornecedor fornecedor={fornecedor} aoMudar={aoSalvar} />
          <div className="grade-2">
            <label className="campo">
              <span>Razão social</span>
              <input value={razao} maxLength={200} aria-invalid={razao.trim().length < 3} onChange={(e) => setRazao(e.target.value)} />
            </label>
            <label className="campo">
              <span>CNPJ</span>
              <input value={cnpj} inputMode="numeric" maxLength={18} aria-invalid={!cnpjOk} onChange={(e) => setCnpj(e.target.value)} onBlur={() => cnpjValido(cnpj) && setCnpj(formatarCnpj(soDigitos(cnpj)))} />
              {!cnpjOk && <small className="campo-erro">CNPJ inválido. Confira os números.</small>}
            </label>
            <label className="campo">
              <span>Outros e-mails para avisos</span>
              <input value={emails} maxLength={600} placeholder="financeiro@empresa.com; rh@empresa.com" onChange={(e) => setEmails(e.target.value)} />
              <small className="dica">Recebem os avisos junto com o e-mail de acesso. Separe por ponto e vírgula, até 10.</small>
            </label>
          </div>
          <EscolherTipos tipos={tiposF} marcados={tipos} aoMudar={setTipos} />
          {tiposMudaram && (
            <p className="aviso aviso-info">
              Ao salvar, o fornecedor passa a ver os documentos da homologação do(s) tipo(s) marcado(s), e a cobrança do mensal trabalhista segue o tipo novo.
            </p>
          )}
          {GRUPOS_CADASTRO.map((g) => (
            <fieldset key={g.titulo} className="campo-grupo">
              <legend>{g.titulo}</legend>
              <div className="grade-3">
                {g.campos.map(([c, rotulo, extra]) => (
                  <label key={c} className="campo">
                    <span>{rotulo}</span>
                    <input
                      type={extra?.tipo ?? 'text'}
                      value={String(dados[c] ?? '')}
                      maxLength={extra?.max ?? 200}
                      onChange={(e) => setDados((d) => ({ ...d, [c]: e.target.value }))}
                    />
                    {extra?.dica && <small className="dica">{extra.dica}</small>}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={!pronto || enviando}>{enviando ? 'Salvando' : 'Salvar cadastro'}</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

const EFEITO_SITUACAO: Record<SituacaoFornecedor, string> = {
  ativo: 'Trabalha com a Emais normalmente.',
  inativo: 'Não trabalha mais com a Emais: sai da lista de fornecedores e das cobranças. O histórico continua guardado.',
  bloqueado:
    'Não recebe convite da homologação, não é homologado e não ganha portal, contrato nem obra nova. A engenharia e o TST veem o aviso no painel da obra; o fornecedor não vê o motivo.',
};

// Situação do fornecedor com a Emais, dentro do cadastro: ativo, inativo ou bloqueado, sempre com motivo.
function SituacaoDoFornecedor({ fornecedor, aoMudar }: { fornecedor: FornecedorCadastro; aoMudar: (msg: string) => void }) {
  const atual: SituacaoFornecedor = fornecedor.situacao ?? (fornecedor.ativa ? 'ativo' : 'inativo');
  const [nova, setNova] = useState<SituacaoFornecedor | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [historico, setHistorico] = useState(fornecedor.historico_situacao ?? null);

  useEffect(() => {
    setNova(null);
    setMotivo('');
    setErro(null);
    setHistorico(fornecedor.historico_situacao ?? null);
    // A lista não traz o histórico; busca só deste fornecedor.
    if (!fornecedor.historico_situacao) {
      lerFornecedoresCadastro(fornecedor.empresa_id)
        .then((l) => setHistorico(l[0]?.historico_situacao ?? []))
        .catch(() => setHistorico([]));
    }
  }, [fornecedor]);

  const precisaMotivo = nova !== null && nova !== 'ativo';
  const pronto = nova !== null && (!precisaMotivo || motivo.trim().length >= 5);
  const emObra = fornecedor.colaboradores.em_obra;

  async function confirmar() {
    if (!nova || !pronto) return;
    setOcupado(true);
    setErro(null);
    try {
      await mudarSituacaoFornecedor(fornecedor.empresa_id, nova, motivo.trim());
      aoMudar(`${fornecedor.razao_social}: ${nova === 'ativo' ? (atual === 'bloqueado' ? 'desbloqueado' : 'reativado') : nova}.`);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(false);
    }
  }

  const opcoes: { para: SituacaoFornecedor; rotulo: string }[] = (
    [
      { para: 'ativo', rotulo: atual === 'bloqueado' ? 'Desbloquear' : 'Reativar' },
      { para: 'inativo', rotulo: 'Inativar' },
      { para: 'bloqueado', rotulo: 'Bloquear' },
    ] as { para: SituacaoFornecedor; rotulo: string }[]
  ).filter((o) => o.para !== atual);

  return (
    <fieldset className="campo-grupo">
      <legend>Situação do fornecedor</legend>
      <p>
        <span className={`selo ${SELO_SITUACAO_FORNECEDOR[atual]}`}>{NOMES_SITUACAO_FORNECEDOR[atual]}</span>
        {fornecedor.situacao_em && (
          <small className="sub">
            Desde {dataBr(fornecedor.situacao_em.slice(0, 10))}{fornecedor.situacao_por ? `, por ${fornecedor.situacao_por}` : ''}
          </small>
        )}
        {fornecedor.situacao_motivo && <small className="sub">Motivo: {fornecedor.situacao_motivo}</small>}
      </p>
      <p className="dica">{EFEITO_SITUACAO[atual]}</p>
      {nova === null ? (
        <div className="linha-botoes">
          {opcoes.map((o) => (
            <button
              key={o.para}
              type="button"
              className={`botao ${o.para === 'bloqueado' ? 'botao-perigo' : 'botao-secundario'} botao-pequeno`}
              onClick={() => setNova(o.para)}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      ) : (
        <div className="formulario">
          <p className={`aviso ${nova === 'bloqueado' ? 'aviso-alerta' : 'aviso-info'}`}>
            {EFEITO_SITUACAO[nova]}
            {nova !== 'ativo' && emObra > 0 ? ` Hoje ele tem ${emObra === 1 ? '1 colaborador' : `${emObra} colaboradores`} em obra; eles continuam como estão até a obra encerrar.` : ''}
          </p>
          <label className="campo">
            <span>Motivo{precisaMotivo ? '' : ' (opcional)'}</span>
            <textarea
              rows={2}
              maxLength={500}
              value={motivo}
              placeholder={nova === 'bloqueado' ? 'Ex.: documento adulterado na medição de outubro' : nova === 'inativo' ? 'Ex.: contrato encerrado, sem obra prevista' : ''}
              onChange={(e) => setMotivo(e.target.value)}
            />
            {precisaMotivo && motivo.trim().length < 5 && <small className="dica">Pelo menos 5 letras. Fica no histórico do fornecedor.</small>}
          </label>
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <div className="linha-botoes">
            <button type="button" className={`botao${nova === 'bloqueado' ? ' botao-perigo' : ''}`} disabled={!pronto || ocupado} onClick={confirmar}>
              {ocupado ? 'Salvando' : opcoes.find((o) => o.para === nova)?.rotulo}
            </button>
            <button type="button" className="botao botao-discreto" onClick={() => setNova(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {!!historico?.length && (
        <details className="detalhe-dobravel">
          <summary>Histórico da situação ({historico.length})</summary>
          <ul className="lista-simples">
            {historico.map((h, i) => (
              <li key={i}>
                <span>
                  {NOMES_SITUACAO_FORNECEDOR[h.de]} para <strong>{NOMES_SITUACAO_FORNECEDOR[h.para]}</strong>
                  {h.motivo ? `: ${h.motivo}` : ''}
                  <small className="sub">{dataBr(h.em.slice(0, 10))}{h.quem ? ` por ${h.quem}` : ''}</small>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  );
}

// Acesso ao portal da empresa, dentro do cadastro: criar, usar um login que já existe, trocar o e-mail,
// mandar o convite e tirar a empresa do login. Um login pode cuidar de várias empresas; cada empresa tem um só.
function AcessoDaEmpresa({ fornecedor, acesso, acessos, aoMudar }: { fornecedor: FornecedorCadastro; acesso: Acesso | null; acessos: Acesso[]; aoMudar: (msg: string) => void }) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState<LinkAcesso | null>(null);

  useEffect(() => {
    setEmail(acesso ? acesso.email : fornecedor.email_acesso ?? String(fornecedor.dados.email_empresa ?? ''));
    setNome(acesso ? acesso.nome : fornecedor.razao_social);
    setTrocando(false);
    setErro(null);
  }, [acesso, fornecedor]);

  const emHomologacao = !fornecedor.liberado_em && (fornecedor.homologacao === 'convidada' || fornecedor.homologacao === 'devolvida');
  const limpo = email.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);
  const existente = !acesso && emailOk ? acessos.find((a) => a.email.toLowerCase() === limpo) ?? null : null;
  const outras = acesso ? acesso.empresas.filter((e) => e.id !== fornecedor.empresa_id) : [];
  const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  async function fazer(acao: () => Promise<string>) {
    setOcupado(true);
    setErro(null);
    try {
      aoMudar(await acao());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <fieldset className="campo-grupo">
      <legend>Acesso ao portal</legend>
      {acesso ? (
        <>
          <p>
            <strong>{acesso.email}</strong> <span className="sub">({acesso.nome})</span>
            <br />
            <span className="sub">
              {!acesso.ativo ? 'Acesso desativado' : acesso.ultimo_login ? `Último acesso em ${dia(acesso.ultimo_login)}` : 'Ainda não entrou no portal'}
            </span>
          </p>
          {outras.length > 0 && <p className="dica">Este login também cuida de: {outras.map((e) => e.razao_social).join(', ')}.</p>}
          {trocando ? (
            <div className="grade-2">
              <label className="campo">
                <span>Novo e-mail de login</span>
                <input type="email" value={email} maxLength={200} aria-invalid={!emailOk} onChange={(e) => setEmail(e.target.value)} />
                <small className="texto-alerta">
                  A senha não muda.{outras.length > 0 ? ` A troca vale para as ${outras.length + 1} empresas deste login.` : ''}
                </small>
              </label>
              <div className="linha-botoes linha-botoes-baixo">
                <button
                  type="button"
                  className="botao botao-pequeno"
                  disabled={ocupado || !emailOk || limpo === acesso.email.toLowerCase()}
                  onClick={() =>
                    fazer(async () => {
                      await trocarEmailAcesso(fornecedor.empresa_id, limpo);
                      if (emHomologacao) await reenviarConvite(fornecedor.empresa_id);
                      return `O login agora é ${limpo}, com a mesma senha.${emHomologacao ? ' O convite da homologação foi refeito para o e-mail novo.' : ''}`;
                    })
                  }
                >
                  Trocar e-mail
                </button>
                <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setTrocando(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="linha-botoes">
              {acesso.ativo && !emHomologacao && (
                <>
                  <button
                    type="button"
                    className="botao botao-secundario botao-pequeno"
                    disabled={ocupado}
                    onClick={() =>
                      fazer(async () => {
                        const r = await enviarAcesso(acesso.id);
                        return `${acesso.ultimo_login ? 'Link de nova senha' : 'Convite'} na fila do envio automático para ${r.email}.`;
                      })
                    }
                  >
                    Enviar acesso
                  </button>
                  <button
                    type="button"
                    className="botao botao-secundario botao-pequeno"
                    disabled={ocupado}
                    onClick={async () => {
                      setOcupado(true);
                      setErro(null);
                      try {
                        setLink(await gerarLinkAcesso(acesso.id));
                      } catch (e) {
                        setErro(mensagemDeErro(e as Error));
                      } finally {
                        setOcupado(false);
                      }
                    }}
                  >
                    Copiar texto do acesso
                  </button>
                </>
              )}
              <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado} onClick={() => setTrocando(true)}>Trocar e-mail</button>
              {outras.length > 0 ? (
                <button
                  type="button"
                  className="botao botao-discreto botao-pequeno"
                  disabled={ocupado}
                  onClick={() =>
                    fazer(async () => {
                      await tirarEmpresaDoAcesso(acesso, fornecedor.empresa_id);
                      return `${fornecedor.razao_social} saiu do login ${acesso.email}. Agora a empresa está sem acesso ao portal.`;
                    })
                  }
                >
                  Tirar desta empresa
                </button>
              ) : (
                <button
                  type="button"
                  className="botao botao-discreto botao-pequeno"
                  disabled={ocupado}
                  onClick={() =>
                    fazer(async () => {
                      await mudarAtivoAcesso(acesso.id, !acesso.ativo);
                      return acesso.ativo ? `Acesso ${acesso.email} desativado.` : `Acesso ${acesso.email} reativado.`;
                    })
                  }
                >
                  {acesso.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                </button>
              )}
            </div>
          )}
          {emHomologacao && <p className="dica">Em homologação: o convite da homologação é o e-mail de acesso. Ele fica em Homologação, no detalhe do fornecedor.</p>}
        </>
      ) : (
        <>
          <p className="texto-alerta">Esta empresa ainda não tem acesso ao portal.</p>
          <div className="grade-2">
            <label className="campo">
              <span>E-mail de login</span>
              <input type="email" value={email} maxLength={200} aria-invalid={!!email && !emailOk} placeholder="e-mail do fornecedor" onChange={(e) => setEmail(e.target.value)} />
              {existente ? (
                <small className="texto-alerta">
                  Já é o login de {existente.nome}, que cuida de {existente.empresas.map((x) => x.razao_social).join(', ') || 'nenhuma empresa'}. A empresa entra nesse mesmo acesso.
                </small>
              ) : (
                <small className="dica">Se for o e-mail de um login que já existe, a empresa entra nesse acesso.</small>
              )}
            </label>
            {!existente && (
              <label className="campo">
                <span>Nome do acesso</span>
                <input value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} />
              </label>
            )}
          </div>
          <div className="linha-botoes">
            <button
              type="button"
              className="botao botao-pequeno"
              disabled={ocupado || !emailOk || (!existente && nome.trim().length < 2)}
              onClick={() =>
                fazer(async () => {
                  if (existente) await vincularEmpresaAoAcesso(existente, fornecedor.empresa_id);
                  else await criarAcessoFornecedor(fornecedor.empresa_id, nome.trim(), limpo);
                  if (emHomologacao) await reenviarConvite(fornecedor.empresa_id);
                  return existente
                    ? `${fornecedor.razao_social} entrou no acesso de ${existente.nome} (${existente.email}).`
                    : `Acesso criado com ${limpo}.${emHomologacao ? ' O convite da homologação foi refeito para este e-mail.' : ' Use "Enviar acesso" ou "Copiar texto do acesso" para mandar o convite.'}`;
                })
              }
            >
              {existente ? 'Usar este acesso' : 'Criar acesso'}
            </button>
          </div>
        </>
      )}
      {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
      <EnvioDoLink link={link} empresas={acesso?.empresas ?? []} aoFechar={() => setLink(null)} />
    </fieldset>
  );
}

// Convite da homologação: mostra se já saiu e permite mandar pelo e-mail do Suprimentos.
// O texto abre na tela com botões de copiar (o "Abrir no Outlook" depende da versão do Outlook instalada).
export function ConviteOutlook({ empresaId, versao = 0 }: { empresaId: string; versao?: number }) {
  const [convite, setConvite] = useState<ConviteFila | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    setAberto(false);
    setCopiado(null);
    lerConvite(empresaId).then(setConvite).catch(() => setConvite(null));
  }, [empresaId, versao]);

  async function copiar(texto: string, qual: string) {
    try {
      await copiarTexto(texto);
      setCopiado(qual);
    } catch {
      setCopiado('falhou');
    }
  }

  if (!convite) return null;
  if (convite.situacao_envio === 'enviado') {
    return (
      <p className="dica">
        Convite enviado em {dataBr(convite.enviado_em ?? convite.criado_em)}
        {convite.envio_para?.startsWith('Outlook') ? ' à mão, pelo e-mail do Suprimentos' : ` para ${convite.para ?? ''}`}.
      </p>
    );
  }
  if (!convite.para) return <p className="dica texto-alerta">O convite está sem e-mail. Informe o e-mail de acesso em Editar cadastro.</p>;
  return (
    <div className="caixa">
      <p className="dica">
        Convite na fila do envio automático para <strong>{convite.para}</strong>. Se preferir, mande pelo seu e-mail: abra o texto, copie e cole numa mensagem nova.
      </p>
      {!aberto && (
        <div className="linha-botoes">
          <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setAberto(true)}>
            Ver o texto do convite
          </button>
        </div>
      )}
      {aberto && (
        <>
          <div className="previa-email">
            <p><span className="sub">Para</span> {convite.para}</p>
            <p><span className="sub">Assunto</span> {convite.assunto}</p>
            <pre>{convite.corpo}</pre>
          </div>
          <div className="linha-botoes">
            <button type="button" className="botao botao-pequeno" onClick={() => copiar(convite.corpo, 'texto')}>Copiar texto</button>
            <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => copiar(convite.assunto, 'assunto')}>Copiar assunto</button>
            <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => copiar(convite.para ?? '', 'e-mail')}>Copiar e-mail</button>
            <a className="botao botao-discreto botao-pequeno" href={linkOutlook(convite.para, convite.assunto, convite.corpo)}>Abrir no Outlook</a>
          </div>
          {copiado === 'falhou' ? (
            <p className="aviso aviso-erro" role="alert">O navegador não deixou copiar. Selecione o texto acima e copie com Ctrl+C.</p>
          ) : copiado ? (
            <p className="aviso aviso-ok" role="status">{copiado === 'texto' ? 'Texto' : copiado === 'assunto' ? 'Assunto' : 'E-mail'} copiado.</p>
          ) : null}
        </>
      )}
      <div className="linha-botoes">
        {aberto && (
          <button
            type="button"
            className="botao botao-pequeno"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              setErro(null);
              try {
                await marcarEnviadoOutlook(convite.id);
                setConvite(await lerConvite(empresaId));
              } catch (e) {
                setErro(mensagemDeErro(e as Error));
              } finally {
                setOcupado(false);
              }
            }}
          >
            Já mandei pelo meu e-mail
          </button>
        )}
      </div>
      {aberto && <small className="dica">Depois de enviar, clique em "Já mandei pelo meu e-mail" para o envio automático não mandar de novo.</small>}
      {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
    </div>
  );
}
