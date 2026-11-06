import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TermoLgpd } from './TermoLgpd';
import { Dialogo } from './Dialogo';
import { mensagemDeErro } from '../lib/supabase';
import { data, diasAte, hojeIso, somarDias, tamanhoArquivo } from '../lib/formato';
import { enviarDocumento, problemaNoArquivo, type TipoDocumento } from '../lib/fornecedor';

export type PedidoDeEnvio = {
  tipo: TipoDocumento;
  empresaId: string;
  empresaNome: string;
  colaborador: { id: string; nome: string } | null;
  motivoDevolucao?: string | null;
};

const MAXIMO_ARQUIVOS = 5;

export function EnvioDocumento({ pedido, aoFechar, aoEnviar }: { pedido: PedidoDeEnvio | null; aoFechar: () => void; aoEnviar: (nome: string) => void }) {
  const [emissao, setEmissao] = useState('');
  const [vigencia, setVigencia] = useState('');
  const [dispensado, setDispensado] = useState(false);
  const [motivoDispensa, setMotivoDispensa] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEmissao('');
    setVigencia('');
    setDispensado(false);
    setMotivoDispensa('');
    setArquivos([]);
    setAceite(false);
    setErro(null);
    setProgresso(null);
  }, [pedido]);

  if (!pedido) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const t = pedido.tipo;

  const vencimentoCalculado = t.regra === 'emissao_mais_prazo' && emissao && t.validade_dias ? somarDias(emissao, t.validade_dias) : null;
  const diasRestantes = vencimentoCalculado ? diasAte(vencimentoCalculado) : vigencia ? diasAte(vigencia) : null;
  const emissaoFutura = !!emissao && emissao > hojeIso();

  const problemas = arquivos.map(problemaNoArquivo).filter((p): p is string => !!p);
  const datasOk = dispensado || (t.regra === 'emissao_mais_prazo' ? !!emissao && !emissaoFutura : t.regra === 'vigencia_informada' ? !!vigencia : true);
  const arquivosOk = dispensado ? true : arquivos.length > 0 && problemas.length === 0;
  const dispensaOk = !dispensado || motivoDispensa.trim().length >= 3;
  const pronto = datasOk && arquivosOk && dispensaOk && aceite;

  function adicionar(lista: FileList | null) {
    if (!lista) return;
    // Copia antes de limpar o campo: a FileList esvazia quando o valor do campo é zerado.
    const novos = Array.from(lista);
    setArquivos((atuais) => [...atuais, ...novos].slice(0, MAXIMO_ARQUIVOS));
    if (entrada.current) entrada.current.value = '';
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto || !pedido) return;
    setErro(null);
    setEnviando(true);
    try {
      await enviarDocumento({
        tipo: t.codigo,
        empresaId: pedido.empresaId,
        colaboradorId: pedido.colaborador?.id ?? null,
        dataEmissao: !dispensado && t.regra === 'emissao_mais_prazo' ? emissao : null,
        vencimento: !dispensado && t.regra === 'vigencia_informada' ? vigencia : null,
        dispensado,
        motivoDispensa: dispensado ? motivoDispensa.trim() : null,
        arquivos: dispensado ? [] : arquivos,
        aceiteLgpd: aceite,
        aoProgredir: (f, total) => setProgresso(`Enviando arquivo ${f} de ${total}`),
      });
      aoEnviar(t.nome);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
      setProgresso(null);
    }
  }

  const deQuem = pedido.colaborador ? pedido.colaborador.nome : pedido.empresaNome;

  return (
    <Dialogo aberto titulo={`Enviar ${t.nome}`} aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <p className="apoio">
          {pedido.colaborador ? 'Documento de ' : 'Documento da empresa '}
          <strong>{deQuem}</strong>
          {pedido.colaborador ? `, ${pedido.empresaNome}` : ''}.
        </p>

        {pedido.motivoDevolucao && (
          <p className="aviso aviso-alerta">
            <strong>Devolvido pela Emais.</strong> {pedido.motivoDevolucao}
          </p>
        )}

        {t.pode_dispensar && (
          <label className="opcao">
            <input type="checkbox" checked={dispensado} onChange={(e) => setDispensado(e.target.checked)} />
            <span>{/^nr\d+$/.test(t.codigo) ? 'Dispensar: o serviço deste colaborador não exige esta NR' : `Não se aplica ${pedido.colaborador ? 'a este colaborador' : 'a esta empresa'}`}</span>
          </label>
        )}

        {dispensado ? (
          <label className="campo">
            <span>{/^nr\d+$/.test(t.codigo) ? 'Justificativa da dispensa' : 'Por que não se aplica'}</span>
            <textarea
              rows={2}
              value={motivoDispensa}
              onChange={(e) => setMotivoDispensa(e.target.value)}
              placeholder={/^nr\d+$/.test(t.codigo) ? 'Ex.: o colaborador não trabalha em altura nesta obra' : 'Ex.: sócio da empresa, sem registro em carteira'}
            />
            <small className="dica">A Emais confere a justificativa antes de aceitar a dispensa.</small>
          </label>
        ) : (
          <>
            {t.regra === 'emissao_mais_prazo' && (
              <label className="campo campo-data">
                <span>Data de emissão do documento</span>
                <input type="date" value={emissao} max={hojeIso()} aria-invalid={emissaoFutura} onChange={(e) => setEmissao(e.target.value)} />
                {emissaoFutura && <small className="campo-erro">A data de emissão não pode ser futura.</small>}
                {vencimentoCalculado && !emissaoFutura && (
                  <small className={diasRestantes !== null && diasRestantes <= 0 ? 'campo-erro' : 'dica'}>
                    {diasRestantes !== null && diasRestantes <= 0
                      ? `Pela emissão, este documento venceu em ${data(vencimentoCalculado)}. Envie um documento atualizado.`
                      : `Vale até ${data(vencimentoCalculado)} (${t.validade_dias} dias a partir da emissão).`}
                  </small>
                )}
              </label>
            )}
            {t.regra === 'vigencia_informada' && (
              <label className="campo campo-data">
                <span>Vigência final</span>
                <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
                {vigencia && diasRestantes !== null && diasRestantes <= 0 && (
                  <small className="campo-erro">Esta vigência já terminou. Envie a apólice renovada.</small>
                )}
              </label>
            )}

            <div className="campo">
              <span>Arquivo</span>
              <small className="dica">PDF, JPG, PNG ou HEIC, até 10 MB cada. Se o documento tiver frente e verso, anexe os dois.</small>
              <label className="area-arquivo">
                <input
                  ref={entrada}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
                  multiple
                  onChange={(e) => adicionar(e.target.files)}
                />
                <span>{arquivos.length === 0 ? 'Escolher arquivo ou tirar foto' : 'Adicionar outro arquivo'}</span>
              </label>
              {arquivos.length > 0 && (
                <ul className="arquivos-escolhidos">
                  {arquivos.map((a, i) => (
                    <li key={`${a.name}-${i}`}>
                      <span>
                        {a.name} <span className="sub">{tamanhoArquivo(a.size)}</span>
                      </span>
                      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setArquivos((l) => l.filter((_, j) => j !== i))}>
                        Tirar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {problemas.map((p) => (
                <small key={p} className="campo-erro">{p}</small>
              ))}
            </div>
          </>
        )}

        <TermoLgpd
          marcado={aceite}
          aoMudar={setAceite}
          observacao={t.codigo === 'aso' || t.codigo === 'aso_demissional' ? 'O ASO contém dado de saúde e fica restrito ao administrativo da Emais.' : undefined}
        />

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {progresso && <p className="aviso aviso-ok" role="status">{progresso}</p>}

        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!pronto || enviando}>
            {enviando ? 'Enviando' : 'Enviar para a Emais'}
          </button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
