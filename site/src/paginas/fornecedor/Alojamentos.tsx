import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { CampoFotos } from '../../componentes/CampoFotos';
import { mensagemDeErro, supabase } from '../../lib/supabase';
import { data, diasAte } from '../../lib/formato';
import {
  lerAlojamento, lerMeusAlojamentos, lerMinhasNcs, lerVistoria, linksDosArquivos, responderNc,
  type AlojamentoComObra, type AlojamentoFornecedor, type NcFornecedor, type Vistoria,
} from '../../lib/seguranca';
import { baixarPdfVistoria } from '../../lib/pdfSeguranca';
import { Fotos, SeloClassificacao, Voltar, caminhosDaVistoria } from '../seguranca/comum';
import { LeituraVistoria } from '../seguranca/VistoriaPagina';
import { seloNc } from '../seguranca/NcsVistoria';

// Fornecedor: alojamentos sob responsabilidade da empresa, vistorias concluídas e itens a regularizar.
export function AlojamentosFornecedor() {
  const [alojamentos, setAlojamentos] = useState<AlojamentoFornecedor[] | null>(null);
  const [ncs, setNcs] = useState<NcFornecedor[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function carregar() {
    const [a, n] = await Promise.all([lerMeusAlojamentos(), lerMinhasNcs()]);
    setAlojamentos(a);
    setNcs(n);
    setLinks(await linksDosArquivos(n.flatMap((x) => x.resposta_fotos ?? [])));
  }

  useEffect(() => {
    carregar().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, []);

  const abertas = ncs.filter((n) => n.situacao === 'aberta' || n.situacao === 'reaberta');
  const emAvaliacao = ncs.filter((n) => n.situacao === 'respondida');
  const regularizadas = ncs.filter((n) => n.situacao === 'regularizada');

  return (
    <Pagina titulo="Alojamentos" apoio="Vistorias dos alojamentos sob responsabilidade da sua empresa e os itens que a Segurança do Trabalho pediu para regularizar.">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!alojamentos && !erro && <Carregando />}

      {alojamentos && (
        <>
          <section className="bloco">
            <h2 className="bloco-titulo">Itens a regularizar {abertas.length > 0 && <span className="contador">{abertas.length}</span>}</h2>
            {abertas.length === 0 ? (
              <p className="vazio">Nenhum item pendente. Quando a vistoria apontar algo para regularizar, ele aparece aqui e chega por e-mail.</p>
            ) : (
              <ul className="lista-ncs">
                {abertas.map((n) => (
                  <ItemParaResponder
                    key={n.id}
                    n={n}
                    aoResponder={async () => {
                      await carregar();
                      setOk('Resposta enviada. A Segurança do Trabalho avalia e, se precisar, devolve com o que falta.');
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {emAvaliacao.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">Aguardando avaliação da Segurança do Trabalho</h2>
              <ul className="lista-ncs">
                {emAvaliacao.map((n) => (
                  <li key={n.id}>
                    <CabecalhoNc n={n} />
                    <div className="resposta-fornecedor">
                      <span className="sub">Sua resposta em {data(n.respondida_em)}</span>
                      <p>{n.resposta}</p>
                      <Fotos caminhos={n.resposta_fotos ?? []} links={links} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="bloco">
            <h2 className="bloco-titulo">Alojamentos</h2>
            {alojamentos.length === 0 ? (
              <p className="vazio">Nenhum alojamento ligado à sua empresa.</p>
            ) : (
              <ul className="lista-inspecoes">
                {alojamentos.map((a) => {
                  const ultima = a.vistorias[0];
                  const pend = abertas.filter((n) => n.vistoria?.alojamento?.nome === a.nome).length;
                  return (
                    <li key={a.id}>
                      {ultima ? (
                        <Link to={`/alojamentos/vistoria/${ultima.id}`} className="inspecao-linha">
                          <span className="inspecao-data">
                            {data(ultima.data_vistoria)}
                            <small>última vistoria</small>
                          </span>
                          <span className="inspecao-local">
                            <strong>{a.nome}</strong>
                            <small>{a.obra.nome}{a.endereco ? `. ${a.endereco}` : ''}</small>
                            {pend > 0 && <small className="texto-alerta">{pend} {pend === 1 ? 'item a regularizar' : 'itens a regularizar'}</small>}
                          </span>
                          <span className="inspecao-situacao"><SeloClassificacao v={ultima} /></span>
                          <span className="inspecao-abrir" aria-hidden="true">Abrir ›</span>
                        </Link>
                      ) : (
                        <div className="inspecao-linha">
                          <span className="inspecao-data">-<small>sem vistoria</small></span>
                          <span className="inspecao-local"><strong>{a.nome}</strong><small>{a.obra.nome}</small></span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {regularizadas.length > 0 && (
            <details className="bloco detalhe-dobravel">
              <summary>Itens já regularizados ({regularizadas.length})</summary>
              <ul className="lista-ncs">
                {regularizadas.map((n) => (
                  <li key={n.id}>
                    <CabecalhoNc n={n} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Pagina>
  );
}

function CabecalhoNc({ n }: { n: NcFornecedor }) {
  const aberta = n.situacao === 'aberta' || n.situacao === 'reaberta';
  const dias = diasAte(n.prazo);
  return (
    <>
      <div className="vistoria-item-linha">
        <span>
          <strong>{n.vistoria?.alojamento?.nome ?? 'Alojamento'}</strong>
          <small className="sub"> {n.vistoria?.obra?.nome}{n.vistoria ? `, vistoria de ${data(n.vistoria.data_vistoria)}` : ''}</small>
        </span>
        {seloNc(n.situacao)}
      </div>
      <p className="nc-descricao">{n.descricao}</p>
      {n.recomendacao && <p className="sub">O que fazer: {n.recomendacao}</p>}
      <p className={`sub${aberta && dias < 0 ? ' texto-erro' : ''}`}>
        Prazo: {data(n.prazo)}
        {aberta ? (dias < 0 ? ` (vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'})` : dias === 0 ? ' (vence hoje)' : ` (faltam ${dias} ${dias === 1 ? 'dia' : 'dias'})`) : ''}
      </p>
      {n.situacao === 'reaberta' && n.motivo_reabertura && <p className="aviso aviso-erro">Não aceito: {n.motivo_reabertura}</p>}
    </>
  );
}

function ItemParaResponder({ n, aoResponder }: { n: NcFornecedor; aoResponder: () => Promise<void> }) {
  const [texto, setTexto] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      await responderNc(n.id, texto.trim(), fotos);
      await aoResponder();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <li>
      <CabecalhoNc n={n} />
      <div className="responder-nc">
        <label className="campo">
          <span>O que foi feito</span>
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva a correção" />
        </label>
        <div className="campo">
          <span>Fotos da correção (até 5)</span>
          <CampoFotos
            pasta={`nc/${n.id}`}
            fotos={fotos}
            links={links}
            aoMudar={(f, novos) => {
              setLinks((l) => ({ ...l, ...novos }));
              setFotos(f);
            }}
          />
        </div>
        {erro && <p className="texto-erro">{erro}</p>}
        <button type="button" className="botao" disabled={texto.trim().length < 5 || enviando} onClick={enviar}>
          {enviando ? 'Enviando' : 'Enviar resposta'}
        </button>
      </div>
    </li>
  );
}

// Vistoria concluída vista pelo fornecedor (só leitura), com o PDF.
export function VistoriaFornecedor() {
  const { id = '' } = useParams();
  const [v, setV] = useState<Vistoria | null>(null);
  const [aloj, setAloj] = useState<AlojamentoComObra | null>(null);
  const [empresa, setEmpresa] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    (async () => {
      const x = await lerVistoria(id);
      const a = await lerAlojamento(x.alojamento_id!);
      setV(x);
      setAloj(a);
      if (a.empresa_id) {
        const { data: e } = await supabase.from('empresas').select('razao_social').eq('id', a.empresa_id).maybeSingle();
        setEmpresa((e?.razao_social as string) ?? '');
      }
      if (!x.fotos_excluidas_em) setLinks(await linksDosArquivos(caminhosDaVistoria(x)));
    })().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [id]);

  return (
    <Pagina
      titulo={aloj ? `Vistoria de ${aloj.nome}` : 'Vistoria'}
      apoio={aloj ? aloj.obra.nome : undefined}
      acoes={
        v && aloj ? (
          <button
            type="button"
            className="botao botao-secundario"
            disabled={baixando}
            onClick={async () => {
              setBaixando(true);
              try {
                await baixarPdfVistoria(v, { obra: aloj.obra.nome, alojamento: aloj.nome, endereco: aloj.endereco, responsavel: empresa });
              } catch (e) {
                setErro(mensagemDeErro(e as Error));
              } finally {
                setBaixando(false);
              }
            }}
          >
            {baixando ? 'Gerando PDF' : 'Baixar PDF'}
          </button>
        ) : undefined
      }
    >
      <Voltar para="/alojamentos" rotulo="Alojamentos" />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {!v && !erro && <Carregando />}
      {v && <LeituraVistoria v={v} links={links} responsavel={empresa} />}
    </Pagina>
  );
}
