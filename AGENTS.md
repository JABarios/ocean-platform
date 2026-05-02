# AGENTS.md — Plataforma OCEAN

> Este documento está dirigido a agentes de código (AI coding agents). Describe la arquitectura, convenciones y comandos esenciales para trabajar en el proyecto OCEAN. El proyecto se documenta principalmente en español.

---

## 1. Visión general del proyecto

**OCEAN** es una plataforma colaborativa clínica diseñada para trabajar junto a **KAPPA** (estación de trabajo local de EEG). Su propósito es coordinar la revisión de casos EEG entre profesionales, gestionar solicitudes de revisión, conservar la discusión clínica estructurada y promover casos de interés hacia una biblioteca docente validada.

- **No** es un repositorio masivo de EEGs.
- **No** es una red social médica.
- Incluye **visor de EEG en navegador** (`/cases/:id/eeg`) que desencripta y renderiza la señal vía módulo WebAssembly.
- La unidad central del sistema es la **petición de revisión de un caso**.

La estructura del repositorio es:

```
ocean-platform/
├── backend/             # API REST (Node.js + Express + TypeScript + Prisma + SQLite)
├── frontend/            # Aplicación web (React + TypeScript + Vite)
├── scripts/             # Scripts de utilidad y despliegue
├── docker-compose.yml   # Desarrollo con Docker (PostgreSQL + MinIO)
├── docker-compose.prod.yml # Producción con Docker (SQLite bind-mount)
└── docs/                # Documentación (DEPLOY.md, MINERVA.md)
```

---

## 2. Stack tecnológico

### Backend
- **Runtime:** Node.js 20
- **Framework:** Express 4
- **Lenguaje:** TypeScript 5.4 (target ES2022, módulos CommonJS)
- **ORM:** Prisma 5.22 con `@prisma/client`
- **Base de datos:** SQLite en desarrollo local (`provider = "sqlite"` en schema)
- **Autenticación:** JWT (`jsonwebtoken`) + bcryptjs
- **Validación:** Zod
- **Dev runner:** `tsx watch src/index.ts`

### Frontend
- **Framework:** React 18
- **Lenguaje:** TypeScript 5.4 (target ES2020, módulos ESNext)
- **Bundler:** Vite 5
- **Routing:** `react-router-dom` v6
- **Gestión de estado:** Zustand v4 (persistencia en `localStorage`)
- **Estilos:** CSS puro con variables CSS (`src/index.css`)
- **Cifrado:** Web Crypto API con fallback a `node-forge` para contextos HTTP no-localhost

---

## 3. Estructura de código

### Backend (`backend/`)

```
backend/
├── src/
│   ├── index.ts              # Punto de entrada Express
│   ├── routes/
│   │   ├── auth.ts           # POST /register, POST /login, GET /me
│   │   ├── cases.ts          # CRUD de casos, máquina de estados VALID_TRANSITIONS, incluye package
│   │   ├── comments.ts       # Comentarios vinculados a casos
│   │   ├── requests.ts       # Solicitudes de revisión (pending, active, accept, reject)
│   │   ├── packages.ts       # Subida/descarga con diskStorage + hash streaming (sin cargar en RAM)
│   │   ├── teaching.ts       # Propuestas docentes, recomendaciones, validación
│   │   ├── users.ts          # Listado y administración de usuarios
│   │   ├── galleries.ts      # Galerías e importación desde directorio del servidor
│   │   ├── groups.ts         # Grupos clínicos
│   │   ├── audit.ts          # Auditoría
│   │   ├── viewer-state.ts   # Persistencia del visor por usuario + EEG
│   │   └── cleanup.ts        # Limpieza manual/segura
│   ├── middleware/
│   │   └── auth.ts           # authMiddleware, requireRole
│   └── utils/
│       ├── prisma.ts         # Singleton PrismaClient
│       ├── storage.ts        # Abstracted storage (filesystem / S3)
│       ├── cleanup.ts        # Cron cleanup de paquetes expirados
│       └── keyCustody.ts     # Custodia de claves EEG
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts               # 4 usuarios de prueba (pass: ocean123)
│   └── migrations/
├── tests/                    # 117 tests de integración (Jest + Supertest)
├── .env / .env.example
└── package.json
```

### Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx               # Rutas: /, /login, /register, /cases, /cases/new, /cases/:id, /cases/:id/eeg, /eegs, /galleries, /library, /queue, /admin
│   ├── api/
│   │   └── client.ts         # API_BASE dinámico (window.location.hostname:4000)
│   ├── store/
│   │   └── authStore.ts      # Zustand con persistencia
│   ├── hooks/
│   │   └── useCrypto.ts      # AES-GCM (Web Crypto) + fallback node-forge
│   ├── utils/
│   │   └── edfAnonymization.ts # Anonimización de cabeceras EDF antes del cifrado
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Dashboard.tsx
│   │   ├── CaseNew.tsx       # Formulario + cifrado de .edf + anonimización
│   │   ├── CaseDetail.tsx    # Detalle, comentarios y recuperación de clave EEG
│   │   ├── CaseOperations.tsx # Bandeja operativa de casos
│   │   ├── EEGViewer.tsx     # Visor EEG completo (ver §EEG Viewer)
│   │   ├── EegRecords.tsx    # Inventario de EEGs reutilizables
│   │   ├── Galleries.tsx     # Listado de galerías
│   │   ├── GalleryDetail.tsx # Detalle de galería
│   │   ├── TeachingLibrary.tsx
│   │   ├── TeachingQueue.tsx
│   │   ├── AdminHome.tsx
│   │   ├── UserAdmin.tsx
│   │   └── CleanupAdmin.tsx
│   └── test/                 # 54 tests en 7 suites (Vitest + RTL)
├── public/
│   └── wasm/                 # kappa_wasm.js + kappa_wasm.wasm (módulo Emscripten)
└── package.json
```

---

## 4. Comandos de build y desarrollo

### Backend

```bash
cd backend
npm install
npm run dev                 # tsx watch src/index.ts (puerto 4000)
npm run build               # tsc → dist/
npm run start               # node dist/index.js
npm run db:seed             # tsx prisma/seed.ts
npm test                    # Jest — 117 tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # vite — puerto 5173
npm run build               # tsc && vite build → dist/
npm test                    # Vitest — 54 tests
```

### Producción (servidor Hetzner — app.ocean-eeg.org)

Stack actual de producción: **Docker** (backend) + **nginx en host** (HTTPS + frontend estático + proxy /api/).

```bash
# Requisito: crear ~/ocean-platform/.env con:
# JWT_SECRET=<openssl rand -hex 64>
# KEY_CUSTODY_SECRET=<openssl rand -hex 64>
# CORS_ORIGIN=https://app.ocean-eeg.org

# Primera vez
docker compose -f docker-compose.prod.yml up --build -d

# Actualizar tras cambios
./scripts/update.sh

# Logs y estado
docker compose -f docker-compose.prod.yml logs backend --tail=30
docker compose -f docker-compose.prod.yml ps
curl http://localhost:4000/health
```

La DB SQLite de producción vive en `backend/data/prod.db` (bind-mount, persiste entre rebuilds).
Si al arrancar aparece error P3005 (DB ya existe sin historial de migraciones):
```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps backend \
  npx prisma migrate resolve --applied 20260423194258_init
