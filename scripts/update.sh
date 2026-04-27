#!/bin/bash
# OCEAN — Actualización en caliente (sin borrar datos)
# Uso: ./scripts/update.sh
#
# Requisitos: Docker Compose gestionando ocean-backend y ocean-postgres
#             nginx sirviendo frontend/dist/ en el host

set -e

OCEAN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$OCEAN_DIR/frontend"

echo "=== OCEAN — Actualización en caliente ==="
echo ""

# 1. Actualizar código
echo "[1/4] Actualizando código desde GitHub..."
cd "$OCEAN_DIR"
git fetch origin
git reset --hard origin/main

# 2. Reconstruir y reiniciar backend
echo "[2/4] Reconstruyendo backend..."
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d

# 3. Frontend — VITE_API_URL desde .env.production
echo "[3/4] Compilando frontend..."
cd "$FRONTEND_DIR"
npm install

if [ -f ".env.production" ]; then
  echo "  Usando .env.production"
  npm run build
elif [ -n "${VITE_API_URL:-}" ]; then
  echo "  Usando VITE_API_URL=$VITE_API_URL"
  npm run build
else
  echo "  ⚠️  VITE_API_URL no definida — crea frontend/.env.production con:"
  echo "     VITE_API_URL=https://tu-dominio/api"
  npm run build
fi

# 4. Recargar nginx para servir el nuevo dist/
echo "[4/4] Recargando nginx..."
sudo nginx -s reload

echo ""
echo "========================================"
echo "ACTUALIZACIÓN COMPLETADA"
echo "========================================"
docker compose -f "$OCEAN_DIR/docker-compose.prod.yml" ps
echo ""
echo "Nginx activo — el nuevo frontend ya está en dist/"
echo ""
