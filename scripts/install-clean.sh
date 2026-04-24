#!/bin/bash
# Instalación limpia de OCEAN v0.2.0-stable en Minerva
# Uso: ./scripts/install-clean.sh

set -e

echo "=== OCEAN — Instalación limpia ==="
echo ""

# 1. Matar procesos viejos
echo "[1/6] Matando procesos viejos..."
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "python -m http.server" 2>/dev/null || true
sleep 2

# 2. Borrar instalación anterior
echo "[2/6] Borrando instalación anterior..."
cd ~
rm -rf ocean-platform

# 3. Clonar repo
echo "[3/6] Clonando repositorio..."
git clone git@github.com:JABarios/ocean-platform.git
cd ocean-platform

# 4. Checkout a versión estable
echo "[4/6] Seleccionando versión estable..."
git checkout v0.2.0-stable

# 5. Instalar dependencias y build
echo "[5/6] Instalando dependencias..."
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push --accept-data-loss
npx prisma db seed
cd ../frontend
echo "VITE_API_URL=http://localhost:4000" > .env
npm install
npm run build
cd ..

# 6. Listo
echo ""
echo "========================================"
echo "INSTALACIÓN COMPLETADA"
echo "========================================"
echo ""
echo "Para arrancar:"
echo "  cd ~/ocean-platform/backend && npm run dev &"
echo "  cd ~/ocean-platform/frontend/dist && python -m http.server 5173 --bind 0.0.0.0 &"
echo ""
echo "Acceso: http://localhost:5173"
echo ""
echo "Credenciales (password: ocean123):"
echo "  clinician@ocean.local"
echo "  reviewer@ocean.local"
echo "  curator@ocean.local"
echo "  admin@ocean.local"
echo ""
