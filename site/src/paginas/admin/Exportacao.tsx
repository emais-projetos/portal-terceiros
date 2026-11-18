import { useEffect, useState } from 'react';
import { Mensagem } from '../../componentes/Pagina';
import { useSessao } from '../../lib/sessao';
import { mensagemDeErro } from '../../lib/supabase';
import { exportarTudo, lerUltimaExportacao, type Exportacao, type ProgressoExportacao } from '../../lib/exportacao';

const mb = (b: number) => `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
const diasDesde = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 864e5);
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Acessos > Exportar: cópia completa do portal, uma vez por mês.
export function ExportacaoMensal() {
  const { usuario } = useSessao();
  const [ultima, setUltima] = useState<(Exportacao & { nome: string | null }) | null | undefined>(undefined);
  const [progresso, setProgresso] = useState<ProgressoExportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    lerUltimaExportacao().then(setUltima).catch(() => setUltima(null));
  }, []);

  async function exportar() {
    setErro(null);
    setOk(null);
    setProgresso({ etapa: 'tabelas', feito: 0, total: 1 });
    try {
      const r = await exportarTudo(usuario?.nome ?? 'administrativo', setProgresso);
      setOk(`Exportação baixada: ${r.tabelas} tabelas, ${r.linhas.toLocaleString('pt-BR')} linhas e ${r.arquivos} arquivos (${mb(r.bytes)}). Guarde o ZIP na pasta restrita do SharePoint.`);
      setUltima(await lerUltimaExportacao());
      window.dispatchEvent(new Event('exportacao-feita'));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setProgresso(null);
    }
  }

  const atrasada = ultima === null || (ultima && diasDesde(ultima.feita_em) > 30);
  const etapa = progresso
    ? progresso.etapa === 'tabelas'
      ? `Lendo as tabelas: ${progresso.feito + 1} de ${progresso.total}${progresso.detalhe ? ` (${progresso.detalhe})` : ''}`
      : progresso.etapa === 'arquivos'
        ? `Baixando os arquivos: ${progresso.feito + 1} de ${progresso.total}`
        : 'Montando o ZIP'
    : '';

  return (
    <section className="bloco">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      <h2 className="bloco-titulo">Exportação mensal</h2>
      <p className="apoio">
        Baixa uma cópia completa do portal num ZIP: todas as tabelas em planilha (CSV, abre no Excel) e todos os arquivos que ainda estão
        guardados (documentos, medição, fotos da segurança e listas de presença). Faça uma vez por mês e guarde na pasta restrita do SharePoint:
        o arquivo tem CPF, documentos e assinaturas dos colaboradores.
      </p>
      {ultima !== undefined && (
        <div className={`aviso${atrasada ? ' aviso-alerta' : ''}`}>
          {ultima
            ? `Última exportação em ${dataHora(ultima.feita_em)}${ultima.nome ? `, por ${ultima.nome}` : ''}: ${ultima.tabelas} tabelas, ${ultima.arquivos} arquivos, ${mb(ultima.bytes)}.${atrasada ? ` Já passou de 30 dias (${diasDesde(ultima.feita_em)} dias).` : ''}`
            : 'Nenhuma exportação feita ainda.'}
        </div>
      )}
      <div className="linha-botoes">
        <button type="button" className="botao" disabled={!!progresso} onClick={() => void exportar()}>
          {progresso ? 'Exportando...' : 'Exportar tudo'}
        </button>
        {progresso && <span className="dica" role="status">{etapa}. Não feche a página.</span>}
      </div>
      <p className="dica">
        Os arquivos já apagados pelo prazo de guarda (30 dias depois do download) não entram: a cópia deles é a que foi salva no SharePoint.
      </p>
    </section>
  );
}

// Para o menu: 1 quando a exportação do mês está pendente.
export async function exportacaoPendente(): Promise<number> {
  const u = await lerUltimaExportacao();
  return !u || diasDesde(u.feita_em) > 30 ? 1 : 0;
}
