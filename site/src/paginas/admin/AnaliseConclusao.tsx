import { useEffect, useMemo, useState } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { data, formatarCpf, hojeIso, somarDias } from '../../lib/formato';
import {
  NOMES_ENVIO_CONCLUSAO, concluirAnalise, lerHistoricoAnalises, lerPreviaConclusao,
  type ConclusaoAnalise, type DocumentoAnalisado, type ParaConcluir, type PreviaConclusao,
} from '../../lib/admin';

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Empresas com documento analisado e ainda não comunicado: o administrativo conclui e sai um e-mail só.
export function AnalisesParaConcluir({ lista, aoConcluir }: { lista: ParaConcluir[]; aoConcluir: (mensagem: string) => void }) {
  const [abrindo, setAbrindo] = useState<ParaConcluir | null>(null);
  if (!lista.length) return null;
  return (
    <section className="bloco bloco-concluir">
      <div className="barra-lista">
        <h2 className="bloco-titulo">
          Análises para concluir <span className="contador">{lista.length}</span>
        </h2>
      </div>
      <p className="dica">
        {lista.length === 1 ? '1 empresa tem' : `${lista.length} empresas têm`} documento analisado que o fornecedor ainda não recebeu por e-mail. Ao terminar o
        lote da empresa, clique em Concluir análise: sai um e-mail só, com o que precisa corrigir e o que foi aprovado.
      </p>
      <ul className="lista-concluir">
        {lista.map((p) => (
          <li key={p.empresa_id}>
            <span>
              <strong>{p.empresa}</strong>
              <small className="sub">
                {formatarCnpj(p.cnpj)}. {plural(p.colaboradores, 'colaborador', 'colaboradores')}: {plural(p.aprovados, 'documento aprovado', 'documentos aprovados')}
                {p.devolvidos ? `, ${plural(p.devolvidos, 'devolvido', 'devolvidos')}` : ''}. Analisado desde {data(p.desde)}.
              </small>
              {p.na_fila > 0 && <small className="sub texto-alerta">Ainda {p.na_fila === 1 ? 'há 1 documento' : `há ${p.na_fila} documentos`} desta empresa na fila de análise.</small>}
              {!p.tem_email && <small className="sub texto-erro">Sem e-mail cadastrado: cadastre o e-mail da empresa antes de concluir.</small>}
            </span>
            <button type="button" className="botao botao-pequeno" disabled={!p.tem_email} onClick={() => setAbrindo(p)}>
              Concluir análise
            </button>
          </li>
        ))}
      </ul>
      <ConcluirDialogo
        empresa={abrindo}
        aoFechar={() => setAbrindo(null)}
        aoConcluir={(m) => {
          setAbrindo(null);
          aoConcluir(m);
        }}
      />
    </section>
  );
}

