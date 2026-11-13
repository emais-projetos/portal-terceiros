import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { data } from '../../lib/formato';
import type { MinhaEmpresa } from '../../lib/fornecedor';
import { informarContrato, lerContratos, lerObrasAtivas, lerPedidosObra, pedirObra, type PedidoObra } from '../../lib/ajuda';

// Fornecedor: número do contrato em cada obra e pedido para atuar em outra obra (a Emais aprova).
export function ObrasEContratos({ aberto, empresas, aoFechar, aoMudar }: { aberto: boolean; empresas: MinhaEmpresa[]; aoFechar: () => void; aoMudar: () => void }) {
  const [contratos, setContratos] = useState<Map<string, string | null> | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [pedidos, setPedidos] = useState<PedidoObra[]>([]);
  const [obras, setObras] = useState<{ id: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);

  const carregar = useCallback(async () => {
    const [c, p, o] = await Promise.all([lerContratos(), lerPedidosObra(), lerObrasAtivas()]);
    setContratos(c);
    setPedidos(p);
    setObras(o);
    setRascunho(Object.fromEntries([...c.entries()].map(([k, v]) => [k, v ?? ''])));
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setOk(null);
    setPedindo(false);
    carregar().catch((e) => setErro(mensagemDeErro(e)));
  }, [aberto, carregar]);

  async function salvarContrato(empresaId: string, obraId: string, obra: string) {
    const chave = `${empresaId}|${obraId}`;
    setErro(null);
    setOk(null);
    setOcupado(chave);
    try {
      await informarContrato(empresaId, obraId, rascunho[chave] ?? '');
      setOk(`Contrato da obra ${obra} salvo.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  const pendentes = pedidos.filter((p) => p.situacao === 'pendente');
  const recentes = pedidos.filter((p) => p.situacao !== 'pendente').slice(0, 5);

  return (
    <Dialogo aberto={aberto} titulo="Obras e contratos" aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {ok && <p className="aviso aviso-ok" role="status">{ok}</p>}
        {!contratos && !erro && <Carregando />}
        {contratos && (
          <>
            <p className="apoio">Informe o número do contrato com a Emais em cada obra. Para trabalhar em outra obra, peça o acesso abaixo: a Emais confere e libera.</p>
            {empresas.map((e) => (
              <section key={e.id}>
                {empresas.length > 1 && <h3 className="detalhe-subtitulo">{e.razao_social}</h3>}
                {e.obras.length === 0 ? (
                  <p className="sub">Ainda não atua em nenhuma obra.</p>
                ) : (
                  <ul className="lista-simples">
                    {e.obras.map((o) => {
                      const chave = `${e.id}|${o.id}`;
                      const salvo = contratos.get(chave) ?? '';
                      const atual = rascunho[chave] ?? '';
                      return (
                        <li key={o.id}>
                          <span>
                            <strong>{o.nome}</strong>
                            {!salvo && <small className="sub texto-alerta">Contrato não informado</small>}
                          </span>
                          <form
                            className="em-linha"
                            onSubmit={(ev) => {
                              ev.preventDefault();
                              salvarContrato(e.id, o.id, o.nome);
                            }}
                          >
                            <label className="campo campo-compacto">
                              <span className="sr">Número do contrato em {o.nome}</span>
                              <input
                                placeholder="Número do contrato"
                                value={atual}
                                maxLength={60}
                                onChange={(ev) => setRascunho((r) => ({ ...r, [chave]: ev.target.value }))}
                              />
                            </label>
                            <button className="botao botao-secundario botao-pequeno" type="submit" disabled={atual.trim() === salvo || ocupado === chave}>
                              {ocupado === chave ? 'Salvando' : 'Salvar'}
                            </button>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}

            <h3 className="detalhe-subtitulo">Pedidos de acesso a outra obra</h3>
            {pendentes.length === 0 && recentes.length === 0 && <p className="sub">Nenhum pedido feito.</p>}
            {(pendentes.length > 0 || recentes.length > 0) && (
              <ul className="lista-simples">
                {[...pendentes, ...recentes].map((p) => (
                  <li key={p.id}>
                    <span>
                      <strong>{p.obras?.nome}</strong>
                      {empresas.length > 1 && <small className="sub">{p.empresas?.razao_social}</small>}
                      {p.situacao === 'recusado' && p.motivo_recusa && <small className="sub">Motivo: {p.motivo_recusa}</small>}
                    </span>
                    <span className={`selo ${p.situacao === 'aprovado' ? 'selo-liberado' : p.situacao === 'recusado' ? 'selo-pendente_fornecedor' : 'selo-em_analise'}`}>
                      {p.situacao === 'pendente' ? `Aguardando a Emais desde ${data(p.pedido_em)}` : p.situacao === 'aprovado' ? 'Aprovado' : 'Não aprovado'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {pedindo ? (
              <PedidoNovo
                empresas={empresas}
                obras={obras}
                pendentes={pendentes}
                aoCancelar={() => setPedindo(false)}
                aoPedir={async (empresaId, obraId, contrato, obs) => {
                  setErro(null);
                  setOk(null);
                  try {
                    await pedirObra(empresaId, obraId, contrato, obs);
                    setOk('Pedido enviado. A Emais responde pela Ajuda, no canto da tela.');
                    setPedindo(false);
                    await carregar();
                    aoMudar();
                  } catch (e) {
                    setErro(mensagemDeErro(e as Error));
                  }
                }}
              />
            ) : (
              <div className="linha-botoes">
                <button className="botao botao-secundario" type="button" onClick={() => setPedindo(true)}>Pedir acesso a outra obra</button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialogo>
  );
}

function PedidoNovo({
  empresas, obras, pendentes, aoCancelar, aoPedir,
}: {
  empresas: MinhaEmpresa[];
  obras: { id: string; nome: string }[];
  pendentes: PedidoObra[];
  aoCancelar: () => void;
  aoPedir: (empresaId: string, obraId: string, contrato: string, observacao: string) => Promise<void>;
}) {
  const [empresaId, setEmpresaId] = useState(empresas.length === 1 ? empresas[0].id : '');
  const [obraId, setObraId] = useState('');
  const [contrato, setContrato] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const empresa = empresas.find((e) => e.id === empresaId);
  // Só as obras em que a empresa ainda não atua e sem pedido aguardando.
  const livres = obras.filter((o) => empresa && !empresa.obras.some((x) => x.id === o.id) && !pendentes.some((p) => p.empresa_id === empresaId && p.obra_id === o.id));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!empresaId || !obraId) return;
    setEnviando(true);
    try {
      await aoPedir(empresaId, obraId, contrato, obs);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="formulario caixa-destaque" onSubmit={enviar}>
      {empresas.length > 1 && (
        <label className="campo">
          <span>Empresa</span>
          <select value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setObraId(''); }}>
            <option value="">Escolha a empresa</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
          </select>
        </label>
      )}
      <div className="grade-2">
        <label className="campo">
          <span>Obra</span>
          <select value={obraId} disabled={!empresa} onChange={(e) => setObraId(e.target.value)}>
            <option value="">{empresa && livres.length === 0 ? 'Nenhuma obra disponível' : 'Escolha a obra'}</option>
            {livres.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Número do contrato (se já tiver)</span>
          <input value={contrato} maxLength={60} onChange={(e) => setContrato(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        <span>Observação (opcional)</span>
        <textarea rows={2} maxLength={500} placeholder="Ex.: serviço de pintura a partir de dezembro" value={obs} onChange={(e) => setObs(e.target.value)} />
      </label>
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!empresaId || !obraId || enviando}>{enviando ? 'Enviando' : 'Enviar pedido'}</button>
        <button className="botao botao-discreto" type="button" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
