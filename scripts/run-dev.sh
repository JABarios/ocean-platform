#!/bin/bash
# OCEAN — Modo desarrollo
# Uso:
#   ./scripts/run-dev.sh              → Solo localhost (Minerva misma)
#   ./scripts/run-dev.sh --network    → Accesible desde la red local

set -e

NETWORK_MODE=false
if [ "$1" = "--network" ]; then
  NETWORK_MODE=true
fi

cd "$(dirname "$0")/.."

echo "=== OCEAN — Modo desarrollo ==="
if [ "$NETWORK_MODE" = true ]; then
  IP_LOCAL=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  echo "  Modo: ACCESIBLE DESDE RED LOCAL ($IP_LOCAL)"
else
  echo "  Modo: LOCALHOST SOLO"
fi
echo ""

# Backend
echo "[1/4] Preparando backend..."
cd backend

cp .env.example .env

# Si modo red, añadir la IP al CORS
if [ "$NETWORK_MODE" = true ]; then
  echo "CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://$IP_LOCAL:5173" >> .env
  echo "  → CORS permite acceso desde http://$IP_LOCAL:5173"
fi

if [ ! -d "node_modules" ]; then
  echo "  Instalando dependencias del backend..."
  npm install
fi

npx prisma generate
npx prisma db push --accept-data-loss
npx prisma db seed 2>/dev/null || true

echo "  → Backend listo. Arrancando en http://localhost:4000"
npm run dev &
BACKEND_PID=$!
cd ..

# Frontend
echo ""
echo "[2/4] Preparando frontend..."
cd frontend

if [ ! -d "node_modules" ]; then
  echo "  Instalando dependencias del frontend..."
  npm install
fi

# Configurar API URL
if [ "$NETWORK_MODE" = true ]; then
  echo "VITE_API_URL=http://$IP_LOCAL:4000" > .env
  echo "  → Frontend apunta a http://$IP_LOCAL:4000"
else
  echo "VITE_API_URL=http://localhost:4000" > .env
fi

echo "  → Frontend listo. Arrancando..."
npm run dev -- --host &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================"
echo "OCEAN está corriendo"
echo "========================================"
if [ "$NETWORK_MODE" = true ]; then
  echo "  Frontend: http://$IP_LOCAL:5173"
  echo "  Backend:  http://$IP_LOCAL:4000"
  echo "  Accesible desde cualquier PC de la red local"
else
  echo "  Frontend: http://localhost:5173"
  echo "  Backend:  http://localhost:4000"
  echo "  Solo desde esta máquina"
fi
echo ""
echo "Credenciales de prueba (password: ocean123):"
echo "  clinician@ocean.local"
echo "  reviewer@ocean.local"
echo "  curator@ocean.local"
echo "  admin@ocean.local"
echo ""
echo "Para parar: Ctrl+C"
echo ""

trap "echo ''; echo 'Deteniendo servicios...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
