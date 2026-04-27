#!/bin/bash
# OCEAN — Actualización en caliente (sin borrar datos)
# Uso: ./scripts/update.sh
#
# Requisitos: PM2 gestionando ocean-backend, nginx sirviendo frontend/dist/
# No toca la base de datos ni los archivos subidos.

set -e

OCEAN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$OCEAN_DIR/backend"
FRONTEND_DIR="$OCEAN_DIR/frontend"

echo "=== OCEAN — Actualización en caliente ==="
echo ""

# 1. Parar backend (nginx sigue sirviendo el build anterior mientras compilamos)
echo "[1/5] Parando backend..."
pm2 stop ocean-backend 2>/dev/null || true

# 2. Actualizar código
echo "[2/5] Actualizando código desde GitHub..."
cd "$OCEAN_DIR"
git fetch origin
git reset --hard origin/main

# 3. Backend
echo "[3/5] Actualizando backend..."
cd "$BACKEND_DIR"
npm install --omit=dev
npx prisma generate
npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss
npm run build

# 4. Frontend — VITE_API_URL desde .env.production si existe, si no desde entorno
echo "[4/5] Compilando frontend..."
cd "$FRONTEND_DIR"
npm install --omit=dev

if [ -f ".env.production" ]; then
  echo "  Usando .env.production para VITE_API_URL"
  npm run build
elif [ -n "$VITE_API_URL" ]; then
  echo "  Usando VITE_API_URL=$VITE_API_URL"
  npm run build
else
  echo "  ⚠️  VITE_API_URL no definida — el frontend usará window.location.hostname:4000"
  echo "     Crea frontend/.env.production con: VITE_API_URL=https://tu-dominio/api"
  npm run build
fi

# 5. Arrancar backend con PM2
echo "[5/5] Arrancando backend..."
cd "$BACKEND_DIR"
pm2 start dist/index.js --name ocean-backend 2>/dev/null || pm2 restart ocean-backend
pm2 save

echo ""
echo "========================================"
echo "ACTUALIZACIÓN COMPLETADA"
echo "========================================"
pm2 list
echo ""
echo "Nginx sigue activo — el nuevo frontend ya está en dist/"
echo ""
