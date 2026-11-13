#!/usr/bin/env bash
# Teste de segurança do Portal de Terceiros.
# Cria um banco de teste vazio, aplica todas as migrações, confere as regras da estrutura e testa cada perfil.
# Usa as variáveis padrão do Postgres (PGHOST, PGPORT, PGUSER, PGPASSWORD). O usuário precisa ser superusuário.
set -euo pipefail
cd "$(dirname "$0")"
BANCO="${BANCO_TESTE:-portal_teste_seguranca}"
export PGOPTIONS="-c client_min_messages=warning"

dropdb --if-exists "$BANCO"
createdb "$BANCO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f 01_stubs_supabase.sql >/dev/null
for f in ../migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$f" >/dev/null || { echo "Falha ao aplicar $f"; exit 1; }
done
echo "Migrações aplicadas: $(ls ../migrations/*.sql | wc -l)"

problemas="$(psql -At -v ON_ERROR_STOP=1 -d "$BANCO" -f 02_verificar_estrutura.sql)"
if [ -n "$problemas" ]; then
  echo "========== Problemas na estrutura do banco =========="
  echo "$problemas"
  exit 1
fi
echo "Estrutura do banco: nenhum problema."

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f 03_testar_perfis.sql
