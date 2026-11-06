import type { StatusAlocacao } from './consultas';

// 'AAAA-MM-DD' ou data/hora ISO -> 'DD/MM/AAAA', sem mudar o dia por causa do fuso.
export function data(valor: string | null | undefined): string {
  if (!valor) return '';
  const [a, m, d] = valor.slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : '';
}

export function hojeIso(): string {
  const h = new Date();
  const local = new Date(h.getTime() - h.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function somarDias(isoData: string, dias: number): string {
  const [a, m, d] = isoData.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export function diasAte(isoData: string): number {
  const [a, m, d] = isoData.split('-').map(Number);
  const [ha, hm, hd] = hojeIso().split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000);
}

// Confere as datas do cadastro do colaborador (as mesmas regras do banco). Devolve o erro ou null.
export function erroDatasColaborador(admissao: string, nascimento: string): string | null {
  const hoje = hojeIso();
  const [a, m, d] = hoje.split('-').map(Number);
  const limiteNascimento = `${a - 18}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (nascimento && nascimento < '1930-01-01') return 'Data de nascimento inválida: confira o ano.';
  if (nascimento && nascimento > limiteNascimento) return 'Colaborador menor de 18 anos não pode ser cadastrado.';
  if (admissao && admissao < '1960-01-01') return 'Data de admissão inválida: confira o ano.';
  if (admissao && admissao > somarDias(hoje, 90)) return 'Data de admissão muito à frente: confira a data.';
  if (admissao && nascimento && admissao <= nascimento) return 'A admissão precisa ser depois do nascimento.';
  return null;
}

export function cnpjValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

export function formatarCpf(cpf: string | null | undefined): string {
  if (!cpf) return '';
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

export function soDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

export function cpfValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (peso - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

export function tamanhoArquivo(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const rotuloStatus: Record<StatusAlocacao, string> = {
  em_cadastro: 'Em cadastro',
  pendente_fornecedor: 'Com o fornecedor',
  em_analise: 'Em análise',
  aprovado_admin: 'Aguardando TST',
  liberado: 'Liberado',
  encerrado: 'Encerrado',
};

export type SituacaoPendencia =
  | 'nao_enviado'
  | 'em_analise'
  | 'devolvido'
  | 'vencido'
  | 'a_vencer'
  | 'vigente'
  | 'dispensado';

export const rotuloSituacao: Record<SituacaoPendencia, string> = {
  nao_enviado: 'Não enviado',
  em_analise: 'Em análise',
  devolvido: 'Devolvido',
  vencido: 'Vencido',
  a_vencer: 'Vence em breve',
  vigente: 'Em dia',
  dispensado: 'Dispensado',
};

// Ordem de exibição: o que trava primeiro.
export const ordemSituacao: Record<SituacaoPendencia, number> = {
  vencido: 0,
  nao_enviado: 1,
  devolvido: 2,
  em_analise: 3,
  a_vencer: 4,
  vigente: 5,
  dispensado: 6,
};
