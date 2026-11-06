import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Farol, LegendaFarois, LinhaFarol } from '../../componentes/Farois';
import { mensagemDeErro } from '../../lib/supabase';
import { data, hojeIso } from '../../lib/formato';
import { mesPorExtenso } from '../../lib/medicao';
import { lerObrasDoPainel, lerPainelObra } from '../../lib/painelObra';
import { faroisDaObra, listaMeses, ordemCor, type FarolEmpresa, type Tarefa } from '../../lib/farois';

// Início do fornecedor: a situação da empresa em cada obra, com faróis e o que fazer para ficar verde.

type Linha = FarolEmpresa & { obraId: string; obra: string };

const destino = (t: Tarefa) =>
  t.acao === 'medicao'
    ? t.medicaoId
      ? `/medicao?m=${t.medicaoId}`
      : '/medicao'
    : t.acao === 'documentos_empresa'
      ? '/documentos-empresa'
      : t.acao === 'colaboradores'
        ? '/meus-colaboradores'
        : '/pendencias';

export function MinhasObras() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const obras = await lerObrasDoPainel();
      const paineis = await Promise.all(obras.map(async (o) => ({ obra: o, painel: await lerPainelObra(o.id) })));
      const todas = paineis.flatMap(({ obra, painel }) =>
        faroisDaObra(painel.colaboradores, painel.medicoes).map((f) => ({ ...f, obraId: obra.id, obra: obra.nome })),
      );
      todas.sort((a, b) => ordemCor[a.geral] - ordemCor[b.geral] || a.obra.localeCompare(b.obra, 'pt-BR'));
      if (cancelado) return;
      setLinhas(todas);
      if (todas.length && todas[0].geral !== 'verde') setAberta(`${todas[0].obraId}|${todas[0].empresaId}`);
    })().catch((e) => !cancelado && setErro(mensagemDeErro(e)));
    return () => {
      cancelado = true;
    };
  }, []);

  const variasEmpresas = useMemo(() => new Set((linhas ?? []).map((l) => l.empresaId)).size > 1, [linhas]);
  const retidas = (linhas ?? []).filter((l) => l.med.cor === 'vermelho');
  const meses = [...new Set(retidas.flatMap((l) => l.retidas))].sort();
  const primeiraRetida = retidas.flatMap((l) => l.tarefas).find((t) => t.acao === 'medicao' && t.cor === 'vermelho');
  const obrasRetidas = new Set(retidas.map((l) => l.obraId)).size;

  return (
    <Pagina
      titulo="Suas obras"
      apoio={`Situação da sua empresa em cada obra da Emais em ${data(hojeIso())}. Clique na obra para ver o que fazer.`}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {!linhas && !erro && <Carregando />}
      {linhas && linhas.length === 0 && <p className="vazio">Sua empresa ainda não tem colaboradores em obras da Emais. Use "Colaboradores" para cadastrar e incluir nas obras.</p>}

      {linhas && retidas.length > 0 && (
        <div className="faixa-retido" role="alert">
          <div>
            <Farol cor="vermelho" grande />
            <span>
              <strong>Regularize a mensal trabalhista {obrasRetidas === 1 ? 'em 1 obra' : `em ${obrasRetidas} obras`}</strong>
              {meses.length === 1
                ? `A medição de ${mesPorExtenso(meses[0])} não foi aprovada no prazo.`
                : `As medições de ${listaMeses(meses, true)} não foram aprovadas no prazo.`}{' '}
              A falta da regularização poderá ocasionar o bloqueio do pagamento. Corrija os documentos aqui no portal; não envie documentos por e-mail.
            </span>
          </div>
          {primeiraRetida && (
            <Link className="botao" to={destino(primeiraRetida)}>
              Abrir medição
            </Link>
          )}
        </div>
      )}

      {linhas && linhas.length > 0 && (
        <>
          <LegendaFarois amarelo="Pendência: resolva antes que vire bloqueio" />
          <ul className="lista-farois">
            {linhas.map((l) => {
              const chave = `${l.obraId}|${l.empresaId}`;
              return (
                <LinhaFarol
                  key={chave}
                  id={chave}
                  geral={l.geral}
                  titulo={l.obra}
                  subtitulo={variasEmpresas ? l.empresa : undefined}
                  manchete={l.manchete.replace(/pagamento retido/i, 'Mensal trabalhista a regularizar')}
                  doc={l.doc.cor}
                  int={l.int.cor}
                  med={l.med.cor}
                  aberta={aberta === chave}
                  aoAlternar={() => setAberta(aberta === chave ? null : chave)}
                >
                  {l.tarefas.length === 0 ? (
                    <p className="frente">Tudo em dia nesta obra. {l.med.itens[l.med.itens.length - 1]}</p>
                  ) : (
                    <>
                      <h3 className="detalhe-subtitulo">O que fazer para ficar verde</h3>
                      <ul className="tarefas">
                        {l.tarefas.map((t) => (
                          <li key={t.titulo} className="tarefa">
                            <span className="tarefa-texto">
                              <Farol cor={t.cor} />
                              <span>
                                <strong>{t.titulo}</strong>
                                {t.detalhe}
                              </span>
                            </span>
                            <Link className="botao botao-secundario botao-pequeno" to={destino(t)}>
                              {t.rotulo}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <p className="dica">{l.med.itens.find((x) => x.includes('no prazo')) ?? ''}</p>
                    </>
                  )}
                </LinhaFarol>
              );
            })}
          </ul>
        </>
      )}
    </Pagina>
  );
}
