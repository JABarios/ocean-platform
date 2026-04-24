# Guía de despliegue en Arch Linux (Minerva)

Esta guía describe cómo instalar la plataforma OCEAN en un servidor Arch Linux. Se ofrecen dos métodos:

1. **[Docker Compose](#opciÓn-a-docker-compose-recomendada)** — Más fácil, reproducible, todo containerizado.
2. **[Instalación nativa](#opciÓn-b-instalaciÓn-nativa)** — Sin Docker, más eficiente en recursos, servicios gestionados por systemd.

---

## Prerrequisitos comunes

```bash
# Instalar git y base-devel (si no los tienes)
sudo pacman -Syu --needed git base-devel

# Clonar el repositorio
git clone git@github.com:JABarios/ocean-platform.git
cd ocean-platform
```

---

## Opción A: Docker Compose (recomendada)

### 1. Instalar Docker

```bash
sudo pacman -Syu docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Cierra sesión y vuelve a entrar para que el grupo docker aplique
```

### 2. Configurar variables de entorno

```bash
cp .env.prod.example .env
nano .env
```

Edita al menos estos valores:

```env
POSTGRES_PASSWORD=una-contraseña-muy-segura
JWT_SECRET=una-cadena-larga-y-aleatoria-de-al-menos-64-caracteres
CORS_ORIGIN=http://minerva.local,http://192.168.1.XXX
VITE_API_URL=http://minerva.local:4000
```

- `CORS_ORIGIN`: Lista separada por comas de los orígenes desde los que se accederá al frontend (IPs o dominios de los navegadores de los usuarios).
- `VITE_API_URL`: URL pública completa del backend. Debe ser accesible desde los navegadores de los usuarios.

### 3. Levantar la plataforma

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Esto construye y arranca:
- **PostgreSQL** 16 (datos persistentes en volumen Docker)
- **Backend** Node.js (puerto 4000)
- **Frontend** Nginx sirviendo estáticos (puerto 80)

### 4. Crear schema y datos iniciales

```bash
# Ejecutar migraciones
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# (Opcional) Sembrar usuarios de prueba
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

### 5. Verificar estado

```bash
# Ver logs
docker compose -f docker-compose.prod.yml logs -f

# Health check
curl http://localhost:4000/health
```

### 6. Acceso

Abre un navegador en otra máquina de la red y ve a:
- Frontend: `http://minerva.local` (o la IP de Minerva)
- Backend API: `http://minerva.local:4000`

Credenciales de prueba (si ejecutaste seed):
- `clinician@ocean.local` / `ocean123`
- `reviewer@ocean.local` / `ocean123`
- `curator@ocean.local` / `ocean123`
- `admin@ocean.local` / `ocean123`

### 7. Actualizar tras cambios en código

```bash
git pull
docker compose -f docker-compose.prod.yml up --build -d
```

### 8. Backup de la base de datos

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U ocean ocean_db > ocean_backup_$(date +%F).sql
```

---

## Opción B: Instalación nativa

Si prefieres no usar Docker, instala los componentes directamente en Arch Linux.

### 1. Instalar dependencias del sistema

```bash
sudo pacman -Syu nodejs npm postgresql nginx
sudo systemctl enable --now postgresql
```

### 2. Configurar PostgreSQL

```bash
# Crear usuario y base de datos
sudo -u postgres initdb --locale=es_ES.UTF-8 -E UTF8 -D /var/lib/postgres/data
sudo systemctl restart postgresql

sudo -u postgres psql -c "CREATE USER ocean WITH PASSWORD 'tu-contraseña';"
sudo -u postgres psql -c "CREATE DATABASE ocean_db OWNER ocean;"
```

### 3. Configurar backend

```bash
cd backend

# Instalar dependencias
npm ci

# Crear .env de producción
cat > .env << 'EOF'
DATABASE_URL=postgresql://ocean:tu-contraseña@localhost:5432/ocean_db
JWT_SECRET=cambia-esto-por-una-cadena-larga-y-aleatoria
PORT=4000
NODE_ENV=production
STORAGE_TYPE=filesystem
UPLOAD_DIR=./uploads/cases
CORS_ORIGIN=http://minerva.local
EOF

# Generar cliente Prisma y migrar
npx prisma generate
npx prisma migrate deploy

# Compilar TypeScript
npm run build
```

### 4. Servicio systemd para el backend

```bash
sudo tee /etc/systemd/system/ocean-backend.service << 'EOF'
[Unit]
Description=OCEAN Backend API
After=network.target postgresql.service

[Service]
Type=simple
User=ocean
WorkingDirectory=/opt/ocean-platform/backend
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production
EnvironmentFile=/opt/ocean-platform/backend/.env

[Install]
WantedBy=multi-user.target
EOF

# Crear usuario y copiar código
sudo useradd -r -s /bin/false ocean
sudo mkdir -p /opt/ocean-platform
sudo cp -r . /opt/ocean-platform/
sudo chown -R ocean:ocean /opt/ocean-platform

sudo systemctl daemon-reload
sudo systemctl enable --now ocean-backend
```

### 5. Compilar y servir frontend

```bash
cd ../frontend

# Instalar y build
npm ci
VITE_API_URL=http://minerva.local:4000 npm run build

# El build queda en dist/
# Nginx lo servirá
```

### 6. Configurar Nginx

```bash
sudo tee /etc/nginx/sites-available/ocean << 'EOF'
server {
    listen 80;
    server_name minerva.local;
    root /opt/ocean-platform/frontend/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# En Arch, nginx usa /etc/nginx/conf.d/ o /etc/nginx/sites-enabled/
sudo mkdir -p /etc/nginx/sites-enabled
sudo ln -sf /etc/nginx/sites-available/ocean /etc/nginx/sites-enabled/ocean

# Añadir include en nginx.conf si no existe
sudo sed -i '/http {/a\    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf

sudo nginx -t
sudo systemctl enable --now nginx
```

### 7. Firewall (opcional)

```bash
# Si usas ufw o iptables, abre puertos 80 y 4000
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT
```

---

## SSL/TLS (recomendado para producción real)

Si Minerva tiene acceso a Internet o usas un dominio propio, configura HTTPS con Let's Encrypt:

```bash
sudo pacman -S certbot certbot-nginx
sudo certbot --nginx -d minerva.tu-dominio.com
```

Si es solo intranet local, puedes usar un certificado autofirmado:

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ocean.key -out /etc/nginx/ocean.crt \
  -subj "/CN=minerva.local"
```

Y añade la configuración SSL a nginx.

---

## Estructura de archivos en el servidor

```
/opt/ocean-platform/           (o ~/ocean-platform si usas Docker)
├── backend/
│   ├── .env
│   ├── dist/
│   ├── uploads/cases/         # Bloques cifrados de EEG
│   └── prisma/
├── frontend/
│   └── dist/                  # Build estático servido por nginx
├── docker-compose.prod.yml    # (solo si usas Docker)
└── docs/
```

---

## Troubleshooting

| Problema | Solución |
|---|---|
| `docker: permission denied` | `sudo usermod -aG docker $USER` y reiniciar sesión |
| Frontend no conecta al backend | Verifica `VITE_API_URL` y `CORS_ORIGIN`. Deben coincidir con la URL real desde el navegador. |
| Error de Prisma/migraciones | `docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy` |
| Nginx 404 en rutas del frontend | Asegúrate de que `try_files $uri $uri/ /index.html;` esté configurado |
| Puerto 4000 no accesible | Verifica firewall (`iptables -L`) y que el backend esté escuchando en `0.0.0.0` |

---

## Notas de seguridad

1. **JWT_SECRET**: Nunca uses el valor por defecto. Genera uno largo y aleatorio:
   ```bash
   openssl rand -hex 32
   ```
2. **Contraseñas de PostgreSQL**: Usa contraseñas fuertes y no las commitees.
3. **Uploads**: Los archivos `.enc` (EEG cifrados) se guardan en `uploads/cases/`. Asegúrate de que solo el proceso del backend tenga acceso.
4. **Firewall**: En producción expuesta, solo abre los puertos necesarios (80/443). El puerto 4000 no necesita ser público si usas nginx como reverse proxy.
