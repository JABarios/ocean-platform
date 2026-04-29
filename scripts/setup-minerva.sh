#!/bin/bash
# Script de instalación nativa de OCEAN en Arch Linux (Minerva)
# Ejecutar como usuario normal (no root). Pedirá sudo cuando lo necesite.

set -e

if [ "${OCEAN_ALLOW_LEGACY_MINERVA:-}" != "1" ]; then
  echo "ERROR: setup-minerva.sh es un script histórico y ya no forma parte del camino soportado de despliegue."
  echo "Usa docs/DEPLOY.md e install-new-machine.sh para despliegues actuales."
  echo "Si necesitas ejecutar esta versión legacy conscientemente, relanza con:"
  echo "  OCEAN_ALLOW_LEGACY_MINERVA=1 ./scripts/setup-minerva.sh"
  exit 1
fi

OCEAN_DIR="$HOME/ocean-platform"
BACKEND_DIR="$OCEAN_DIR/backend"
FRONTEND_DIR="$OCEAN_DIR/frontend"

echo "=== OCEAN — Instalación nativa en Arch Linux ==="
echo ""

# 1. Verificar dependencias
echo "[1/9] Verificando dependencias..."
for cmd in git node npm psql; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: '$cmd' no está instalado."
    echo "Instala con: sudo pacman -Syu git nodejs npm postgresql"
    exit 1
  fi
done
echo "OK"

# 2. Clonar repo si no existe
if [ ! -d "$OCEAN_DIR" ]; then
  echo "[2/9] Clonando repositorio..."
  git clone git@github.com:JABarios/ocean-platform.git "$OCEAN_DIR"
else
  echo "[2/9] Repositorio ya existe, actualizando..."
  cd "$OCEAN_DIR" && git pull
fi

# 3. Configurar PostgreSQL
echo "[3/9] Configurando PostgreSQL..."
if ! sudo systemctl is-active --quiet postgresql; then
  sudo systemctl enable --now postgresql
fi

DB_USER="ocean"
DB_PASS="oceanpass-$(openssl rand -hex 8)"
DB_NAME="ocean_db"

# Crear usuario y BD si no existen
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "  → Usuario: $DB_USER"
echo "  → Contraseña: $DB_PASS"
echo "  → Base de datos: $DB_NAME"

# 4. Backend — dependencias y build
echo "[4/9] Instalando dependencias del backend..."
cd "$BACKEND_DIR"
npm ci

# 5. Crear .env del backend
echo "[5/9] Configurando entorno del backend..."
JWT_SECRET=$(openssl rand -hex 32)

cat > "$BACKEND_DIR/.env" <<EOF
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
JWT_SECRET=$JWT_SECRET
PORT=4000
NODE_ENV=production
STORAGE_TYPE=filesystem
UPLOAD_DIR=./uploads/cases
CORS_ORIGIN=*
EOF

echo "  → JWT_SECRET generado"
echo "  → .env creado en backend/.env"

# 6. Prisma migrate + seed
echo "[6/9] Creando schema de base de datos..."
# Cambiar provider a postgresql temporalmente (el schema es compatible)
cp prisma/schema.prisma prisma/schema.prisma.bak
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
npx prisma generate
npx prisma db push --accept-data-loss
# Restaurar schema original para no ensuciar el repo
cp prisma/schema.prisma.bak prisma/schema.prisma

# 7. Compilar backend
echo "[7/9] Compilando backend..."
npm run build

# 8. Frontend — build estático
echo "[8/9] Compilando frontend..."
cd "$FRONTEND_DIR"
npm install   # npm install en vez de npm ci porque el lockfile puede estar desincronizado

# Crear .env para que Vite inyecte la URL correcta en el build
API_HOST="$(hostname -f 2>/dev/null || hostname)"
echo "VITE_API_URL=http://$API_HOST:4000" > .env

cat .env
npm run build

# 9. Servicio systemd para backend
echo "[9/9] Creando servicio systemd..."

sudo tee /etc/systemd/system/ocean-backend.service > /dev/null <<EOF
[Unit]
Description=OCEAN Backend API
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$BACKEND_DIR
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ocean-backend

echo ""
echo "========================================"
echo "INSTALACIÓN COMPLETADA"
echo "========================================"
echo ""
echo "Para arrancar el backend:"
echo "  sudo systemctl start ocean-backend"
echo ""
echo "Logs del backend:"
echo "  sudo journalctl -u ocean-backend -f"
echo ""
echo "Para servir el frontend (elige uno):"
echo "  1. Con Python (rápido):"
echo "     cd $FRONTEND_DIR/dist && python -m http.server 8080"
echo "  2. Con nginx (producción): copia $FRONTEND_DIR/dist a /srv/http/ocean"
echo ""
echo "Acceso:"
echo "  Frontend: http://$(hostname -f || hostname):8080 (o el puerto que elijas)"
echo "  API:      http://$(hostname -f || hostname):4000/health"
echo ""
echo "Credenciales de prueba (password: ocean123):"
echo "  admin@ocean.local, clinician@ocean.local, reviewer@ocean.local, curator@ocean.local"
echo ""
echo "¡Guarda esta contraseña de PostgreSQL!"
echo "  $DB_PASS"
echo ""
