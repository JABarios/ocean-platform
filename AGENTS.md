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
ocean/
├── ocean-platform/          # Código fuente de la aplicación
│   ├── backend/             # API REST (Node.js + Express + TypeScript + Prisma)
│   ├── frontend/            # Aplicación web (React + TypeScript + Vite)
│   ├── docker-compose.yml   # Orquestación local
│   └── shared/              # (vacío — reservado para tipos/compartidos)
└── *.md                     # Documentación de especificaciones (español)
```

---

## 2. Stack tecnológico

### Backend
- **Runtime:** Node.js 20
- **Framework:** Express 4
- **Lenguaje:** TypeScript 5.4 (target ES2022, módulos CommonJS)
- **ORM:** Prisma 5.12 con `@prisma/client`
- **Base de datos:** SQLite en desarrollo local (`prisma/schema.prisma` usa `provider = "sqlite"`); el `docker-compose.yml` define PostgreSQL 16 para entornos containerizados.
- **Autenticación:** JWT (`jsonwebtoken`) + bcryptjs para hashes de contraseña.
- **Validación:** Zod para validación de payloads de entrada.
- **Dev runner:** `tsx watch` (reemplazo de ts-node-dev).

### Frontend
- **Framework:** React 18
- **Lenguaje:** TypeScript 5.4 (target ES2020, módulos ESNext)
- **Bundler:** Vite 5
- **Routing:** `react-router-dom` v6
- **Gestión de estado:** Zustand v4 (con persistencia en `localStorage`)
- **Estilos:** CSS puro con variables CSS (`src/index.css`). No hay CSS-in-JS ni frameworks de UI.

### Infraestructura / Despliegue
- **Contenedores:** Docker + Docker Compose.
- **Servicios definidos:** `postgres`, `backend`, `frontend`.

---

## 3. Estructura de código

### Backend (`ocean-platform/backend/`)

```
backend/
├── src/
│   ├── index.ts              # Punto de entrada Express. Configura CORS, JSON parser, rutas y error handler.
│   ├── routes/
│   │   ├── auth.ts           # POST /register, POST /login, GET /me
│   │   ├── cases.ts          # CRUD de casos y cambio de estado clínico
│   │   ├── comments.ts       # Comentarios vinculados a casos
│   │   ├── requests.ts       # Solicitudes de revisión (pending, active, accept, reject)
│   │   └── teaching.ts       # Propuestas docentes, recomendaciones y validación
│   ├── middleware/
│   │   └── auth.ts           # authMiddleware, attachUserOptional, requireRole
│   └── utils/
│       └── prisma.ts         # Singleton de PrismaClient con logs condicionales
├── prisma/
│   ├── schema.prisma         # Modelos: User, Group, GroupMember, Case, CasePackage, ReviewRequest, Comment, TeachingProposal, TeachingRecommendation, AuditEvent
│   ├── seed.ts               # Usuarios de prueba: admin@ocean.local, curator@ocean.local, clinician@ocean.local, reviewer@ocean.local (pass: ocean123)
│   └── migrations/           # Migraciones Prisma
├── .env / .env.example       # Variables de entorno (DATABASE_URL, JWT_SECRET, PORT, NODE_ENV)
├── package.json
└── tsconfig.json
```

**Convenciones del backend:**
- Las rutas se agrupan por dominio en archivos bajo `src/routes/`.
- Todos los endpoints protegidos usan `authMiddleware`.
- La validación de entrada se hace con esquemas Zod.
- Los mensajes de error de la API están en español.
- El cliente de Prisma se instancia una sola vez (`utils/prisma.ts`) y se reutiliza en desarrollo mediante `globalThis`.

### Frontend (`ocean-platform/frontend/`)

```
frontend/
├── src/
│   ├── main.tsx              # Monta la app con React.StrictMode y BrowserRouter
│   ├── App.tsx               # Definición de rutas (/, /login, /register, /cases/new, /cases/:id)
│   ├── api/
│   │   └── client.ts         # Cliente fetch genérico con JWT, manejo de 401 y base URL desde VITE_API_URL
│   ├── store/
│   │   └── authStore.ts      # Zustand store: login, register, logout, fetchMe; persiste token en localStorage
│   ├── types.ts              # Interfaces TypeScript compartidas (User, CaseItem, Comment, etc.)
│   ├── components/
│   │   ├── Layout.tsx        # Barra de navegación superior, logout y contenedor principal
│   │   └── ProtectedRoute.tsx # Redirección a /login si no hay token
│   └── pages/
│       ├── Login.tsx
│       ├── Register.tsx
│       ├── Dashboard.tsx     # Lista de casos, revisiones pendientes y activas
│       ├── CaseNew.tsx       # Formulario de creación de caso
│       └── CaseDetail.tsx    # Detalle, comentarios, solicitud de revisión y propuesta docente
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

