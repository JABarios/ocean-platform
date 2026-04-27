#!/bin/bash
# OCEAN — Instalación en máquina nueva (Ubuntu 24.04 / 22.04)
# Uso: sudo bash scripts/install-new-machine.sh
#
# Instala: Node 20, PM2, nginx, fail2ban, UFW, Certbot
# Configura: backend + frontend + nginx + PM2 autostart
#
# Variables de entorno opcionales para modo no interactivo:
#   OCEAN_DOMAIN    — dominio público (ej. app.ocean-eeg.org)
#   OCEAN_EMAIL     — email para Certbot
#   OCEAN_REPO      — URL del repo (default: git@github.com:JABarios/ocean-platform.git)
#   OCEAN_DIR       — directorio de instalación (default: /opt/ocean-platform)
#   OCEAN_SEED      — "yes" para sembrar datos de prueba tras instalar
#   OCEAN_HTTPS     — "yes" para configurar HTTPS con Certbot

set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*" >&2; }

# ── Comprobaciones previas ────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "Este script debe ejecutarse como root: sudo bash $0"
  exit 1
fi

if ! grep -qi "ubuntu" /etc/os-release 2>/dev/null; then
  warn "Sistema no es Ubuntu — el script está probado en Ubuntu 22.04/24.04."
  read -rp "Continuar de todas formas? [s/N] " ans
  [[ "${ans,,}" == "s" ]] || exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     OCEAN — Instalación en máquina nueva     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Configuración interactiva ─────────────────────────────────────────────────
OCEAN_REPO="${OCEAN_REPO:-git@github.com:JABarios/ocean-platform.git}"
OCEAN_DIR="${OCEAN_DIR:-/opt/ocean-platform}"

if [[ -z "${OCEAN_DOMAIN:-}" ]]; then
  read -rp "Dominio público (ej. app.ocean-eeg.org, o IP): " OCEAN_DOMAIN
fi

if [[ -z "${OCEAN_EMAIL:-}" ]]; then
  read -rp "Email para notificaciones (Certbot, etc.): " OCEAN_EMAIL
fi

if [[ -z "${OCEAN_HTTPS:-}" ]]; then
  read -rp "Configurar HTTPS con Certbot? [s/N]: " ans
  [[ "${ans,,}" == "s" ]] && OCEAN_HTTPS="yes" || OCEAN_HTTPS="no"
fi

if [[ -z "${OCEAN_SEED:-}" ]]; then
  read -rp "Sembrar datos de prueba tras instalar? [s/N]: " ans
  [[ "${ans,,}" == "s" ]] && OCEAN_SEED="yes" || OCEAN_SEED="no"
fi

# URL pública de la API
API_URL="https://${OCEAN_DOMAIN}/api"
[[ "${OCEAN_HTTPS}" != "yes" ]] && API_URL="http://${OCEAN_DOMAIN}/api"

echo ""
echo "Configuración:"
echo "  Dominio:    $OCEAN_DOMAIN"
echo "  API URL:    $API_URL"
echo "  Directorio: $OCEAN_DIR"
echo "  HTTPS:      $OCEAN_HTTPS"
echo "  Seed:       $OCEAN_SEED"
echo ""
read -rp "¿Es correcto? [S/n]: " ans
[[ "${ans,,}" == "n" ]] && { err "Abortado."; exit 1; }

# ── 1. Actualizar sistema ─────────────────────────────────────────────────────
echo ""
echo "[1/10] Actualizando sistema..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git nginx fail2ban ufw certbot python3-certbot-nginx
ok "Sistema actualizado"

# ── 2. Node 20 ───────────────────────────────────────────────────────────────
echo ""
echo "[2/10] Instalando Node.js 20..."
NODE_MAJOR=$(node --version 2>/dev/null | grep -oP '(?<=v)\d+' || echo "0")
if [[ "$NODE_MAJOR" -ge 20 ]]; then
  ok "Node $(node --version) ya instalado"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
  ok "Node $(node --version) instalado"
fi

# ── 3. PM2 ───────────────────────────────────────────────────────────────────
echo ""
echo "[3/10] Instalando PM2..."
if command -v pm2 &>/dev/null; then
  ok "PM2 ya instalado ($(pm2 --version))"
else
  npm install -g pm2 -q
  ok "PM2 instalado"
fi

# ── 4. Clonar repositorio ────────────────────────────────────────────────────
echo ""
echo "[4/10] Preparando código fuente..."
if [[ -d "$OCEAN_DIR/.git" ]]; then
  warn "Directorio $OCEAN_DIR ya existe — actualizando con git pull"
  git -C "$OCEAN_DIR" fetch origin
  git -C "$OCEAN_DIR" reset --hard origin/main
  ok "Código actualizado"
else
  git clone "$OCEAN_REPO" "$OCEAN_DIR"
  ok "Repositorio clonado en $OCEAN_DIR"
fi

BACKEND_DIR="$OCEAN_DIR/backend"
FRONTEND_DIR="$OCEAN_DIR/frontend"

# ── 5. Backend — .env ────────────────────────────────────────────────────────
echo ""
echo "[5/10] Configurando backend..."

