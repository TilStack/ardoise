#!/usr/bin/env bash
# Démarre PostgreSQL et crée les bases de dev et de test si besoin (Ubuntu / Debian).
set -euo pipefail

if ! pg_isready -q -h localhost; then
  sudo service postgresql start 2>/dev/null || service postgresql start
  sleep 2
fi

as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }

as_pg "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='ardoise'\" | grep -q 1 || psql -c \"CREATE USER ardoise WITH PASSWORD 'ardoise' CREATEDB\""
for db in ardoise_dev ardoise_test; do
  as_pg "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\" | grep -q 1 || createdb -O ardoise $db"
done
echo "PostgreSQL prêt : ardoise_dev et ardoise_test"