**Convenciones del frontend:**
- Los estilos están definidos en `index.css` con variables CSS y clases utilitarias simples (`.card`, `.btn-primary`, `.badge`, etc.).
- Algunos componentes incluyen bloques `<style>{`...`}`</style>` para estilos locales (CSS-in-JS ligero mediante JSX).
- Todo el texto de la interfaz está en español.
- No se usan hooks de datos ni bibliotecas de fetching; las llamadas son directas con `api.client.ts`.

---

## 4. Comandos de build y desarrollo

### Backend

```bash
cd ocean-platform/backend

# Instalar dependencias
npm install

# Desarrollo con hot-reload
npm run dev                 # tsx watch src/index.ts

# Compilar
npm run build               # tsc → genera dist/

# Producción
npm run start               # node dist/index.js

# Base de datos
npm run db:migrate          # prisma migrate dev
npm run db:generate         # prisma generate
npm run db:seed             # tsx prisma/seed.ts
```

**Nota:** El backend requiere un archivo `.env`. Ver `.env.example` para las variables necesarias.

### Frontend

```bash
cd ocean-platform/frontend

# Instalar dependencias
npm install

# Desarrollo
npm run dev                 # vite --host (puerto 5173)

# Compilar para producción
npm run build               # tsc && vite build → genera dist/

# Previsualizar build
npm run preview             # vite preview
```

### Docker Compose (todo el stack)

```bash
cd ocean-platform

# Levantar PostgreSQL + backend + frontend
docker-compose up --build

# El backend estará en http://localhost:4000
# El frontend estará en http://localhost:5173
# PostgreSQL en localhost:5432
```

El `docker-compose.yml` configura:
- `DATABASE_URL=postgresql://ocean:oceanpass@postgres:5432/ocean_db` para el backend.
- `VITE_API_URL=http://localhost:4000` para el frontend.
- El backend ejecuta automáticamente `npx prisma migrate dev --name init` antes de arrancar en modo dev.

---

## 5. Modelo de datos principal

Los modelos clave de Prisma (`prisma/schema.prisma`) son:

- **User:** identidad, roles (`Clinician`, `Reviewer`, `Curator`, `Admin`), estado (`Pending`/`Active`).
- **Group:** grupos cerrados de revisión con miembros (`GroupMember`).
- **Case:** caso clínico con metadatos (título, contexto, edad, modalidad, tags). Estados clínicos: `Draft`, `Requested`, `InReview`, `Resolved`, `Archived`. Estados docentes: `None`, `Proposed`, `Recommended`, `Validated`, `Rejected`.
- **CasePackage:** paquete cifrado del caso (referencia al blob, hash, estado de subida).
- **ReviewRequest:** solicitud de revisión de un caso a un usuario o grupo. Estados: `Pending`, `Accepted`, `Rejected`, `Completed`.
- **Comment:** comentario vinculado a un caso. Tipos: `Comment`, `Conclusion`, `TeachingNote`.
- **TeachingProposal:** propuesta para convertir un caso en material docente.
- **TeachingRecommendation:** recomendación cualificada de un usuario a una propuesta docente.
- **AuditEvent:** trazabilidad de acciones clave sobre casos.

**Nota sobre campos JSON:**
Dado que el schema actual usa SQLite, los campos que conceptualmente son JSON (`tags`, `preferences`, `summaryMetrics`, `metadata`) se almacenan como cadenas de texto (`String`) y se hace `JSON.parse`/`JSON.stringify` en los controladores.

---

## 6. Flujo de autenticación y autorización

1. **Registro/Login:** El backend emite un JWT firmado con `JWT_SECRET` (expira en 7 días).
2. **Frontend:** El token se almacena en `localStorage` bajo la clave `ocean_token`. El `authStore` de Zustand lo persiste y lo adjunta a cada petición vía el header `Authorization: Bearer <token>`.
3. **Middleware:** `authMiddleware` verifica el JWT en cada petición protegida y adjunta `req.user`.
4. **Roles:** `requireRole(['Curator', 'Admin'])` protege endpoints sensibles como la validación de propuestas docentes.
5. **Logout automático:** Si el backend responde 401, el cliente elimina el token y recarga la página.

