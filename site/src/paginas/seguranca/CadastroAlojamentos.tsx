import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import type { ObraDoPainel } from '../../lib/painelObra';
import {
  criarAlojamento, juntarAlojamentos, lerCadastroAlojamentos, lerFornecedoresDaObra, salvarAlojamento,
  type AlojamentoCadastro, type Fornecedor,
} from '../../lib/seguranca';

const EMAIS = '__emais__';
const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Edicao = { id?: string; obra: string; empresa: string; nome: string; endereco: string; ativo: boolean; vistorias: number };

// Segurança da obra > Cadastro (administrativo): a lista oficial de alojamentos de cada obra, com fornecedor,
// nome e endereço. O TST só escolhe um alojamento desta lista em "Realizar inspeção".
export function CadastroAlojamentos({ obras }: { obras: ObraDoPainel[] }) {
  const [lista, setLista] = useState<AlojamentoCadastro[] | null>(null);
  const [obra, setObra] = useState('');
  const [busca, setBusca] = useState('');
  const [desativados, setDesativados] = useState(false);
  const [editando, setEditando] = useState<Edicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function carregar() {
    try {
      setLista(await lerCadastroAlojamentos());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }
  useEffect(() => {
    void carregar();
  }, []);

  const visiveis = useMemo(() => {
    const b = sem(busca.trim());
    return (lista ?? [])
      .filter((a) => (!obra || a.obra_id === obra) && (desativados || a.ativo))
      .filter((a) => !b || sem(`${a.nome} ${a.endereco ?? ''} ${a.empresa ?? 'emais'} ${a.empresa_a_vincular ?? ''}`).includes(b))
      .sort(
        (x, y) =>
          x.obra.localeCompare(y.obra, 'pt-BR') ||
          (x.empresa ?? x.empresa_a_vincular ?? 'zzz').localeCompare(y.empresa ?? y.empresa_a_vincular ?? 'zzz', 'pt-BR') ||
          x.nome.localeCompare(y.nome, 'pt-BR'),
      );
  }, [lista, obra, busca, desativados]);

  if (!lista && !erro) return <Carregando />;
  const ativos = (lista ?? []).filter((a) => a.ativo && (!obra || a.obra_id === obra));
  const semEndereco = ativos.filter((a) => !a.endereco?.trim()).length;
  const aVincular = ativos.filter((a) => a.empresa_a_vincular).length;

  async function salvo(m: string) {
    setEditando(null);
    setOk(m);
    setErro(null);
    await carregar();
  }

  return (
    <section className="bloco">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      <div className="barra-lista">
        <p className="apoio">
          Lista oficial dos alojamentos de cada obra. Em "Realizar inspeção" o TST só escolhe um alojamento daqui, então mantenha o nome e o endereço
          padronizados. Cadastro repetido se corrige com "Juntar", dentro de Editar.
        </p>
        <button
          type="button"
          className="botao botao-pequeno"
          onClick={() => setEditando({ obra: obra || (obras.length === 1 ? obras[0].id : ''), empresa: '', nome: '', endereco: '', ativo: true, vistorias: 0 })}
        >
          Cadastrar alojamento
        </button>
      </div>

      <div className="filtros">
        <label className="campo">
          <span>Obra</span>
          <select value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Todas as obras</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Buscar</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, endereço ou fornecedor" />
        </label>
        <label className="opcao">
          <input type="checkbox" checked={desativados} onChange={(e) => setDesativados(e.target.checked)} />
          <span>Mostrar desativados</span>
        </label>
      </div>

      {(semEndereco > 0 || aVincular > 0) && (
        <p className="aviso aviso-alerta">
          {[
            semEndereco ? `${semEndereco} ${semEndereco === 1 ? 'alojamento sem endereço' : 'alojamentos sem endereço'}` : '',
            aVincular ? `${aVincular} sem fornecedor vinculado (vieram do ObraCheck)` : '',
          ].filter(Boolean).join(' e ')}
          . Complete o cadastro em Editar.
        </p>
      )}

      {visiveis.length === 0 ? (
        <p className="vazio">{lista?.length ? 'Nenhum alojamento com esse filtro.' : 'Nenhum alojamento cadastrado ainda.'}</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                {!obra && <th scope="col">Obra</th>}
                <th scope="col">Fornecedor</th>
                <th scope="col">Alojamento</th>
                <th scope="col">Endereço</th>
                <th scope="col">Vistorias</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((a) => (
                <tr key={a.id} className={a.ativo ? undefined : 'linha-inativa'}>
                  {!obra && <td>{a.obra}</td>}
                  <td>
                    {a.empresa_a_vincular ? (
                      <span>
                        <span className="etiqueta etiqueta-alerta">a vincular</span> <small className="sub">ObraCheck: {a.empresa_a_vincular}</small>
                      </span>
                    ) : (
                      a.empresa ?? 'Emais'
                    )}
                  </td>
                  <th scope="row">
                    {a.nome}
                    {!a.ativo && <small className="sub">desativado</small>}
                  </th>
                  <td>{a.endereco?.trim() ? a.endereco : <span className="sub texto-alerta">sem endereço</span>}</td>
                  <td>{a.vistorias} {a.vistorias === 1 ? 'vistoria' : 'vistorias'}</td>
                  <td className="acoes">
                    <button
                      type="button"
                      className="botao botao-secundario botao-pequeno"
                      onClick={() =>
                        setEditando({ id: a.id, obra: a.obra_id, empresa: a.empresa_id ?? (a.empresa_a_vincular ? '' : EMAIS), nome: a.nome, endereco: a.endereco ?? '', ativo: a.ativo, vistorias: a.vistorias })
                      }
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditarCadastro
        edicao={editando}
        obras={obras}
        lista={lista ?? []}
        aoFechar={() => setEditando(null)}
        aoSalvar={salvo}
      />
    </section>
  );
}

function EditarCadastro({
  edicao, obras, lista, aoFechar, aoSalvar,
}: {
  edicao: Edicao | null;
  obras: ObraDoPainel[];
  lista: AlojamentoCadastro[];
  aoFechar: () => void;
  aoSalvar: (m: string) => Promise<void>;
}) {
  const [f, setF] = useState<Edicao | null>(null);
  const [fornecedores, setFornecedores] = useState<Fornecedor[] | null>(null);
  const [destino, setDestino] = useState('');
  const [confirmarJuntar, setConfirmarJuntar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setF(edicao);
    setDestino('');
    setConfirmarJuntar(false);
    setErro(null);
  }, [edicao]);

  const obraId = f?.obra ?? '';
  useEffect(() => {
    setFornecedores(null);
    if (!obraId) return;
    lerFornecedoresDaObra(obraId).then(setFornecedores).catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [obraId]);

  if (!f) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const original = f.id ? lista.find((a) => a.id === f.id) : undefined;
  const nomeObra = obras.find((o) => o.id === f.obra)?.nome ?? original?.obra ?? '';
  const repetido = lista.find((a) => a.id !== f.id && a.obra_id === f.obra && sem(a.nome.trim()) === sem(f.nome.trim()));
  const valido = !!f.obra && !!f.empresa && f.nome.trim().length > 0 && f.endereco.trim().length > 0 && !repetido;
  const outros = lista
    .filter((a) => a.id !== f.id && a.obra_id === f.obra)
    .sort((x, y) => (x.empresa ?? 'zzz').localeCompare(y.empresa ?? 'zzz', 'pt-BR') || x.nome.localeCompare(y.nome, 'pt-BR'));
  const opcoes = (fornecedores ?? []).filter((x) => x.ativo_na_obra || x.id === original?.empresa_id).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f || !valido) return;
    setSalvando(true);
    setErro(null);
    try {
      const empresaId = f.empresa === EMAIS ? null : f.empresa;
      if (f.id) await salvarAlojamento(f.id, { nome: f.nome, endereco: f.endereco, empresaId, ativo: f.ativo });
      else await criarAlojamento({ obraId: f.obra, nome: f.nome, endereco: f.endereco, empresaId });
      await aoSalvar(`Alojamento ${f.nome.trim()} ${f.id ? 'salvo' : 'cadastrado'}.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setSalvando(false);
    }
  }

  async function juntar() {
    if (!f?.id || !destino) return;
    const alvo = lista.find((a) => a.id === destino);
    setSalvando(true);
    setErro(null);
    try {
      const n = await juntarAlojamentos(f.id, destino);
      await aoSalvar(`${original?.nome ?? f.nome} foi juntado em ${alvo?.nome ?? 'outro alojamento'}: ${n} ${n === 1 ? 'vistoria passou' : 'vistorias passaram'} para ele.`);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
      setConfirmarJuntar(false);
    } finally {
      setSalvando(false);
    }
  }

  const alvoJuntar = lista.find((a) => a.id === destino);

  return (
    <Dialogo aberto titulo={f.id ? `Editar ${original?.nome ?? f.nome}` : 'Cadastrar alojamento'} aoFechar={aoFechar}>
      <form className="formulario formulario-largo" onSubmit={salvar}>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {original?.empresa_a_vincular && (
          <p className="aviso aviso-info">No ObraCheck este alojamento estava como <strong>{original.empresa_a_vincular}</strong>, que não existe no portal. Escolha o fornecedor.</p>
        )}
        {f.id ? (
          <p className="dica">Obra: <strong>{nomeObra}</strong></p>
        ) : (
          <label className="campo">
            <span>Obra</span>
            <select value={f.obra} onChange={(e) => setF({ ...f, obra: e.target.value, empresa: '' })} required>
              <option value="">Escolha a obra</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </label>
        )}
        <label className="campo">
          <span>Fornecedor responsável</span>
          <select value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} disabled={!f.obra || !fornecedores} required>
            <option value="">{f.obra && !fornecedores ? 'Carregando' : 'Escolha o fornecedor'}</option>
            {opcoes.map((x) => (
              <option key={x.id} value={x.id}>{x.nome}{x.ativo_na_obra ? '' : ' (fora da obra)'}</option>
            ))}
            <option value={EMAIS}>Emais (alojamento da própria Emais)</option>
          </select>
        </label>
        <label className="campo">
          <span>Nome do alojamento</span>
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: R P Santos, Casa 1" required />
        </label>
        {repetido && <p className="aviso aviso-alerta">Já existe {repetido.nome} nesta obra. Use outro nome ou junte os dois cadastros.</p>}
        <label className="campo">
          <span>Endereço</span>
          <input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} placeholder="Rua, número, bairro" required />
        </label>
        <p className="dica">Sugestão de padrão para o nome: fornecedor e número da casa (ex.: "R P Santos, Casa 1"). O fornecedor vê as vistorias concluídas do alojamento e responde os itens a corrigir.</p>
        {f.id && (
          <label className="opcao">
            <input type="checkbox" checked={!f.ativo} onChange={(e) => setF({ ...f, ativo: !e.target.checked })} />
            <span>Alojamento desativado (não aparece mais em Realizar inspeção; as vistorias ficam guardadas)</span>
          </label>
        )}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || salvando}>{salvando ? 'Salvando' : f.id ? 'Salvar' : 'Cadastrar'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>

        {f.id && outros.length > 0 && (
          <fieldset className="campo-grupo caixa">
            <legend>Juntar com outro alojamento (cadastro repetido)</legend>
            <p className="dica">
              {f.vistorias === 0
                ? `${original?.nome ?? f.nome} não tem vistoria: o cadastro é apagado e fica só o alojamento escolhido.`
                : `${f.vistorias === 1 ? 'A vistoria' : `As ${f.vistorias} vistorias`} de ${original?.nome ?? f.nome} ${f.vistorias === 1 ? 'passa' : 'passam'} para o alojamento escolhido e este cadastro é apagado.`}{' '}
              Antes, deixe o nome e o endereço certos no alojamento que vai ficar.
            </p>
            <label className="campo">
              <span>Fica o alojamento</span>
              <select value={destino} onChange={(e) => { setDestino(e.target.value); setConfirmarJuntar(false); }}>
                <option value="">Escolha o alojamento que fica</option>
                {outros.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome} ({a.empresa ?? (a.empresa_a_vincular ? 'a vincular' : 'Emais')}){a.endereco ? `, ${a.endereco}` : ''}</option>
                ))}
              </select>
            </label>
            {alvoJuntar && alvoJuntar.empresa_id !== original?.empresa_id && (
              <p className="aviso aviso-alerta">Os dois estão com fornecedores diferentes. Confira antes de juntar.</p>
            )}
            {!confirmarJuntar ? (
              <button type="button" className="botao botao-secundario" disabled={!destino || salvando} onClick={() => setConfirmarJuntar(true)}>Juntar</button>
            ) : (
              <div className="linha-botoes">
                <button type="button" className="botao botao-perigo" disabled={salvando} onClick={() => void juntar()}>
                  {salvando ? 'Juntando' : `Confirmar: apagar ${original?.nome ?? f.nome} e passar para ${alvoJuntar?.nome}`}
                </button>
                <button type="button" className="botao botao-discreto" onClick={() => setConfirmarJuntar(false)}>Voltar</button>
              </div>
            )}
          </fieldset>
        )}
      </form>
    </Dialogo>
  );
}