BACKEND_ENV="$BACKEND_DIR/.env"
if [[ ! -f "$BACKEND_ENV" ]]; then
  JWT_SECRET=$(openssl rand -hex 64)
  cat > "$BACKEND_ENV" << EOF
DATABASE_URL=file:./prod.db
JWT_SECRET=$JWT_SECRET
PORT=4000
NODE_ENV=production
STORAGE_TYPE=filesystem
UPLOAD_DIR=./uploads/cases
CORS_ORIGIN=http://${OCEAN_DOMAIN}
EOF
  [[ "${OCEAN_HTTPS}" == "yes" ]] && sed -i "s|CORS_ORIGIN=http://|CORS_ORIGIN=https://|" "$BACKEND_ENV"
  ok "Creado $BACKEND_ENV (JWT_SECRET generado automáticamente)"
else
  warn ".env ya existe — no se sobreescribe. Verifica JWT_SECRET y CORS_ORIGIN manualmente si es necesario."
fi

# Backend: instalar dependencias, migraciones, compilar
cd "$BACKEND_DIR"
npm install
npx prisma generate
npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss
npm run build
ok "Backend compilado"

# ── 6. Frontend — .env.production + build ────────────────────────────────────
echo ""
echo "[6/10] Compilando frontend..."
cd "$FRONTEND_DIR"
cat > .env.production << EOF
VITE_API_URL=$API_URL
EOF
npm install
npm run build
ok "Frontend compilado (dist/ listo)"

# ── 7. Nginx ─────────────────────────────────────────────────────────────────
echo ""
echo "[7/10] Configurando nginx..."

NGINX_CONF="/etc/nginx/sites-available/ocean"
cat > "$NGINX_CONF" << EOF
limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/m;

server {
    listen 80;
    server_name ${OCEAN_DOMAIN};

    root ${FRONTEND_DIR}/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        client_max_body_size 2048m;
        proxy_pass http://localhost:4000/;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ocean
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx
ok "Nginx configurado y activo"

# ── 8. PM2 ───────────────────────────────────────────────────────────────────
echo ""
echo "[8/10] Arrancando backend con PM2..."
cd "$BACKEND_DIR"
pm2 delete ocean-backend 2>/dev/null || true
pm2 start dist/index.js --name ocean-backend
pm2 save

# Generar y ejecutar el comando de startup para el usuario actual
PM2_STARTUP=$(pm2 startup systemd -u "$SUDO_USER" --hp "/home/$SUDO_USER" 2>&1 | grep "sudo env")
if [[ -n "$PM2_STARTUP" ]]; then
  eval "$PM2_STARTUP"
  ok "PM2 autostart configurado para $SUDO_USER"
else
  # Si no hay SUDO_USER (root directo), configurar para root
  pm2 startup systemd 2>/dev/null || true
  warn "Ejecuta 'pm2 save && pm2 startup' manualmente si el autostart no funciona"
fi
pm2 save
ok "PM2 arrancado y guardado"

# ── 9. UFW + fail2ban ────────────────────────────────────────────────────────
echo ""
echo "[9/10] Configurando firewall..."
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw --force enable >/dev/null
ok "UFW activo: 22 (SSH), 80 (HTTP), 443 (HTTPS)"

systemctl enable --now fail2ban
ok "fail2ban activo"

# ── 10. Certbot HTTPS (opcional) ─────────────────────────────────────────────
echo ""
echo "[10/10] Certificado HTTPS..."
if [[ "${OCEAN_HTTPS}" == "yes" ]]; then
  certbot --nginx -d "$OCEAN_DOMAIN" --non-interactive --agree-tos -m "$OCEAN_EMAIL" --redirect
  ok "Certificado SSL obtenido y nginx actualizado con HTTPS"
  # Actualizar CORS_ORIGIN en .env
  sed -i "s|CORS_ORIGIN=http://|CORS_ORIGIN=https://|g" "$BACKEND_ENV"
  # Reiniciar backend con nuevo CORS
  pm2 restart ocean-backend
  pm2 save
else
  warn "HTTPS no configurado. Para activarlo después: sudo certbot --nginx -d $OCEAN_DOMAIN"
fi

# ── Seed (opcional) ──────────────────────────────────────────────────────────
if [[ "${OCEAN_SEED}" == "yes" ]]; then
  echo ""
  echo "[extra] Sembrando datos de prueba..."
  cd "$BACKEND_DIR"
  npx prisma db seed 2>/dev/null && ok "Seed completado" || warn "Seed falló — puede que los datos ya existan"
fi

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         INSTALACIÓN COMPLETADA               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
pm2 list
echo ""
echo "  Frontend: http${OCEAN_HTTPS:+s}://${OCEAN_DOMAIN}"
echo "  Backend:  http${OCEAN_HTTPS:+s}://${OCEAN_DOMAIN}/api"
echo "  Health:   curl http://localhost:4000/health"
echo ""
if [[ "${OCEAN_SEED}" == "yes" ]]; then
  echo "  Cuentas de prueba (password: ocean123):"
  echo "    clinician@ocean.local"
  echo "    reviewer@ocean.local"
  echo "    curator@ocean.local"
  echo "    admin@ocean.local"
  echo ""
fi
echo "  Para actualizar en el futuro:"
echo "    sudo bash $OCEAN_DIR/scripts/update.sh"
echo ""
