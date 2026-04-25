# AGENTS.md — Plataforma OCEAN

> Este documento está dirigido a agentes de código (AI coding agents). Describe la arquitectura, convenciones y comandos esenciales para trabajar en el proyecto OCEAN. El proyecto se documenta principalmente en español.

---

## 1. Visión general del proyecto

**OCEAN** es una plataforma colaborativa clínica diseñada para trabajar junto a **KAPPA** (estación de trabajo local de EEG). Su propósito es coordinar la revisión de casos EEG entre profesionales, gestionar solicitudes de revisión, conservar la discusión clínica estructurada y promover casos de interés hacia una biblioteca docente validada.

- **No** es un repositorio masivo de EEGs.
- **No** es una red social médica.
- **No** incluye visor de EEG en navegador (la señal se abre en KAPPA local).
- La unidad central del sistema es la **petición de revisión de un caso**.

La estructura del repositorio es:

```
ocean-platform/
├── backend/             # API REST (Node.js + Express + TypeScript + Prisma + SQLite)
├── frontend/            # Aplicación web (React + TypeScript + Vite)
├── scripts/             # Scripts de utilidad (ocean.sh, install-new-machine.sh)
├── docker-compose.yml   # Desarrollo con Docker (PostgreSQL + MinIO)
├── docker-compose.prod.yml # Producción con Docker
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
│   │   └── users.ts          # Listado de usuarios
│   ├── middleware/
│   │   └── auth.ts           # authMiddleware, requireRole
│   └── utils/
│       ├── prisma.ts         # Singleton PrismaClient
│       ├── storage.ts        # Abstracted storage (filesystem / S3)
│       └── cleanup.ts        # Cron cleanup de paquetes expirados
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts               # 4 usuarios de prueba (pass: ocean123)
│   └── migrations/
├── tests/                    # 31 tests de integración (Jest + Supertest)
├── .env / .env.example
└── package.json
```

### Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx               # Rutas: /, /login, /register, /cases/new, /cases/:id, /library, /queue
│   ├── api/
│   │   └── client.ts         # API_BASE dinámico (window.location.hostname:4000)
│   ├── store/
│   │   └── authStore.ts      # Zustand con persistencia
│   ├── hooks/
│   │   └── useCrypto.ts      # AES-GCM (Web Crypto) + fallback node-forge
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Dashboard.tsx
│   │   ├── CaseNew.tsx       # Formulario + cifrado de .edf
│   │   ├── CaseDetail.tsx    # Detalle, descarga, descifrado, comentarios
│   │   ├── TeachingLibrary.tsx
│   │   └── TeachingQueue.tsx
│   └── test/                 # 34 tests en 5 suites (Vitest + RTL)
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
npm test                    # Jest — 31 tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # vite — puerto 5173
npm run build               # tsc && vite build → dist/
npm test                    # Vitest — 34 tests
```

### Control rápido en Minerva (o máquina con ocean.sh)

```bash
source ~/.bashrc            # carga ocean_up y ocean_down
ocean_up                    # Arranca backend + frontend
ocean_down                  # Mata todo limpiamente
```

Ver `docs/MINERVA.md` para la guía completa de uso en el servidor.

---

## 5. Versiones estables

| Tag | Descripción |
|---|---|
| `v0.2.2-stable` | Versión actual. Control ocean_up/down robusto, cifrado fallback, API_BASE dinámico |
| `v0.1.0-dev` | Primera versión funcional (solo localhost, sin control scripts) |

Para instalar en máquina nueva:
```bash
git clone git@github.com:JABarios/ocean-platform.git
cd ocean-platform
git checkout v0.2.2-stable
./scripts/install-new-machine.sh
```

---

## 6. Modelo de datos principal

- **User:** roles (`Clinician`, `Reviewer`, `Curator`, `Admin`)
- **Case:** estados clínicos `Draft → Requested → InReview → Resolved → Archived` (máquina de estados en backend)
- **CasePackage:** blob cifrado (IV + ciphertext AES-GCM), hash SHA-256
- **ReviewRequest:** estados `Pending`, `Accepted`, `Rejected`, `Completed`
- **Comment:** tipos `Comment`, `Conclusion`, `TeachingNote`
- **TeachingProposal:** estados `None → Proposed → Recommended → Validated/Rejected`
- **AuditEvent:** trazabilidad de acciones

---

## 7. Flujo de autenticación y autorización

1. JWT firmado con `JWT_SECRET` (7 días de expiración).
2. Token dual: Zustand persist (`ocean-auth`) + `localStorage` (`ocean_token`) para compatibilidad api/client.
3. `authMiddleware` verifica JWT **y re-valida rol + status contra la DB** en cada petición. Rechaza tokens de usuarios inactivos o roles degradados.
4. `requireRole` protege endpoints sensibles (validación docente).
5. Respuesta 401 → limpia token y recarga página.

---

## 8. Testing

### Backend — 30 tests (Jest + Supertest + SQLite :memory:)

```bash
cd backend && npm test
```

Suites: auth, cases, requests, teaching, packages, comments.

### Frontend — 14 tests (Vitest + React Testing Library)

```bash
cd frontend && npm test
```

Suites: Login, Dashboard, CaseNew, CaseDetail, api.client (manejo de errores).

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
- **Cifrado:** AES-256-GCM en navegador. La clave nunca llega al servidor.

---

## 10. Documentación adicional

- `docs/DEPLOY.md` — Guía de despliegue en Arch Linux (Docker y nativo)
- `docs/MINERVA.md` — Guía rápida para uso en el servidor Minerva
- `OCEAN_Especificaciones_Fusion.md` — Especificación funcional completa
