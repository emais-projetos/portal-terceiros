import { useEffect, useState, type FormEvent } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Dialogo } from '../../componentes/Dialogo';
import { EnvioDocumento, type PedidoDeEnvio } from '../../componentes/EnvioDocumento';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { cnpjValido, ordemSituacao, soDigitos } from '../../lib/formato';
import { cadastrarSubcontratada, lerDocumentosDaEmpresa, type DocumentoEmpresa, type MinhaEmpresa } from '../../lib/fornecedor';
import { useFornecedor } from '../../lib/useFornecedor';
import { ItemPendencia } from './OQueFalta';

export function DocumentosEmpresa() {
  const { dados, erro, setErro, recarregar } = useFornecedor();
  const [docs, setDocs] = useState<Map<string, DocumentoEmpresa[]> | null>(null);
  const [pedido, setPedido] = useState<PedidoDeEnvio | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [subAberta, setSubAberta] = useState(false);

  useEffect(() => {
    if (!dados) return;
    Promise.all(dados.empresas.map(async (e) => [e.id, await lerDocumentosDaEmpresa(e, dados.tipos)] as const))
      .then((pares) => setDocs(new Map(pares)))
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [dados, setErro]);

  return (
    <Pagina
      titulo="Documentos da empresa"
      apoio="Valem para todos os colaboradores da empresa. Mantenha em dia para não travar as liberações."
      acoes={dados && dados.empresas.some((e) => e.obras.length > 0) ? (
        <button type="button" className="botao botao-secundario" onClick={() => setSubAberta(true)}>Inserir subcontratada</button>
      ) : undefined}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {(!dados || !docs) && !erro && <Carregando />}

      {dados && docs && dados.empresas.map((empresa) => (
        <section key={empresa.id} className="bloco">
          <h2 className="bloco-titulo">
            {empresa.razao_social} <span className="sub">{formatarCnpj(empresa.cnpj)}</span>
            {empresa.obras.some((o) => o.subcontratada) && <span className="selo selo-aprovado_admin">Subcontratada</span>}
          </h2>
          {empresa.obras.some((o) => o.subcontratada) && (
            <p className="dica">O contrato de serviço entre as partes é obrigatório para liberar os colaboradores da subcontratada.</p>
          )}
          <ul className="lista-pendencias">
            {(docs.get(empresa.id) ?? [])
              .slice()
              .sort((a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || a.tipo.ordem - b.tipo.ordem)
              .map((d) => (
                <li key={d.tipo.codigo}>
                  <ItemPendencia
                    nome={d.tipo.nome}
                    situacao={d.situacao}
                    impeditivo={d.tipo.impeditivo}
                    vencimento={d.vencimento}
                    motivo={d.motivo_devolucao}
                    renovacaoEmAnalise={d.renovacaoEmAnalise}
                    aoEnviar={() => setPedido({ tipo: d.tipo, empresaId: empresa.id, empresaNome: empresa.razao_social, colaborador: null, motivoDevolucao: d.motivo_devolucao })}
                  />
                </li>
              ))}
          </ul>
        </section>
      ))}

      {dados && (
        <NovaSubcontratada
          aberto={subAberta}
          empresas={dados.empresas.filter((e) => e.obras.length > 0)}
          aoFechar={() => setSubAberta(false)}
          aoCriar={async (nome) => {
            setSubAberta(false);
            setOk(`${nome} cadastrada como subcontratada. Envie os documentos dela abaixo, inclusive o contrato entre as partes, e cadastre os colaboradores em Colaboradores.`);
            setDocs(null);
            await recarregar();
          }}
        />
      )}

      <EnvioDocumento
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (nome) => {
          setPedido(null);
          setOk(`${nome} enviado. A Emais confere e você acompanha por aqui.`);
          setDocs(null);
          await recarregar();
        }}
      />
    </Pagina>
  );
}

// Subcontratada: entra no mesmo login, nas obras escolhidas, com o contrato entre as partes obrigatório.
function NovaSubcontratada({
  aberto, empresas, aoFechar, aoCriar,
}: {
  aberto: boolean;
  empresas: MinhaEmpresa[];
  aoFechar: () => void;
  aoCriar: (nome: string) => void;
}) {
  const [principal, setPrincipal] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [razao, setRazao] = useState('');
  const [email, setEmail] = useState('');
  const [obras, setObras] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setPrincipal(empresas.length === 1 ? empresas[0].id : '');
    setCnpj('');
    setRazao('');
    setEmail('');
    setObras([]);
    setErro(null);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const empresa = empresas.find((e) => e.id === principal);
  const digitos = soDigitos(cnpj);
  const cnpjOk = cnpjValido(digitos);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valido = !!empresa && cnpjOk && razao.trim().length >= 3 && emailOk && obras.length > 0;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido || !empresa) return;
    setErro(null);
    setEnviando(true);
    try {
      await cadastrarSubcontratada({ principal: empresa.id, cnpj: digitos, razao_social: razao.trim(), email: email.trim(), obras });
      aoCriar(razao.trim().toUpperCase());
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Inserir empresa subcontratada" aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <p className="apoio">
          A subcontratada fica no seu acesso: você envia os documentos dela e cadastra os colaboradores dela. Para liberar os colaboradores, o
          contrato de serviço entre as partes é obrigatório.
        </p>
        {empresas.length > 1 && (
          <label className="campo">
            <span>Empresa que subcontrata</span>
            <select value={principal} onChange={(e) => { setPrincipal(e.target.value); setObras([]); }}>
              <option value="">Escolha a empresa</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
            </select>
          </label>
        )}
        <div className="grade-2">
          <label className="campo">
            <span>CNPJ da subcontratada</span>
            <input inputMode="numeric" placeholder="00.000.000/0000-00" value={cnpj} aria-invalid={digitos.length === 14 && !cnpjOk} onChange={(e) => setCnpj(e.target.value)} />
            {digitos.length === 14 && !cnpjOk && <small className="campo-erro">CNPJ inválido. Confira os números.</small>}
          </label>
          <label className="campo">
            <span>Razão social</span>
            <input value={razao} onChange={(e) => setRazao(e.target.value)} autoComplete="off" />
          </label>
        </div>
        <label className="campo">
          <span>E-mail de contato da subcontratada</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {empresa && (
          <div className="campo">
            <span>Obras onde a subcontratada vai trabalhar</span>
            <ul className="lista-marcar lista-curta">
              {empresa.obras.map((o) => (
                <li key={o.id}>
                  <label>
                    <input type="checkbox" checked={obras.includes(o.id)} onChange={() => setObras((l) => (l.includes(o.id) ? l.filter((x) => x !== o.id) : [...l, o.id]))} />
                    <span>{o.nome}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>{enviando ? 'Cadastrando' : 'Cadastrar subcontratada'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
