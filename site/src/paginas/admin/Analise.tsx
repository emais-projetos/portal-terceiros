import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { data, diasAte, formatarCpf, tamanhoArquivo } from '../../lib/formato';
import {
  abrirArquivo, aprovarDocumento, baixarArquivo, baixarTodos, devolverDocumento, lerAlocacoes, lerFilaAnalise, nomeDoZip, nomePadronizado, vencimentoDoDocumento,
  type AlocacaoResumo, type DocumentoEmAnalise,
} from '../../lib/admin';
import { Detalhe } from './Colaboradores';

const MOTIVOS_COMUNS = [
  'Arquivo ilegível ou cortado',
  'Documento vencido',
  'Documento de outra pessoa ou empresa',
  'Falta assinatura',
  'Data de emissão não confere com o documento',
];

type Pessoa = { chave: string; nome: string | null; cpf: string | null; colaboradorId: string | null; docs: DocumentoEmAnalise[] };
type Arquivo = DocumentoEmAnalise['arquivos'][number];

function resumoDoGrupo(docs: DocumentoEmAnalise[]) {
  const dias = docs.map((d) => vencimentoDoDocumento(d)).filter((v): v is string => !!v).map(diasAte);
  const envios = [...new Set(docs.map((d) => data(d.enviado_em)))];
  return {
    envio: envios.length === 1 ? envios[0] : `${envios[0]} a ${envios[envios.length - 1]}`,
    vencidos: dias.filter((x) => x <= 0).length,
    vencendo: dias.filter((x) => x > 0 && x <= 30).length,
    semArquivo: docs.filter((d) => !d.dispensado && d.arquivos.filter((a) => !a.apagado_em).length === 0).length,
  };
}

function LinhaDocumento({ d, ocupado, aoAbrir, aoBaixar, aoAprovar, aoDevolver }: {
  d: DocumentoEmAnalise;
  ocupado: boolean;
  aoAbrir: (a: Arquivo) => void;
  aoBaixar: (a: Arquivo) => void;
  aoAprovar: () => void;
  aoDevolver: () => void;
}) {
  const venc = vencimentoDoDocumento(d);
  const dias = venc ? diasAte(venc) : null;
  const ativos = d.arquivos.filter((x) => !x.apagado_em);
  return (
    <tr>
      <th scope="row">
        {d.tipos_documento.nome}
        <small className="sub">
          {d.tipos_documento.area}
          {d.tipos_documento.impeditivo ? ', impeditivo' : ''}, enviado em {data(d.enviado_em)}
        </small>
      </th>
      <td>
        {d.dispensado ? (
          <>
            <span className="selo selo-doc-dispensado">Dispensa pedida</span>
            <small className="sub">Justificativa: {typeof d.dados?.motivo_dispensa === 'string' && d.dados.motivo_dispensa ? d.dados.motivo_dispensa : 'não informada'}</small>
          </>
        ) : (
          data(d.data_emissao) || <span className="sub">Não informada</span>
        )}
      </td>
      <td>
        {venc ? data(venc) : <span className="sub">Não vence</span>}
        {dias !== null && dias <= 30 && (
          <small className={dias <= 0 ? 'sub texto-erro' : 'sub texto-alerta'}>{dias <= 0 ? 'já vencido' : `em ${dias} dias`}</small>
        )}
      </td>
      <td>
        {d.arquivos.length === 0 && <span className="sub">Sem arquivo</span>}
        {d.arquivos.map((a) => (
          <div key={a.id} className="arquivo">
            {a.apagado_em ? (
              <span className="sub">{a.nome_original} (apagado)</span>
            ) : (
              <>
                <button type="button" className="link-botao" title={a.nome_original} onClick={() => aoAbrir(a)}>
                  {nomePadronizado(d, a, ativos.indexOf(a) + 1, ativos.length)}
                </button>
                <small className="sub">
                  {tamanhoArquivo(a.tamanho_bytes)}
                  {a.baixado_em ? `, baixado em ${data(a.baixado_em)}` : ''}
                </small>
                <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoBaixar(a)}>
                  Baixar
                </button>
              </>
            )}
          </div>
        ))}
      </td>
      <td className="acoes">
        <button type="button" className="botao botao-pequeno" disabled={ocupado} onClick={aoAprovar}>
          Aprovar
        </button>
        <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado} onClick={aoDevolver}>
          Devolver
        </button>
      </td>
    </tr>
  );
}

