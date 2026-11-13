# Teste de segurança

Garante que cada perfil só enxerga e altera o que é seu. Roda sozinho no GitHub (aba Actions, "Testar segurança"):

- a cada mudança enviada ao repositório;
- toda segunda-feira de manhã;
- antes de publicar o site: se falhar, o site não é publicado.

Não usa dados nem senhas de produção. Cria um banco vazio, aplica todas as migrações e usa dados fictícios.

## O que é testado

**1. Estrutura do banco** (`02_verificar_estrutura.sql`). Só lê, então também pode rodar no Supabase de produção.

- Toda tabela tem regra de acesso (RLS) ligada.
- Toda view respeita a regra de acesso de quem consulta (`security_invoker`).
- Nenhuma função com poder total roda sem login, e todas têm `search_path` fixo.
- Nenhuma regra de acesso vale para quem não fez login.
- Só as tabelas de consulta (funções, obras, parâmetros, tipos de documento etc.) podem ser lidas inteiras.
- A pasta de arquivos não é pública.
- Toda função nova precisa ser revisada e entrar no teste por perfil.

**2. Teste por perfil** (`03_testar_perfis.sql`). Entra como sem login, fornecedor 1 e 2, TST 1 e 2, engenharia, admin desativado e admin, e:

- confere, em todas as tabelas e views, que ninguém vê, altera ou apaga linhas de outra empresa ou de outra obra;
- confere que as tabelas do administrativo (e-mails, cobranças, convites, histórico) ficam vazias para os outros perfis;
- tenta ganhar acesso: virar admin, se ligar a outra empresa ou obra, aprovar o próprio documento, liberar o próprio colaborador, escrever como se fosse a Emais;
- chama as funções do administrativo com os outros perfis, e as funções do fornecedor com dados de outra empresa;
- faz controles positivos (cada um vê o que é seu), para o teste não passar no vazio.

O resultado mostra quantas verificações foram feitas e a lista de falhas. Qualquer falha faz o teste falhar.

## Rodar no computador

Precisa de um Postgres 16 com usuário administrador:

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=... bash supabase/testes/rodar.sh
```

## Ao criar uma migração nova

1. Rode o teste antes de aplicar a migração no Supabase.
2. Ao recriar uma view, use sempre `create or replace view ... with (security_invoker = true) as`.
3. Função nova chamada pelo site: revogue de `anon` e `public`, inclua em `02_verificar_estrutura.sql` (lista de funções revisadas) e teste em `03_testar_perfis.sql` com um perfil que não deveria conseguir usá-la.
4. Depois de aplicar no Supabase, rode `02_verificar_estrutura.sql` lá também: precisa voltar vazio.
