import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { cnpjValido, data, diasAte, soDigitos } from '../../lib/formato';
import { useSessao } from '../../lib/sessao';
import { lerPedidosObra, responderPedidoObra, type PedidoObra } from '../../lib/ajuda';
import type { Acesso } from '../../lib/admin';
import {
  ITENS_QUALIFICACAO, NOMES_SITUACAO_FORNECEDOR, NOMES_SITUACAO_HOMOLOGACAO, SELO_HOMOLOGACAO, SELO_SITUACAO_FORNECEDOR,
  abrirArquivoHomologacao, analisarDocumentoHomologacao, devolverHomologacao, documentoAtual, documentoSeAplica, encerrarContrato, formatarCnpj,
  homologarFornecedor, lerAcessosPorEmpresa, lerCamposHomologacao, lerDetalheHomologacao, lerFornecedoresCadastro, lerHistoricoFornecedor,
  lerTiposHomologacao, liberarPortal, reenviarConvite, reprovarHomologacao, respostaAdicional, salvarCadastroFornecedor,
  type CampoHomologacao, type DadosF31, type DetalheHomologacao, type DocumentoHomologacao, type EventoFornecedor, type FornecedorCadastro,
  type RespostaQualificacao, type TipoHomologacao,
} from '../../lib/homologacao';
import { definirTiposFornecedor, lerTiposFornecedor, nomesDosTipos, type TipoFornecedor } from '../../lib/tiposFornecedor';
import { definirCategoriasFornecedor, lerCategorias, nomesDasCategorias, type CategoriaServico } from '../../lib/categorias';
import { receitaAtiva, type CamposReceita } from '../../lib/receita';
import {
  AcessoDaEmpresa, ConviteOutlook, EscolherTipos, GRUPOS_CADASTRO, PedirMotivo, ReceitaNoCadastro, RegistrarContrato, SituacaoDoFornecedor, oQueOTipoPede,
  type PedidoContrato,
} from './Dialogos';

// Ficha do fornecedor: tudo de uma empresa numa página só, com abas (Suprimentos e administrativo veem igual).
// A aba fica na URL (?ficha=documentos), junto com ?empresa=, para o link levar direto ao ponto.

const ABAS_FICHA = [
  ['resumo', 'Resumo'],
  ['documentos', 'Documentos'],
  ['homologacao', 'Homologação'],
  ['cadastro', 'Cadastro'],
  ['obras', 'Obras e contratos'],
  ['acesso', 'Acesso'],
  ['historico', 'Histórico'],
] as const;
type AbaFicha = (typeof ABAS_FICHA)[number][0];

// Situação de cada documento, junta homologação (F.31) e documentos da empresa no portal.
type SitDoc = 'em_dia' | 'vencendo' | 'em_analise' | 'pendente' | 'opcional';
const FILTROS_DOC = [
  ['todos', 'Todos'],
  ['pendente', 'Vencidos ou faltando'],
  ['vencendo', 'Vencendo'],
  ['em_analise', 'Em análise'],
  ['em_dia', 'Em dia'],
] as const;
type FiltroDoc = (typeof FILTROS_DOC)[number][0];
const VENCENDO_DIAS = 15;

type LinhaHom = { tipo: TipoHomologacao; doc: DocumentoHomologacao | null; sit: SitDoc; selo: string; rotulo: string };
type LinhaPortal = FornecedorCadastro['documentos'][number] & { sit: SitDoc };

const ROTULO_PORTAL: Record<string, string> = {
  vencido: 'Vencido', a_vencer: 'Vencendo', nao_enviado: 'Não enviado', devolvido: 'Devolvido', em_analise: 'Em análise', vigente: 'Em dia', dispensado: 'Dispensado',
};
const CLASSE_PORTAL: Record<string, string> = {
  vencido: 'selo-doc-vencido', a_vencer: 'selo-doc-a_vencer', nao_enviado: 'selo-doc-nao_enviado', devolvido: 'selo-doc-devolvido',
  em_analise: 'selo-doc-em_analise', vigente: 'selo-doc-vigente', dispensado: 'selo-doc-dispensado',
};
const SIT_PORTAL: Record<string, SitDoc> = {
  vencido: 'pendente', nao_enviado: 'pendente', devolvido: 'pendente', a_vencer: 'vencendo', em_analise: 'em_analise', vigente: 'em_dia', dispensado: 'em_dia',
};
const ORDEM_SIT: Record<SitDoc, number> = { pendente: 1, em_analise: 2, vencendo: 3, em_dia: 4, opcional: 5 };