```

---

## 5. Versiones estables

| Tag | Descripción |
|---|---|
| `v0.4.0-stable` | Producción con Docker (backend) + nginx host (frontend/HTTPS). SQLite en bind-mount. update.sh usa docker compose. |
| `v0.3.2-stable` | Visor EEG con tema claro, filtros HP/LP/notch, ganancia relativa auto, ventana temporal, navegación por teclado |
| `v0.3.1-stable` | Visor EEG integrado con módulo WASM, SPA fallback, flujo de clave automático, 82 tests backend, 34 frontend |
| `v0.3.0-stable` | DB re-validation, máquina de estados, diskStorage, 65 tests backend, 34 frontend |

Scripts principales:
| Script | Uso |
|---|---|
| `update.sh` | Actualización en caliente del servidor actual |
| `install-new-machine.sh` | Instalación completa en Ubuntu 22.04/24.04 nuevo (Node, Docker, nginx, Certbot, UFW) |
| `ocean.sh` | `ocean_up` / `ocean_down` — arrancar/parar (entorno de desarrollo local) |
| `run-dev.sh` | Modo desarrollo con `--network` para acceso LAN |
| `setup-minerva.sh` | Script histórico, bloqueado por defecto |

Para instalar en máquina nueva:
```bash
git clone git@github.com:JABarios/ocean-platform.git
sudo bash ocean-platform/scripts/install-new-machine.sh
```

---

## 6. Modelo de datos principal

- **User:** roles (`Clinician`, `Reviewer`, `Curator`, `Admin`)
- **Case:** estados clínicos `Draft → Requested → InReview → Resolved → Archived` (máquina de estados en backend)
- **CasePackage:** blob cifrado (IV + ciphertext AES-GCM), hash SHA-256 y referencia a `EegRecord`
- **EegRecord:** registro EEG reutilizable y deduplicado por hash
- **Gallery / GalleryRecord:** colecciones de EEGs anónimos o públicos
- **Group / GroupMember:** grupos clínicos y membresía
- **ReviewRequest:** estados `Pending`, `Accepted`, `Rejected`, `Completed`
- **Comment:** tipos `Comment`, `Conclusion`, `TeachingNote`
- **TeachingProposal:** estados `None → Proposed → Recommended → Validated/Rejected`
- **ViewerState:** estado persistido del visor por `user + packageHash`
- **EegAccessSecret:** custodia de clave EEG en OCEAN
- **AuditEvent:** trazabilidad de acciones

---

## 7. Flujo de autenticación y autorización

1. JWT firmado con `JWT_SECRET` (7 días de expiración).
2. El token se persiste con Zustand bajo la clave `ocean-auth` en `localStorage`. `api/client.ts` lo lee desde ahí mediante `authStorage.ts`; no se usa ya una clave separada `ocean_token`.
3. `authMiddleware` verifica JWT **y re-valida rol + status contra la DB** en cada petición. Rechaza tokens de usuarios inactivos o roles degradados.
4. `requireRole` protege endpoints sensibles (validación docente).
5. Respuesta 401 → limpia token y recarga página.

---

## 8. Testing

### Backend — 117 tests (Jest + Supertest + SQLite :memory:)

```bash
cd backend && npm test
```

Suites: auth, cases, requests, teaching, packages, comments, galleries, groups, cleanup, viewer-state y audit.

### Frontend — 54 tests (Vitest + React Testing Library)

```bash
cd frontend && npm test
```

Suites: Login, Dashboard, CaseNew, CaseDetail, api.client, EEGViewer.utils y edfAnonymization.

### EEG Viewer

- El visor web usa `frontend/public/wasm/kappa_wasm.js/.wasm`, compilado desde el repo padre `kappa`.
- El visor persiste estado por usuario y `blobHash`, y reutiliza caché local cifrada del paquete cuando existe.
- `EEGViewer.tsx` trabaja con duración real de página derivada de `nSamples / sfreq`; no asume que `1 record = 1 s`.
- Soporta montajes `promedio` (por defecto), `doble_banana`, `transversal`, `linked_mastoids` y `hjorth`.
- `promedio` resta la media instantánea de todos los canales.
- `linked_mastoids` usa `(A1 + A2) / 2` como referencia común.
- `hjorth` resta al electrodo activo la media instantánea de los vecinos listados.
- El orden del selector es `promedio`, `doble_banana`, `transversal`, `linked_mastoids`, `hjorth`.
- Los canales EEG izquierdos impares se dibujan en azul, los derechos pares en rojo y la línea media (`z`) en gris.
- El fondo del trazado es amarillo pálido y las marcas verticales de `1 s` usan gris suave.
- La metadata del estudio (`subjectId`, fecha) va en un flotante dentro del visor y solo aparece al pasar el ratón por la banda izquierda de etiquetas.
- La barra superior está compactada para mantener todos los controles en una sola fila desplazable.
- El módulo WASM aplica HP/LP en modo zero-phase (warmup + forward + backward) y notch forward-only para evitar transitorios severos en el borde izquierdo de cada página.
- La barra de amplitud usa una escala discreta clínica (`1, 2, 5, 10... µV`) y cambia de tamaño junto con la ganancia visible.
- El visor incluye selector DSA bajo demanda por canal EEG. Al activarlo, `Artefactos` se enciende por defecto, aunque luego puede desactivarse.
- El panel DSA permite click para saltar a la época correspondiente; la barra de artefactos encima del DSA también permite navegar a épocas marcadas.
- El visor lee anotaciones EDF+ embebidas (`extractEdfAnnotations`) y puede mostrarlas en un panel lateral, además de marcarlas con ticks en la barra temporal inferior.
- La subida web anonimiza cabeceras EDF antes del cifrado.
- Parte de la lógica pura del visor vive en `frontend/src/pages/eegViewerUtils.ts` y está cubierta con tests unitarios (montajes, colores, tiempo real, hover de metadata, regla DSA→Artefactos).
- Si se cambia `src/wasm/kappa_wasm.cpp` en `kappa`, hay que recompilar con `./build_wasm.sh` y refrescar los binarios de `frontend/public/wasm/`.

### Scripts

```bash
# Arrancar/parar
source scripts/ocean.sh && ocean_up    # backend + frontend
ocean_down                             # parar todo

