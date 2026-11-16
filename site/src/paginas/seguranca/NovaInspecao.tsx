import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialogo } from '../../componentes/Dialogo';
import { mensagemDeErro } from '../../lib/supabase';
import { hojeIso } from '../../lib/formato';
import {
  abrirFicha, criarAlojamento, criarMaquina, criarVistoria, salvarLocadora,
  type Alojamento, type Fornecedor, type Locadora, type Maquina, type Modelo, type Responsavel,
} from '../../lib/seguranca';

type Tipo = 'alojamento' | 'maquina' | 'canteiro';
const NOVO = '__novo__';

function agoraHora() {
  return new Date().toTimeString().slice(0, 5);
}

// "Realizar inspeção": escolhe o tipo e o que vai ser inspecionado (ou cadastra na hora) e abre o formulário.
export function NovaInspecao({
  aberto, obraId, obraNome, alojamentos, maquinas, modelos, fornecedores, locadoras, tst, aoFechar,
}: {
  aberto: boolean;
  obraId: string;
  obraNome: string;
  alojamentos: Alojamento[];
  maquinas: Maquina[];
  modelos: Modelo[];
  fornecedores: Fornecedor[];
  locadoras: Locadora[];
  tst: string;
  aoFechar: () => void;
}) {
  const navegar = useNavigate();
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [alvo, setAlvo] = useState('');
  const [dia, setDia] = useState(hojeIso());
  const [hora, setHora] = useState(agoraHora());
  // Novo alojamento
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  // Nova máquina
  const [modelo, setModelo] = useState('');
  const [identificacao, setIdentificacao] = useState('');
  // Responsável (novo cadastro)
  const [resp, setResp] = useState<'' | Responsavel['tipo']>('');
  const [empresa, setEmpresa] = useState('');
  const [locadora, setLocadora] = useState('');
  const [novaLocadora, setNovaLocadora] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setTipo(null);
    setAlvo('');
    setDia(hojeIso());
    setHora(agoraHora());
    setNome('');
    setEndereco('');
    setModelo('');
    setIdentificacao('');
    setResp('');
    setEmpresa('');
    setLocadora('');
    setNovaLocadora('');
    setErro(null);
  }, [aberto]);

  const modelosMaquina = modelos.filter((m) => m.grupo === 'maquina');
  const modeloAlojamento = modelos.find((m) => m.codigo === 'alojamento');
  const temCanteiro = modelos.some((m) => m.grupo === 'canteiro');
  const ativosAloj = alojamentos.filter((a) => a.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const nomeModelo = (c: string) => modelos.find((m) => m.codigo === c)?.nome ?? c;
  const ativasMaq = maquinas
    .filter((m) => m.ativo)
    .sort((a, b) => nomeModelo(a.modelo_codigo).localeCompare(nomeModelo(b.modelo_codigo), 'pt-BR') || a.identificacao.localeCompare(b.identificacao, 'pt-BR'));
  const fornecedoresAtivos = fornecedores.filter((f) => f.ativo_na_obra);
  const novo = alvo === NOVO;

  const respOk =
    resp === 'emais' || (resp === 'fornecedor' && !!empresa) || (resp === 'locadora' && (locadora === NOVO ? novaLocadora.trim().length > 1 : !!locadora));
  const valido =
    !!dia &&
    !!alvo &&
    (!novo || (tipo === 'alojamento' ? nome.trim().length > 0 && (resp === 'emais' || (resp === 'fornecedor' && !!empresa)) : !!modelo && identificacao.trim().length > 0 && respOk));

  async function responsavel(): Promise<Responsavel> {
    if (resp === 'fornecedor') return { tipo: 'fornecedor', id: empresa };
    if (resp === 'locadora') return { tipo: 'locadora', id: locadora === NOVO ? (await salvarLocadora({ nome: novaLocadora, cnpj: '', telefone: '' })).id : locadora };
    return { tipo: 'emais' };
  }

  async function iniciar(e: FormEvent) {
    e.preventDefault();
    if (!valido || !tipo) return;
    setEnviando(true);
    setErro(null);
    try {
      if (tipo === 'alojamento') {
        const alojamentoId = novo ? await criarAlojamento({ obraId, nome, endereco, empresaId: resp === 'fornecedor' ? empresa : null }) : alvo;
        const id = await criarVistoria({ obraId, alojamentoId, modelo: modeloAlojamento!, data: dia, horario: hora, tst });
        navegar(`/seguranca/vistoria/${id}`);
      } else {
        const maquinaId = novo ? await criarMaquina({ obraId, modelo, identificacao, responsavel: await responsavel() }) : alvo;
        const fichaId = await abrirFicha(maquinaId, dia);
        navegar(`/seguranca/ficha/${fichaId}/dia/${Number(dia.slice(8, 10))}`);
      }
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Realizar inspeção" aoFechar={aoFechar}>
      <form className="formulario formulario-largo" onSubmit={iniciar}>
        <p className="dica">Obra: <strong>{obraNome}</strong></p>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <div className="tipos-inspecao" role="radiogroup" aria-label="O que vai ser inspecionado">
          {([
            ['alojamento', 'Alojamento', 'Vistoria NR-18 com fotos e assinatura dos moradores'],
            ['maquina', 'Máquina', 'Checklist do dia, que entra na ficha mensal da máquina'],
            ['canteiro', 'Canteiro', temCanteiro ? 'Checklist do canteiro de obras' : 'Checklist ainda não cadastrado'],
          ] as const).map(([t, rotulo, sub]) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              disabled={t === 'canteiro' && !temCanteiro}
              className="tipo-inspecao"
              onClick={() => {
                setTipo(t);
                setAlvo('');
                setResp('');
              }}
            >
              <strong>{rotulo}</strong>
              <small>{sub}</small>
            </button>
          ))}
        </div>

        {tipo === 'alojamento' && (
          <>
            <label className="campo">
              <span>Alojamento</span>
              <select value={alvo} onChange={(e) => setAlvo(e.target.value)} required>
                <option value="">Escolha o alojamento</option>
                {ativosAloj.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                <option value={NOVO}>+ Cadastrar novo alojamento</option>
              </select>
            </label>
            {novo && (
              <div className="caixa">
                <label className="campo">
                  <span>Nome do alojamento</span>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Casa 3, Rua das Flores" />
                </label>
                <label className="campo">
                  <span>Endereço</span>
                  <input value={endereco} onChange={(e) => setEndereco(e.target.value)} />
                </label>
                <fieldset className="campo-grupo opcoes-empilhadas">
                  <legend>Quem responde pelo alojamento</legend>
                  <label className="opcao"><input type="radio" name="novo-resp" checked={resp === 'fornecedor'} onChange={() => setResp('fornecedor')} /><span>Fornecedor da obra</span></label>
                  {resp === 'fornecedor' && (
                    <label className="campo">
                      <span className="sr">Fornecedor</span>
                      <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                        <option value="">Escolha o fornecedor</option>
                        {fornecedoresAtivos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="opcao"><input type="radio" name="novo-resp" checked={resp === 'emais'} onChange={() => setResp('emais')} /><span>Emais</span></label>
                </fieldset>
              </div>
            )}
          </>
        )}

        {tipo === 'maquina' && (
          <>
            <label className="campo">
              <span>Máquina</span>
              <select value={alvo} onChange={(e) => setAlvo(e.target.value)} required>
                <option value="">Escolha a máquina</option>
                {ativasMaq.map((m) => <option key={m.id} value={m.id}>{nomeModelo(m.modelo_codigo)}, {m.identificacao}</option>)}
                <option value={NOVO}>+ Cadastrar máquina nova na obra</option>
              </select>
            </label>
            {novo && (
              <div className="caixa">
                <label className="campo">
                  <span>Tipo de máquina</span>
                  <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                    <option value="">Escolha o tipo</option>
                    {modelosMaquina.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
                  </select>
                </label>
                <label className="campo">
                  <span>Identificação (placa, frota ou número de série)</span>
                  <input value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} />
                </label>
                <fieldset className="campo-grupo opcoes-empilhadas">
                  <legend>De quem é a máquina</legend>
                  <label className="opcao"><input type="radio" name="novo-resp-m" checked={resp === 'fornecedor'} onChange={() => setResp('fornecedor')} /><span>De um terceiro da obra</span></label>
                  {resp === 'fornecedor' && (
                    <label className="campo">
                      <span className="sr">Fornecedor</span>
                      <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                        <option value="">Escolha o fornecedor</option>
                        {fornecedoresAtivos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="opcao"><input type="radio" name="novo-resp-m" checked={resp === 'locadora'} onChange={() => setResp('locadora')} /><span>De uma locadora de equipamentos</span></label>
                  {resp === 'locadora' && (
                    <label className="campo">
                      <span className="sr">Locadora</span>
                      <select value={locadora} onChange={(e) => setLocadora(e.target.value)}>
                        <option value="">Escolha a locadora</option>
                        {locadoras.filter((l) => l.ativo).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                        <option value={NOVO}>+ Cadastrar locadora</option>
                      </select>
                    </label>
                  )}
                  {resp === 'locadora' && locadora === NOVO && (
                    <label className="campo">
                      <span>Nome da locadora</span>
                      <input value={novaLocadora} onChange={(e) => setNovaLocadora(e.target.value)} />
                    </label>
                  )}
                  <label className="opcao"><input type="radio" name="novo-resp-m" checked={resp === 'emais'} onChange={() => setResp('emais')} /><span>Da Emais</span></label>
                </fieldset>
              </div>
            )}
          </>
        )}

        {(tipo === 'alojamento' || tipo === 'maquina') && (
          <div className="grade-2">
            <label className="campo">
              <span>Data</span>
              <input type="date" max={hojeIso()} value={dia} onChange={(e) => setDia(e.target.value)} required />
            </label>
            {tipo === 'alojamento' && (
              <label className="campo">
                <span>Horário</span>
                <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              </label>
            )}
          </div>
        )}

        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!tipo || !valido || enviando}>{enviando ? 'Abrindo' : 'Abrir formulário'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
