# Guía de despliegue — Ubuntu 22.04 / 24.04

Esta guía describe el setup de producción actual en **Hetzner** (`app.ocean-eeg.org`).

Stack:
- **Docker** gestiona el backend Node.js (con SQLite en bind-mount)
- **nginx en el host** sirve el frontend estático y hace proxy de `/api/` al backend
- **Certbot** gestiona el certificado HTTPS

---

## Instalación en máquina nueva

```bash
git clone git@github.com:JABarios/ocean-platform.git
sudo bash ocean-platform/scripts/install-new-machine.sh
```

El script instala Node 20, Docker, nginx, fail2ban, UFW y Certbot, y configura todo automáticamente.

---

## Setup manual paso a paso (Ubuntu 22.04/24.04)

### 1. Instalar Docker

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Cierra sesión y vuelve a entrar para que el grupo docker aplique
```

### 2. Clonar el repositorio

```bash
git clone git@github.com:JABarios/ocean-platform.git
cd ocean-platform
```

### 3. Configurar variables de entorno

```bash
cat > .env << EOF
JWT_SECRET=$(openssl rand -hex 64)
CORS_ORIGIN=https://tu-dominio.com
EOF
```

### 4. Levantar el backend con Docker

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Esto construye y arranca:
- **Backend** Node.js en `127.0.0.1:4000` (solo accesible desde el host)
- **SQLite** en `backend/data/prod.db` (bind-mount, persiste entre rebuilds)
- Las migraciones se aplican automáticamente al arrancar

### 5. Compilar el frontend

```bash
cd frontend
echo "VITE_API_URL=https://tu-dominio.com/api" > .env.production
npm install && npm run build
```

### 6. Configurar nginx

```bash
sudo tee /etc/nginx/sites-available/ocean << 'EOF'
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/m;

