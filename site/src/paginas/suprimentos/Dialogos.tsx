import { useEffect, useState, type FormEvent } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { mensagemDeErro } from '../../lib/supabase';
import { cnpjValido, hojeIso, somarDias, soDigitos, tamanhoArquivo } from '../../lib/formato';
import {
  cadastrarFornecedor, registrarContrato, lerObrasAtivas, formatarCnpj, salvarCadastroFornecedor,
  type ContratoFornecedor, type DadosF31, type FornecedorCadastro, type ObraSimples,
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

  useEffect(() => {
    if (!aberto) return;
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
      aoCadastrar(r.aviso ?? `${razao.trim()} cadastrado. O convite para preencher a homologação vai para ${email.trim().toLowerCase()}.`, r.empresaId);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Novo fornecedor" aoFechar={aoFechar} largura="larga">
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
  const [emails, setEmails] = useState('');
  const [dados, setDados] = useState<Partial<DadosF31>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!fornecedor) return;
    setRazao(fornecedor.razao_social);
    setEmails(fornecedor.emails_contato ?? '');
    setDados({ ...fornecedor.dados });
    setErro(null);
  }, [fornecedor]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!fornecedor || razao.trim().length < 3) return;
    setEnviando(true);
    setErro(null);
    try {
      const saida: Partial<DadosF31> = {};
      for (const g of GRUPOS_CADASTRO) for (const [c] of g.campos) (saida as Record<string, string>)[c] = String(dados[c] ?? '').trim();
      await salvarCadastroFornecedor(fornecedor.empresa_id, razao.trim(), emails, saida);
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
          <p className="apoio">
            CNPJ {formatarCnpj(fornecedor.cnpj)}{fornecedor.email_acesso ? ` · acesso ao portal: ${fornecedor.email_acesso}` : ''}.
            O CNPJ e o e-mail de acesso são alterados pelo administrativo, em Acessos.
          </p>
          <div className="grade-2">
            <label className="campo">
              <span>Razão social</span>
              <input value={razao} maxLength={200} aria-invalid={razao.trim().length < 3} onChange={(e) => setRazao(e.target.value)} />
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
            <button className="botao" type="submit" disabled={razao.trim().length < 3 || enviando}>{enviando ? 'Salvando' : 'Salvar cadastro'}</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}
