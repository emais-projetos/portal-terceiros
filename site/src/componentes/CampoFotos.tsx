import { useRef, useState } from 'react';
import { comprimirFoto, enviarImagem } from '../lib/seguranca';
import { mensagemDeErro } from '../lib/supabase';

// Fotos de um item: "Tirar foto" abre a câmera no celular (no computador, escolhe o arquivo).
// Cada foto é reduzida e enviada na hora; a lista de caminhos volta para o formulário.
export function CampoFotos({
  pasta, fotos, links, maximo = 5, desativado, aoMudar,
}: {
  pasta: string;
  fotos: string[];
  links: Record<string, string>;
  maximo?: number;
  desativado?: boolean;
  aoMudar: (fotos: string[], novosLinks: Record<string, string>) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(lista: FileList | null) {
    if (!lista?.length) return;
    setErro(null);
    const arquivos = [...lista].slice(0, Math.max(0, maximo - fotos.length));
    setEnviando(arquivos.length);
    const novas: string[] = [];
    const novosLinks: Record<string, string> = {};
    try {
      for (const a of arquivos) {
        const jpg = await comprimirFoto(a);
        const caminho = await enviarImagem(`${pasta}/${crypto.randomUUID()}.jpg`, jpg);
        novas.push(caminho);
        novosLinks[caminho] = URL.createObjectURL(jpg);
        setEnviando((n) => n - 1);
      }
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setEnviando(0);
      if (entrada.current) entrada.current.value = '';
      if (novas.length) aoMudar([...fotos, ...novas], novosLinks);
    }
  }

  return (
    <div className="campo-fotos">
      <div className="fotos-miniaturas">
        {fotos.map((c) => (
          <span key={c} className="foto-com-acao">
            {links[c] ? (
              <a href={links[c]} target="_blank" rel="noreferrer"><img src={links[c]} alt="Foto do item" /></a>
            ) : (
              <span className="foto-indisponivel">foto</span>
            )}
            {!desativado && (
              <button type="button" className="foto-remover" aria-label="Tirar esta foto" onClick={() => aoMudar(fotos.filter((f) => f !== c), {})}>
                ×
              </button>
            )}
          </span>
        ))}
        {enviando > 0 && <span className="foto-indisponivel">enviando</span>}
      </div>
      {!desativado && fotos.length < maximo && (
        <>
          <button type="button" className="botao botao-secundario botao-pequeno" disabled={enviando > 0} onClick={() => entrada.current?.click()}>
            {fotos.length ? 'Mais uma foto' : 'Tirar foto'}
          </button>
          <input ref={entrada} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => escolher(e.target.files)} />
        </>
      )}
      {erro && <p className="texto-erro">{erro}</p>}
    </div>
  );
}
