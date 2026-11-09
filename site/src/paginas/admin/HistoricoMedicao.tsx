import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { GradeMedicao } from '../../componentes/GradeMedicao';
import { lerTodasMedicoes, type Medicao } from '../../lib/medicao';

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
  const [obra, setObra] = useState('');

  useEffect(() => {
    lerTodasMedicoes()
      .then(setMedicoes)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const obras = useMemo(() => {
    const m = new Map<string, string>();
    (medicoes ?? []).forEach((x) => x.obra_id && x.obra && m.set(x.obra_id, x.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [medicoes]);

  const itens = useMemo(
    () =>
      (medicoes ?? [])
        .filter((m) => !obra || m.obra_id === obra)
        .map((m) => ({ ...m, pendentes: m.itens_pendentes })),
    [medicoes, obra],
  );

  return (
    <Pagina
      titulo="Medição mensal"
      apoio="Situação de cada empresa mês a mês, como na planilha de controle. Clique numa célula para abrir a medição."
      abas={<AbasMedicao atual="historico" />}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {!medicoes && !erro && <Carregando />}

      {medicoes && (
        <GradeMedicao
          itens={itens}
          textoAjuda="Quando a empresa tem mais de uma obra no mês, cada obra aparece numa linha da célula; passe o mouse para ver qual."
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
    </Pagina>
  );
}