---

## 7. Guía de estilo y convenciones

- **Idioma:** Todo el código fuente de la UI y los mensajes de error de la API están en **español**. Los nombres de variables, funciones y tipos están en inglés siguiendo convenciones TypeScript habituales.
- **TypeScript:** Ambos proyectos usan `strict: true`.
- **Backend:**
  - Módulos CommonJS (`"module": "commonjs"`).
  - Importaciones con sintaxis ES (`import`/`export`) gracias a `esModuleInterop`.
  - Rutas Express: manejo manual de `async/await` con `return` para evitar enviar múltiples respuestas.
- **Frontend:**
  - Módulos ES (`"type": "module"`).
  - Componentes funcionales con hooks.
  - Estilos preferentemente en `index.css`; estilos locales permitidos mediante bloques `<style>` dentro del JSX.
- **No hay configurado ESLint ni Prettier.** Si se añaden, deben respetar el estilo existente.

---

## 8. Testing

### Backend (`ocean-platform/backend/`)

- **Framework:** Jest 29 + Supertest
- **Base de datos de tests:** SQLite `:memory:` via `TEST_DATABASE_URL`
- **Setup:** `tests/setup.ts` crea el schema ejecutando el DDL de `prisma/migrations/migration.sql`
- **Comando:** `npm test` → 30 tests de integración en 5 suites (auth, cases, requests, teaching, packages)

```bash
cd ocean-platform/backend
npm test
```

**Suites de test:**
- `auth.test.ts` — registro, login, perfil de usuario
- `cases.test.ts` — CRUD de casos, cambio de estado clínico, listado
- `requests.test.ts` — flujo completo de solicitudes de revisión (crear, listar pending/active, aceptar, rechazar)
- `teaching.test.ts` — propuestas, recomendaciones, validación por curator, biblioteca, cola
- `packages.test.ts` — subida y descarga de paquetes cifrados

### Frontend (`ocean-platform/frontend/`)

- **Framework:** Vitest + React Testing Library + MSW
- **Setup:** `src/test/setup.ts` provee mocks de `api/client`, `react-router-dom` y Zustand store
- **Comando:** `npm test` → 11 tests en 3 suites

```bash
cd ocean-platform/frontend
npm test
```

**Suites de test:**
- `Login.test.tsx` — renderizado, login exitoso, errores de credenciales
- `Dashboard.test.tsx` — carga de casos y revisiones, filtrado por estado
- `CaseNew.test.tsx` — creación de caso, validación de campos, subida de archivo `.edf` con cifrado

### Convenciones de testing

- Credenciales de prueba (todas con contraseña `ocean123`):
  - `clinician@ocean.local`, `reviewer@ocean.local`, `curator@ocean.local`, `admin@ocean.local`
- Tests de backend usan `beforeEach` para truncar tablas entre tests.
- Tests de frontend usan `vi.mock` para interceptar llamadas a la API; no hay llamadas de red reales.

---

## 9. Consideraciones de seguridad

- **JWT_SECRET:** En desarrollo tiene un fallback (`dev-secret-change-me`). En producción debe ser una cadena larga y aleatoria configurada mediante variable de entorno.
- **CORS:** En desarrollo se permite explícitamente `http://localhost:5173`. En producción el origen debe restringirse.
- **Contraseñas:** Hasheadas con bcrypt a 10 rounds.
- **Validación de entrada:** Zod en todos los endpoints que reciben body.
- **Autorización:** Verificación de propiedad del caso (`ownerId`) o participación en la revisión (`ReviewRequest`) antes de permitir lectura/escritura sobre casos y comentarios.
- **SQL Injection:** Mitigado por el uso de Prisma ORM (queries parametrizadas).

---

## 10. Documentación adicional

En la raíz del repositorio existen tres archivos de especificación en español que detallan los objetivos, principios de diseño y alcance funcional de la plataforma:

- `# Especificación de la plataforma OCEAN.md`
- `OCEAN_Especificaciones_Fusion.md`
- `OCEAN_Especificaciones_Plataforma.md`

Son la referencia de dominio para entender el propósito de cada funcionalidad (gestión de casos, flujo de revisión, curación docente, auditoría, etc.).
