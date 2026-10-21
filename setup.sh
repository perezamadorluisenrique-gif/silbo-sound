#!/usr/bin/env bash
# Prepara el entorno (idempotente). Solo comandos corrientes.
set -euo pipefail
cd "$(dirname "$0")"
node --version
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --no-audit --no-fund
fi