server {
    listen 80;
    server_name tu-dominio.com;
    root /ruta/a/ocean-platform/frontend/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        client_max_body_size 2048m;
        proxy_pass http://localhost:4000/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/ocean /etc/nginx/sites-enabled/ocean
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Certificado HTTPS (Certbot)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

### 8. Verificar estado

```bash
curl http://localhost:4000/health
curl https://tu-dominio.com/api/health
docker compose -f docker-compose.prod.yml ps
```

### 9. Sembrar datos de prueba (opcional)

```bash
docker compose -f docker-compose.prod.yml exec -T backend npx prisma db seed
```

Credenciales (password: `ocean123`):
- `clinician@ocean.local`
- `reviewer@ocean.local`
- `curator@ocean.local`
- `admin@ocean.local`

### 10. Autostart tras reboot

```bash
sudo systemctl enable docker
docker update --restart unless-stopped ocean-backend
```

### 11. Actualizar tras cambios en código

```bash
./scripts/update.sh
```

### 12. Backup de la base de datos

```bash
cp backend/data/prod.db "ocean_backup_$(date +%F).db"
```

---

## Solución de problemas frecuentes

### Error P3005 al arrancar (DB ya existe sin historial de migraciones)

Ocurre al migrar una DB existente de SQLite a Docker por primera vez:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps backend \
  npx prisma migrate resolve --applied 20260423194258_init
docker compose -f docker-compose.prod.yml restart backend
```

### Puerto 4000 ocupado

```bash
ss -tlnp | grep 4000    # identificar el proceso
pm2 delete ocean-backend 2>/dev/null || kill -9 <PID>
docker compose -f docker-compose.prod.yml restart backend
```

---

## Estructura de archivos en el servidor

```
~/ocean-platform/
├── .env                       # JWT_SECRET + CORS_ORIGIN (nunca commitear)
├── backend/
│   ├── data/prod.db           # SQLite de producción (bind-mount Docker)
│   ├── uploads/cases/         # Bloques cifrados de EEG (bind-mount Docker)
│   └── prisma/
├── frontend/
│   ├── .env.production        # VITE_API_URL (nunca commitear)
│   └── dist/                  # Build estático servido por nginx
└── docker-compose.prod.yml
```

---

## Hardening del servidor (VPS expuesto)

Una IP pública empieza a recibir escaneos automáticos en minutos. Estos pasos son el mínimo recomendable.

### 1. UFW — solo abrir lo necesario

El backend (4000) y el frontend de desarrollo (5173) **no** necesitan estar expuestos: nginx hace el proxy internamente.

```bash
sudo ufw allow 22/tcp    # SSH (o el puerto que hayas configurado)
sudo ufw allow 80/tcp    # HTTP → redirige a HTTPS
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
sudo ufw status
```

### 2. Fail2ban — bloqueo automático de IPs abusivas

Monitoriza los logs y banea IPs que acumulan demasiados fallos (SSH, nginx, etc.).

```bash
sudo apt install fail2ban -y
sudo systemctl enable --now fail2ban

# Verificar que SSH está protegido:
sudo fail2ban-client status sshd
```

La configuración por defecto (5 intentos fallidos → ban 10 min) es suficiente para empezar.

### 3. Rate limiting en nginx — proteger el endpoint de login

Añade esto al config de nginx para limitar intentos de fuerza bruta contra la API:

```bash
sudo nano /etc/nginx/sites-enabled/ocean
```

```nginx
# Antes del bloque server:
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/m;

# Dentro del location /api/:
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        client_max_body_size 2048m;
        proxy_pass http://localhost:4000/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Cambiar el puerto SSH (opcional)

Reduce drásticamente el ruido de escaneos automáticos:

```bash
sudo nano /etc/ssh/sshd_config
# Cambiar: Port 22  →  Port 2222
sudo systemctl restart ssh

# Actualizar UFW:
sudo ufw delete allow 22/tcp
sudo ufw allow 2222/tcp
```

> Abre la nueva sesión SSH antes de cerrar la actual para verificar que funciona.

---

## Troubleshooting

| Problema | Solución |
|---|---|
| `docker: permission denied` | `sudo usermod -aG docker $USER` y reiniciar sesión |
| Frontend no conecta al backend | Verifica `VITE_API_URL` y `CORS_ORIGIN`. Deben coincidir con la URL real desde el navegador. |
| Error P3005 (DB schema not empty) | Ver sección "Solución de problemas frecuentes" arriba — baseline de migraciones |
| Nginx 404 en rutas del frontend | Asegúrate de que `try_files $uri $uri/ /index.html;` esté configurado |
| Nginx 405 en POST a `/api/` | Falta el `location /api/` con `proxy_pass` — `try_files` no acepta POST |
| Nginx 413 al subir paquete | Añadir `client_max_body_size 2048m;` en `location /api/` |
| Backend no responde en 4000 | Puerto ocupado: `ss -tlnp \| grep 4000` → `kill -9 <PID>` → `docker compose ... restart backend` |
| Contenedor sin red ni puertos | `docker compose down && docker compose up -d` (recrear en vez de restart) |
| 502 Bad Gateway tras reboot | Docker no arrancó: `sudo systemctl start docker && docker compose -f ~/ocean-platform/docker-compose.prod.yml up -d` |

---

## Notas de seguridad

1. **JWT_SECRET**: Nunca uses el valor por defecto. Genera uno largo y aleatorio:
   ```bash
   openssl rand -hex 64
   ```
2. **`.env` y `.env.production`**: Nunca los commitees. Están en `.gitignore`.
3. **Uploads**: Los archivos `.enc` (EEG cifrados) se guardan en `backend/uploads/cases/`. Solo el contenedor Docker tiene acceso.
4. **Puertos expuestos**: Solo 22, 80 y 443 (UFW). El 4000 (backend Docker) está en `127.0.0.1` — solo accesible desde el host, nginx hace el proxy.
5. **CORS_ORIGIN**: En producción debe ser el dominio exacto (`https://app.ocean-eeg.org`), nunca `*`.
