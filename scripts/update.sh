#!/bin/bash
# OCEAN — Actualización en caliente (sin borrar datos)
# Uso: ./scripts/update.sh
# Actualiza el código, dependencias, schema Prisma y build del frontend.
# No toca la base de datos ni los archivos subidos.

set -e

OCEAN_DIR="$HOME/ocean-platform"
BACKEND_DIR="$OCEAN_DIR/backend"
FRONTEND_DIR="$OCEAN_DIR/frontend"

echo "=== OCEAN — Actualización en caliente ==="
echo ""

# 1. Parar servicios
echo "[1/5] Parando servicios..."
if type ocean_down &>/dev/null; then
  ocean_down >/dev/null 2>&1 || true
else
  pkill -f "tsx watch" 2>/dev/null || true
  pkill -f "python.*http.server" 2>/dev/null || true
  sleep 2
fi

# 2. Actualizar código
echo "[2/5] Actualizando código desde GitHub..."
cd "$OCEAN_DIR"
git fetch origin
git reset --hard origin/main

# 3. Backend
echo "[3/5] Actualizando backend..."
cd "$BACKEND_DIR"
npm install
npx prisma generate
npx prisma db push --accept-data-loss

# 4. Frontend
echo "[4/5] Compilando frontend..."
cd "$FRONTEND_DIR"
npm install
npm run build

# 5. Arrancar
echo "[5/5] Arrancando..."
cd "$BACKEND_DIR"
nohup npm run dev >/dev/null 2>&1 &
sleep 3
cd "$FRONTEND_DIR/dist"
nohup python -m http.server 5173 --bind 0.0.0.0 >/dev/null 2>&1 &

echo ""
echo "========================================"
echo "ACTUALIZACIÓN COMPLETADA"
echo "========================================"
echo ""
echo "Acceso: http://$(hostname -f || hostname):5173"
echo ""
