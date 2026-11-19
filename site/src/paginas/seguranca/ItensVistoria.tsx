import { CampoFotos } from '../../componentes/CampoFotos';
import { hojeIso, somarDias } from '../../lib/formato';
import { NOMES_STATUS_VISTORIA, type ItemVistoria, type Pessoa } from '../../lib/seguranca';

// Um item do checklist em edição: Sim / Não / Não se aplica, o que fazer e prazo (no "Não") e fotos.
export function ItemEdicao({
  it, n, numero, idVistoria, links, responsavel, aoMudar, aoLinks,
}: {
  it: ItemVistoria;
  n: number;
  numero: number;
  idVistoria: string;
  links: Record<string, string>;
  responsavel?: string;
  aoMudar: (p: Partial<ItemVistoria>, gravarJa?: boolean) => void;
  aoLinks: (novos: Record<string, string>) => void;
}) {
  return (
    <li className={`item-inspecao${it.status === 'nao' ? ' item-inspecao-nao' : ''}${it.status ? '' : ' item-inspecao-aberto'}`}>
      <p className="item-inspecao-texto">
        <span className="item-inspecao-numero">{numero}</span>
        {it.texto}
      </p>
      {responsavel && <p className="item-inspecao-resp">Corrige: {responsavel}</p>}
      <div className="escolha" role="radiogroup" aria-label={`Resposta do item ${numero}`}>
        {(['sim', 'nao', 'na'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={it.status === s}
            className={`escolha-${s}`}
            onClick={() => aoMudar(s === 'nao' && !it.prazo ? { status: s, prazo: somarDias(hojeIso(), 7), auto_na: false } : { status: s, auto_na: false })}
          >
            {NOMES_STATUS_VISTORIA[s]}
          </button>
        ))}
      </div>
      {it.status === 'nao' && (
        <div className="grade-recomendacao">
          <label className="campo">
            <span>O que precisa ser feito</span>
            <textarea rows={2} value={it.recomendacao} onChange={(e) => aoMudar({ recomendacao: e.target.value })} />
          </label>
          <label className="campo">
            <span>Prazo</span>
            <input type="date" value={it.prazo ?? ''} onChange={(e) => aoMudar({ prazo: e.target.value || null })} />
          </label>
        </div>
      )}
      <CampoFotos
        pasta={`vistoria/${idVistoria}/${n}`}
        fotos={it.fotos ?? []}
        links={links}
        aoMudar={(fotos, novos) => {
          aoLinks(novos);
          aoMudar({ fotos }, true);
        }}
      />
    </li>
  );
}

// Quem assina: moradores e quem acompanhou. Morador pode estar ausente ou não saber assinar (registro eletrônico).
export function ListaAssinaturas({
  pessoas, links, comCargo, comPresenca = false, rotuloIncluir, aoIncluir, aoMudar, aoRemover, aoAssinar,
}: {
  pessoas: { p: Pessoa; i: number }[];
  links: Record<string, string>;
  comCargo: boolean;
  comPresenca?: boolean;
  rotuloIncluir: string;
  aoIncluir: () => void;
  aoMudar: (i: number, p: Partial<Pessoa>) => void;
  aoRemover: (i: number) => void;
  aoAssinar: (i: number) => void;
}) {
  return (
    <div className="lista-pessoas">
      {pessoas.map(({ p, i }) => (
        <div key={i} className="pessoa-assina">
          <div className={comCargo ? 'grade-2' : undefined}>
            <label className="campo">
              <span>Nome{p.empresa ? <small className="sub"> {p.empresa}</small> : null}</span>
              <input value={p.nome} readOnly={!!p.colaborador_id} onChange={(e) => aoMudar(i, { nome: e.target.value })} />
            </label>
            {comCargo && (
              <label className="campo">
                <span>Cargo</span>
                <input value={p.cargo ?? ''} onChange={(e) => aoMudar(i, { cargo: e.target.value })} />
              </label>
            )}
          </div>
          {comPresenca && (
            <div className="pessoa-presenca">
              <label className="opcao">
                <input type="checkbox" checked={!!p.ausente} onChange={(e) => aoMudar(i, { ausente: e.target.checked, ...(e.target.checked ? { nao_assina: false } : {}) })} />
                <span>Ausente na hora</span>
              </label>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={!!p.nao_assina}
                  disabled={!!p.ausente}
                  onChange={(e) => aoMudar(i, { nao_assina: e.target.checked, ...(e.target.checked ? { assinatura: null } : {}) })}
                />
                <span>Não sabe assinar</span>
              </label>
            </div>
          )}
          <div className="pessoa-assina-acoes">
            {p.ausente ? (
              <span className="sub">ausente, sem assinatura</span>
            ) : p.nao_assina ? (
              <span className="sub">{p.codigo ? `registro eletrônico ${p.codigo}` : 'registro eletrônico, o código sai ao concluir'}</span>
            ) : p.assinatura && links[p.assinatura] ? (
              <img className="assinatura-previa" src={links[p.assinatura]} alt={`Assinatura de ${p.nome}`} />
            ) : (
              <span className="sub">sem assinatura</span>
            )}
            {!p.ausente && !p.nao_assina && (
              <button type="button" className="botao botao-secundario botao-pequeno" disabled={!p.nome.trim()} onClick={() => aoAssinar(i)}>
                {p.assinatura ? 'Assinar de novo' : 'Assinar'}
              </button>
            )}
            <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => aoRemover(i)}>Tirar</button>
          </div>
        </div>
      ))}
      <button type="button" className="botao botao-discreto botao-pequeno" onClick={aoIncluir}>+ {rotuloIncluir}</button>
    </div>
  );
}

// Situação do morador no PDF e na leitura.
export function situacaoMorador(p: Pessoa): string | null {
  if (p.ausente) return 'Ausente na hora da vistoria';
  if (p.nao_assina) return p.codigo ? `Não sabe assinar: registro eletrônico ${p.codigo}` : 'Não sabe assinar: registro eletrônico';
  return null;
}