# Actualizar en caliente (sin perder datos)
./scripts/update.sh

# Modo desarrollo con acceso desde red
./scripts/run-dev.sh --network
```

---

## 9. Consideraciones de seguridad

- **JWT_SECRET:** fallback en dev, variable de entorno en producción.
- **CORS:** `CORS_ORIGIN=*` para desarrollo local/red; restringir en prod.
- **Contraseñas:** bcrypt a 10 rounds.
- **Validación:** Zod en todos los endpoints con body.
- **Autorización:** verificación `ownerId` o participación en `ReviewRequest`.
- **Transiciones de estado:** máquina de estados `VALID_TRANSITIONS` en `PATCH /cases/:id/status`.
- **Transacciones:** operaciones multi-write (aceptar solicitud, crear propuesta docente) envueltas en `prisma.$transaction`.
- **Almacenamiento de archivos:** multer usa `diskStorage` (no RAM); hash SHA-256 por streaming.
- **Propuestas docentes:** transacción interactiva evita race condition TOCTOU (duplicados).
- **Cifrado:** AES-256-GCM en navegador. La clave nunca llega en claro al servidor.
- **Visor EEG:** Descarga paquete cifrado → desencripta con clave → monta en MEMFS de Emscripten → renderiza señal en canvas. Clave guardada en `sessionStorage` para el creador (auto-start en recargas). Otros usuarios deben introducirla manualmente.
- **Clave de descifrado:** Puede custodiarse en OCEAN y recuperarse con contraseña del usuario. El propietario también puede volver a revelarla manualmente.
- **Controles del visor:** Filtro paso-alto (HP: off/0.3/0.5/1/5 Hz), paso-bajo (LP: 15/30/45/70 Hz), notch 50 Hz, ventana temporal (10/20/30 s), ganancia relativa (0.1×–4× sobre escala auto compartida). Teclado: ←/→ navega páginas, ↑/↓ ajusta ganancia.

---

## 10. Visor EEG (`/cases/:id/eeg`)

Página fullscreen sin Layout ni ProtectedRoute. Valida el token internamente al hacer el fetch del paquete.

### Pipeline de carga

```
1. Formulario de clave  →  sessionStorage lookup (auto-start si existe)
2. GET /packages/download/:id  (Authorization: Bearer <token>)
3. decryptFile(buffer, keyBase64)  ←  useCrypto (AES-GCM / forge fallback)
4. Cargar kappa_wasm.js como <script> clásico (UMD, no ESM)
   └─ poll window.KappaModule cada 50ms, timeout 10s