function ConcluirDialogo({ empresa, aoFechar, aoConcluir }: { empresa: ParaConcluir | null; aoFechar: () => void; aoConcluir: (m: string) => void }) {
  const [previa, setPrevia] = useState<PreviaConclusao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setPrevia(null);
    setErro(null);
    if (!empresa) return;
    lerPreviaConclusao(empresa.empresa_id).then(setPrevia).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [empresa]);

  async function concluir() {
    if (!empresa || !previa) return;
    setEnviando(true);
    setErro(null);
    try {
      await concluirAnalise(empresa.empresa_id, previa.documentos);
      aoConcluir(
        previa.modelo_ativo
          ? `Análise de ${empresa.empresa} concluída. O e-mail para ${previa.para} entrou na fila e sai na próxima passada do envio automático.`
          : `Análise de ${empresa.empresa} concluída e registrada. O e-mail está desativado em Acessos > E-mails, então não foi para a fila.`,
      );
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={!!empresa} titulo={`Concluir análise: ${empresa?.empresa ?? ''}`} aoFechar={aoFechar}>
      <div className="formulario formulario-largo">
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {!previa && !erro && <Carregando />}
        {previa && (
          <>
            <p className="dica">
              {plural(previa.documentos.length, 'documento analisado', 'documentos analisados')}: {plural(previa.aprovados, 'colaborador aprovado', 'colaboradores aprovados')}
              {previa.devolvidos ? `, ${plural(previa.devolvidos, 'com correção', 'com correção')}` : ''}.
            </p>
            {previa.na_fila > 0 && (
              <p className="aviso aviso-alerta">
                Ainda {previa.na_fila === 1 ? 'há 1 documento' : `há ${previa.na_fila} documentos`} desta empresa na fila de análise. Eles não entram neste e-mail; vão na
                próxima conclusão.
              </p>
            )}
            {!previa.modelo_ativo && <p className="aviso aviso-alerta">Este e-mail está desativado em Acessos &gt; E-mails: a análise fica registrada, sem envio.</p>}
            <dl className="previa-email">
              <div><dt>Para</dt><dd>{previa.para ?? 'sem e-mail cadastrado'} <small className="sub">(e-mail do fornecedor cadastrado no portal)</small></dd></div>
              <div><dt>Assunto</dt><dd>{previa.assunto}</dd></div>
            </dl>
            <pre className="previa-corpo">{previa.corpo}</pre>
            <p className="dica">O texto vem de Acessos &gt; E-mails. Na fila, o envio respeita a pausa e o modo teste.</p>
            <div className="linha-botoes">
              <button type="button" className="botao" disabled={enviando || !previa.para} onClick={() => void concluir()}>
                {enviando ? 'Concluindo' : previa.modelo_ativo ? 'Concluir e colocar o e-mail na fila' : 'Concluir sem e-mail'}
              </button>
              <button type="button" className="botao botao-discreto" onClick={aoFechar}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </Dialogo>
  );
}

// Histórico: o que foi analisado (aprovado ou devolvido), por quem, quando e se o fornecedor já recebeu.
export function HistoricoAnalises({ recarregarEm }: { recarregarEm: number }) {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<{ documentos: DocumentoAnalisado[]; conclusoes: ConclusaoAnalise[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState('');
  const [resultado, setResultado] = useState<'' | 'aprovado' | 'devolvido'>('');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    setDados(null);
    setErro(null);
    lerHistoricoAnalises(`${somarDias(hojeIso(), -dias)}T00:00:00-03:00`).then(setDados).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [dias, recarregarEm]);

  const empresas = useMemo(() => [...new Map((dados?.documentos ?? []).map((d) => [d.empresa_id, d.empresa])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [dados]);
  const conclusao = useMemo(() => new Map((dados?.conclusoes ?? []).map((c) => [c.id, c])), [dados]);

  const grupos = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const docs = (dados?.documentos ?? []).filter(
      (d) => (!empresa || d.empresa_id === empresa) && (!resultado || d.resultado === resultado) && (!b || (d.colaborador ?? 'documentos da empresa').toLowerCase().includes(b)),
    );
    const porEmpresa = new Map<string, { empresa: string; pessoas: Map<string, DocumentoAnalisado[]> }>();
    for (const d of docs) {
      const g = porEmpresa.get(d.empresa_id) ?? { empresa: d.empresa, pessoas: new Map() };
      const chave = d.colaborador_id ?? 'empresa';
      g.pessoas.set(chave, [...(g.pessoas.get(chave) ?? []), d]);
      porEmpresa.set(d.empresa_id, g);
    }
    return [...porEmpresa.entries()].sort((a, b2) => a[1].empresa.localeCompare(b2[1].empresa, 'pt-BR'));
  }, [dados, empresa, resultado, busca]);

  const conclusoes = (dados?.conclusoes ?? []).filter((c) => !empresa || c.empresa_id === empresa);

  return (
    <>
      <div className="filtros">
        <label className="campo">
          <span>Período</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={365}>Últimos 12 meses</option>
          </select>
        </label>
        <label className="campo">
          <span>Empresa</span>
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Todas</option>
            {empresas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Resultado</span>
          <select value={resultado} onChange={(e) => setResultado(e.target.value as typeof resultado)}>
            <option value="">Aprovados e devolvidos</option>
            <option value="aprovado">Só aprovados</option>
            <option value="devolvido">Só devolvidos</option>
          </select>
        </label>
        <label className="campo campo-busca">
          <span>Colaborador</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome" />
        </label>
      </div>
      {erro && <p className="aviso aviso-erro">{erro}</p>}
      {!dados && !erro && <Carregando />}

      {dados && conclusoes.length > 0 && (
        <section className="bloco">
          <h2 className="bloco-titulo">E-mails das análises concluídas</h2>
          <ul className="lista-concluir">
            {conclusoes.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.empresa}</strong>
                  <small className="sub">
                    Concluída em {dataHora(c.concluida_em)}{c.quem ? ` por ${c.quem}` : ''}. {plural(c.colaboradores, 'colaborador', 'colaboradores')},{' '}
                    {plural(c.aprovados, 'aprovado', 'aprovados')}{c.devolvidos ? `, ${plural(c.devolvidos, 'com correção', 'com correção')}` : ''}. Para {c.para}.
                  </small>
                  {aberta === c.id && (
                    <>
                      <p className="previa-assunto">{c.assunto}</p>
                      <pre className="previa-corpo">{c.corpo}</pre>
                    </>
                  )}
                </span>
                <span className="acoes-concluir">
                  <span className={`selo ${c.situacao_envio === 'enviado' ? 'selo-ok' : c.situacao_envio === 'erro' ? 'selo-erro' : 'selo-fila'}`}>
                    {NOMES_ENVIO_CONCLUSAO[c.situacao_envio]}
                    {c.situacao_envio === 'enviado' && c.enviado_em ? ` em ${data(c.enviado_em)}` : ''}
                    {c.envio_teste ? ' (teste)' : ''}
                  </span>
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setAberta(aberta === c.id ? null : c.id)}>
                    {aberta === c.id ? 'Fechar e-mail' : 'Ver e-mail'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dados && grupos.length === 0 && <p className="vazio">Nenhum documento analisado com esse filtro.</p>}
      {grupos.map(([id, g]) => (
        <section key={id} className="bloco">
          <h2 className="bloco-titulo">{g.empresa}</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Colaborador</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Analisado</th>
                  <th scope="col">Fornecedor avisado</th>
                </tr>
              </thead>
              <tbody>
                {[...g.pessoas.entries()]
                  .sort((a, b) => (a[0] === 'empresa' ? -1 : b[0] === 'empresa' ? 1 : (a[1][0].colaborador ?? '').localeCompare(b[1][0].colaborador ?? '', 'pt-BR')))
                  .flatMap(([chave, docs]) =>
                    docs.map((d, k) => {
                      const c = d.conclusao_id ? conclusao.get(d.conclusao_id) : undefined;
                      return (
                        <tr key={d.id}>
                          {k === 0 ? (
                            <th scope="row" rowSpan={docs.length}>
                              {chave === 'empresa' ? 'Documentos da empresa' : d.colaborador}
                              {d.cpf && <small className="sub">{formatarCpf(d.cpf)}</small>}
                            </th>
                          ) : null}
                          <td>{d.documento}</td>
                          <td>
                            <span className={`selo ${d.resultado === 'aprovado' ? 'selo-ok' : 'selo-erro'}`}>{d.resultado === 'aprovado' ? 'Aprovado' : 'Devolvido'}</span>
                            {d.resultado === 'devolvido' && d.motivo && <small className="sub">{d.motivo}</small>}
                            {d.resultado === 'devolvido' && d.status === 'substituido' && <small className="sub">fornecedor já reenviou</small>}
                          </td>
                          <td>
                            {dataHora(d.analisado_em)}
                            {d.quem && <small className="sub">{d.quem}</small>}
                          </td>
                          <td>
                            {d.aguardando ? (
                              <span className="selo selo-teste">aguardando conclusão</span>
                            ) : c ? (
                              <>
                                {data(c.concluida_em)}
                                <small className="sub">{NOMES_ENVIO_CONCLUSAO[c.situacao_envio]}</small>
                              </>
                            ) : d.conclusao_id ? (
                              <span className="sub">em análise concluída antes do período</span>
                            ) : (
                              <span className="sub">antes da conclusão por e-mail</span>
                            )}
                          </td>
                        </tr>
                      );
                    }),
                  )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
