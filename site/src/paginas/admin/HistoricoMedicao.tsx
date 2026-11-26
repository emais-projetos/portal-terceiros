import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { GradeMedicao } from '../../componentes/GradeMedicao';
import { DialogoDispensa, EscolherDispensa, type AlvoDispensa } from '../../componentes/DispensaMedicao';
import { lerTodasMedicoes, type Medicao } from '../../lib/medicao';

// Meses que podem ser dispensados: do início do portal (setembro de 2026) até o mês atual, do mais novo ao mais antigo.
function mesesParaDispensa(): string[] {
  const lista: string[] = [];
  const hoje = new Date();
  for (let d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d >= new Date(2026, 8, 1); d.setMonth(d.getMonth() - 1)) {
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return lista;
}

export function AbasMedicao({ atual }: { atual: 'mes' | 'historico' }) {
  return (
    <nav className="abas" aria-label="Visões da medição">
      <Link to="/medicao" aria-current={atual === 'mes' ? 'page' : undefined}>Por mês</Link>
      <Link to="/medicao?ver=historico" aria-current={atual === 'historico' ? 'page' : undefined}>Histórico por empresa</Link>
    </nav>
  );
}

export function HistoricoMedicao() {
  const [medicoes, setMedicoes] = useState<Medicao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [obra, setObra] = useState('');
  const [escolhendo, setEscolhendo] = useState(false);
  const [dispensa, setDispensa] = useState<AlvoDispensa[] | null>(null);
  const meses = useMemo(mesesParaDispensa, []);

  const carregar = useCallback(() => {
    lerTodasMedicoes()
      .then(setMedicoes)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const obras = useMemo(() => {
    const m = new Map<string, string>();
    (medicoes ?? []).forEach((x) => x.obra_id && x.obra && m.set(x.obra_id, x.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [medicoes]);

  const itens = useMemo(
    () =>
      (medicoes ?? [])
        .filter((m) => !obra || m.obra_id === obra)
        .map((m) => ({ ...m, pendentes: m.itens_pendentes, dispensada: !!m.dispensada_em })),
    [medicoes, obra],
  );

  return (
    <Pagina
      titulo="Medição mensal"
      apoio="Situação de cada empresa mês a mês, como na planilha de controle. Clique numa célula para abrir a medição."
      abas={<AbasMedicao atual="historico" />}
      acoes={
        <button type="button" className="botao botao-secundario" onClick={() => setEscolhendo(true)}>
          Dispensar medição
        </button>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!medicoes && !erro && <Carregando />}

      {medicoes && (
        <GradeMedicao
          itens={itens}
          textoAjuda="Quando a empresa tem mais de uma obra no mês, cada obra aparece numa linha da célula; passe o mouse para ver qual. Para dispensar um mês que já tem medição, abra a célula; para um mês sem medição, use Dispensar medição."
          filtrosExtras={
            <label className="campo">
              <span>Obra</span>
              <select value={obra} onChange={(e) => setObra(e.target.value)}>
                <option value="">Todas, com o histórico da planilha</option>
                {obras.map(([id, nome]) => (
                  <option key={id} value={id}>{nome}</option>
                ))}
              </select>
            </label>
          }
          celula={(m, conteudo, props) => (
            <Link {...props} to={`/medicao?m=${m.id}&mes=${m.competencia}&de=historico`}>
              {conteudo}
            </Link>
          )}
        />
      )}

      <EscolherDispensa
        aberto={escolhendo}
        meses={meses}
        aoFechar={() => setEscolhendo(false)}
        aoEscolher={(a) => {
          setEscolhendo(false);
          setDispensa([a]);
        }}
      />
      <DialogoDispensa
        alvos={dispensa}
        aoFechar={() => setDispensa(null)}
        aoDispensar={() => {
          setDispensa(null);
          setOk('Medição dispensada. Ela aparece na grade como "Disp." e o fornecedor vê o motivo no portal.');
          carregar();
        }}
      />
    </Pagina>
  );
}