5. Module.FS.writeFile('/tmp/file.edf', bytes)
6. kappa.openEDF('/tmp/file.edf')
7. getMeta() → setFilters(hp, lp, notch) → `readEpoch(0, windowSecs)` usando semántica de **segundos reales** para offset y duración
8. Render canvas
```

### Módulo WASM (`public/wasm/kappa_wasm.js`)

```typescript
const Module = await KappaModule()        // global UMD
const k = new Module.KappaWasm()
k.openEDF('/tmp/file.edf')                // → bool
k.getMeta()                               // → { numChannels, sampleRate, numSamples, subjectId, recordingDate, channelLabels }
k.setFilters(hp, lp, notch)              // Hz; 0 = desactivado
k.readEpoch(offsetSec, durationSec)      // → { nChannels, nSamples, sfreq, channelNames, channelTypes, data: Float32Array[] }
k.computeDSAForChannel(channelIndex, artifactRejectEnabled)
                                          // → { normPow, stages, artifactStatuses, epochSec, artifactEpochSec, ... }
```

> `kappa_wasm.js` es UMD. No usar `import`. Cargarlo con `createElement('script')`.

### Escala de amplitud (heurística compartida)

1. Por canal: calcular rango auto (percentil 2–98) y centro (mediana)
2. Referencia = **mediana** de todos los rangos (robusto ante canales ECG/EMG con amplitud muy diferente)
3. Cada canal se centra en su propia mediana; todos comparten el mismo rango = `refRange / gainMult`
4. Ganancia por defecto: 1× (escala natural)

### Funciones clínicas y de interacción

- Selector de montaje con `promedio` por defecto.
- Selector `DSA` por canal EEG; el valor inicial es `Desactivado`.
- Toggle `Artefactos` asociado al DSA. Si el DSA pasa de `Desactivado` a un canal, el toggle se activa automáticamente.
- Barra de artefactos encima del DSA, coloreada por estado de época, con click para navegar.
- Heatmap DSA navegable por click.
- Tooltip temporal del cursor y barra de amplitud arrastrable.
- Botones `-1s` / `+1s` y atajos `Shift+←` / `Shift+→` con navegación fina por segundos reales.
- Panel lateral para anotaciones EDF+ embebidas, con apertura desde la toolbar y salto directo a cada anotación.

### Controles de teclado

| Tecla | Acción |
|-------|--------|
| `←` / `→` | Página anterior / siguiente |
| `↑` / `↓` | Aumentar / reducir ganancia (paso por opciones: 0.1×, 0.3×, 0.5×, 0.7×, 1×, 2×, 4×) |

### Colores de canal

| Tipo | Color |
|------|-------|
| EEG  | `#1d4ed8` (azul) |
| EOG  | `#047857` (verde) |
| ECG  | `#dc2626` (rojo) |
| EMG  | `#b45309` (ámbar) |
| RESP | `#7c3aed` (violeta) |

### Harness standalone (`tools/eeg-viewer-harness/`)

Programa mínimo para probar cambios en el visor sin necesidad del backend OCEAN completo.

```bash
python tools/eeg-viewer-harness/server.py /ruta/a/archivo.edf [puerto]
# Abrir http://localhost:8765
```

Sirve una página vanilla-JS que:
1. Carga el módulo WASM desde `frontend/public/wasm/`.
2. Lee el archivo EDF vía endpoint `/edf` (sin cifrado).
3. Monta el EDF en MEMFS y renderiza con la misma lógica de canvas que la app React.

Incluye filtros HP/LP/notch, ventana, ganancia, normalización z-score, cursor, barra de escala arrastrable, navegación por teclado y los montajes clínicos principales. Su llamada buena a KAPPA para la paginación fina es `readEpoch(page * windowSecs, windowSecs)`, es decir, por segundos. No replica todavía el panel DSA ni la barra de artefactos de la app React.

Archivos:
- `server.py` — servidor Python sin dependencias (sirve HTML, JS, WASM y el EDF)
- `index.html` — página del visor
- `viewer.js` — lógica de renderizado portada desde `EEGViewer.tsx`

---

## 11. Documentación adicional

- `docs/DEPLOY.md` — Guía de despliegue en Ubuntu (Docker + nginx host, setup actual en Hetzner)
- `docs/MINERVA.md` — Guía rápida para uso en el servidor Minerva
- `OCEAN_Especificaciones_Fusion.md` — Especificación funcional completa
