import { useEffect, useState, type FormEvent } from 'react';
import { Dialogo } from './Dialogo';
import { data, hojeIso } from '../lib/formato';
import { mensagemDeErro } from '../lib/supabase';
import { corrigirDocumento, desfazerDispensa, dispensarDocumento, type DocumentoAjuste } from '../lib/admin';

export type Ajuste =
  | { modo: 'corrigir'; doc: DocumentoAjuste; colaborador: string | null }
  | { modo: 'dispensar'; tipo: string; nome: string; grupo: DocumentoAjuste['grupo']; empresaId: string; empresa: string; colaboradorId: string | null; colaborador: string | null }
  | { modo: 'desfazer'; doc: DocumentoAjuste; colaborador: string | null };

function somarDiasIso(iso: string, dias: number) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Administrativo: corrigir a data de um documento (e aprovar, se estiver em análise ou devolvido), dispensar um
// documento que não se aplica ou desfazer a dispensa. Tudo com motivo, que fica no histórico.
export function AjusteDocumento({ ajuste, aoFechar, aoConcluir }: { ajuste: Ajuste | null; aoFechar: () => void; aoConcluir: (mensagem: string) => Promise<void> | void }) {
  const [emissao, setEmissao] = useState('');
  const [vigencia, setVigencia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setErro(null);
    setMotivo('');
    if (ajuste?.modo === 'corrigir') {
      setEmissao(ajuste.doc.data_emissao ?? '');
      setVigencia(ajuste.doc.data_vencimento_informada ?? '');
    }
  }, [ajuste]);

  if (!ajuste) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const quem = ajuste.colaborador ? ` de ${ajuste.colaborador}` : '';

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!ajuste) return;
    setEnviando(true);
    setErro(null);
    try {
      if (ajuste.modo === 'corrigir') {
        const d = ajuste.doc;
        const aprova = d.status === 'em_analise' || d.status === 'devolvido';
        await corrigirDocumento(d.id, emissao || null, d.regra === 'emissao_mais_prazo' ? null : vigencia || null, motivo.trim(), true);
        await aoConcluir(`${d.nome}${quem}: data corrigida${aprova ? ' e documento aprovado' : ''}.`);
      } else if (ajuste.modo === 'dispensar') {
        await dispensarDocumento(ajuste.empresaId, ajuste.grupo === 'empresa' ? null : ajuste.colaboradorId, ajuste.tipo, motivo.trim());
        await aoConcluir(ajuste.grupo === 'empresa' ? `${ajuste.nome} dispensado para todos os colaboradores de ${ajuste.empresa}.` : `${ajuste.nome}${quem} dispensado.`);
      } else {
        await desfazerDispensa(ajuste.doc.id, motivo.trim());
        await aoConcluir(`Dispensa de ${ajuste.doc.nome}${quem} desfeita: o documento volta a ser exigido.`);
      }
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  if (ajuste.modo === 'corrigir') {
    const d = ajuste.doc;
    const aprova = d.status === 'em_analise' || d.status === 'devolvido';
    const venc =
      d.regra === 'emissao_mais_prazo' ? (emissao && d.validade_dias ? somarDiasIso(emissao, d.validade_dias) : null) : vigencia || null;
    const antes =
      d.regra === 'emissao_mais_prazo' ? (d.data_emissao && d.validade_dias ? somarDiasIso(d.data_emissao, d.validade_dias) : null) : d.data_vencimento_informada;
    const valido = motivo.trim().length >= 5 && (d.regra !== 'emissao_mais_prazo' || !!emissao) && (d.regra !== 'vigencia_informada' || !!vigencia);
    return (
      <Dialogo aberto titulo={`${aprova ? 'Corrigir e aprovar' : 'Corrigir'}: ${d.nome}${quem}`} aoFechar={aoFechar}>
        <form className="formulario formulario-largo" onSubmit={enviar}>
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <p className="dica">
            {d.status === 'devolvido' ? 'Documento devolvido ao fornecedor. ' : d.status === 'em_analise' ? 'Documento em análise. ' : 'Documento aprovado. '}
            {d.regra === 'emissao_mais_prazo'
              ? `O vencimento é calculado pela emissão (${d.validade_dias} dias).`
              : d.regra === 'vigencia_informada'
                ? 'O vencimento é a vigência final informada.'
                : 'Não vence, a não ser que a vigência seja informada.'}
          </p>
          <div className="grade-2">
            <label className="campo">
              <span>Data de emissão</span>
              <input type="date" value={emissao} max={hojeIso()} onChange={(e) => setEmissao(e.target.value)} required={d.regra === 'emissao_mais_prazo'} />
            </label>
            {d.regra !== 'emissao_mais_prazo' && (
              <label className="campo">
                <span>Vigência final{d.regra === 'sem_vencimento' ? ' (opcional)' : ''}</span>
                <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} required={d.regra === 'vigencia_informada'} />
              </label>
            )}
          </div>
          <p className="sub">
            Vencimento: {antes ? data(antes) : 'não vence'} → <strong>{venc ? data(venc) : 'não vence'}</strong>
          </p>
          <label className="campo">
            <span>Motivo da correção</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: data de emissão digitada errada; conferida no documento" />
          </label>
          <p className="dica">Fica no histórico do documento, com a data antiga e a nova.{aprova ? ' O documento sai aprovado, sem voltar ao fornecedor.' : ''}</p>
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={!valido || enviando}>{enviando ? 'Salvando' : aprova ? 'Corrigir e aprovar' : 'Salvar correção'}</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      </Dialogo>
    );
  }

  if (ajuste.modo === 'desfazer') {
    return (
      <Dialogo aberto titulo={`Desfazer dispensa: ${ajuste.doc.nome}${quem}`} aoFechar={aoFechar}>
        <form className="formulario formulario-largo" onSubmit={enviar}>
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
          <p className="dica">
            Dispensado{ajuste.doc.dispensado_por ? ` por ${ajuste.doc.dispensado_por}` : ' a pedido do fornecedor'}
            {ajuste.doc.data_emissao ? ` em ${data(ajuste.doc.data_emissao)}` : ''}. Motivo: {ajuste.doc.motivo_dispensa ?? 'não informado'}.
          </p>
          <p className="dica">O documento volta a ser exigido e aparece como pendência para o fornecedor.</p>
          <label className="campo">
            <span>Motivo</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: colaborador mudou de função" />
          </label>
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={motivo.trim().length < 5 || enviando}>{enviando ? 'Salvando' : 'Desfazer dispensa'}</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      </Dialogo>
    );
  }

  return (
    <Dialogo aberto titulo={`Dispensar: ${ajuste.nome}${ajuste.grupo === 'empresa' ? '' : quem}`} aoFechar={aoFechar}>
      <form className="formulario formulario-largo" onSubmit={enviar}>
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {ajuste.grupo === 'empresa' ? (
          <p className="aviso aviso-alerta">
            {ajuste.nome} é documento da empresa: a dispensa vale para <strong>todos os colaboradores de {ajuste.empresa}</strong>, em todas as obras.
          </p>
        ) : (
          <p className="dica">A pendência sai e o documento aparece como dispensado pela Emais, com o motivo. Dá para desfazer depois.</p>
        )}
        <label className="campo">
          <span>Motivo da dispensa</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: colaborador administrativo, não sobe em altura" />
        </label>
        <p className="dica">Fica registrado com o seu nome e a data. Hoje: {data(hojeIso())}.</p>
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={motivo.trim().length < 5 || enviando}>{enviando ? 'Salvando' : 'Dispensar'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
