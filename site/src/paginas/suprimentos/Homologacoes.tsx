import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data } from '../../lib/formato';
import { NOMES_SITUACAO_HOMOLOGACAO, SELO_HOMOLOGACAO, formatarCnpj, lerListaHomologacoes, type ItemHomologacao } from '../../lib/homologacao';
import { NovoFornecedor } from './Dialogos';
import { FichaFornecedor } from './Ficha';

export { SELO_HOMOLOGACAO };

const ABAS = [
  ['analisar', 'Para analisar', ['enviada']],
  ['fornecedor', 'Com o fornecedor', ['convidada', 'devolvida']],
  ['homologados', 'Homologados', ['homologada']],
  ['reprovados', 'Reprovados', ['reprovada']],
] as const;
type Aba = (typeof ABAS)[number][0];

// Homologação (Suprimentos): fornecedores convidados, o que chegou para analisar e o parecer do F.31.
export function Homologacoes() {
  const [params, setParams] = useSearchParams();
  const empresa = params.get('empresa');
  const aba = (params.get('aba') as Aba) || 'analisar';
  const [lista, setLista] = useState<ItemHomologacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (empresa) return;
    lerListaHomologacoes()
      .then(setLista)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [empresa, versao]);

  if (empresa) {
    return <FichaFornecedor empresaId={empresa} voltarRotulo="Homologação" aoVoltar={() => setParams(aba === 'analisar' ? {} : { aba })} />;
  }

  const definicao = ABAS.find((a) => a[0] === aba) ?? ABAS[0];
  const filtrada = (lista ?? []).filter((h) => (definicao[2] as readonly string[]).includes(h.situacao));
  const contagem = (sit: readonly string[]) => (lista ?? []).filter((h) => sit.includes(h.situacao)).length;

  return (
    <Pagina
      titulo="Homologação"
      apoio="Fornecedores de serviço novos: convite, conferência dos dados e documentos do F.31 e o parecer do Suprimentos. Depois de homologado, registre o contrato em Fornecedores."
      acoes={<button type="button" className="botao" onClick={() => setNovo(true)}>Novo fornecedor</button>}
      abas={
        <nav className="abas abas-botoes" aria-label="Homologação">
          {ABAS.map(([a, nome, sit]) => (
            <button key={a} type="button" aria-current={aba === a ? 'page' : undefined} onClick={() => setParams(a === 'analisar' ? {} : { aba: a })}>
              {nome}
              {a === 'analisar' ? !!contagem(sit) && <span className="contador">{contagem(sit)}</span> : <span className="sub"> {contagem(sit)}</span>}
            </button>
          ))}
        </nav>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!lista && !erro ? (
        <Carregando />
      ) : filtrada.length === 0 ? (
        <p className="vazio">{aba === 'analisar' ? 'Nenhuma homologação aguardando análise.' : 'Nenhum fornecedor nesta situação.'}</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Fornecedor</th>
                <th scope="col">Situação</th>
                <th scope="col">Datas</th>
                <th scope="col">Obras previstas</th>
                <th scope="col"><span className="sr">Abrir</span></th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((h) => (
                <tr key={h.empresa_id}>
                  <th scope="row">
                    {h.razao_social}
                    <small className="sub">{formatarCnpj(h.cnpj)}{h.email ? ` · ${h.email}` : ''}</small>
                  </th>
                  <td>
                    <span className={`selo ${SELO_HOMOLOGACAO[h.situacao]}`}>{NOMES_SITUACAO_HOMOLOGACAO[h.situacao]}</span>
                    {h.situacao === 'homologada' && (
                      <small className="sub">
                        {h.contratos === 0 ? 'Falta registrar o contrato' : h.liberado_em ? `Portal liberado em ${data(h.liberado_em)}` : 'Aguardando o administrativo liberar o portal'}
                      </small>
                    )}
                    {h.docs_em_analise > 0 && h.situacao !== 'enviada' && <small className="sub">{h.docs_em_analise} documento(s) novo(s) para conferir</small>}
                  </td>
                  <td>
                    <small className="sub">Convite {data(h.convidada_em)}</small>
                    {h.enviada_em && <small className="sub">Enviada {data(h.enviada_em)}</small>}
                    {h.decidida_em && <small className="sub">Parecer {data(h.decidida_em)}</small>}
                  </td>
                  <td className="quebra">{h.obras_previstas.length ? h.obras_previstas.join(', ') : <span className="sub">-</span>}</td>
                  <td className="acoes">
                    <button type="button" className="botao botao-pequeno" onClick={() => setParams({ ...(aba === 'analisar' ? {} : { aba }), empresa: h.empresa_id })}>
                      {h.situacao === 'enviada' ? 'Analisar' : 'Abrir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NovoFornecedor
        aberto={novo}
        aoFechar={() => setNovo(false)}
        aoCadastrar={(msg) => {
          setNovo(false);
          setOk(msg);
          setParams({ aba: 'fornecedor' });
          setVersao((v) => v + 1);
        }}
      />
    </Pagina>
  );
}