export function Analise() {
  const [fila, setFila] = useState<DocumentoEmAnalise[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<DocumentoEmAnalise | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  // Cadastro do colaborador aberto daqui (o mesmo da aba Colaboradores): editar, pedir outro documento, bloquear.
  const [cadastro, setCadastro] = useState<AlocacaoResumo | null>(null);

  async function abrirCadastro(colaboradorId: string) {
    setErro(null);
    try {
      const alocs = (await lerAlocacoes()).filter((a) => a.colaborador_id === colaboradorId);
      const ordem = ['em_analise', 'pendente_fornecedor', 'em_cadastro', 'aprovado_admin', 'liberado', 'encerrado'];
      const escolhida = alocs.sort((a, b) => ordem.indexOf(a.status) - ordem.indexOf(b.status))[0];
      if (!escolhida) {
        setErro('Este colaborador não está em nenhuma obra.');
        return;
      }
      setCadastro(escolhida);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  async function carregar() {
    try {
      setFila(await lerFilaAnalise());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  // Empresa > colaborador (os documentos da empresa ficam num grupo próprio). Dentro do grupo, a ordem da fila:
  // o documento enviado primeiro aparece primeiro.
  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const lista = (fila ?? []).filter(
      (d) => !t || d.empresas.razao_social.toLowerCase().includes(t) || (d.colaboradores?.nome ?? '').toLowerCase().includes(t),
    );
    const porEmpresa = new Map<string, Map<string, Pessoa>>();
    for (const d of lista) {
      const empresa = d.empresas.razao_social;
      const pessoas = porEmpresa.get(empresa) ?? new Map<string, Pessoa>();
      const chave = d.colaborador_id ? `${empresa}|${d.colaborador_id}` : `${empresa}|empresa`;
      const p = pessoas.get(chave) ?? { chave, nome: d.colaboradores?.nome ?? null, cpf: d.colaboradores?.cpf ?? null, colaboradorId: d.colaborador_id, docs: [] };
      p.docs.push(d);
      pessoas.set(chave, p);
      porEmpresa.set(empresa, pessoas);
    }
    return [...porEmpresa.entries()]
      .map(([empresa, pessoas]) => ({
        empresa,
        cnpj: [...pessoas.values()][0].docs[0].empresas.cnpj,
        // Documentos da empresa primeiro; depois os colaboradores em ordem alfabética, para a lista não mudar de lugar
        // enquanto os documentos são aprovados.
        pessoas: [...pessoas.values()].sort((a, b) => (a.nome === null ? -1 : b.nome === null ? 1 : a.nome.localeCompare(b.nome, 'pt-BR'))),
      }))
      .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
  }, [fila, busca]);

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const todasChaves = grupos.flatMap((g) => g.pessoas.map((p) => p.chave));
  // Com um grupo só na tela (ou a busca chegou a uma pessoa), já abre.
  const aberto = (chave: string) => todasChaves.length === 1 || abertos.has(chave);
  const alternar = (chave: string) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  async function executar(id: string, acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOcupado(id);
    try {
      await acao();
      setOk(sucesso);
      setFila((f) => (f ?? []).filter((d) => d.id !== id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  async function arquivo(acao: () => Promise<void>) {
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  const total = fila?.length ?? 0;
  const contarArquivos = (docs: DocumentoEmAnalise[]) => docs.reduce((n, d) => n + d.arquivos.filter((a) => !a.apagado_em).length, 0);
  const visiveis = grupos.flatMap((g) => g.pessoas.flatMap((p) => p.docs));
  const arquivosVisiveis = contarArquivos(visiveis);

  async function baixarLote(chave: string, docs: DocumentoEmAnalise[], rotulo: string) {
    setErro(null);
    setOk(null);
    setBaixando(chave);
    try {
      const qtd = await baixarTodos(docs, nomeDoZip(rotulo), (f, t) => setOk(`Baixando ${f} de ${t} arquivos`));
      setOk(`${qtd} ${qtd === 1 ? 'arquivo baixado' : 'arquivos baixados'} num ZIP, já com o nome padronizado. O prazo de 30 dias para apagar começa a contar agora.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setBaixando(null);
    }
  }

  return (
    <Pagina
      titulo="Análise de documentos"
      apoio={
        fila
          ? total === 0
            ? 'Nenhum documento esperando análise.'
            : `${total} ${total === 1 ? 'documento enviado espera' : 'documentos enviados esperam'} conferência, do mais antigo para o mais novo.`
          : undefined
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      {total > 0 && (
        <div className="filtros">
          <label className="campo campo-busca">
            <span>Buscar</span>
            <input type="search" placeholder="Empresa ou colaborador" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          {todasChaves.length > 1 && (
            <button
              type="button"
              className="botao botao-secundario botao-filtro"
              onClick={() => setAbertos(todasChaves.every((c) => abertos.has(c)) ? new Set() : new Set(todasChaves))}
            >
              {todasChaves.every((c) => abertos.has(c)) ? 'Fechar todos' : 'Abrir todos'}
            </button>
          )}
          {arquivosVisiveis > 0 && (
            <div className="filtros-acao">
              <button
                type="button"
                className="botao"
                disabled={!!baixando}
                onClick={() => baixarLote('todos', visiveis, busca.trim() ? busca.trim() : 'fila_de_analise')}
              >
                {baixando === 'todos' ? 'Preparando ZIP' : `Baixar todos (${arquivosVisiveis} ${arquivosVisiveis === 1 ? 'arquivo' : 'arquivos'})`}
              </button>
              <small className="dica">Nome dos arquivos: data de emissão_documento_colaborador</small>
            </div>
          )}
        </div>
      )}

      {!fila && !erro && <Carregando />}
      {fila && total === 0 && (
        <p className="vazio">
          Quando um fornecedor enviar documentos e mandar o colaborador para análise, eles aparecem aqui. Depois de baixar o arquivo
          para o SharePoint, ele fica guardado no portal por mais 30 dias e é apagado.
        </p>
      )}

      {grupos.map((g) => {
        const docsEmpresa = g.pessoas.flatMap((p) => p.docs);
        const colaboradores = g.pessoas.filter((p) => p.nome !== null).length;
        return (
          <section key={g.empresa} className="bloco">
            <div className="barra-lista">
              <h2 className="bloco-titulo">
                {g.empresa} <span className="sub">{formatarCnpj(g.cnpj)}</span>
              </h2>
              {grupos.length > 1 && contarArquivos(docsEmpresa) > 0 && (
                <button type="button" className="botao botao-secundario botao-pequeno" disabled={!!baixando} onClick={() => baixarLote(g.empresa, docsEmpresa, g.empresa)}>
                  {baixando === g.empresa ? 'Preparando ZIP' : `Baixar desta empresa (${contarArquivos(docsEmpresa)})`}
                </button>
              )}
            </div>
            <p className="dica">
              {colaboradores > 0 && `${colaboradores} ${colaboradores === 1 ? 'colaborador' : 'colaboradores'}, `}
              {docsEmpresa.length} {docsEmpresa.length === 1 ? 'documento' : 'documentos'} para conferir.
            </p>
            <ul className="grupos-analise">
              {g.pessoas.map((p) => {
                const estaAberto = aberto(p.chave);
                const resumo = resumoDoGrupo(p.docs);
                const arquivos = contarArquivos(p.docs);
                const idLista = `docs-${p.chave.replace(/[^a-z0-9]/gi, '')}`;
                return (
                  <li key={p.chave} className={`grupo-analise${estaAberto ? ' grupo-aberto' : ''}`}>
                    <div className="grupo-cabecalho">
                      <button type="button" className="grupo-abrir" aria-expanded={estaAberto} aria-controls={idLista} onClick={() => alternar(p.chave)}>
                        <svg className="grupo-seta" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="grupo-nome">
                          {p.nome ?? 'Documentos da empresa'}
                          {p.nome !== null && <small className="sub">{formatarCpf(p.cpf) || 'sem CPF'}</small>}
                        </span>
                      </button>
                      <span className="grupo-resumo">
                        <span>
                          {p.docs.length} {p.docs.length === 1 ? 'documento' : 'documentos'}, enviado{p.docs.length === 1 ? '' : 's'} em {resumo.envio}
                        </span>
                        {resumo.vencidos > 0 && <span className="selo selo-doc-vencido">{resumo.vencidos} já {resumo.vencidos === 1 ? 'vencido' : 'vencidos'}</span>}
                        {resumo.vencendo > 0 && <span className="selo selo-doc-a_vencer">{resumo.vencendo} vence{resumo.vencendo === 1 ? '' : 'm'} em 30 dias</span>}
                        {resumo.semArquivo > 0 && <span className="selo selo-doc-nao_enviado">{resumo.semArquivo} sem arquivo</span>}
                      </span>
                      {p.colaboradorId && (
                        <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => abrirCadastro(p.colaboradorId!)}>
                          Abrir cadastro
                        </button>
                      )}
                      {arquivos > 0 && (
                        <button
                          type="button"
                          className="botao botao-discreto botao-pequeno"
                          disabled={!!baixando}
                          onClick={() => baixarLote(p.chave, p.docs, p.nome ? `${p.nome} ${g.empresa}` : g.empresa)}
                        >
                          {baixando === p.chave ? 'Preparando ZIP' : `Baixar (${arquivos})`}
                        </button>
                      )}
                    </div>
                    {estaAberto && (
                      <div className="tabela-rolagem" id={idLista}>
                        <table className="tabela tabela-lista">
                          <thead>
                            <tr>
                              <th scope="col">Documento</th>
                              <th scope="col">Emissão</th>
                              <th scope="col">Vence em</th>
                              <th scope="col">Arquivo</th>
                              <th scope="col"><span className="sr">Ações</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.docs.map((d) => (
                              <LinhaDocumento
                                key={d.id}
                                d={d}
                                ocupado={ocupado === d.id}
                                aoAbrir={(a) => arquivo(() => abrirArquivo(a.caminho))}
                                aoBaixar={(a) => arquivo(async () => {
                                  await baixarArquivo(d, a);
                                  await carregar();
                                })}
                                aoAprovar={() => executar(d.id, () => aprovarDocumento(d.id), `${d.tipos_documento.nome}${d.colaboradores ? ` de ${d.colaboradores.nome}` : ''} aprovado.`)}
                                aoDevolver={() => setDevolvendo(d)}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Detalhe ehAdmin alocacao={cadastro} aoFechar={() => setCadastro(null)} aoMudar={async () => { await carregar(); }} />

      <Devolucao
        documento={devolvendo}
        aoFechar={() => setDevolvendo(null)}
        aoDevolver={async (motivo) => {
          const d = devolvendo!;
          setDevolvendo(null);
          await executar(d.id, () => devolverDocumento(d.id, motivo), `${d.tipos_documento.nome}${d.colaboradores ? ` de ${d.colaboradores.nome}` : ''} devolvido ao fornecedor.`);
        }}
      />
    </Pagina>
  );
}

function Devolucao({ documento, aoFechar, aoDevolver }: { documento: DocumentoEmAnalise | null; aoFechar: () => void; aoDevolver: (m: string) => void }) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => setMotivo(''), [documento]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim()) aoDevolver(motivo.trim());
  }

  return (
    <Dialogo aberto={!!documento} titulo="Devolver documento" aoFechar={aoFechar}>
      {documento && (
        <form className="formulario formulario-largo" onSubmit={enviar}>
          <p className="apoio">
            {documento.tipos_documento.nome}
            {documento.colaboradores ? ` de ${documento.colaboradores.nome}` : ''}, {documento.empresas.razao_social}. O fornecedor vê o
            motivo nas pendências e o colaborador volta para ele.
          </p>
          <div className="chips" role="group" aria-label="Motivos comuns">
            {MOTIVOS_COMUNS.map((m) => (
              <button key={m} type="button" className="chip" onClick={() => setMotivo(m)}>
                {m}
              </button>
            ))}
          </div>
          <label className="campo">
            <span>Motivo da devolução</span>
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={!motivo.trim()}>Devolver ao fornecedor</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}
