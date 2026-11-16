import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { Assinatura } from '../../componentes/Assinatura';
import { CampoFotos } from '../../componentes/CampoFotos';
import { mensagemDeErro } from '../../lib/supabase';
import { data } from '../../lib/formato';
import {
  NOMES_STATUS_FICHA, colaboradoresAtivos, competencia, enviarImagem, lerFicha, lerMaquina, lerModelos, linksDosArquivos, salvarDiaFicha,
  type ColaboradorAtivo, type Ficha, type MaquinaComObra,
} from '../../lib/seguranca';
import { Voltar } from './comum';

type Status = 'ok' | 'nc' | 'na' | null;

export function DiaFicha() {
  const { id = '', dia = '' } = useParams();
  const navegar = useNavigate();
  const n = Number(dia);
  const chave = String(n).padStart(2, '0');

  const [f, setF] = useState<Ficha | null>(null);
  const [maq, setMaq] = useState<MaquinaComObra | null>(null);
  const [nomeMaquina, setNomeMaquina] = useState('');
  const [colabs, setColabs] = useState<ColaboradorAtivo[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [operador, setOperador] = useState('');
  const [observacao, setObservacao] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [assinando, setAssinando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const x = await lerFicha(id);
      const m = await lerMaquina(x.maquina_id);
      setF(x);
      setMaq(m);
      const existente = x.dias[chave];
      setStatuses(existente ? existente.statuses : x.itens.map(() => null));
      setOperador(existente?.operador ?? '');
      setObservacao(existente?.observacao ?? '');
      setFotos(existente?.fotos ?? []);
      setAssinatura(existente?.assinatura ?? null);
      lerModelos().then((mo) => setNomeMaquina(mo.find((y) => y.codigo === m.modelo_codigo)?.nome ?? '')).catch(() => undefined);
      if (m.empresa_id) colaboradoresAtivos(m.empresa_id).then(setColabs).catch(() => undefined);
      if (existente) setLinks(await linksDosArquivos([...(existente.fotos ?? []), existente.assinatura ?? ''].filter(Boolean)));
    })().catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [id, chave]);

  if (!f || !maq)
    return (
      <Pagina titulo="Checklist do dia">
        <Voltar para={`/seguranca/ficha/${id}`} rotulo="Ficha do mês" />
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );

  const diaIso = `${f.competencia.slice(0, 8)}${chave}`;
  const existe = !!f.dias[chave];
  const faltam = statuses.filter((s) => !s).length;
  const voltar = (ok?: string) => navegar(`/seguranca/ficha/${id}`, { state: ok ? { ok } : undefined });

  async function salvar() {
    if (faltam) {
      setErro(`Faltam ${faltam} ${faltam === 1 ? 'item' : 'itens'} sem resposta.`);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await salvarDiaFicha(id, n, { statuses: statuses as string[], operador, observacao, fotos, assinatura });
      voltar(`Checklist do dia ${data(diaIso)} salvo.`);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Pagina titulo={`${nomeMaquina || 'Máquina'} ${maq.identificacao}`} apoio={`Checklist de ${data(diaIso)}. ${maq.obra.nome}.`}>
      <Voltar para={`/seguranca/ficha/${id}`} rotulo={`Ficha de ${competencia(f.competencia)}`} />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {f.fechada_em && <Mensagem tipo="erro">Este mês já foi fechado. Só o administrativo consegue corrigir.</Mensagem>}

      <div className="form-inspecao">
        <section className="bloco">
          <div className="barra-lista">
            <h2 className="bloco-titulo">Checklist</h2>
            <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => setStatuses((s) => s.map((x) => x ?? 'ok'))}>
              Marcar os que faltam como conforme
            </button>
          </div>
          <ol className="itens-inspecao">
            {f.itens.map((item, i) => (
              <li key={i} className={`item-inspecao${statuses[i] === 'nc' ? ' item-inspecao-nao' : ''}${statuses[i] ? '' : ' item-inspecao-aberto'}`}>
                <p className="item-inspecao-texto">
                  <span className="item-inspecao-numero">{i + 1}</span>
                  {item}
                </p>
                <div className="escolha" role="radiogroup" aria-label={`Resposta do item ${i + 1}`}>
                  {(['ok', 'nc', 'na'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={statuses[i] === s}
                      className={`escolha-${s === 'ok' ? 'sim' : s === 'nc' ? 'nao' : 'na'}`}
                      onClick={() => setStatuses((l) => l.map((x, k) => (k === i ? s : x)))}
                    >
                      {NOMES_STATUS_FICHA[s]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="bloco">
          <label className="campo">
            <span>Operador da máquina</span>
            <input list="operadores" value={operador} onChange={(e) => setOperador(e.target.value)} autoComplete="off" />
            <datalist id="operadores">
              {colabs.map((c) => <option key={c.id} value={c.nome} />)}
            </datalist>
          </label>
          <label className="campo">
            <span>Observação</span>
            <textarea rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="O que foi encontrado e o que foi feito" />
          </label>
          <div className="campo">
            <span>Fotos</span>
            <CampoFotos
              pasta={`ficha/${id}/${chave}`}
              fotos={fotos}
              links={links}
              maximo={10}
              aoMudar={(nova, novos) => {
                setLinks((l) => ({ ...l, ...novos }));
                setFotos(nova);
              }}
            />
          </div>
          <div className="pessoa-assina-acoes">
            {assinatura && links[assinatura] ? <img className="assinatura-previa" src={links[assinatura]} alt="Assinatura do operador" /> : <span className="sub">sem assinatura do operador</span>}
            <button type="button" className="botao botao-secundario botao-pequeno" disabled={operador.trim().length < 2} onClick={() => setAssinando(true)}>
              {assinatura ? 'Assinar de novo' : 'Assinatura do operador'}
            </button>
          </div>
        </section>

        <div className="barra-acoes-fixa">
          <span className="sub">{faltam ? `${faltam} sem resposta` : 'Checklist completo'}</span>
          <div className="linha-botoes">
            {existe && <button type="button" className="botao botao-discreto" onClick={() => setApagando(true)}>Apagar o dia</button>}
            <button type="button" className="botao botao-discreto" onClick={() => voltar()}>Cancelar</button>
            <button type="button" className="botao" disabled={salvando || operador.trim().length < 2} onClick={salvar}>{salvando ? 'Salvando' : 'Salvar o dia'}</button>
          </div>
        </div>
      </div>

      <Assinatura
        aberto={assinando}
        nome={operador}
        aoFechar={() => setAssinando(false)}
        aoConfirmar={async (png) => {
          try {
            const caminho = await enviarImagem(`ficha/${id}/${chave}/assinatura-${crypto.randomUUID()}.png`, png);
            setLinks((l) => ({ ...l, [caminho]: URL.createObjectURL(png) }));
            setAssinatura(caminho);
          } catch (e) {
            setErro(mensagemDeErro(e as Error));
          }
          setAssinando(false);
        }}
      />
      <Dialogo aberto={apagando} titulo={`Apagar o dia ${data(diaIso)}?`} aoFechar={() => setApagando(false)}>
        <div className="formulario formulario-largo">
          <p>As respostas deste dia saem da ficha. Fica registrado quem apagou.</p>
          <div className="linha-botoes">
            <button
              type="button"
              className="botao botao-perigo"
              onClick={async () => {
                try {
                  await salvarDiaFicha(id, n, null);
                  voltar(`Dia ${data(diaIso)} apagado.`);
                } catch (e) {
                  setApagando(false);
                  setErro(mensagemDeErro(e as Error));
                }
              }}
            >
              Apagar
            </button>
            <button type="button" className="botao botao-discreto" onClick={() => setApagando(false)}>Cancelar</button>
          </div>
        </div>
      </Dialogo>
    </Pagina>
  );
}
