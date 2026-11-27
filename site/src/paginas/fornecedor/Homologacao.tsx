import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Dialogo } from '../../componentes/Dialogo';
import { TermoLgpd } from '../../componentes/TermoLgpd';
import { mensagemDeErro } from '../../lib/supabase';
import { data, diasAte, hojeIso, somarDias, tamanhoArquivo } from '../../lib/formato';
import { problemaNoArquivo } from '../../lib/fornecedor';
import {
  documentoAtual, lerCamposHomologacao, enviarDocumentoHomologacao, enviarHomologacao, formatarCnpj, lerMinhaHomologacao,
  lerTiposHomologacao, salvarHomologacao, abrirArquivoHomologacao, documentoSeAplica,
  type CampoHomologacao, type DadosF31, type DocumentoHomologacao, type MinhaHomologacao, type Referencia, type TipoHomologacao,
} from '../../lib/homologacao';

const REFERENCIA_VAZIA: Referencia = { empresa: '', endereco: '', cidade: '', estado: '', telefone: '', email: '', contato: '' };


// Tela do fornecedor novo: preenche o F.31 (Homologação de fornecedores), envia os documentos e manda para o Suprimentos.
// Depois de homologado, a mesma tela serve para renovar as certidões que vencem.
export function Homologacao() {
  const [lista, setLista] = useState<MinhaHomologacao[] | null>(null);
  const [tipos, setTipos] = useState<TipoHomologacao[]>([]);
  const [campos, setCampos] = useState<CampoHomologacao[]>([]);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [l, t, c] = await Promise.all([lerMinhaHomologacao(), lerTiposHomologacao(true), lerCamposHomologacao()]);
      setLista(l);
      setTipos(t);
      setCampos(c);
      setEscolhida((atual) => atual && l.some((h) => h.empresa_id === atual) ? atual : (l.find((h) => !h.liberado) ?? l[0])?.empresa_id ?? null);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      setLista([]);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const atual = lista?.find((h) => h.empresa_id === escolhida) ?? null;

  return (
    <Pagina
      titulo="Homologação"
      apoio="Cadastro da sua empresa como fornecedor de serviços da Emais. O Suprimentos confere os dados e os documentos e libera a próxima etapa."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!lista ? (
        <Carregando />
      ) : !atual ? (
        <p className="vazio">Não há homologação aberta para a sua empresa. Se você recebeu um convite, fale com a Emais pela Ajuda.</p>
      ) : (
        <>
          {lista.length > 1 && (
            <div className="abas abas-botoes" role="tablist">
              {lista.map((h) => (
                <button key={h.empresa_id} type="button" role="tab" aria-selected={h.empresa_id === escolhida} onClick={() => setEscolhida(h.empresa_id)}>
                  {h.razao_social}
                </button>
              ))}
            </div>
          )}
          <FormularioHomologacao
            key={atual.empresa_id}
            h={atual}
            tipos={tipos.filter((t) => t.ativo && documentoSeAplica(t, atual.tipos))}
            campos={campos.filter((c) => c.ativo)}
            aoMudar={async (msg) => {
              setErro(null);
              setOk(msg);
              await carregar();
            }}
            aoErro={(m) => {
              setOk(null);
              setErro(m);
            }}
          />
        </>
      )}
    </Pagina>
  );
}

