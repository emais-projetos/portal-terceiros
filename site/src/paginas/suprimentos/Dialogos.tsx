import { useEffect, useState, type FormEvent } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { copiarTexto, linkOutlook } from '../../lib/admin';
import { data as dataBr } from '../../lib/formato';
import { mensagemDeErro } from '../../lib/supabase';
import { cnpjValido, hojeIso, somarDias, soDigitos, tamanhoArquivo } from '../../lib/formato';
import {
  cadastrarFornecedor, registrarContrato, lerObrasAtivas, formatarCnpj, salvarCadastroFornecedor, trocarEmailAcesso,
  criarAcessoFornecedor, lerConvite, marcarEnviadoOutlook, reenviarConvite,
  type ContratoFornecedor, type ConviteFila, type DadosF31, type FornecedorCadastro, type ObraSimples,
} from '../../lib/homologacao';

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

export function NovoFornecedor({ aberto, aoFechar, aoCadastrar }: { aberto: boolean; aoFechar: () => void; aoCadastrar: (msg: string, empresaId: string) => void }) {
  const obras = useObras(aberto);
  const [razao, setRazao] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [contato, setContato] = useState('');
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ empresaId: string; msg: string } | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setFeito(null);
    setRazao('');
    setCnpj('');
    setEmail('');
    setContato('');
    setMarcadas([]);
    setErro(null);
  }, [aberto]);

  const cnpjOk = cnpjValido(cnpj);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pronto = razao.trim().length >= 3 && cnpjOk && emailOk;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await cadastrarFornecedor({ razao: razao.trim(), cnpj: soDigitos(cnpj), email: email.trim().toLowerCase(), contato: contato.trim(), obras: marcadas });
      setFeito({ empresaId: r.empresaId, msg: r.aviso ?? `${razao.trim()} cadastrado. O convite para preencher a homologação vai para ${email.trim().toLowerCase()}.` });
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
            <small className="dica">Vira o login do fornecedor no portal.</small>
          </label>
          <label className="campo">
            <span>Pessoa de contato</span>
            <input value={contato} maxLength={200} onChange={(e) => setContato(e.target.value)} />
          </label>
        </div>
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

export function EditarCadastro({ fornecedor, aoFechar, aoSalvar }: { fornecedor: FornecedorCadastro | null; aoFechar: () => void; aoSalvar: (msg: string) => void }) {
  const [razao, setRazao] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [acesso, setAcesso] = useState('');
  const [emails, setEmails] = useState('');
  const [dados, setDados] = useState<Partial<DadosF31>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!fornecedor) return;
    setRazao(fornecedor.razao_social);
    setCnpj(formatarCnpj(fornecedor.cnpj));
    setAcesso(fornecedor.email_acesso ?? '');
    setEmails(fornecedor.emails_contato ?? '');
    setDados({ ...fornecedor.dados });
    setErro(null);
  }, [fornecedor]);

  const cnpjOk = cnpjValido(cnpj) || soDigitos(cnpj) === fornecedor?.cnpj;
  const emHomologacao = !!fornecedor && !fornecedor.liberado_em && (fornecedor.homologacao === 'convidada' || fornecedor.homologacao === 'devolvida');
  const podeCriarAcesso = !!fornecedor && !fornecedor.email_acesso && emHomologacao;
  const acessoMudou = !!fornecedor?.email_acesso && acesso.trim().toLowerCase() !== fornecedor.email_acesso;
  const criarAcesso = podeCriarAcesso && acesso.trim() !== '';
  const acessoOk = (!fornecedor?.email_acesso && !criarAcesso) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acesso.trim());
  const pronto = razao.trim().length >= 3 && cnpjOk && acessoOk;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!fornecedor || !pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      const saida: Partial<DadosF31> = {};
      for (const g of GRUPOS_CADASTRO) for (const [c] of g.campos) (saida as Record<string, string>)[c] = String(dados[c] ?? '').trim();
      await salvarCadastroFornecedor(fornecedor.empresa_id, razao.trim(), soDigitos(cnpj), emails, saida);
      const novo = acesso.trim().toLowerCase();
      if (acessoMudou || criarAcesso) {
        try {
          if (criarAcesso) await criarAcessoFornecedor(fornecedor.empresa_id, razao.trim(), novo);
          else await trocarEmailAcesso(fornecedor.empresa_id, novo);
          // Em homologação, o convite que ainda não saiu é refeito para o e-mail novo.
          if (emHomologacao) await reenviarConvite(fornecedor.empresa_id);
        } catch (er) {
          setErro(`O cadastro foi salvo, mas o e-mail de acesso não ${criarAcesso ? 'foi criado' : 'mudou'}: ${mensagemDeErro(er as Error)}`);
          return;
        }
      }
      aoSalvar(
        criarAcesso
          ? `Cadastro atualizado e acesso criado com ${novo}. O convite foi refeito para este e-mail.`
          : acessoMudou
            ? `Cadastro atualizado. O fornecedor agora entra no portal com ${novo}, com a mesma senha.${emHomologacao ? ' O convite foi refeito para o e-mail novo.' : ''}`
            : 'Cadastro atualizado.',
      );
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
              <span>E-mail de acesso ao portal</span>
              {podeCriarAcesso ? (
                <>
                  <input type="email" value={acesso} maxLength={200} aria-invalid={!acessoOk} placeholder="e-mail do fornecedor" onChange={(e) => setAcesso(e.target.value)} />
                  <small className="texto-alerta">O fornecedor ainda não tem acesso. Ao salvar, o portal cria o login com este e-mail e refaz o convite.</small>
                </>
              ) : fornecedor.email_acesso ? (
                <>
                  <input type="email" value={acesso} maxLength={200} aria-invalid={!acessoOk} onChange={(e) => setAcesso(e.target.value)} />
                  <small className={acessoMudou ? 'texto-alerta' : 'dica'}>
                    {acessoMudou ? 'É o login do fornecedor: ele passa a entrar com o e-mail novo, com a mesma senha.' : 'É o login do fornecedor no portal.'}
                  </small>
                </>
              ) : (
                <span className="valor-fixo">Sem acesso ao portal. O acesso é criado pelo administrativo, em Acessos.</span>
              )}
            </label>
            <label className="campo">
              <span>Outros e-mails para avisos</span>
              <input value={emails} maxLength={600} placeholder="financeiro@empresa.com; rh@empresa.com" onChange={(e) => setEmails(e.target.value)} />
              <small className="dica">Recebem os avisos junto com o e-mail de acesso. Separe por ponto e vírgula, até 10.</small>
            </label>
          </div>
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