function linhaHomologacao(tipo: TipoHomologacao, docs: DocumentoHomologacao[]): LinhaHom {
  const doc = documentoAtual(docs, tipo.codigo);
  if (!doc) return { tipo, doc, sit: tipo.obrigatorio ? 'pendente' : 'opcional', selo: 'selo-doc-nao_enviado', rotulo: 'Não enviado' };
  if (doc.status === 'em_analise') return { tipo, doc, sit: 'em_analise', selo: 'selo-doc-em_analise', rotulo: 'Para conferir' };
  if (doc.status === 'devolvido') return { tipo, doc, sit: tipo.obrigatorio ? 'pendente' : 'opcional', selo: 'selo-doc-devolvido', rotulo: 'Devolvido' };
  const dias = doc.vencimento ? diasAte(doc.vencimento) : null;
  if (dias !== null && dias < 0) return { tipo, doc, sit: 'pendente', selo: 'selo-doc-vencido', rotulo: 'Vencido' };
  if (dias !== null && dias <= VENCENDO_DIAS) return { tipo, doc, sit: 'vencendo', selo: 'selo-doc-a_vencer', rotulo: dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia(s)` };
  return { tipo, doc, sit: 'em_dia', selo: 'selo-doc-vigente', rotulo: 'Aprovado' };
}

const ROTULOS_CAMPOS: Record<string, string> = {
  razao_social: 'razão social', cnpj: 'CNPJ', nome_fantasia: 'nome fantasia', ramo: 'ramo', praca: 'praça', inscricao_estadual: 'inscrição estadual',
  inscricao_municipal: 'inscrição municipal', cep: 'CEP', endereco: 'endereço', numero: 'número', complemento: 'complemento', bairro: 'bairro', cidade: 'cidade',
  estado: 'estado', contato: 'contato', telefone: 'telefone', celular: 'celular', email_empresa: 'e-mail da empresa', banco: 'banco', agencia: 'agência', conta: 'conta',
};

// Texto de cada acontecimento do histórico.
function textoEvento(e: EventoFornecedor, nomeObra: (id: string) => string, nomeTipo: (codigo: string) => string): string {
  const x = (e.detalhe ?? {}) as Record<string, unknown>;
  const t = (k: string) => (typeof x[k] === 'string' && (x[k] as string).trim() ? (x[k] as string).trim() : '');
  const sit = (k: string) => NOMES_SITUACAO_FORNECEDOR[t(k) as keyof typeof NOMES_SITUACAO_FORNECEDOR] ?? t(k);
  switch (e.acao) {
    case 'cadastro_alterado': {
      const campos = Array.isArray(x.campos) ? (x.campos as string[]).map((c) => ROTULOS_CAMPOS[c] ?? c) : [];
      return `Cadastro alterado${campos.length ? `: ${campos.join(', ')}` : ''}`;
    }
    case 'categorias_alteradas': return 'Categorias de serviço alteradas';
    case 'tipos_fornecedor_alterados': return 'Tipo de fornecedor alterado';
    case 'situacao_fornecedor_alterada': return `Situação de ${sit('de')} para ${sit('para')}${t('motivo') ? `: ${t('motivo')}` : ''}`;
    case 'homologacao_cadastrada': return 'Cadastrado para homologação';
    case 'convite_homologacao': return `Convite da homologação${t('para') ? ` para ${t('para')}` : ''}`;
    case 'homologacao_enviada': return 'O fornecedor enviou a homologação';
    case 'homologacao_devolvida': return `Devolvido para correção${t('observacao') ? `: ${t('observacao')}` : ''}`;
    case 'homologada': return `Homologado${t('responsavel') ? ` (aprovação de ${t('responsavel')})` : ''}`;
    case 'homologacao_reprovada': return `Homologação reprovada${t('motivo') ? `: ${t('motivo')}` : ''}`;
    case 'portal_liberado': return 'Portal liberado para o fornecedor';
    case 'email_enviado_outlook': return 'E-mail marcado como enviado pelo Outlook';
    case 'emails_alterados': return 'E-mails para avisos alterados';
    case 'subcontratada_cadastrada': return 'Cadastrada como subcontratada';
    case 'contrato_registrado': return `Contrato ${t('numero')} registrado`;
    case 'contrato_alterado': return `Contrato ${t('numero')} alterado`;
    case 'contrato_encerrado': return `Contrato encerrado${t('motivo') ? `: ${t('motivo')}` : ''}`;
    case 'documento_homologacao_aprovado': return `${nomeTipo(t('tipo'))} aprovado`;
    case 'documento_homologacao_devolvido': return `${nomeTipo(t('tipo'))} devolvido${t('motivo') ? `: ${t('motivo')}` : ''}`;
    case 'pedido_obra_aprovado': return `Pedido para atuar em ${nomeObra(t('obra_id')) || 'outra obra'} aprovado`;
    case 'pedido_obra_recusado': return `Pedido para atuar em ${nomeObra(t('obra_id')) || 'outra obra'} recusado${t('motivo') ? `: ${t('motivo')}` : ''}`;
    default: return e.acao.replace(/_/g, ' ');
  }
}

type ItemHistorico = { em: string; texto: string; quem: string | null };

function MaisAcoes({ itens }: { itens: { rotulo: string; fazer: () => void; perigo?: boolean }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const fechar = (ev: MouseEvent | KeyboardEvent) => {
      const el = ref.current;
      if (!el?.open) return;
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !el.contains(ev.target as Node)) el.open = false;
    };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', fechar);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('keydown', fechar);
    };
  }, []);
  if (!itens.length) return null;
  return (
    <details className="menu-acoes" ref={ref}>
      <summary className="botao">Mais ações</summary>
      <div className="menu-acoes-lista">
        {itens.map((i) => (
          <button
            key={i.rotulo}
            type="button"
            className={i.perigo ? 'texto-erro' : undefined}
            onClick={() => {
              if (ref.current) ref.current.open = false;
              i.fazer();
            }}
          >
            {i.rotulo}
          </button>
        ))}
      </div>
    </details>
  );
}

export function FichaFornecedor({ empresaId, aoVoltar, voltarRotulo = 'Voltar' }: { empresaId: string; aoVoltar: () => void; voltarRotulo?: string }) {
  const { usuario } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const [params, setParams] = useSearchParams();
  const pedida = params.get('ficha');
  const [d, setD] = useState<DetalheHomologacao | null>(null);
  const [cad, setCad] = useState<FornecedorCadastro | null>(null);
  const [tiposHom, setTiposHom] = useState<TipoHomologacao[]>([]);
  const [campos, setCampos] = useState<CampoHomologacao[]>([]);
  const [categoriasL, setCategoriasL] = useState<CategoriaServico[]>([]);
  const [tiposF, setTiposF] = useState<TipoFornecedor[]>([]);
  const [acessos, setAcessos] = useState<Awaited<ReturnType<typeof lerAcessosPorEmpresa>> | null>(null);
  const [eventos, setEventos] = useState<EventoFornecedor[]>([]);
  const [pedidos, setPedidos] = useState<PedidoObra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoConvite, setVersaoConvite] = useState(0);
  const [devolverDoc, setDevolverDoc] = useState<DocumentoHomologacao | null>(null);
  const [dialogo, setDialogo] = useState<'devolver' | 'reprovar' | null>(null);
  const [encerrar, setEncerrar] = useState<string | null>(null);
  const [recusar, setRecusar] = useState<PedidoObra | null>(null);
  const [contrato, setContrato] = useState<PedidoContrato | null>(null);
  const [qualificacao, setQualificacao] = useState<Record<string, RespostaQualificacao>>({});
  const [comentarios, setComentarios] = useState('');
  const [responsavel, setResponsavel] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [x, t, c, f, a, h, p, cat, tf] = await Promise.all([
        lerDetalheHomologacao(empresaId), lerTiposHomologacao(true), lerCamposHomologacao(), lerFornecedoresCadastro(empresaId),
        lerAcessosPorEmpresa().catch(() => null), lerHistoricoFornecedor(empresaId).catch(() => [] as EventoFornecedor[]),
        lerPedidosObra().catch(() => [] as PedidoObra[]), lerCategorias().catch(() => [] as CategoriaServico[]), lerTiposFornecedor().catch(() => [] as TipoFornecedor[]),
      ]);
      setD(x);
      setCad(f.find((e) => e.empresa_id === empresaId) ?? f[0] ?? null);
      // Só os documentos do(s) tipo(s) do fornecedor; removido da configuração ou de outro tipo só aparece se ele já tinha enviado.
      setTiposHom(t.filter((tp) => (tp.ativo && documentoSeAplica(tp, x.tipos)) || x.documentos.some((doc) => doc.tipo === tp.codigo)));
      setCampos(c);
      setAcessos(a);
      setEventos(h);
      setPedidos(p.filter((z) => z.empresa_id === empresaId));
      setCategoriasL(cat);
      setTiposF(tf);
      setQualificacao(x.qualificacao ?? {});
      setComentarios(x.comentarios ?? '');
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [empresaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (d && !responsavel) setResponsavel(d.responsavel ?? usuario?.nome ?? '');
  }, [d, responsavel, usuario]);

  const linhasHom = useMemo(() => (d && d.situacao !== 'anterior' ? tiposHom.map((t) => linhaHomologacao(t, d.documentos)) : []), [d, tiposHom]);
  const linhasPortal = useMemo<LinhaPortal[]>(() => (cad?.documentos ?? []).map((x) => ({ ...x, sit: SIT_PORTAL[x.situacao] ?? 'em_dia' })), [cad]);
  const contagem = useMemo(() => {
    const todas = [...linhasHom.map((l) => l.sit), ...linhasPortal.map((l) => l.sit)];
    const n = (s: SitDoc) => todas.filter((x) => x === s).length;
    return { em_dia: n('em_dia'), vencendo: n('vencendo'), em_analise: n('em_analise'), pendente: n('pendente') };
  }, [linhasHom, linhasPortal]);

  const historico = useMemo<ItemHistorico[]>(() => {
    if (!d) return [];
    const obrasConhecidas = new Map<string, string>([
      ...d.obras_ativas.map((o) => [o.id, o.nome] as [string, string]),
      ...d.obras_previstas.map((o) => [o.id, o.nome] as [string, string]),
      ...pedidos.map((p) => [p.obra_id, p.obras?.nome ?? ''] as [string, string]),
    ]);
    const nomeTipo = (c: string) => tiposHom.find((t) => t.codigo === c)?.nome ?? 'Documento';
    const itens: ItemHistorico[] = eventos.map((e) => ({ em: e.em, texto: textoEvento(e, (id) => obrasConhecidas.get(id) ?? '', nomeTipo), quem: e.quem }));
    // Análises anteriores à migração 072 não viraram evento: entram pelo próprio documento (só a última de cada um).
    const temEvento = (doc: DocumentoHomologacao) =>
      eventos.some((e) => e.acao.startsWith('documento_homologacao_') && (e.detalhe as Record<string, unknown> | null)?.tipo === doc.tipo && !!doc.analisado_em && Math.abs(Date.parse(e.em) - Date.parse(doc.analisado_em)) < 60000);
    for (const doc of d.documentos) {
      if (temEvento(doc)) continue;
      if (doc.status === 'aprovado' && doc.analisado_em) itens.push({ em: doc.analisado_em, texto: `${nomeTipo(doc.tipo)} aprovado`, quem: doc.analisado_por ?? null });
      if (doc.status === 'devolvido') itens.push({ em: doc.analisado_em ?? doc.enviado_em, texto: `${nomeTipo(doc.tipo)} devolvido${doc.motivo ? `: ${doc.motivo}` : ''}`, quem: doc.analisado_por ?? null });
    }
    return itens.sort((a, b) => b.em.localeCompare(a.em));
  }, [d, eventos, pedidos, tiposHom]);

  async function acao(fn: () => Promise<unknown>, msg: string) {
    setErro(null);
    setOcupado(true);
    try {
      await fn();
      setOk(msg);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      throw e;
    } finally {
      setOcupado(false);
    }
  }

  function irPara(a: AbaFicha, extra: Record<string, string> = {}) {
    const p = new URLSearchParams(params);
    p.delete('filtro');
    p.delete('foco');
    if (a === 'resumo') p.delete('ficha');
    else p.set('ficha', a);
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    setParams(p);
    if (!extra.foco) window.scrollTo({ top: 0 });
  }

  const voltar = (
    <button type="button" className="link-voltar botao-link ficha-voltar" onClick={aoVoltar}>
      ‹ {voltarRotulo}
    </button>
  );

  if (!d) {
    return (
      <Pagina titulo="Fornecedor" voltar={voltar}>
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );
  }

  const situacao = cad?.situacao ?? 'ativo';
  const bloqueado = situacao === 'bloqueado';
  const ativos = d.contratos.filter((c) => c.situacao === 'ativo');
  const pendentesObra = pedidos.filter((p) => p.situacao === 'pendente');
  const acesso = acessos?.porEmpresa.get(d.empresa_id) ?? null;
  const abasVisiveis = ABAS_FICHA.filter(([a]) => a !== 'homologacao' || d.situacao !== 'anterior');
  const aba: AbaFicha = abasVisiveis.some(([a]) => a === pedida) ? (pedida as AbaFicha) : 'resumo';
  const local = [d.dados?.cidade, d.dados?.estado].filter(Boolean).join('/');
  const podeContrato = (d.situacao === 'homologada' || d.situacao === 'anterior') && !bloqueado;

  function abrirContrato(pedido?: PedidoObra) {
    if (!d) return;
    if (pedido) {
      setContrato({
        empresaId: d.empresa_id, empresaNome: d.razao_social, codigoBp: d.codigo_bp, contrato: null,
        obrasIniciais: [pedido.obra_id], numeroInicial: pedido.numero_contrato, titulo: `Contrato da obra ${pedido.obras?.nome ?? ''}`,
      });
      return;
    }
    const semContrato = d.obras_ativas.filter((o) => !ativos.some((c) => c.obras.some((x) => x.id === o.id)));
    setContrato({
      empresaId: d.empresa_id, empresaNome: d.razao_social, codigoBp: d.codigo_bp, contrato: null,
      obrasIniciais: semContrato.length ? semContrato.map((o) => o.id) : ativos.length ? [] : d.obras_previstas.map((o) => o.id),
      numeroInicial: semContrato.find((o) => o.numero_contrato)?.numero_contrato ?? null,
    });
  }

  const emHomologacao = d.situacao === 'convidada' || d.situacao === 'devolvida';
  const itensMenu = [
    ...(podeContrato ? [{ rotulo: 'Registrar contrato', fazer: () => abrirContrato() }] : []),
    ...(emHomologacao
      ? [{ rotulo: 'Reenviar convite', fazer: () => acao(() => reenviarConvite(d.empresa_id), 'Convite refeito na fila de e-mails, com o e-mail e o texto atuais.').then(() => setVersaoConvite((v) => v + 1)).catch(() => undefined) }]
      : []),
    { rotulo: 'Editar cadastro', fazer: () => irPara('cadastro') },
    { rotulo: 'Consultar na Receita', fazer: () => irPara('cadastro', { foco: 'receita' }) },
    { rotulo: 'Acesso ao portal', fazer: () => irPara('acesso') },
    { rotulo: bloqueado ? 'Desbloquear ou inativar' : situacao === 'inativo' ? 'Reativar ou bloquear' : 'Inativar ou bloquear', fazer: () => irPara('cadastro', { foco: 'situacao' }) },
    ...(emHomologacao || d.situacao === 'enviada' ? [{ rotulo: 'Reprovar homologação', fazer: () => setDialogo('reprovar'), perigo: true }] : []),
  ];

  const selos = (
    <span className="selos-linha">
      <span className={`selo ${SELO_HOMOLOGACAO[d.situacao]}`}>{d.situacao === 'anterior' ? 'Anterior ao portal' : NOMES_SITUACAO_HOMOLOGACAO[d.situacao]}</span>
      <span className={`selo ${SELO_SITUACAO_FORNECEDOR[situacao]}`} title={cad?.situacao_motivo ?? undefined}>{NOMES_SITUACAO_FORNECEDOR[situacao]}</span>
      {cad?.receita?.situacao && (
        <span className={`selo ${receitaAtiva(cad.receita.situacao) ? 'selo-encerrado' : 'selo-bloqueado'}`} title={cad.receita.aviso ?? undefined}>
          Receita: {cad.receita.situacao.toLowerCase()}
        </span>
      )}
    </span>
  );

  const apoio = [
    `CNPJ ${formatarCnpj(d.cnpj)}`,
    d.codigo_bp ? `BP ${d.codigo_bp}` : 'sem BP',
    local,
    nomesDosTipos(d.tipos, tiposF),
    nomesDasCategorias(d.categorias, categoriasL),
  ].filter(Boolean).join(' · ');

  const contadorAba = (a: AbaFicha) => {
    if (a === 'documentos') return contagem.em_analise + contagem.pendente;
    if (a === 'obras') return pendentesObra.length;
    return 0;
  };

  return (
    <Pagina
      titulo={d.razao_social}
      voltar={voltar}
      selos={selos}
      apoio={apoio}
      acoes={
        <>
          {d.situacao !== 'anterior' && (
            <button
              type="button"
              className="botao botao-secundario"
              onClick={() => import('../../lib/pdfF31').then((m) => m.baixarF31(d, tiposHom, campos, nomesDasCategorias(d.categorias, categoriasL))).catch((e) => setErro(mensagemDeErro(e)))}
            >
              Baixar F.31 (PDF)
            </button>
          )}
          <MaisAcoes itens={itensMenu} />
        </>
      }
      abas={
        <nav className="abas abas-botoes" aria-label="Ficha do fornecedor">
          {abasVisiveis.map(([a, nome]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => irPara(a)}>
              {nome}
              {!!contadorAba(a) && <span className="contador">{contadorAba(a)}</span>}
            </button>
          ))}
        </nav>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {cad && situacao !== 'ativo' && (
        <p className={`aviso ficha-aviso ${bloqueado ? 'aviso-erro' : 'aviso-info'}`}>
          <strong>Fornecedor {bloqueado ? 'bloqueado' : 'inativo'}</strong>
          {cad.situacao_motivo ? `: ${cad.situacao_motivo}` : ''}
          {cad.situacao_em ? ` (desde ${data(cad.situacao_em)}${cad.situacao_por ? `, por ${cad.situacao_por}` : ''})` : ''}.
          {bloqueado ? ' Não recebe convite, homologação, portal, contrato nem obra nova.' : ''}
        </p>
      )}

      {aba === 'resumo' && (
        <AbaResumo
          d={d}
          cad={cad}
          acesso={acesso}
          eventos={eventos}
          historico={historico}
          contagem={contagem}
          pendentesObra={pendentesObra}
          ehAdmin={ehAdmin}
          ocupado={ocupado}
          irPara={irPara}
          aoRegistrarContrato={() => abrirContrato()}
          aoLiberar={() => acao(() => liberarPortal(d.empresa_id), `Portal liberado para ${d.razao_social}. O e-mail de boas-vindas entrou na fila.`).catch(() => undefined)}
        />
      )}

      {aba === 'documentos' && (
        <AbaDocumentos
          d={d}
          cad={cad}
          linhasHom={linhasHom}
          linhasPortal={linhasPortal}
          filtro={(FILTROS_DOC.some(([f]) => f === params.get('filtro')) ? params.get('filtro') : 'todos') as FiltroDoc}
          aoFiltrar={(f) => irPara('documentos', f === 'todos' ? {} : { filtro: f })}
          ehAdmin={ehAdmin}
          ocupado={ocupado}
          aoAprovar={(doc, nome) => acao(() => analisarDocumentoHomologacao(doc.id, true), `${nome} aprovado.`).catch(() => undefined)}
          aoDevolver={setDevolverDoc}
          aoErro={setErro}
        />
      )}

      {aba === 'homologacao' && (
        <AbaHomologacao
          d={d}
          cad={cad}
          campos={campos}
          linhasHom={linhasHom}
          qualificacao={qualificacao}
          setQualificacao={setQualificacao}
          comentarios={comentarios}
          setComentarios={setComentarios}
          responsavel={responsavel}
          setResponsavel={setResponsavel}
          versaoConvite={versaoConvite}
          ocupado={ocupado}
          irPara={irPara}
          aoReenviar={() => acao(() => reenviarConvite(d.empresa_id), 'Convite refeito na fila de e-mails, com o e-mail e o texto atuais.').then(() => setVersaoConvite((v) => v + 1)).catch(() => undefined)}
          aoHomologar={() => acao(() => homologarFornecedor(d.empresa_id, qualificacao, comentarios, responsavel.trim()), 'Fornecedor homologado. Agora registre o contrato assinado.').catch(() => undefined)}
          aoDialogo={setDialogo}
        />
      )}

      {aba === 'cadastro' && cad && (
        <AbaCadastro
          cad={cad}
          tiposF={tiposF}
          categoriasL={categoriasL}
          foco={params.get('foco')}
          aoSalvar={async (msg) => {
            setOk(msg);
            await carregar();
          }}
        />
      )}

      {aba === 'obras' && (
        <AbaObras
          d={d}
          cad={cad}
          pedidos={pedidos}
          podeContrato={podeContrato}
          aoRegistrar={abrirContrato}
          aoEditar={(c) => setContrato({ empresaId: d.empresa_id, empresaNome: d.razao_social, codigoBp: d.codigo_bp, contrato: c, obrasIniciais: [] })}
          aoEncerrar={setEncerrar}
          aoRecusar={setRecusar}
          aoErro={setErro}
        />
      )}

      {aba === 'acesso' && cad && (
        <section className="ficha-cartao ficha-estreito">
          <AcessoDaEmpresa
            fornecedor={cad}
            acesso={acesso}
            acessos={acessos?.lista ?? []}
            aoMudar={async (msg) => {
              setOk(msg);
              setVersaoConvite((v) => v + 1);
              await carregar();
            }}
          />
          <dl className="ficha-pares ficha-pares-2">
            <div><dt>E-mail de acesso no cadastro</dt><dd>{cad.email_acesso || '-'}</dd></div>
            <div><dt>Outros e-mails para avisos</dt><dd>{cad.emails_contato || '-'}</dd></div>
          </dl>
          <p className="dica">Os outros e-mails para avisos mudam na aba Cadastro, em Contato e avisos.</p>
        </section>
      )}

      {aba === 'historico' && (
        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">Histórico <span className="sub">{historico.length}</span></h2>
          {historico.length === 0 ? (
            <p className="vazio">Nada registrado ainda.</p>
          ) : (
            <ol className="ficha-linha-tempo">
              {historico.map((h, i) => (
                <li key={i}>
                  <span className="ficha-linha-tempo-data">{data(h.em)}</span>
                  <span>
                    {h.texto}
                    {h.quem && <small className="sub">por {h.quem}</small>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <PedirMotivo
        aberto={!!devolverDoc}
        titulo={devolverDoc ? `Devolver ${tiposHom.find((t) => t.codigo === devolverDoc.tipo)?.nome ?? 'documento'}` : ''}
        apoio="O motivo aparece para o fornecedor no portal e no e-mail de correções."
        botao="Devolver documento"
        aoFechar={() => setDevolverDoc(null)}
        aoConfirmar={async (m) => {
          if (!devolverDoc) return;
          await acao(() => analisarDocumentoHomologacao(devolverDoc.id, false, m), 'Documento devolvido.');
          setDevolverDoc(null);
        }}
      />
      <PedirMotivo
        aberto={dialogo === 'devolver'}
        titulo="Devolver para correção"
        apoio="O fornecedor recebe um e-mail com os documentos devolvidos e esta observação. Se só os dados precisam de ajuste, explique aqui."
        botao="Devolver ao fornecedor"
        rotulo="Observação para o fornecedor"
        minimo={0}
        aoFechar={() => setDialogo(null)}
        aoConfirmar={async (m) => {
          await acao(() => devolverHomologacao(d.empresa_id, m), 'Homologação devolvida. O e-mail de correções entrou na fila.');
          setDialogo(null);
        }}
      />
      <PedirMotivo
        aberto={dialogo === 'reprovar'}
        titulo="Reprovar homologação"
        apoio="O fornecedor recebe o motivo por e-mail e não segue para o cadastro dos colaboradores."
        botao="Reprovar"
        minimo={5}
        aoFechar={() => setDialogo(null)}
        aoConfirmar={async (m) => {
          await acao(() => reprovarHomologacao(d.empresa_id, m), 'Homologação reprovada.');
          setDialogo(null);
        }}
      />
      <PedirMotivo
        aberto={!!encerrar}
        titulo="Encerrar contrato"
        apoio="O contrato sai das obras em A regularizar. Os colaboradores do fornecedor não são bloqueados por isso."
        botao="Encerrar contrato"
        aoFechar={() => setEncerrar(null)}
        aoConfirmar={async (m) => {
          if (!encerrar) return;
          await acao(() => encerrarContrato(encerrar, m), 'Contrato encerrado.');
          setEncerrar(null);
        }}
      />
      <PedirMotivo
        aberto={!!recusar}
        titulo={recusar ? `Recusar: ${recusar.obras?.nome ?? ''}` : ''}
        apoio="O motivo vai para o fornecedor na Ajuda."
        botao="Recusar pedido"
        aoFechar={() => setRecusar(null)}
        aoConfirmar={async (m) => {
          if (!recusar) return;
          await acao(() => responderPedidoObra(recusar.id, false, m), 'Pedido recusado. O fornecedor recebeu o motivo na Ajuda.');
          setRecusar(null);
        }}
      />
      <RegistrarContrato
        pedido={contrato}
        aoFechar={() => setContrato(null)}
        aoRegistrar={async (msg) => {
          setContrato(null);
          setOk(msg);
          await carregar();
        }}
      />
    </Pagina>
  );
}

// ------------------------------------------------------------------------------------------------ Resumo

type Etapa = { nome: string; info: string; estado: 'feito' | 'atual' | 'falta' | 'erro' };

function etapasDaHomologacao(d: DetalheHomologacao, eventos: EventoFornecedor[]): Etapa[] {
  const envios = eventos.filter((e) => e.acao === 'homologacao_enviada').length;
  const devolucoes = eventos.filter((e) => e.acao === 'homologacao_devolvida').length;
  const s = d.situacao;
  const decidida = s === 'homologada' || s === 'reprovada';
  const enviou = s === 'enviada' || decidida;
  const etapas: Etapa[] = [
    { nome: 'Convite', info: d.convidada_em ? data(d.convidada_em) : '-', estado: 'feito' },
    {
      nome: 'Preenchimento',
      info: s === 'devolvida' ? 'corrigindo o que voltou' : enviou && d.enviada_em ? `enviado em ${data(d.enviada_em)}` : enviou ? 'enviado' : 'em andamento',
      estado: enviou ? 'feito' : 'atual',
    },
    {
      nome: 'Análise',
      info: envios ? `${envios} envio${envios > 1 ? 's' : ''}${devolucoes ? ` · ${devolucoes} devoluç${devolucoes > 1 ? 'ões' : 'ão'}` : ''}` : s === 'enviada' ? 'para analisar' : '-',
      estado: decidida ? 'feito' : s === 'enviada' ? 'atual' : 'falta',
    },
    {
      nome: s === 'reprovada' ? 'Reprovado' : 'Homologado',
      info: decidida && d.decidida_em ? data(d.decidida_em) : 'aguardando',
      estado: s === 'reprovada' ? 'erro' : s === 'homologada' ? 'feito' : 'falta',
    },
    {
      nome: 'Liberado no portal',
      info: d.liberado_em ? data(d.liberado_em) : s === 'reprovada' ? '-' : 'aguardando',
      estado: d.liberado_em ? 'feito' : s === 'homologada' ? 'atual' : 'falta',
    },
  ];
  return etapas;
}

function AbaResumo({
  d, cad, acesso, eventos, historico, contagem, pendentesObra, ehAdmin, ocupado, irPara, aoRegistrarContrato, aoLiberar,
}: {
  d: DetalheHomologacao;
  cad: FornecedorCadastro | null;
  acesso: Acesso | null;
  eventos: EventoFornecedor[];
  historico: ItemHistorico[];
  contagem: Record<'em_dia' | 'vencendo' | 'em_analise' | 'pendente', number>;
  pendentesObra: PedidoObra[];
  ehAdmin: boolean;
  ocupado: boolean;
  irPara: (a: AbaFicha, extra?: Record<string, string>) => void;
  aoRegistrarContrato: () => void;
  aoLiberar: () => void;
}) {
  const ativos = d.contratos.filter((c) => c.situacao === 'ativo');
  const situacao = cad?.situacao ?? 'ativo';
  const docsHomAnalise = d.documentos.filter((x) => x.status === 'em_analise').length;
  const vencendoContrato = ativos.filter((c) => diasAte(c.termino) <= 30).sort((x, y) => x.termino.localeCompare(y.termino))[0] ?? null;

  // O que fazer agora com este fornecedor: uma frase e, quando dá, o botão que resolve.
  let passo: { texto: ReactNode; botao?: { rotulo: string; fazer: () => void } } ;
  if (situacao === 'bloqueado') passo = { texto: <>Fornecedor bloqueado{cad?.situacao_motivo ? `: ${cad.situacao_motivo}` : ''}. Nada novo é liberado até desbloquear.</>, botao: { rotulo: 'Ver situação', fazer: () => irPara('cadastro', { foco: 'situacao' }) } };
  else if (situacao === 'inativo') passo = { texto: 'Fornecedor inativo: fora das cobranças e da lista. Para voltar a trabalhar com ele, reative no cadastro.', botao: { rotulo: 'Reativar', fazer: () => irPara('cadastro', { foco: 'situacao' }) } };
  else if (d.situacao === 'convidada') passo = { texto: `Aguardando o fornecedor preencher o F.31 e enviar os documentos. Convite de ${data(d.convidada_em)}.`, botao: { rotulo: 'Ver convite', fazer: () => irPara('homologacao') } };
  else if (d.situacao === 'devolvida') passo = { texto: 'Aguardando o fornecedor corrigir o que foi devolvido e reenviar.', botao: { rotulo: 'Ver o que voltou', fazer: () => irPara('documentos', { filtro: 'pendente' }) } };
  else if (d.situacao === 'enviada') passo = { texto: `Analisar a homologação${docsHomAnalise ? `: ${docsHomAnalise} documento(s) para conferir` : ''}.`, botao: { rotulo: 'Analisar', fazer: () => irPara('homologacao') } };
  else if (d.situacao === 'reprovada') passo = { texto: `Homologação reprovada${d.motivo ? `: ${d.motivo}` : ''}.` };
  else if (d.situacao === 'homologada' && ativos.length === 0) passo = { texto: 'Registrar o contrato assinado. Depois disso o administrativo libera o portal.', botao: { rotulo: 'Registrar contrato', fazer: aoRegistrarContrato } };
  else if (d.situacao === 'homologada' && !d.liberado_em)
    passo = ehAdmin
      ? { texto: 'Liberar o portal: o fornecedor está homologado e o contrato já está registrado.', botao: { rotulo: ocupado ? 'Liberando' : 'Liberar portal', fazer: aoLiberar } }
      : { texto: 'Aguardando o administrativo liberar o portal. O contrato já está registrado.' };
  else if (pendentesObra.length) passo = { texto: `Responder o pedido para atuar em ${pendentesObra.map((p) => p.obras?.nome).filter(Boolean).join(', ')}.`, botao: { rotulo: 'Ver pedido', fazer: () => irPara('obras') } };
  else if (!d.codigo_bp && !cad?.subcontratada) passo = { texto: 'Informar o código BP (SAP) ao registrar ou editar o contrato.', botao: { rotulo: 'Ver contratos', fazer: () => irPara('obras') } };
  else if (vencendoContrato) passo = { texto: `Renovar o contrato ${vencendoContrato.numero}: ${diasAte(vencendoContrato.termino) < 0 ? 'venceu' : 'vence'} em ${data(vencendoContrato.termino)}.`, botao: { rotulo: 'Ver contratos', fazer: () => irPara('obras') } };
  else if (contagem.pendente) passo = { texto: `Regularizar ${contagem.pendente} documento(s) vencido(s) ou faltando.`, botao: { rotulo: 'Ver quais', fazer: () => irPara('documentos', { filtro: 'pendente' }) } };
  else if (contagem.vencendo) passo = { texto: `Nada travado. ${contagem.vencendo} documento(s) vencem nos próximos dias.`, botao: { rotulo: 'Ver quais', fazer: () => irPara('documentos', { filtro: 'vencendo' }) } };
  else passo = { texto: 'Nada pendente com este fornecedor.' };

  const titulo =
    d.situacao === 'anterior' ? 'Fornecedor anterior ao portal' :
    d.situacao === 'homologada' ? `Homologado${d.decidida_em ? ` em ${data(d.decidida_em)}` : ''}${d.decidida_por ? ` por ${d.decidida_por}` : ''}` :
    d.situacao === 'reprovada' ? `Reprovado${d.decidida_em ? ` em ${data(d.decidida_em)}` : ''}` :
    NOMES_SITUACAO_HOMOLOGACAO[d.situacao];

  const cartoes: { chave: FiltroDoc; rotulo: string; valor: number; classe: string; link: string }[] = [
    { chave: 'em_dia', rotulo: 'Documentos em dia', valor: contagem.em_dia, classe: '', link: 'Ver em dia' },
    { chave: 'vencendo', rotulo: `Vencendo em ${VENCENDO_DIAS} dias`, valor: contagem.vencendo, classe: contagem.vencendo ? ' cartao-alerta' : ' cartao-neutro', link: 'Ver quais' },
    { chave: 'em_analise', rotulo: 'Em análise', valor: contagem.em_analise, classe: ' cartao-neutro', link: 'Ver em análise' },
    { chave: 'pendente', rotulo: 'Vencidos ou faltando', valor: contagem.pendente, classe: contagem.pendente ? ' cartao-erro' : ' cartao-neutro', link: 'Ver pendentes' },
  ];

  return (
    <div className="ficha-coluna">
      <section className="ficha-cartao">
        <div className="ficha-homologacao">
          <div>
            <span className="ficha-rotulo">Homologação</span>
            <strong className="ficha-destaque">{titulo}</strong>
          </div>
          <div className="ficha-proximo">
            <span className="ficha-proximo-rotulo">Próximo passo</span>
            <span>{passo.texto}</span>
            {passo.botao && (
              <button type="button" className="botao botao-pequeno" disabled={ocupado} onClick={passo.botao.fazer}>{passo.botao.rotulo}</button>
            )}
          </div>
        </div>
        {d.situacao !== 'anterior' && (
          <ol className="ficha-etapas" aria-label="Etapas da homologação">
            {etapasDaHomologacao(d, eventos).map((e) => (
              <li key={e.nome} className={`etapa-${e.estado}`}>
                <strong>{e.nome}</strong>
                <span>{e.info}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="cartoes ficha-contadores">
        {cartoes.map((c) => (
          <button key={c.chave} type="button" className={`cartao cartao-link${c.classe}`} onClick={() => irPara('documentos', { filtro: c.chave })}>
            <span className="cartao-rotulo">{c.rotulo}</span>
            <span className="cartao-valor">{c.valor}</span>
            <span className="cartao-apoio">{c.link} ›</span>
          </button>
        ))}
      </div>

      <div className="ficha-duas">
        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">Na obra</h2>
          {d.obras_ativas.length === 0 ? (
            <p className="dica">{d.obras_previstas.length ? `Ainda sem obra ativa. Previstas: ${d.obras_previstas.map((o) => o.nome).join(', ')}.` : 'Sem obra ativa.'}</p>
          ) : (
            <ul className="ficha-lista">
              {d.obras_ativas.map((o) => (
                <li key={o.id}>
                  <Link className="link" to={`/painel-obra?obra=${o.id}`}>{o.nome}</Link>
                  <small className="sub">{o.numero_contrato ? `Contrato ${o.numero_contrato}` : 'Sem contrato registrado'}</small>
                </li>
              ))}
            </ul>
          )}
          {cad && cad.exige_colaboradores !== false && (
            <p className="ficha-linha">
              {cad.colaboradores.em_obra} colaborador(es) em obra · {cad.colaboradores.liberados} liberado(s)
              {cad.colaboradores.com_vencido > 0 && <span className="texto-erro"> · {cad.colaboradores.com_vencido} com documento vencido</span>}
              {cad.colaboradores.com_vencendo > 0 && <span className="texto-alerta"> · {cad.colaboradores.com_vencendo} vencendo</span>}
            </p>
          )}
          <button type="button" className="botao-link link-acao" onClick={() => irPara('obras')}>Ver obras e contratos ›</button>
        </section>

        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">Receita Federal</h2>
          {cad?.receita ? (
            <p className="ficha-linha">
              <strong className={receitaAtiva(cad.receita.situacao) ? undefined : 'texto-erro'}>{cad.receita.situacao ?? 'Situação não informada'}</strong>
              {cad.receita.situacao_desde ? ` desde ${cad.receita.situacao_desde}` : ''} · consulta de {data(cad.receita.consultada_em)}
              {(cad.receita.cnae || cad.receita.abertura) && (
                <small className="sub">{[cad.receita.cnae, cad.receita.abertura ? `aberta em ${cad.receita.abertura}` : ''].filter(Boolean).join(' · ')}</small>
              )}
              {cad.receita.aviso && !receitaAtiva(cad.receita.situacao) && <small className="sub texto-erro">{cad.receita.aviso}</small>}
            </p>
          ) : (
            <p className="dica">Ainda não consultado.</p>
          )}
          <h2 className="ficha-cartao-titulo">Acesso ao portal</h2>
          {acesso ? (
            <p className="ficha-linha">
              {acesso.email}
              <small className="sub">
                {!acesso.ativo ? 'Acesso desativado' : acesso.ultimo_login ? `Último acesso em ${data(acesso.ultimo_login)}` : 'Ainda não entrou no portal'}
                {acesso.empresas.length > 1 ? ` · cuida de mais ${acesso.empresas.length - 1} empresa${acesso.empresas.length > 2 ? 's' : ''}` : ''}
              </small>
            </p>
          ) : (
            <p className="texto-alerta">Sem acesso ao portal.</p>
          )}
          <button type="button" className="botao-link link-acao" onClick={() => irPara('acesso')}>Ver acesso ›</button>
        </section>
      </div>

      <section className="ficha-cartao">
        <h2 className="ficha-cartao-titulo">Últimos acontecimentos</h2>
        {historico.length === 0 ? (
          <p className="dica">Nada registrado ainda.</p>
        ) : (
          <ol className="ficha-linha-tempo">
            {historico.slice(0, 4).map((h, i) => (
              <li key={i}>
                <span className="ficha-linha-tempo-data">{data(h.em)}</span>
                <span>{h.texto}{h.quem ? `, por ${h.quem}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
        {historico.length > 4 && <button type="button" className="botao-link link-acao" onClick={() => irPara('historico')}>Ver histórico completo ›</button>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Documentos

function AbaDocumentos({
  d, cad, linhasHom, linhasPortal, filtro, aoFiltrar, ehAdmin, ocupado, aoAprovar, aoDevolver, aoErro,
}: {
  d: DetalheHomologacao;
  cad: FornecedorCadastro | null;
  linhasHom: LinhaHom[];
  linhasPortal: LinhaPortal[];
  filtro: FiltroDoc;
  aoFiltrar: (f: FiltroDoc) => void;
  ehAdmin: boolean;
  ocupado: boolean;
  aoAprovar: (doc: DocumentoHomologacao, nome: string) => void;
  aoDevolver: (doc: DocumentoHomologacao) => void;
  aoErro: (m: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const termo = busca.trim().toLowerCase();
  const passa = (sit: SitDoc, nome: string) =>
    (filtro === 'todos' || sit === filtro) && (!termo || nome.toLowerCase().includes(termo));
  const hom = linhasHom.filter((l) => passa(l.sit, l.tipo.nome)).sort((a, b) => ORDEM_SIT[a.sit] - ORDEM_SIT[b.sit] || a.tipo.ordem - b.tipo.ordem);
  const portal = linhasPortal.filter((l) => passa(l.sit, l.nome)).sort((a, b) => ORDEM_SIT[a.sit] - ORDEM_SIT[b.sit] || a.nome.localeCompare(b.nome, 'pt-BR'));
  const conta = (l: { sit: SitDoc }[], s: SitDoc) => l.filter((x) => x.sit === s).length;

  return (
    <div className="ficha-coluna">
      <div className="filtros">
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" value={busca} placeholder="Nome do documento" onChange={(e) => setBusca(e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="Filtrar documentos">
          {FILTROS_DOC.map(([f, nome]) => (
            <button key={f} type="button" className="chip" aria-pressed={filtro === f} onClick={() => aoFiltrar(f)}>{nome}</button>
          ))}
        </div>
      </div>

      {d.situacao !== 'anterior' && (
        <section className="ficha-cartao ficha-cartao-tabela">
          <div className="barra-lista">
            <h2 className="ficha-cartao-titulo">Da homologação (F.31)</h2>
            <span className="sub">
              {conta(linhasHom, 'em_dia') + conta(linhasHom, 'vencendo')} aprovado(s) · {conta(linhasHom, 'em_analise')} para conferir · {conta(linhasHom, 'pendente')} pendente(s)
            </span>
          </div>
          {hom.length === 0 ? (
            <p className="vazio">Nenhum documento neste filtro.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Documento</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Emissão</th>
                    <th scope="col">Vence</th>
                    <th scope="col"><span className="sr">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {hom.map(({ tipo: t, doc, selo, rotulo }) => {
                    const anterior = doc?.status === 'em_analise' ? d.documentos.find((x) => x.tipo === t.codigo && x.status === 'aprovado') : null;
                    return (
                      <tr key={t.codigo}>
                        <th scope="row">
                          {t.nome}
                          <small className="sub">
                            {t.obrigatorio ? 'Obrigatório' : 'Se houver'}
                            {t.validade_dias ? `, vale ${t.validade_dias} dias` : ''}
                            {t.tipo_portal ? ', vale também nos documentos da empresa' : ''}
                          </small>
                          {doc?.status === 'devolvido' && doc.motivo && <small className="sub texto-erro">Devolvido: {doc.motivo}</small>}
                          {doc?.status === 'aprovado' && doc.analisado_por && <small className="sub">Aprovado por {doc.analisado_por}{doc.analisado_em ? ` em ${data(doc.analisado_em)}` : ''}</small>}
                          {anterior && <small className="sub">Renovação: o aprovado anterior vence em {anterior.vencimento ? data(anterior.vencimento) : '-'}</small>}
                        </th>
                        <td className="num" data-rotulo="Situação"><span className={`selo ${selo}`}>{rotulo}</span></td>
                        <td className="num" data-rotulo="Emissão">{doc?.data_emissao ? data(doc.data_emissao) : '-'}</td>
                        <td className="num" data-rotulo="Vence">{doc?.vencimento ? data(doc.vencimento) : doc ? 'Não vence' : '-'}</td>
                        <td className="acoes">
                          {doc?.arquivos?.map((a, i) => (
                            <button key={a.caminho + i} type="button" className="botao botao-secundario botao-pequeno" onClick={() => abrirArquivoHomologacao(a.caminho).catch((e) => aoErro(mensagemDeErro(e)))}>
                              {doc.arquivos.length > 1 ? `Arquivo ${i + 1}` : 'Ver arquivo'}
                            </button>
                          ))}
                          {doc?.status === 'em_analise' && (
                            <>
                              <button type="button" className="botao botao-pequeno" disabled={ocupado} onClick={() => aoAprovar(doc, t.nome)}>Aprovar</button>
                              <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado} onClick={() => aoDevolver(doc)}>Devolver</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="ficha-cartao ficha-cartao-tabela">
        <div className="barra-lista">
          <h2 className="ficha-cartao-titulo">Da empresa no portal</h2>
          <span className="sub">Valem para todos os colaboradores da empresa</span>
        </div>
        {linhasPortal.length === 0 ? (
          <p className="dica">
            {cad?.exige_colaboradores === false
              ? 'Este tipo de fornecedor não tem colaborador em obra, então o portal não cobra documentos da empresa.'
              : 'Sem colaborador em obra no momento, então o portal ainda não cobra documentos da empresa.'}
          </p>
        ) : portal.length === 0 ? (
          <p className="vazio">Nenhum documento neste filtro.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Documento</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Vence</th>
                </tr>
              </thead>
              <tbody>
                {portal.map((x) => (
                  <tr key={x.nome}>
                    <th scope="row">{x.nome}<small className="sub">{x.impeditivo ? 'Trava a liberação' : 'Não trava a liberação'}</small></th>
                    <td className="num" data-rotulo="Situação"><span className={`selo ${CLASSE_PORTAL[x.situacao]}`}>{ROTULO_PORTAL[x.situacao]}</span></td>
                    <td className="num" data-rotulo="Vence">{x.vencimento ? data(x.vencimento) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cad && cad.certidoes.length > 0 && (
          <p className="dica">
            Certidões da homologação: {cad.certidoes.map((c) => `${c.nome} (${diasAte(c.vencimento) < 0 ? 'venceu' : 'vence'} em ${data(c.vencimento)})`).join('; ')}
          </p>
        )}
        <p className="dica">
          {ehAdmin ? (
            <>A análise destes documentos fica em <Link to="/analise">Análise de documentos</Link>.</>
          ) : (
            'A cobrança e a análise destes documentos são feitas pelo administrativo. Aqui é para acompanhar.'
          )}
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Homologação

function AbaHomologacao({
  d, cad, campos, linhasHom, qualificacao, setQualificacao, comentarios, setComentarios, responsavel, setResponsavel, versaoConvite, ocupado, irPara,
  aoReenviar, aoHomologar, aoDialogo,
}: {
  d: DetalheHomologacao;
  cad: FornecedorCadastro | null;
  campos: CampoHomologacao[];
  linhasHom: LinhaHom[];
  qualificacao: Record<string, RespostaQualificacao>;
  setQualificacao: (f: (q: Record<string, RespostaQualificacao>) => Record<string, RespostaQualificacao>) => void;
  comentarios: string;
  setComentarios: (v: string) => void;
  responsavel: string;
  setResponsavel: (v: string) => void;
  versaoConvite: number;
  ocupado: boolean;
  irPara: (a: AbaFicha, extra?: Record<string, string>) => void;
  aoReenviar: () => void;
  aoHomologar: () => void;
  aoDialogo: (x: 'devolver' | 'reprovar') => void;
}) {
  const dados = d.dados ?? {};
  const analisando = d.situacao === 'enviada';
  const emAnalise = linhasHom.filter((l) => l.sit === 'em_analise').length;
  const faltando = linhasHom.filter((l) => l.tipo.ativo && l.tipo.obrigatorio && l.doc?.status !== 'aprovado' && l.sit !== 'em_analise').map((l) => l.tipo.nome);
  const respondidas = ITENS_QUALIFICACAO.filter((i) => qualificacao[i.chave]).length;
  const qualificacaoCompleta = respondidas === ITENS_QUALIFICACAO.length;
  const responsavelOk = responsavel.trim().length >= 3;
  const bloqueado = cad?.situacao === 'bloqueado';
  const podeHomologar = analisando && !bloqueado && faltando.length === 0 && emAnalise === 0 && qualificacaoCompleta && responsavelOk;
  const receitaRuim = cad?.receita?.situacao && !receitaAtiva(cad.receita.situacao);
  const extras = campos.filter((c) => c.personalizado && (respostaAdicional(dados, c) || c.ativo));
  const referencias = (dados.referencias ?? []).filter((r) => r.empresa);

  const checklist: { ok: boolean; texto: ReactNode }[] = [
    {
      ok: emAnalise === 0,
      texto: emAnalise ? (
        <>{emAnalise} documento(s) para conferir. <button type="button" className="botao-link link-acao" onClick={() => irPara('documentos', { filtro: 'em_analise' })}>Conferir</button></>
      ) : 'Nenhum documento esperando conferência',
    },
    {
      ok: faltando.length === 0,
      texto: faltando.length ? (
        <>{faltando.length > 3 ? `Faltam ${faltando.length} obrigatórios sem envio, devolvidos ou vencidos.` : `Faltam aprovados: ${faltando.join(', ')}.`} <button type="button" className="botao-link link-acao" onClick={() => irPara('documentos', { filtro: 'pendente' })}>Ver</button></>
      ) : 'Todos os obrigatórios aprovados',
    },
    { ok: qualificacaoCompleta, texto: `Qualificação respondida (${respondidas} de ${ITENS_QUALIFICACAO.length})` },
    { ok: responsavelOk, texto: 'Responsável pela aprovação informado' },
    ...(bloqueado ? [{ ok: false, texto: 'Fornecedor bloqueado: desbloqueie antes de homologar' as ReactNode }] : []),
  ];

  return (
    <div className="ficha-coluna">
      {analisando && (
        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">O que falta para homologar</h2>
          <ul className="ficha-checklist">
            {checklist.map((c, i) => (
              <li key={i} className={c.ok ? 'feito' : 'falta'}>
                <span aria-hidden="true">{c.ok ? '✓' : '!'}</span>
                <span><span className="sr">{c.ok ? 'Feito: ' : 'Falta: '}</span>{c.texto}</span>
              </li>
            ))}
          </ul>
          {receitaRuim && <p className="aviso aviso-alerta">Receita: {cad?.receita?.aviso ?? cad?.receita?.situacao}. Não trava a homologação, mas confira antes de decidir.</p>}
        </section>
      )}

      <section className="ficha-cartao">
        <div className="barra-lista">
          <h2 className="ficha-cartao-titulo">Situação</h2>
          <span className={`selo ${SELO_HOMOLOGACAO[d.situacao]}`}>{NOMES_SITUACAO_HOMOLOGACAO[d.situacao]}</span>
        </div>
        <ul className="lista-simples">
          {d.convidada_em && <li>Convite enviado em {data(d.convidada_em)}</li>}
          {d.enviada_em && <li>Enviada pelo fornecedor em {data(d.enviada_em)}</li>}
          {d.decidida_em && <li>Parecer em {data(d.decidida_em)}{d.decidida_por ? ` por ${d.decidida_por}` : ''}{d.responsavel ? `, aprovação de ${d.responsavel}` : ''}</li>}
          {d.motivo && <li>{d.situacao === 'reprovada' ? 'Motivo da reprovação' : 'Observação enviada'}: {d.motivo}</li>}
          {d.obras_previstas.length > 0 && <li>Obras previstas: {d.obras_previstas.map((o) => o.nome).join(', ')}</li>}
        </ul>
        {(d.situacao === 'convidada' || d.situacao === 'devolvida') && (
          <>
            <div className="linha-botoes">
              <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado} onClick={aoReenviar}>Reenviar convite</button>
              <button type="button" className="botao botao-discreto botao-pequeno" disabled={ocupado} onClick={() => aoDialogo('reprovar')}>Reprovar</button>
            </div>
            <ConviteOutlook empresaId={d.empresa_id} versao={versaoConvite} />
          </>
        )}
      </section>

      {(analisando || d.situacao === 'homologada' || d.situacao === 'reprovada') && (
        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">Qualificação e parecer</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Sim</th>
                  <th scope="col">Não</th>
                  <th scope="col">NA</th>
                </tr>
              </thead>
              <tbody>
                {ITENS_QUALIFICACAO.map((i) => (
                  <tr key={i.chave}>
                    <th scope="row">{i.texto}<small className="sub">{i.grupo}</small></th>
                    {(['sim', 'nao', 'na'] as RespostaQualificacao[]).map((r) => (
                      <td key={r}>
                        <input
                          type="radio"
                          name={`q-${i.chave}`}
                          aria-label={`${i.texto}: ${r}`}
                          checked={qualificacao[i.chave] === r}
                          disabled={!analisando}
                          onChange={() => setQualificacao((q) => ({ ...q, [i.chave]: r }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grade-2">
            <label className="campo">
              <span>Comentários</span>
              <textarea rows={3} value={comentarios} maxLength={2000} readOnly={!analisando} onChange={(e) => setComentarios(e.target.value)} />
            </label>
            <label className="campo">
              <span>Responsável pela aprovação</span>
              <input value={responsavel} maxLength={200} readOnly={!analisando} onChange={(e) => setResponsavel(e.target.value)} />
            </label>
          </div>
          {analisando && (
            <div className="linha-botoes">
              <button type="button" className="botao" disabled={!podeHomologar || ocupado} onClick={aoHomologar}>Homologar</button>
              <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => aoDialogo('devolver')}>Devolver para correção</button>
              <button type="button" className="botao botao-discreto" disabled={ocupado} onClick={() => aoDialogo('reprovar')}>Reprovar</button>
            </div>
          )}
        </section>
      )}

      {(extras.length > 0 || referencias.length > 0 || d.situacao !== 'convidada') && (
        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">Respostas do F.31</h2>
          {extras.length > 0 && (
            <dl className="ficha-pares ficha-pares-2">
              {extras.map((c) => (
                <div key={c.campo}><dt>{c.rotulo}</dt><dd>{respostaAdicional(dados, c) || '-'}</dd></div>
              ))}
            </dl>
          )}
          <h3 className="detalhe-subtitulo">Referências comerciais</h3>
          {referencias.length === 0 ? (
            <p className="dica">Nenhuma referência informada.</p>
          ) : (
            <ul className="lista-simples">
              {referencias.map((r, i) => (
                <li key={i}>
                  <span>
                    <strong>{r.empresa}</strong>
                    {[r.contato, r.telefone, r.email, [r.cidade, r.estado].filter(Boolean).join('/')].filter(Boolean).map((x) => ` · ${x}`).join('')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="dica">Os dados da empresa (endereço, contato, banco) ficam na aba Cadastro.</p>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Cadastro (edição por bloco)

type CampoBloco = { chave: string; rotulo: string; max?: number; tipo?: string; dica?: string; largo?: boolean };
type Bloco = { id: string; titulo: string; campos: CampoBloco[] };

const daGrupo = (titulo: string): CampoBloco[] =>
  (GRUPOS_CADASTRO.find((g) => g.titulo === titulo)?.campos ?? []).map(([c, rotulo, extra]) => ({ chave: c as string, rotulo, max: extra?.max, tipo: extra?.tipo, dica: extra?.dica }));

const BLOCOS: Bloco[] = [
  { id: 'empresa', titulo: 'Dados da empresa', campos: [{ chave: 'razao_social', rotulo: 'Razão social', max: 200, largo: true }, { chave: 'cnpj', rotulo: 'CNPJ', max: 18 }, ...daGrupo('Dados da empresa')] },
  { id: 'endereco', titulo: 'Endereço', campos: daGrupo('Endereço') },
  {
    id: 'contato',
    titulo: 'Contato e avisos',
    campos: [
      ...daGrupo('Contato'),
      { chave: 'emails_contato', rotulo: 'Outros e-mails para avisos', max: 600, largo: true, dica: 'Recebem os avisos junto com o e-mail de acesso. Separe por ponto e vírgula, até 10.' },
    ],
  },
  { id: 'banco', titulo: 'Dados bancários', campos: daGrupo('Dados bancários') },
];
const ESPECIAIS = ['razao_social', 'cnpj', 'emails_contato'];
const blocoDoCampo = (c: string) => BLOCOS.find((b) => b.campos.some((x) => x.chave === c))?.id ?? null;

function valorSalvo(cad: FornecedorCadastro, chave: string): string {
  if (chave === 'razao_social') return cad.razao_social;
  if (chave === 'cnpj') return formatarCnpj(cad.cnpj);
  if (chave === 'emails_contato') return cad.emails_contato ?? '';
  return String((cad.dados as Record<string, unknown>)[chave] ?? '');
}

function AbaCadastro({ cad, tiposF, categoriasL, foco, aoSalvar }: {
  cad: FornecedorCadastro; tiposF: TipoFornecedor[]; categoriasL: CategoriaServico[]; foco: string | null; aoSalvar: (msg: string) => Promise<void>;
}) {
  const [edicoes, setEdicoes] = useState<Record<string, Record<string, string>>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [editandoTipos, setEditandoTipos] = useState(false);
  const [tipos, setTipos] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);

  useEffect(() => {
    if (!foco) return;
    const t = window.setTimeout(() => document.getElementById(`ficha-${foco}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => window.clearTimeout(t);
  }, [foco]);

  const abrir = (b: Bloco, valores: Record<string, string> = {}) =>
    setEdicoes((e) => ({ ...e, [b.id]: { ...(e[b.id] ?? Object.fromEntries(b.campos.map((c) => [c.chave, valorSalvo(cad, c.chave)]))), ...valores } }));
  const fechar = (id: string) => {
    setEdicoes((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    setErros((e) => ({ ...e, [id]: '' }));
  };

  async function salvar(b: Bloco) {
    const v = edicoes[b.id];
    if (!v) return;
    const razao = (v.razao_social ?? cad.razao_social).trim();
    const cnpj = soDigitos(v.cnpj ?? cad.cnpj);
    if (razao.length < 3) return setErros((e) => ({ ...e, [b.id]: 'Informe a razão social.' }));
    if (cnpj !== cad.cnpj && !cnpjValido(cnpj)) return setErros((e) => ({ ...e, [b.id]: 'CNPJ inválido. Confira os números.' }));
    const dados: Partial<DadosF31> = {};
    for (const c of b.campos) if (!ESPECIAIS.includes(c.chave)) (dados as Record<string, string>)[c.chave] = (v[c.chave] ?? '').trim();
    setSalvando(b.id);
    setErros((e) => ({ ...e, [b.id]: '' }));
    try {
      await salvarCadastroFornecedor(cad.empresa_id, razao, cnpj, b.id === 'contato' ? v.emails_contato ?? '' : null, dados);
      fechar(b.id);
      await aoSalvar(`${b.titulo}: salvo.`);
    } catch (e) {
      setErros((x) => ({ ...x, [b.id]: mensagemDeErro(e as Error) }));
    } finally {
      setSalvando(null);
    }
  }

  // Receita: "Usar" abre o bloco do campo já com o valor da Receita, para conferir e salvar.
  const usarDaReceita = (campo: keyof CamposReceita, valor: string) => {
    const id = blocoDoCampo(campo as string);
    const b = BLOCOS.find((x) => x.id === id);
    if (b) abrir(b, { [campo]: valor });
  };
  const dadosAtuais: Partial<DadosF31> = { ...cad.dados, ...Object.assign({}, ...Object.values(edicoes)) };
  const razaoAtual = edicoes.empresa?.razao_social ?? cad.razao_social;

  const tiposAntes = cad.tipos?.length ? cad.tipos : ['mao_de_obra'];
  async function salvarTipos() {
    setSalvando('tipos');
    setErros((e) => ({ ...e, tipos: '' }));
    try {
      const mudouTipo = tipos.length !== tiposAntes.length || tipos.some((t) => !tiposAntes.includes(t));
      const catAntes = cad.categorias ?? [];
      const mudouCat = categorias.length !== catAntes.length || categorias.some((c) => !catAntes.includes(c));
      if (mudouTipo) await definirTiposFornecedor(cad.empresa_id, tipos);
      if (mudouCat) await definirCategoriasFornecedor(cad.empresa_id, categorias);
      setEditandoTipos(false);
      await aoSalvar('Tipo e categorias: salvo.');
    } catch (e) {
      setErros((x) => ({ ...x, tipos: mensagemDeErro(e as Error) }));
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="ficha-cadastro">
      <div className="ficha-coluna">
        {BLOCOS.map((b) => {
          const v = edicoes[b.id];
          return (
            <section key={b.id} className={`ficha-cartao${v ? ' ficha-cartao-editando' : ''}`}>
              <div className="barra-lista">
                <h2 className="ficha-cartao-titulo">{b.titulo}</h2>
                {v ? <span className="sub">Editando</span> : <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => abrir(b)}>Editar</button>}
              </div>
              {v ? (
                <form
                  className="formulario formulario-largo"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    salvar(b);
                  }}
                >
                  <div className="grade-3">
                    {b.campos.map((c) => (
                      <label key={c.chave} className={`campo${c.largo ? ' campo-largo' : ''}`}>
                        <span>{c.rotulo}</span>
                        <input
                          type={c.tipo ?? 'text'}
                          value={v[c.chave] ?? ''}
                          maxLength={c.max ?? 200}
                          inputMode={c.chave === 'cnpj' ? 'numeric' : undefined}
                          onChange={(e) => setEdicoes((x) => ({ ...x, [b.id]: { ...x[b.id], [c.chave]: e.target.value } }))}
                        />
                        {c.dica && <small className="dica">{c.dica}</small>}
                        {valorSalvo(cad, c.chave) !== (v[c.chave] ?? '') && <small className="sub texto-alerta">Antes: {valorSalvo(cad, c.chave) || 'vazio'}</small>}
                      </label>
                    ))}
                  </div>
                  {erros[b.id] && <p className="aviso aviso-erro" role="alert">{erros[b.id]}</p>}
                  <div className="linha-botoes">
                    <button type="submit" className="botao botao-pequeno" disabled={salvando === b.id}>{salvando === b.id ? 'Salvando' : `Salvar ${b.titulo.toLowerCase()}`}</button>
                    <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => fechar(b.id)}>Cancelar</button>
                  </div>
                </form>
              ) : (
                <dl className="ficha-pares">
                  {b.campos.map((c) => (
                    <div key={c.chave} className={c.largo ? 'ficha-par-largo' : undefined}>
                      <dt>{c.rotulo}</dt>
                      <dd>{valorSalvo(cad, c.chave) || '-'}</dd>
                    </div>
                  ))}
                  {b.id === 'contato' && (
                    <div className="ficha-par-largo">
                      <dt>E-mail de acesso ao portal</dt>
                      <dd>{cad.email_acesso || '-'} <small className="sub">Muda na aba Acesso</small></dd>
                    </div>
                  )}
                </dl>
              )}
            </section>
          );
        })}
      </div>

      <div className="ficha-coluna">
        <section className={`ficha-cartao${editandoTipos ? ' ficha-cartao-editando' : ''}`}>
          <div className="barra-lista">
            <h2 className="ficha-cartao-titulo">Tipo e categorias</h2>
            {!editandoTipos && (
              <button
                type="button"
                className="botao botao-secundario botao-pequeno"
                onClick={() => {
                  setTipos(tiposAntes);
                  setCategorias(cad.categorias ?? []);
                  setEditandoTipos(true);
                }}
              >
                Editar
              </button>
            )}
          </div>
          {editandoTipos ? (
            <div className="formulario formulario-largo">
              <EscolherTipos tipos={tiposF} marcados={tipos} aoMudar={setTipos} />
              <fieldset className="campo-grupo">
                <legend>Categorias de serviço</legend>
                {cad.dados.ramo && <p className="dica">Ramo informado pelo fornecedor: {cad.dados.ramo}</p>}
                <div className="opcoes opcoes-empilhadas lista-rolagem">
                  {categoriasL.filter((c) => c.ativo || categorias.includes(c.codigo)).map((c) => (
                    <label key={c.codigo} className="opcao">
                      <input type="checkbox" checked={categorias.includes(c.codigo)} onChange={(e) => setCategorias((l) => (e.target.checked ? [...l, c.codigo] : l.filter((x) => x !== c.codigo)))} />
                      <span>{c.nome}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {(tipos.length !== tiposAntes.length || tipos.some((t) => !tiposAntes.includes(t))) && (
                <p className="aviso aviso-info">Ao salvar, o fornecedor passa a ver os documentos da homologação do(s) tipo(s) marcado(s), e a cobrança do mensal trabalhista segue o tipo novo.</p>
              )}
              {erros.tipos && <p className="aviso aviso-erro" role="alert">{erros.tipos}</p>}
              <div className="linha-botoes">
                <button type="button" className="botao botao-pequeno" disabled={!tipos.length || salvando === 'tipos'} onClick={salvarTipos}>{salvando === 'tipos' ? 'Salvando' : 'Salvar'}</button>
                <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setEditandoTipos(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <>
              <dl className="ficha-pares ficha-pares-1">
                {tiposAntes.map((c) => {
                  const t = tiposF.find((x) => x.codigo === c);
                  return (
                    <div key={c}>
                      <dt>Tipo de fornecedor</dt>
                      <dd>{t?.nome ?? c}{t && <small className="sub">{oQueOTipoPede(t)}</small>}</dd>
                    </div>
                  );
                })}
              </dl>
              {(cad.categorias ?? []).length ? (
                <p className="selos-linha">
                  {(cad.categorias ?? []).map((c) => <span key={c} className="selo selo-encerrado">{categoriasL.find((x) => x.codigo === c)?.nome ?? c}</span>)}
                </p>
              ) : (
                <p className="texto-alerta">Sem categoria de serviço.</p>
              )}
            </>
          )}
        </section>

        <section className="ficha-cartao" id="ficha-situacao">
          <SituacaoDoFornecedor fornecedor={cad} aoMudar={(msg) => aoSalvar(msg)} />
        </section>

        <section className="ficha-cartao" id="ficha-receita">
          <ReceitaNoCadastro
            fornecedor={cad}
            razao={razaoAtual}
            dados={dadosAtuais}
            aoUsar={usarDaReceita}
            avisoUsar="Usar abre o bloco do cadastro com o valor da Receita. Só grava quando salvar o bloco."
          />
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Obras e contratos

function AbaObras({
  d, cad, pedidos, podeContrato, aoRegistrar, aoEditar, aoEncerrar, aoRecusar, aoErro,
}: {
  d: DetalheHomologacao;
  cad: FornecedorCadastro | null;
  pedidos: PedidoObra[];
  podeContrato: boolean;
  aoRegistrar: (p?: PedidoObra) => void;
  aoEditar: (c: DetalheHomologacao['contratos'][number]) => void;
  aoEncerrar: (id: string) => void;
  aoRecusar: (p: PedidoObra) => void;
  aoErro: (m: string) => void;
}) {
  const pendentes = pedidos.filter((p) => p.situacao === 'pendente');
  const respondidos = pedidos.filter((p) => p.situacao !== 'pendente').slice(0, 10);
  const ativos = d.contratos.filter((c) => c.situacao === 'ativo');
  return (
    <div className="ficha-coluna">
      {pendentes.map((p) => (
        <div key={p.id} className="ficha-pedido">
          <span>
            <strong>Pedido de obra:</strong> o fornecedor pediu para atuar em {p.obras?.nome} ({data(p.pedido_em)})
            {p.numero_contrato ? `, contrato informado ${p.numero_contrato}` : ''}
            {p.observacao && <small className="sub">{p.observacao}</small>}
          </span>
          <span className="linha-botoes">
            {podeContrato && <button type="button" className="botao botao-pequeno" onClick={() => aoRegistrar(p)}>Registrar contrato</button>}
            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoRecusar(p)}>Recusar</button>
          </span>
        </div>
      ))}

      <section className="ficha-cartao ficha-cartao-tabela">
        <div className="barra-lista">
          <h2 className="ficha-cartao-titulo">Contratos</h2>
          {podeContrato && <button type="button" className="botao botao-pequeno" onClick={() => aoRegistrar()}>Registrar contrato</button>}
        </div>
        {!podeContrato && d.situacao !== 'homologada' && d.situacao !== 'anterior' && <p className="dica">O contrato é registrado depois da homologação.</p>}
        {d.contratos.length === 0 ? (
          <p className="vazio">Nenhum contrato registrado.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Contrato</th>
                  <th scope="col">Obras</th>
                  <th scope="col">Vigência</th>
                  <th scope="col"><span className="sr">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {d.contratos.map((c) => {
                  const dias = diasAte(c.termino);
                  return (
                    <tr key={c.id} className={c.situacao === 'encerrado' ? 'linha-inativa' : undefined}>
                      <th scope="row">
                        {c.numero}
                        <small className="sub">BP {c.codigo_bp}</small>
                      </th>
                      <td className="quebra">{c.obras.map((o) => o.nome).join(', ')}</td>
                      <td>
                        {data(c.inicio)} a {data(c.termino)}
                        {c.situacao === 'encerrado' ? (
                          <small className="sub">Encerrado</small>
                        ) : dias < 0 ? (
                          <small className="sub texto-erro">Vencido</small>
                        ) : dias <= 30 ? (
                          <small className="sub texto-alerta">Vence em {dias} dia(s)</small>
                        ) : null}
                      </td>
                      <td className="acoes">
                        <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => abrirArquivoHomologacao(c.arquivo).catch((e) => aoErro(mensagemDeErro(e)))}>Ver arquivo</button>
                        {c.situacao === 'ativo' && (
                          <>
                            <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => aoEditar(c)}>Editar</button>
                            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoEncerrar(c.id)}>Encerrar</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="dica">Para a obra entrar num contrato que já existe, use Editar nesse contrato.</p>
      </section>

      <section className="ficha-cartao ficha-cartao-tabela">
        <h2 className="ficha-cartao-titulo">Obras em que atua</h2>
        {d.obras_ativas.length === 0 ? (
          <p className="dica">{d.obras_previstas.length ? `Nenhuma ainda. Previstas na homologação: ${d.obras_previstas.map((o) => o.nome).join(', ')}.` : 'Nenhuma obra ativa.'}</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Obra</th>
                  <th scope="col">Contrato</th>
                  <th scope="col"><span className="sr">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {d.obras_ativas.map((o) => {
                  const c = ativos.find((x) => x.obras.some((y) => y.id === o.id));
                  return (
                    <tr key={o.id}>
                      <th scope="row">{o.nome}</th>
                      <td className="num" data-rotulo="Contrato">
                        {c ? `${c.numero}, até ${data(c.termino)}` : o.numero_contrato ? o.numero_contrato : <span className="texto-alerta">Sem contrato registrado</span>}
                      </td>
                      <td className="acoes"><Link className="botao botao-secundario botao-pequeno" to={`/painel-obra?obra=${o.id}`}>Painel da obra</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cad && cad.exige_colaboradores !== false && (
          <p className="dica">
            {cad.colaboradores.em_obra} colaborador(es) em obra, {cad.colaboradores.liberados} liberado(s). Os nomes e documentos de cada um ficam no painel da obra.
          </p>
        )}
      </section>

      {respondidos.length > 0 && (
        <section className="ficha-cartao">
          <h2 className="ficha-cartao-titulo">Pedidos respondidos</h2>
          <ul className="lista-simples">
            {respondidos.map((p) => (
              <li key={p.id}>
                <span>
                  {p.obras?.nome}
                  <small className="sub">
                    {p.situacao === 'aprovado' ? 'Aprovado' : 'Recusado'}
                    {p.analisado_em ? ` em ${data(p.analisado_em)}` : ''}
                    {p.motivo_recusa ? `: ${p.motivo_recusa}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
