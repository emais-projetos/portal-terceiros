import { useEffect, useMemo, useState } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data } from '../../lib/formato';
import {
  copiarTexto, gerarAviso, lerAlocacoes, lerAvisos, lerEmailsEmpresas, lerEmailsTst, linkOutlook, marcarAvisoEnviado,
  type AlocacaoResumo, type AvisoLiberacao,
} from '../../lib/admin';

const CHAVE_DESTINO = 'portal-terceiros:destinatarios:';

function lerDestino(obraId: string): string {
  try {
    return window.localStorage.getItem(CHAVE_DESTINO + obraId) ?? '';
  } catch {
    return '';
  }
}

function guardarDestino(obraId: string, valor: string) {
  try {
    window.localStorage.setItem(CHAVE_DESTINO + obraId, valor);
  } catch {
    // sem armazenamento no navegador: segue sem lembrar
  }
}

export function Liberacao() {
  const [alocacoes, setAlocacoes] = useState<AlocacaoResumo[] | null>(null);
  const [obra, setObra] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [emailsEmpresas, setEmailsEmpresas] = useState<Map<string, string>>(new Map());
  const [emailsTst, setEmailsTst] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<AvisoLiberacao[]>([]);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [para, setPara] = useState('');
  const [mostrarAvisados, setMostrarAvisados] = useState(false);
  const [aviso, setAviso] = useState<AvisoLiberacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    lerAlocacoes()
      .then(setAlocacoes)
      .catch((e) => setErro(mensagemDeErro(e)));
    lerEmailsEmpresas().then(setEmailsEmpresas).catch(() => undefined);
  }, []);

  const obras = useMemo(() => {
    const m = new Map<string, { nome: string; liberados: number }>();
    (alocacoes ?? []).forEach((a) => {
      const o = m.get(a.obra_id) ?? { nome: a.obra, liberados: 0 };
      if (a.status === 'liberado') o.liberados += 1;
      m.set(a.obra_id, o);
    });
    return [...m.entries()].sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [alocacoes]);

  useEffect(() => {
    setSelecao(new Set());
    setAviso(null);
    setOk(null);
    setFornecedor('');
    setEmailsTst([]);
    if (!obra) {
      setAvisos([]);
      return;
    }
    lerEmailsTst(obra).then(setEmailsTst).catch(() => undefined);
    lerAvisos(obra)
      .then(setAvisos)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [obra]);

  // Para: o e-mail cadastrado do fornecedor, os TSTs da obra e os destinatários extras lembrados neste navegador.
  useEffect(() => {
    if (!obra || !fornecedor) return;
    setSelecao(new Set());
    setAviso(null);
    const lista = [emailsEmpresas.get(fornecedor) ?? '', ...emailsTst, ...lerDestino(obra).split(/[;,\s]+/)]
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'));
    setPara([...new Set(lista)].join('; '));
  }, [obra, fornecedor, emailsEmpresas, emailsTst]);

  const avisados = useMemo(() => {
    const s = new Map<string, string>();
    avisos.forEach((av) => av.alocacoes.forEach((id) => { if (!s.has(id)) s.set(id, av.gerado_em); }));
    return s;
  }, [avisos]);

  // Fornecedores da obra com liberados (quantos ainda sem aviso).
  const fornecedores = useMemo(() => {
    const m = new Map<string, { nome: string; semAviso: number; total: number }>();
    (alocacoes ?? [])
      .filter((a) => a.obra_id === obra && a.status === 'liberado')
      .forEach((a) => {
        const f = m.get(a.empresa_id) ?? { nome: a.empresa, semAviso: 0, total: 0 };
        f.total += 1;
        if (!avisados.has(a.alocacao_id)) f.semAviso += 1;
        m.set(a.empresa_id, f);
      });
    return [...m.entries()].sort(([, a], [, b]) => b.semAviso - a.semAviso || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [alocacoes, obra, avisados]);

  const liberados = useMemo(
    () =>
      (alocacoes ?? [])
        .filter((a) => a.obra_id === obra && a.status === 'liberado' && a.empresa_id === fornecedor)
        .filter((a) => mostrarAvisados || !avisados.has(a.alocacao_id))
        .sort((a, b) => (b.validado_tst_em ?? '').localeCompare(a.validado_tst_em ?? '') || a.colaborador.localeCompare(b.colaborador, 'pt-BR')),
    [alocacoes, obra, fornecedor, avisados, mostrarAvisados],
  );

  function alternar(id: string) {
    setSelecao((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function gerar() {
    setErro(null);
    setGerando(true);
    try {
      // Lembra só os destinatários extras (os do fornecedor e do TST vêm do cadastro).
      const cadastrados = new Set([emailsEmpresas.get(fornecedor) ?? '', ...emailsTst].map((e) => e.trim().toLowerCase()));
      guardarDestino(obra, para.split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@') && !cadastrados.has(e)).join('; '));
      const novo = await gerarAviso(obra, [...selecao], para.trim());
      setAviso(novo);
      setAvisos(await lerAvisos(obra));
      setSelecao(new Set());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setGerando(false);
    }
  }

  async function marcarEnviado(av: AvisoLiberacao) {
    setErro(null);
    try {
      await marcarAvisoEnviado(av.id);
      setOk('Aviso marcado como enviado.');
      const lista = await lerAvisos(obra);
      setAvisos(lista);
      if (aviso?.id === av.id) setAviso(lista.find((x) => x.id === av.id) ?? null);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  return (
    <Pagina
      titulo="Aviso de liberação"
      apoio="Escolha a obra e o fornecedor: o e-mail sai com os liberados dele, já endereçado ao fornecedor e ao TST da obra, pronto para o Outlook."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      {!alocacoes && !erro && <Carregando />}
      {alocacoes && (
        <div className="filtros">
          <label className="campo">
            <span>Obra</span>
            <select value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Escolha a obra</option>
              {obras.map(([id, o]) => (
                <option key={id} value={id}>{o.nome} ({o.liberados} liberados)</option>
              ))}
            </select>
          </label>
          {obra && (
            <label className="campo">
              <span>Fornecedor</span>
              <select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}>
                <option value="">Escolha o fornecedor</option>
                {fornecedores.map(([id, f]) => (
                  <option key={id} value={id}>
                    {f.nome} ({f.semAviso ? `${f.semAviso} sem aviso` : `${f.total} já avisados`})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {obra && !fornecedor && fornecedores.length === 0 && <p className="vazio">Nenhum colaborador liberado nesta obra.</p>}

      {obra && fornecedor && (
        <div className="duas-colunas">
          <section>
            <div className="barra-lista">
              <h2 className="bloco-titulo">Liberados {mostrarAvisados ? '' : 'ainda sem aviso'}</h2>
              <label className="opcao">
                <input type="checkbox" checked={mostrarAvisados} onChange={(e) => setMostrarAvisados(e.target.checked)} />
                <span>Mostrar também os já avisados</span>
              </label>
            </div>
            {liberados.length === 0 ? (
              <p className="vazio">Nenhum colaborador liberado {mostrarAvisados ? '' : 'sem aviso '}nesta obra.</p>
            ) : (
              <>
                <div className="linha-botoes">
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setSelecao(new Set(liberados.map((a) => a.alocacao_id)))}>
                    Marcar todos ({liberados.length})
                  </button>
                  {selecao.size > 0 && (
                    <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setSelecao(new Set())}>
                      Limpar
                    </button>
                  )}
                </div>
                <ul className="lista-marcar lista-alta">
                  {liberados.map((a) => (
                    <li key={a.alocacao_id}>
                      <label>
                        <input type="checkbox" checked={selecao.has(a.alocacao_id)} onChange={() => alternar(a.alocacao_id)} />
                        <span>
                          {a.colaborador}
                          <small className="sub">
                            {a.empresa}
                            {a.validado_tst_em ? `, liberado em ${data(a.validado_tst_em)}` : ''}
                            {avisados.has(a.alocacao_id) ? `, avisado em ${data(avisados.get(a.alocacao_id))}` : ''}
                          </small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section>
            <h2 className="bloco-titulo">E-mail</h2>
            <div className="formulario formulario-largo">
              <label className="campo">
                <span>Para</span>
                <input
                  type="text"
                  inputMode="email"
                  placeholder="engenharia.obra@emais.com; tst.obra@emais.com"
                  value={para}
                  onChange={(e) => setPara(e.target.value)}
                />
                <small className="dica">
                  Já vem com o e-mail cadastrado do fornecedor{emailsTst.length ? ' e do TST da obra' : ' (a obra não tem TST cadastrado)'}. Separe com ponto e vírgula; os extras ficam lembrados neste navegador.
                </small>
              </label>
              <button type="button" className="botao" disabled={selecao.size === 0 || gerando} onClick={gerar}>
                {gerando ? 'Gerando' : `Gerar aviso com ${selecao.size} ${selecao.size === 1 ? 'colaborador' : 'colaboradores'}`}
              </button>

              {aviso && (
                <div className="previa-email">
                  <p><span className="sub">Assunto</span> {aviso.assunto}</p>
                  <pre>{aviso.corpo}</pre>
                  <div className="linha-botoes">
                    <a className="botao" href={linkOutlook(aviso.destinatarios ?? '', aviso.assunto, aviso.corpo)}>Abrir no Outlook</a>
                    <button type="button" className="botao botao-secundario" onClick={() => copiarTexto(aviso.corpo).then(() => setOk('Texto copiado.')).catch(() => setErro('O navegador não deixou copiar. Selecione o texto e copie com Ctrl+C.'))}>
                      Copiar texto
                    </button>
                    {!aviso.marcado_enviado_em && (
                      <button type="button" className="botao botao-discreto" onClick={() => marcarEnviado(aviso)}>Marcar como enviado</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {obra && avisos.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">Avisos já gerados nesta obra</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista tabela-compacta">
              <thead>
                <tr>
                  <th scope="col">Gerado em</th>
                  <th scope="col">Colaboradores</th>
                  <th scope="col">Para</th>
                  <th scope="col">Enviado</th>
                  <th scope="col"><span className="sr">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {avisos.map((av) => (
                  <tr key={av.id}>
                    <th scope="row">{data(av.gerado_em)}</th>
                    <td>{av.alocacoes.length}</td>
                    <td className="quebra">{av.destinatarios || <span className="sub">Não informado</span>}</td>
                    <td>{av.marcado_enviado_em ? data(av.marcado_enviado_em) : <span className="sub">Não marcado</span>}</td>
                    <td className="acoes">
                      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setAviso(av)}>Ver e-mail</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Pagina>
  );
}
