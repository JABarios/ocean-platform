#!/bin/bash
# Backup consistente de la base SQLite de OCEAN usando la API de sqlite3 de Python.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OCEAN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DB_PATH="${DB_PATH:-$OCEAN_DIR/backend/data/prod.db}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/ocean-backups/sqlite}"
RETENTION_DAYS="${RETENTION_DAYS:-21}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_PATH="$BACKUP_DIR/prod-$TIMESTAMP.db"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: no existe la base SQLite en $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

python3 - "$DB_PATH" "$OUT_PATH" <<'PY'
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])

src = sqlite3.connect(str(db_path))
dst = sqlite3.connect(str(out_path))
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
PY

find "$BACKUP_DIR" -type f -name 'prod-*.db' -mtime +"$RETENTION_DAYS" -delete

echo "Backup SQLite creado: $OUT_PATH"
