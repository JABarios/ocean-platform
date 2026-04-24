# OCEAN en Minerva — Guía rápida

Versión congelada y estable para uso en localhost.

## Arrancar (manual)

```bash
cd ~/ocean-platform

# Asegurar que el frontend apunta a localhost
cd frontend
echo "VITE_API_URL=http://localhost:4000" > .env
npm run build
cd ..

# Matar procesos viejos si existen
pkill -f "tsx watch" 2>/dev/null
pkill -f "python -m http.server" 2>/dev/null
sleep 1

# Backend
cd backend && npm run dev &

# Frontend (build estático)
cd frontend/dist && python -m http.server 5173 --bind 0.0.0.0 &
```

## Acceso

Desde Chrome en **Minerva**:
```
http://localhost:5173
```

## Credenciales de prueba

- `clinician@ocean.local` / `ocean123`
- `reviewer@ocean.local` / `ocean123`
- `curator@ocean.local` / `ocean123`
- `admin@ocean.local` / `ocean123`

## Para parar

```bash
pkill -f "tsx watch"
pkill -f "python -m http.server"
```

## Estado de esta versión

- ✅ Login / registro
- ✅ Crear casos con cifrado de EEG
- ✅ Solicitar revisión
- ✅ Aceptar/rechazar revisiones
- ✅ Comentarios
- ✅ Descargar/descifrar EEG
- ✅ Propuestas docentes

**NO MODIFICAR** sin consenso. Si se necesitan cambios, crear rama nueva.
