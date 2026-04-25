#!/bin/bash
# Instalación limpia de OCEAN en una máquina nueva
# Uso: ./scripts/install-new-machine.sh

set -e

REPO="git@github.com:JABarios/ocean-platform.git"
TAG="v0.3.0-stable"
DIR="ocean-platform"

echo "=== OCEAN — Instalación en máquina nueva ==="
echo ""

# 1. Clonar
echo "[1/6] Clonando repositorio..."
if [ -d "$DIR" ]; then
  echo "  Borrando instalación anterior..."
  rm -rf "$DIR"
fi
git clone "$REPO"
cd "$DIR"

# 2. Checkout a versión estable
echo "[2/6] Seleccionando versión estable ($TAG)..."
git checkout "$TAG"

# 3. Backend
echo "[3/6] Instalando backend..."
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push --accept-data-loss
npx prisma db seed
cd ..

# 4. Frontend
echo "[4/6] Instalando frontend..."
cd frontend
npm install
npm run build
cd ..

# 5. Script de control
echo "[5/6] Configurando script de control..."
cat >> ~/.bashrc << 'EOF'

# OCEAN — Control
cd ~/ocean-platform && source scripts/ocean.sh
EOF

# 6. Listo
echo ""
echo "========================================"
echo "INSTALACIÓN COMPLETADA"
echo "========================================"
echo ""
echo "Para arrancar en esta máquina:"
echo "  source ~/.bashrc"
echo "  ocean_up"
echo ""
echo "Acceso:"
echo "  Misma máquina: http://localhost:5173"
echo "  Desde red:     http://IP_DE_ESTA_MAQUINA:5173"
echo ""
echo "Credenciales (password: ocean123):"
echo "  clinician@ocean.local"
echo "  reviewer@ocean.local"
echo "  curator@ocean.local"
echo "  admin@ocean.local"
echo ""
