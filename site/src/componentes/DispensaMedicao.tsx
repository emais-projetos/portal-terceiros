import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Dialogo } from './Dialogo';
import { mensagemDeErro, supabase } from '../lib/supabase';
import { MOTIVOS_DISPENSA, dispensarMedicao, mesPorExtenso } from '../lib/medicao';

// Dispensa da medição pelo administrativo: a empresa não precisa apresentar a medição do mês naquela obra
// (ex.: não teve atuação). A medição fica aprovada, sai da cobrança e da retenção, e o motivo fica registrado.

export type AlvoDispensa = { empresa_id: string; empresa: string; obra_id: string; obra: string; competencia: string };

export function DialogoDispensa({ alvos, aoFechar, aoDispensar }: { alvos: AlvoDispensa[] | null; aoFechar: () => void; aoDispensar: (n: number, falhas: string[]) => void }) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setMotivo('');
    setErro(null);
  }, [alvos]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!alvos?.length || motivo.trim().length < 5) return;
    setEnviando(true);
    setErro(null);
    const falhas: string[] = [];
    let n = 0;
    for (const a of alvos) {
      try {
        await dispensarMedicao(a.empresa_id, a.obra_id, a.competencia, motivo.trim());
        n += 1;
      } catch (er) {
        falhas.push(`${a.empresa} (${a.obra}): ${mensagemDeErro(er as Error)}`);
      }
    }
    setEnviando(false);
    if (n === 0) {
      setErro(falhas.join(' · '));
      return;
    }
    aoDispensar(n, falhas);
  }

  const um = alvos?.length === 1 ? alvos[0] : null;
  return (
    <Dialogo aberto={!!alvos} titulo={um ? 'Dispensar medição' : `Dispensar ${alvos?.length ?? 0} medições`} aoFechar={aoFechar}>
      {alvos && (
        <form className="formulario formulario-largo" onSubmit={enviar}>
          {um ? (
            <p className="apoio">
              <strong>{um.empresa}</strong>, obra {um.obra}, medição de {mesPorExtenso(um.competencia)}.
            </p>
          ) : (
            <ul className="lista-simples lista-rolagem">
              {alvos.map((a) => (
                <li key={`${a.empresa_id}|${a.obra_id}|${a.competencia}`}>
                  <span>
                    <strong>{a.empresa}</strong> <span className="sub">{a.obra}, {mesPorExtenso(a.competencia)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="dica">
            A medição fica dispensada: sai da cobrança automática e do aviso de retenção, e o fornecedor vê o motivo no portal. Dá para desfazer depois.
          </p>
          <div className="chips" role="group" aria-label="Motivos comuns">
            {MOTIVOS_DISPENSA.map((x) => (
              <button key={x} type="button" className="chip" aria-pressed={motivo === x} onClick={() => setMotivo(x)}>
                {x}
              </button>
            ))}
          </div>
          <label className="campo">
            <span>Motivo da dispensa</span>
            <textarea rows={3} value={motivo} maxLength={500} placeholder="Ex.: equipe saiu da obra em setembro, sem colaborador no mês" onChange={(e) => setMotivo(e.target.value)} />
          </label>
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={motivo.trim().length < 5 || enviando}>
              {enviando ? 'Dispensando' : um ? 'Dispensar medição' : `Dispensar ${alvos.length} medições`}
            </button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

type Vinculo = { empresa_id: string; obra_id: string; empresa: string; obra: string };

// Para o histórico: escolhe empresa, obra e mês antes de dispensar.
export function EscolherDispensa({ aberto, meses, aoFechar, aoEscolher }: { aberto: boolean; meses: string[]; aoFechar: () => void; aoEscolher: (a: AlvoDispensa) => void }) {
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [empresa, setEmpresa] = useState('');
  const [obra, setObra] = useState('');
  const [mes, setMes] = useState(meses[0] ?? '');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setEmpresa('');
    setObra('');
    setMes(meses[0] ?? '');
    supabase
      .from('empresas_obras')
      .select('empresa_id, obra_id, empresas!empresas_obras_empresa_id_fkey(razao_social), obras(nome, ativa)')
      .eq('ativo', true)
      .then(({ data, error }) => {
        if (error) {
          setErro(mensagemDeErro(error));
          return;
        }
        type Linha = { empresa_id: string; obra_id: string; empresas: { razao_social: string } | null; obras: { nome: string; ativa: boolean } | null };
        setVinculos(
          ((data ?? []) as unknown as Linha[])
            .filter((l) => l.obras?.ativa)
            .map((l) => ({ empresa_id: l.empresa_id, obra_id: l.obra_id, empresa: l.empresas?.razao_social ?? '', obra: l.obras?.nome ?? '' })),
        );
      });
  }, [aberto, meses]);

  const empresas = useMemo(() => {
    const m = new Map<string, string>();
    vinculos.forEach((v) => m.set(v.empresa_id, v.empresa));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [vinculos]);
  const obras = vinculos.filter((v) => v.empresa_id === empresa).sort((a, b) => a.obra.localeCompare(b.obra, 'pt-BR'));

  useEffect(() => {
    setObra(obras.length === 1 ? obras[0].obra_id : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa]);

  const escolhido = vinculos.find((v) => v.empresa_id === empresa && v.obra_id === obra);
  return (
    <Dialogo aberto={aberto} titulo="Dispensar medição" aoFechar={aoFechar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (escolhido && mes) aoEscolher({ ...escolhido, competencia: mes });
        }}
      >
        <label className="campo">
          <span>Empresa</span>
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Escolha a empresa</option>
            {empresas.map(([id, nome]) => (
              <option key={id} value={id}>{nome}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Obra</span>
          <select value={obra} disabled={!empresa} onChange={(e) => setObra(e.target.value)}>
            <option value="">{empresa ? 'Escolha a obra' : 'Escolha a empresa primeiro'}</option>
            {obras.map((o) => (
              <option key={o.obra_id} value={o.obra_id}>{o.obra}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Mês trabalhado</span>
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((c) => (
              <option key={c} value={c}>{mesPorExtenso(c)}</option>
            ))}
          </select>
        </label>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!escolhido || !mes}>Continuar</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
