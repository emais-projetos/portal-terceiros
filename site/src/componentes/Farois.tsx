import type { ReactNode } from 'react';
import { rotuloCor, type Cor, type Frente } from '../lib/farois';

// Peças visuais dos faróis, usadas no painel da obra (engenharia, TST, administrativo) e na tela do fornecedor.

export function Farol({ cor, grande = false, rotulo }: { cor: Cor; grande?: boolean; rotulo?: string }) {
  return (
    <span
      className={`farol farol-${cor}${grande ? ' farol-grande' : ''}`}
      {...(rotulo ? { role: 'img', 'aria-label': rotulo } : { 'aria-hidden': true })}
    />
  );
}

export function SeloFrente({ nome, cor }: { nome: string; cor: Cor }) {
  return (
    <span className={`selo-farol selo-farol-${cor}`}>
      <Farol cor={cor} />
      {nome}
      <span className="sr">: {rotuloCor[cor]}</span>
    </span>
  );
}

export function LegendaFarois({ amarelo = 'Pendência: clique para ver' }: { amarelo?: string }) {
  return (
    <ul className="legenda-farois" aria-label="Legenda dos faróis">
      <li><Farol cor="verde" />OK</li>
      <li><Farol cor="amarelo" />{amarelo}</li>
      <li><Farol cor="vermelho" />Bloqueio: pagamento retido ou documento faltando</li>
      <li><Farol cor="cinza" />Não se aplica</li>
    </ul>
  );
}

export function ResumoFarois({ contagem }: { contagem: Record<Cor, number> }) {
  return (
    <div className="resumo-farois">
      <div className="resumo-farol resumo-vermelho">
        <span className="resumo-rotulo">Bloqueio</span>
        <strong>{contagem.vermelho}</strong>
        <span>pagamento retido ou colaborador liberado com documento faltando</span>
      </div>
      <div className="resumo-farol resumo-amarelo">
        <span className="resumo-rotulo">Com pendência</span>
        <strong>{contagem.amarelo}</strong>
        <span>ainda dá para resolver sem bloquear</span>
      </div>
      <div className="resumo-farol resumo-verde">
        <span className="resumo-rotulo">Tudo certo</span>
        <strong>{contagem.verde}</strong>
        <span>documentos, integração e medição em dia</span>
      </div>
    </div>
  );
}

// Uma linha (empresa ou obra) que abre o detalhe ao clicar.
export function LinhaFarol({
  id, geral, titulo, subtitulo, manchete, doc, int, med, aberta, aoAlternar, children,
}: {
  id: string;
  geral: Cor;
  titulo: string;
  subtitulo?: string;
  manchete: string;
  doc: Cor;
  int: Cor;
  med: Cor;
  aberta: boolean;
  aoAlternar: () => void;
  children: ReactNode;
}) {
  const idDetalhe = `farol-${id.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <li className={`linha-farol${aberta ? ' linha-farol-aberta' : ''}`}>
      <button type="button" className="linha-farol-botao" aria-expanded={aberta} aria-controls={idDetalhe} onClick={aoAlternar}>
        <Farol cor={geral} grande rotulo={rotuloCor[geral]} />
        <span className="linha-farol-texto">
          <strong>{titulo}</strong>
          {subtitulo && <small className="sub">{subtitulo}</small>}
          <span className="linha-farol-manchete">{manchete}</span>
        </span>
        <span className="linha-farol-frentes">
          <SeloFrente nome="Documentos" cor={doc} />
          <SeloFrente nome="Integração" cor={int} />
          <SeloFrente nome="Medição" cor={med} />
        </span>
      </button>
      {aberta && (
        <div className="linha-farol-detalhe" id={idDetalhe}>
          {children}
        </div>
      )}
    </li>
  );
}

// Linha que abre ao clicar, no mesmo visual da linha de farol, com o que quiser à direita.
export function LinhaCompacta({
  id, cor, titulo, subtitulo, manchete, direita, aberta, aoAlternar, children,
}: {
  id: string;
  cor: Cor;
  titulo: string;
  subtitulo?: string;
  manchete: string;
  direita?: ReactNode;
  aberta: boolean;
  aoAlternar: () => void;
  children: ReactNode;
}) {
  const idDetalhe = `linha-${id.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <li className={`linha-farol${aberta ? ' linha-farol-aberta' : ''}`}>
      <button type="button" className="linha-farol-botao" aria-expanded={aberta} aria-controls={idDetalhe} onClick={aoAlternar}>
        <Farol cor={cor} grande rotulo={rotuloCor[cor]} />
        <span className="linha-farol-texto">
          <strong>{titulo}</strong>
          {subtitulo && <small className="sub">{subtitulo}</small>}
          <span className="linha-farol-manchete">{manchete}</span>
        </span>
        {direita && <span className="linha-farol-frentes">{direita}</span>}
      </button>
      {aberta && (
        <div className="linha-farol-detalhe" id={idDetalhe}>
          {children}
        </div>
      )}
    </li>
  );
}

export function DetalheFrentes({ doc, int, med, extra }: { doc: Frente; int: Frente; med: Frente; extra?: ReactNode }) {
  return (
    <>
      <div className="frentes">
        <Bloco titulo="Documentos dos colaboradores" frente={doc} />
        <Bloco titulo="Integração" frente={int} />
        <Bloco titulo="Medição e pagamento" frente={med} />
      </div>
      {extra}
    </>
  );
}

function Bloco({ titulo, frente }: { titulo: string; frente: Frente }) {
  return (
    <section className="frente">
      <h3>
        <Farol cor={frente.cor} />
        {titulo}
        <span className="sr">: {rotuloCor[frente.cor]}</span>
      </h3>
      {frente.itens.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </section>
  );
}
