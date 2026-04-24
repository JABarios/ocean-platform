#!/bin/bash
# OCEAN — Modo desarrollo local (localhost)
# Corre backend (:4000) y frontend (:5173) en la misma máquina.
# Uso: ./scripts/run-dev.sh

set -e

cd "$(dirname "$0")/.."

echo "=== OCEAN — Modo desarrollo local ==="
echo ""

# Backend
echo "[1/4] Preparando backend..."
cd backend

# Usar SQLite en desarrollo
cp .env.example .env

# Instalar dependencias si hace falta
if [ ! -d "node_modules" ]; then
  echo "  Instalando dependencias del backend..."
  npm install
fi

# Generar Prisma y crear base de datos
npx prisma generate
npx prisma db push --accept-data-loss

# Sembrar usuarios de prueba
npx prisma db seed 2>/dev/null || echo "  (Seed ya ejecutado o falló silenciosamente)"

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

echo "  → Frontend listo. Arrancando en http://localhost:5173"
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================"
echo "OCEAN está corriendo en modo desarrollo"
echo "========================================"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:4000"
echo ""
echo "Credenciales de prueba (password: ocean123):"
echo "  clinician@ocean.local"
echo "  reviewer@ocean.local"
echo "  curator@ocean.local"
echo "  admin@ocean.local"
echo ""
echo "Para parar ambos servicios:"
echo "  kill $BACKEND_PID $FRONTEND_PID"
echo ""

# Esperar a que el usuario pulse Ctrl+C
trap "echo ''; echo 'Deteniendo servicios...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