function FormularioHomologacao({ h, tipos, campos, aoMudar, aoErro }: {
  h: MinhaHomologacao;
  tipos: TipoHomologacao[];
  campos: CampoHomologacao[];
  aoMudar: (msg: string) => Promise<void>;
  aoErro: (m: string) => void;
}) {
  const obrigatorios = campos.filter((c) => c.obrigatorio && c.campo !== 'referencias').map((c) => c.campo as keyof DadosF31);
  const referenciaObrigatoria = campos.find((c) => c.campo === 'referencias')?.obrigatorio ?? true;
  const rotulo = (c: string) => campos.find((x) => x.campo === c)?.rotulo ?? c;
  const adicionais = campos.filter((c) => c.personalizado);
  const editavel = h.situacao === 'convidada' || h.situacao === 'devolvida';
  const podeEnviarDocs = editavel || h.situacao === 'homologada';
  const inicial = useMemo<DadosF31>(() => ({
    razao_social: h.razao_social,
    email_empresa: h.dados?.email ?? '',
    ...h.dados,
    referencias: h.dados?.referencias?.length ? h.dados.referencias : [{ ...REFERENCIA_VAZIA }],
  }), [h]);
  const [dados, setDados] = useState<DadosF31>(inicial);
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState<{ tipo: TipoHomologacao; doc: DocumentoHomologacao | null } | null>(null);
  const [tentouEnviar, setTentouEnviar] = useState(false);

  useEffect(() => {
    setDados(inicial);
    setAlterado(false);
  }, [inicial]);

  function mudar<K extends keyof DadosF31>(campo: K, valor: DadosF31[K]) {
    setDados((d) => ({ ...d, [campo]: valor }));
    setAlterado(true);
  }

  function mudarReferencia(i: number, campo: keyof Referencia, valor: string) {
    setDados((d) => {
      const refs = [...(d.referencias ?? [])];
      refs[i] = { ...refs[i], [campo]: valor };
      return { ...d, referencias: refs };
    });
    setAlterado(true);
  }

  const camposFaltando = obrigatorios.filter((c) => !String(dados[c] ?? '').trim());
  const semReferencia = referenciaObrigatoria && !(dados.referencias ?? []).some((r) => r.empresa.trim());
  const docsFaltando = tipos.filter((t) => {
    if (!t.obrigatorio) return false;
    const d = documentoAtual(h.documentos, t.codigo);
    return !d || d.status === 'devolvido';
  });
  const formatoErrado = (c: CampoHomologacao) => {
    const v = String(dados[c.campo as keyof DadosF31] ?? '').trim();
    if (!v) return false;
    if (c.formato === 'data') return !/^\d{4}-\d{2}-\d{2}$/.test(v);
    if (c.formato === 'numero') return !/^-?\d+([.,]\d+)?$/.test(v);
    return false;
  };

  const formatosErrados = adicionais.filter(formatoErrado);
  const pronto = camposFaltando.length === 0 && !semReferencia && docsFaltando.length === 0 && formatosErrados.length === 0;

  function limpar(d: DadosF31): DadosF31 {
    const refs = (d.referencias ?? []).filter((r) => Object.values(r).some((v) => String(v ?? '').trim()));
    const saida: DadosF31 = {};
    for (const [k, v] of Object.entries(d)) {
      if (k === 'referencias' || k === 'email') continue;
      (saida as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v;
    }
    saida.referencias = refs;
    return saida;
  }

  async function salvar(): Promise<boolean> {
    setSalvando(true);
    try {
      await salvarHomologacao(h.empresa_id, limpar(dados));
      setAlterado(false);
      return true;
    } catch (e) {
      aoErro(mensagemDeErro(e as Error));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function enviar() {
    setTentouEnviar(true);
    if (!pronto) {
      aoErro('Ainda falta preencher ou enviar alguns itens. Veja a lista no fim da página.');
      return;
    }
    setEnviando(true);
    try {
      if (!(await salvar())) return;
      await enviarHomologacao(h.empresa_id);
      await aoMudar('Homologação enviada. O Suprimentos vai conferir e você recebe a resposta por e-mail.');
    } catch (e) {
      aoErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }


  const campo = (nome: keyof DadosF31, rotulo: string, extra?: { tipo?: string; dica?: string; max?: number }) => {
    const obrigatorio = obrigatorios.includes(nome);
    const vazio = obrigatorio && tentouEnviar && !String(dados[nome] ?? '').trim();
    return (
      <label className="campo">
        <span>{rotulo}{obrigatorio ? ' *' : ''}</span>
        <input
          type={extra?.tipo ?? 'text'}
          value={String(dados[nome] ?? '')}
          maxLength={extra?.max ?? 200}
          readOnly={!editavel}
          aria-invalid={vazio}
          onChange={(e) => mudar(nome, e.target.value as never)}
        />
        {extra?.dica && <small className="dica">{extra.dica}</small>}
        {vazio && <small className="campo-erro">Preencha este campo.</small>}
      </label>
    );
  };

  return (
    <>
      <SituacaoAtual h={h} />

      <section className="bloco">
        <h2 className="bloco-titulo">Dados da empresa</h2>
        <p className="apoio">CNPJ {formatarCnpj(h.cnpj)}</p>
        <div className="grade-2">
          {campo('razao_social', 'Razão social')}
          {campo('nome_fantasia', 'Nome fantasia')}
          {campo('ramo', 'Ramo de atividade', { dica: 'O serviço que a empresa presta. Ex.: instalações elétricas, pintura, impermeabilização' })}
          {campo('praca', 'Praça de atuação', { dica: 'Cidades ou regiões onde a empresa atende' })}
          {campo('inscricao_estadual', 'Inscrição estadual')}
          {campo('inscricao_municipal', 'Inscrição municipal')}
        </div>
        <h3 className="detalhe-subtitulo">Endereço</h3>
        <div className="grade-3">
          {campo('cep', 'CEP', { max: 9 })}
          {campo('endereco', 'Endereço')}
          {campo('numero', 'Número', { max: 20 })}
          {campo('complemento', 'Complemento')}
          {campo('bairro', 'Bairro')}
          {campo('cidade', 'Cidade')}
          {campo('estado', 'Estado', { max: 2, dica: 'Sigla, ex.: SP' })}
        </div>
        <h3 className="detalhe-subtitulo">Contato</h3>
        <div className="grade-3">
          {campo('contato', 'Pessoa de contato')}
          {campo('telefone', 'Telefone', { tipo: 'tel', max: 20 })}
          {campo('celular', 'Celular', { tipo: 'tel', max: 20 })}
          {campo('email_empresa', 'E-mail da empresa', { tipo: 'email' })}
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Dados bancários</h2>
        <p className="apoio">A conta precisa estar no nome da empresa (mesmo CNPJ). Envie também o comprovante em Documentos, mais abaixo.</p>
        <div className="grade-3">
          {campo('banco', 'Banco')}
          {campo('agencia', 'Agência', { max: 20 })}
          {campo('conta', 'Conta', { max: 30 })}
        </div>
      </section>

      <section className="bloco">
        <h2 className="bloco-titulo">Referências comerciais</h2>
        <p className="apoio">Empresas para quem vocês já prestaram serviço. {referenciaObrigatoria ? 'Informe pelo menos uma, até três.' : 'Até três.'}</p>
        {(dados.referencias ?? []).map((r, i) => (
          <fieldset key={i} className="campo-grupo">
            <legend>Referência {i + 1}</legend>
            <div className="grade-3">
              {(['empresa', 'contato', 'telefone', 'email', 'endereco', 'cidade', 'estado'] as (keyof Referencia)[]).map((c) => (
                <label className="campo" key={c}>
                  <span>{{ empresa: 'Empresa', contato: 'Contato', telefone: 'Telefone', email: 'E-mail', endereco: 'Endereço', cidade: 'Cidade', estado: 'Estado' }[c]}{c === 'empresa' && i === 0 && referenciaObrigatoria ? ' *' : ''}</span>
                  <input
                    type={c === 'email' ? 'email' : c === 'telefone' ? 'tel' : 'text'}
                    value={r[c] ?? ''}
                    maxLength={c === 'estado' ? 2 : 200}
                    readOnly={!editavel}
                    aria-invalid={c === 'empresa' && i === 0 && tentouEnviar && semReferencia}
                    onChange={(e) => mudarReferencia(i, c, e.target.value)}
                  />
                </label>
              ))}
            </div>
            {editavel && (dados.referencias ?? []).length > 1 && (
              <button
                type="button"
                className="botao botao-discreto botao-pequeno"
                onClick={() => {
                  setDados((d) => ({ ...d, referencias: (d.referencias ?? []).filter((_, j) => j !== i) }));
                  setAlterado(true);
                }}
              >
                Tirar referência
              </button>
            )}
          </fieldset>
        ))}
        {editavel && (dados.referencias ?? []).length < 3 && (
          <button
            type="button"
            className="botao botao-secundario botao-pequeno"
            onClick={() => {
              setDados((d) => ({ ...d, referencias: [...(d.referencias ?? []), { ...REFERENCIA_VAZIA }] }));
              setAlterado(true);
            }}
          >
            Incluir referência
          </button>
        )}
      </section>

      {adicionais.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Perguntas adicionais</h2>
          <p className="apoio">Informações que o Suprimentos da Emais pede além do cadastro padrão.</p>
          <div className="grade-2">
            {adicionais.map((c) => {
              const nome = c.campo as keyof DadosF31;
              const errado = formatoErrado(c);
              return (
                <div key={c.campo}>
                  {campo(nome, c.rotulo, {
                    tipo: c.formato === 'data' ? 'date' : 'text',
                    dica: c.formato === 'numero' ? 'Só números. Use vírgula para decimais.' : undefined,
                    max: c.formato === 'texto' ? 500 : 30,
                  })}
                  {errado && <small className="campo-erro">{c.formato === 'data' ? 'Informe uma data válida.' : 'Informe só números.'}</small>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {editavel && (
        <div className="linha-botoes">
          <button
            type="button"
            className="botao botao-secundario"
            disabled={!alterado || salvando}
            onClick={async () => {
              if (await salvar()) await aoMudar('Dados salvos. Você pode continuar depois.');
            }}
          >
            {salvando ? 'Salvando' : 'Salvar dados'}
          </button>
          {alterado && <span className="dica">Há alterações não salvas.</span>}
        </div>
      )}

      <section className="bloco">
        <h2 className="bloco-titulo">Documentos</h2>
        <p className="apoio">
          {h.situacao === 'homologada'
            ? 'Quando uma certidão vencer, envie a nova por aqui. O Suprimentos confere e, se for o caso, ela já vale também no portal.'
            : 'Envie cada documento com a data de emissão. O cartão CNPJ, o PGR e o PCMSO aprovados aqui já entram aprovados em Documentos da empresa.'}
        </p>
        <div className="lista-pendencias">
          {tipos.map((t) => (
            <ItemDocumento
              key={t.codigo}
              tipo={t}
              docs={h.documentos}
              podeEnviar={podeEnviarDocs}
              aoEnviar={(doc) => setPedido({ tipo: t, doc })}
            />
          ))}
        </div>
      </section>

      {editavel && (
        <section className="bloco bloco-concluir">
          <h2 className="bloco-titulo">Enviar para o Suprimentos</h2>
          {pronto ? (
            <p className="apoio">Tudo preenchido. Depois de enviar, os dados ficam travados até a resposta do Suprimentos.</p>
          ) : (
            <>
              <p className="apoio">Para enviar, ainda falta:</p>
              <ul className="lista-simples">
                {camposFaltando.length > 0 && <li>Preencher: {camposFaltando.map(rotulo).join(', ')}</li>}
                {semReferencia && <li>Informar pelo menos uma referência comercial</li>}
                {formatosErrados.length > 0 && <li>Corrigir o formato: {formatosErrados.map((c) => c.rotulo).join(', ')}</li>}
                {docsFaltando.map((t) => <li key={t.codigo}>Enviar {t.nome}{documentoAtual(h.documentos, t.codigo)?.status === 'devolvido' ? ' (devolvido, envie de novo)' : ''}</li>)}
              </ul>
            </>
          )}
          <div className="linha-botoes">
            <button type="button" className="botao" disabled={enviando || salvando} onClick={enviar}>
              {enviando ? 'Enviando' : 'Enviar para homologação'}
            </button>
          </div>
        </section>
      )}

      <EnvioDocumentoHomologacao
        pedido={pedido}
        empresaId={h.empresa_id}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (nome) => {
          setPedido(null);
          await aoMudar(`${nome} enviado.`);
        }}
      />
    </>
  );
}

function SituacaoAtual({ h }: { h: MinhaHomologacao }) {
  let conteudo: ReactNode = null;
  let classe = 'aviso aviso-info';
  if (h.situacao === 'convidada') {
    conteudo = <>Preencha os dados, envie os documentos e clique em <strong>Enviar para homologação</strong>, no fim da página. Dá para salvar e continuar depois.</>;
  } else if (h.situacao === 'devolvida') {
    classe = 'aviso aviso-alerta';
    conteudo = (
      <>
        <strong>O Suprimentos pediu correções.</strong> {h.motivo ?? 'Veja os documentos devolvidos abaixo.'} Corrija e envie de novo para homologação.
      </>
    );
  } else if (h.situacao === 'enviada') {
    conteudo = <><strong>Em análise no Suprimentos</strong>{h.enviada_em ? ` desde ${data(h.enviada_em)}` : ''}. Você recebe a resposta por e-mail.</>;
  } else if (h.situacao === 'homologada' && !h.liberado) {
    classe = 'aviso aviso-ok';
    conteudo = <><strong>Empresa homologada.</strong> O administrativo da Emais vai liberar o portal para o cadastro dos colaboradores. Você recebe um e-mail quando estiver liberado.</>;
  } else if (h.situacao === 'homologada') {
    classe = 'aviso aviso-ok';
    conteudo = <><strong>Empresa homologada.</strong> Mantenha as certidões em dia: quando uma vencer, o portal avisa e você envia a nova aqui.</>;
  } else if (h.situacao === 'reprovada') {
    classe = 'aviso aviso-erro';
    conteudo = <><strong>Homologação não aprovada.</strong> {h.motivo ?? ''} Para mais informações, fale com o Suprimentos da Emais pela Ajuda.</>;
  }
  return conteudo ? <p className={classe} role="status">{conteudo}</p> : null;
}

const ROTULO_DOC: Record<string, string> = { em_analise: 'Em análise', aprovado: 'Aprovado', devolvido: 'Devolvido', nao: 'Não enviado', vencido: 'Vencido' };
const CLASSE_DOC: Record<string, string> = { em_analise: 'selo-doc-em_analise', aprovado: 'selo-doc-vigente', devolvido: 'selo-doc-devolvido', nao: 'selo-doc-nao_enviado', vencido: 'selo-doc-vencido' };

function ItemDocumento({ tipo, docs, podeEnviar, aoEnviar }: { tipo: TipoHomologacao; docs: DocumentoHomologacao[]; podeEnviar: boolean; aoEnviar: (d: DocumentoHomologacao | null) => void }) {
  const doc = documentoAtual(docs, tipo.codigo);
  const aprovadoAnterior = doc?.status === 'em_analise' ? docs.find((d) => d.tipo === tipo.codigo && d.status === 'aprovado') ?? null : null;
  const vencido = doc?.status === 'aprovado' && !!doc.vencimento && diasAte(doc.vencimento) < 0;
  const situacao = !doc ? 'nao' : vencido ? 'vencido' : doc.status;
  const acao = !doc ? 'Enviar' : doc.status === 'em_analise' ? null : doc.status === 'devolvido' || vencido ? 'Enviar novo' : 'Atualizar';
  return (
    <div className="item-pendencia">
      <div>
        <strong>{tipo.nome}</strong>
        <span className="sub">
          {tipo.obrigatorio ? 'Obrigatório' : 'Se houver'}
          {tipo.validade_dias ? `, vale ${tipo.validade_dias} dias da emissão` : ''}
          {doc?.vencimento ? `, ${vencido ? 'venceu' : 'vence'} em ${data(doc.vencimento)}` : ''}
        </span>
        {tipo.observacao && <span className="sub">{tipo.observacao}</span>}
        {doc?.status === 'devolvido' && doc.motivo && <span className="sub texto-erro">Motivo da devolução: {doc.motivo}</span>}
        {aprovadoAnterior && <span className="sub">O documento aprovado anterior continua valendo até o Suprimentos conferir o novo.</span>}
        {doc?.arquivos?.length ? (
          <span className="sub">
            {doc.arquivos.map((a, i) => (
              <button key={a.caminho} type="button" className="botao-link" onClick={() => abrirArquivoHomologacao(a.caminho).catch(() => undefined)}>
                {a.nome ?? `Arquivo ${i + 1}`}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      <span className={`selo ${CLASSE_DOC[situacao]}`}>{ROTULO_DOC[situacao]}</span>
      {podeEnviar && acao ? (
        <button type="button" className={acao === 'Atualizar' ? 'botao botao-secundario botao-pequeno' : 'botao botao-pequeno'} onClick={() => aoEnviar(doc)}>
          {acao}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

const MAXIMO_ARQUIVOS = 5;

function EnvioDocumentoHomologacao({ pedido, empresaId, aoFechar, aoEnviar }: {
  pedido: { tipo: TipoHomologacao; doc: DocumentoHomologacao | null } | null;
  empresaId: string;
  aoFechar: () => void;
  aoEnviar: (nome: string) => Promise<void>;
}) {
  const [emissao, setEmissao] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEmissao('');
    setArquivos([]);
    setAceite(false);
    setErro(null);
  }, [pedido]);

  if (!pedido) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const t = pedido.tipo;
  const futura = !!emissao && emissao > hojeIso();
  const vence = emissao && t.validade_dias ? somarDias(emissao, t.validade_dias) : null;
  const problemas = arquivos.map(problemaNoArquivo).filter((p): p is string => !!p);
  const pronto = !!emissao && !futura && arquivos.length > 0 && problemas.length === 0 && aceite;

  function adicionar(lista: FileList | null) {
    if (!lista) return;
    const novos = Array.from(lista);
    setArquivos((atuais) => [...atuais, ...novos].slice(0, MAXIMO_ARQUIVOS));
    if (entrada.current) entrada.current.value = '';
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setErro(null);
    setEnviando(true);
    try {
      await enviarDocumentoHomologacao(empresaId, t.codigo, emissao, arquivos);
      await aoEnviar(t.nome);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto titulo={`Enviar ${t.nome}`} aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        {pedido.doc?.status === 'devolvido' && pedido.doc.motivo && (
          <p className="aviso aviso-alerta"><strong>Devolvido pelo Suprimentos.</strong> {pedido.doc.motivo}</p>
        )}
        {t.observacao && <p className="apoio">{t.observacao}</p>}
        <label className="campo campo-data">
          <span>Data de emissão do documento</span>
          <input type="date" value={emissao} max={hojeIso()} aria-invalid={futura} onChange={(e) => setEmissao(e.target.value)} />
          {futura && <small className="campo-erro">A data de emissão não pode ser futura.</small>}
          {vence && !futura && (
            <small className={diasAte(vence) < 0 ? 'campo-erro' : 'dica'}>
              {diasAte(vence) < 0 ? `Pela emissão, venceu em ${data(vence)}. Envie um documento atualizado.` : `Vale até ${data(vence)} (${t.validade_dias} dias a partir da emissão).`}
            </small>
          )}
        </label>
        <div className="campo">
          <span>Arquivo</span>
          <small className="dica">PDF, JPG, PNG ou HEIC, até 10 MB cada. Tem mais de uma página em arquivos separados? Anexe todos.</small>
          <label className="area-arquivo">
            <input
              ref={entrada}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
              multiple
              onChange={(e) => adicionar(e.target.files)}
            />
            <span>{arquivos.length === 0 ? 'Escolher arquivo ou tirar foto' : 'Adicionar outro arquivo'}</span>
          </label>
          {arquivos.length > 0 && (
            <ul className="arquivos-escolhidos">
              {arquivos.map((a, i) => (
                <li key={`${a.name}-${i}`}>
                  <span>{a.name} <span className="sub">{tamanhoArquivo(a.size)}</span></span>
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setArquivos((l) => l.filter((_, j) => j !== i))}>Tirar</button>
                </li>
              ))}
            </ul>
          )}
          {problemas.map((p) => <small key={p} className="campo-erro">{p}</small>)}
        </div>
        <TermoLgpd marcado={aceite} aoMudar={setAceite} />
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!pronto || enviando}>{enviando ? 'Enviando' : 'Enviar para o Suprimentos'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
