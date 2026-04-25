#!/bin/bash
# OCEAN — Modo desarrollo
# Uso:
#   ./scripts/run-dev.sh              → Solo localhost
#   ./scripts/run-dev.sh --network    → Accesible desde red local

set -e

NETWORK_MODE=false
if [ "$1" = "--network" ]; then
  NETWORK_MODE=true
fi

cd "$(dirname "$0")/.."

echo "=== OCEAN — Modo desarrollo ==="
if [ "$NETWORK_MODE" = true ]; then
  IP_LOCAL=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  if [ -z "$IP_LOCAL" ]; then
    IP_LOCAL=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$IP_LOCAL" ]; then
    echo "  ⚠️  No se pudo detectar IP local. Usando localhost."
    IP_LOCAL="localhost"
  fi
  echo "  Modo: ACCESIBLE DESDE RED LOCAL ($IP_LOCAL)"
else
  echo "  Modo: LOCALHOST SOLO"
fi
echo ""

# Backend
echo "[1/3] Preparando backend..."
cd backend

# Solo crear .env si no existe (preserva JWT_SECRET y configuración local)
if [ ! -f ".env" ]; then
  cp .env.example .env
  # Generar JWT_SECRET aleatorio si está vacío
  if ! grep -q "JWT_SECRET=.\+" .env; then
    JWT_RAND=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)
    sed -i "s/JWT_SECRET=/JWT_SECRET=$JWT_RAND/" .env
  fi
fi

# Si modo red, abrir CORS a cualquier origen (práctico para LAN)
if [ "$NETWORK_MODE" = true ]; then
  grep -q "CORS_ORIGIN" .env && sed -i "s/CORS_ORIGIN=.*/CORS_ORIGIN=*/" .env || echo "CORS_ORIGIN=*" >> .env
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
echo "[2/3] Preparando frontend..."
cd frontend

if [ ! -d "node_modules" ]; then
  echo "  Instalando dependencias del frontend..."
  npm install
fi

# VITE_API_URL debe pasarse en build time (Vite lo incrusta estáticamente)
if [ "$NETWORK_MODE" = true ]; then
  echo "  Compilando con VITE_API_URL=http://$IP_LOCAL:4000"
  VITE_API_URL="http://$IP_LOCAL:4000" npm run build
else
  npm run build
fi

echo "  → Frontend listo. Sirviendo build estático..."
python -m http.server 5173 --directory dist --bind 0.0.0.0 &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================"
echo "OCEAN está corriendo"
echo "========================================"
if [ "$NETWORK_MODE" = true ]; then
  echo "  Frontend: http://$IP_LOCAL:5173"
  echo "  Backend:  http://$IP_LOCAL:4000"
  echo "  Accesible desde cualquier PC de la red"
else
  echo "  Frontend: http://localhost:5173"
  echo "  Backend:  http://localhost:4000"
fi
echo ""
echo "Credenciales (password: ocean123):"
echo "  clinician@ocean.local, reviewer@ocean.local"
echo "  curator@ocean.local, admin@ocean.local"
echo ""
echo "Para parar: Ctrl+C"
echo ""

trap "echo ''; echo 'Deteniendo servicios...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
