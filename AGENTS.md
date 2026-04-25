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
- **Servicios definidos:** `postgres`, `minio`, `backend`, `frontend`.

---

## 3. Estructura de código

### Backend (`ocean-platform/backend/`)

```
backend/
├── src/
│   ├── index.ts              # Punto de entrada Express. Configura CORS, JSON parser, rutas y error handler.
│   ├── routes/
│   │   ├── auth.ts           # POST /register, POST /login, GET /me
│   │   ├── cases.ts          # CRUD de casos y cambio de estado clínico (con máquina de estados)
│   │   ├── comments.ts       # Comentarios vinculados a casos (con control de acceso en GET)
│   │   ├── packages.ts       # Subida y descarga de paquetes EEG cifrados
│   │   ├── requests.ts       # Solicitudes de revisión (pending, active, accept, reject)
│   │   ├── teaching.ts       # Propuestas docentes, recomendaciones y validación
│   │   └── users.ts          # Listado de usuarios activos
│   ├── middleware/
│   │   └── auth.ts           # authMiddleware (re-valida rol y status desde BD), requireRole
│   └── utils/
│       ├── cleanup.ts        # Jobs cron: expirar ReviewRequests, eliminar paquetes caducados
│       ├── prisma.ts         # Singleton de PrismaClient con logs condicionales
│       └── storage.ts        # Abstracción de almacenamiento: filesystem local o S3/MinIO
├── prisma/
│   ├── schema.prisma         # Modelos: User, Group, GroupMember, Case, CasePackage, ReviewRequest, Comment, TeachingProposal, TeachingRecommendation, AuditEvent
│   ├── seed.ts               # Usuarios de prueba: admin@ocean.local, curator@ocean.local, clinician@ocean.local, reviewer@ocean.local (pass: ocean123)
│   └── migrations/           # Migraciones Prisma
├── tests/
│   ├── setup.ts              # SQLite :memory:, DDL completo, beforeAll/afterEach
│   ├── helpers.ts            # createUser, createCase, createReviewRequest, generateToken, prisma
│   ├── auth.test.ts
│   ├── cases.test.ts
│   ├── comments.test.ts
│   ├── requests.test.ts
│   └── teaching.test.ts
├── .env                      # Variables de entorno locales (NO se versiona — ver .gitignore)
├── .env.example              # Plantilla de variables necesarias (sin valores secretos)
├── .gitignore                # Excluye .env, node_modules/, uploads/, dev.db*
├── package.json
└── tsconfig.json
```

**Convenciones del backend:**
- Las rutas se agrupan por dominio en archivos bajo `src/routes/`.
- Todos los endpoints protegidos usan `authMiddleware`.
- La validación de entrada se hace con esquemas Zod.
- Los mensajes de error de la API están en español.
- El cliente de Prisma se instancia una sola vez (`utils/prisma.ts`) y se reutiliza en desarrollo mediante `globalThis`.
- Las operaciones que implican múltiples escrituras en BD usan `prisma.$transaction` para garantizar atomicidad.

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
│   ├── hooks/
│   │   └── useCrypto.ts      # Cifrado/descifrado AES-256-GCM client-side (Web Crypto API)
│   ├── types.ts              # Interfaces TypeScript compartidas (User, CaseItem, Comment, etc.)
│   ├── components/
│   │   ├── Layout.tsx        # Barra de navegación superior, logout y contenedor principal
│   │   └── ProtectedRoute.tsx # Redirección a /login si no hay token
│   └── pages/
│       ├── Login.tsx
│       ├── Register.tsx
│       ├── Dashboard.tsx     # Lista de casos, revisiones pendientes y activas
│       ├── CaseNew.tsx       # Formulario de creación de caso con cifrado de archivo EDF
│       ├── CaseDetail.tsx    # Detalle, comentarios, solicitud de revisión y propuesta docente
│       ├── TeachingLibrary.tsx
│       └── TeachingQueue.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

**Convenciones del frontend:**
- Los estilos están definidos en `index.css` con variables CSS y clases utilitarias simples (`.card`, `.btn-primary`, `.badge`, etc.).
- Algunos componentes incluyen bloques `<style>{`...`}`</style>` para estilos locales (CSS-in-JS ligero mediante JSX).
- Todo el texto de la interfaz está en español.
- No se usan hooks de datos ni bibliotecas de fetching; las llamadas son directas con `api/client.ts`.
- **El token de autenticación se lee siempre de `useAuthStore((s) => s.token)`.** Nunca usar `localStorage.getItem('ocean_token')` ni ninguna otra clave directamente en componentes.

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

# Tests
npm test                    # jest --runInBand → 65 tests de integración
```

**Nota:** El backend requiere un archivo `.env`. Copiar `.env.example` y rellenar los valores. El archivo `.env` no se versiona (ver `.gitignore`).

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

# Tests
npm test                    # vitest run → 38 tests en 4 suites
```

### Docker Compose (todo el stack)

```bash
cd ocean-platform

# Levantar PostgreSQL + MinIO + backend + frontend
docker-compose up --build

# El backend estará en http://localhost:4000
# El frontend estará en http://localhost:5173
# PostgreSQL en localhost:5432
# MinIO console en http://localhost:9001
```

El `docker-compose.yml` configura:
- `DATABASE_URL=postgresql://ocean:oceanpass@postgres:5432/ocean_db` para el backend.
- `VITE_API_URL=http://localhost:4000` para el frontend.
- El backend ejecuta automáticamente `npx prisma migrate dev --name init` antes de arrancar en modo dev.
- MinIO requiere credenciales `S3_ACCESS_KEY` / `S3_SECRET_KEY` en el `.env` del backend.

---

## 5. Modelo de datos principal

Los modelos clave de Prisma (`prisma/schema.prisma`) son:

- **User:** identidad, roles (`Clinician`, `Reviewer`, `Curator`, `Admin`), estado (`Pending`/`Active`).
- **Group:** grupos cerrados de revisión con miembros (`GroupMember`).
- **Case:** caso clínico con metadatos (título, contexto, edad, modalidad, tags). Estados clínicos: `Draft`, `Requested`, `InReview`, `Resolved`, `Archived`. Estados docentes: `None`, `Proposed`, `Recommended`, `Validated`, `Rejected`.
- **CasePackage:** paquete cifrado del caso (referencia al blob, hash, estado de subida, política de retención).
- **ReviewRequest:** solicitud de revisión de un caso a un usuario o grupo. Estados: `Pending`, `Accepted`, `Rejected`, `Expired`, `Completed`.
- **Comment:** comentario vinculado a un caso. Tipos: `Comment`, `Conclusion`, `TeachingNote`. La respuesta de la API devuelve el contenido bajo el campo `content` (no `body`).
- **TeachingProposal:** propuesta para convertir un caso en material docente.
- **TeachingRecommendation:** recomendación cualificada de un usuario a una propuesta docente (máximo una por usuario por propuesta).
- **AuditEvent:** trazabilidad de acciones clave sobre casos.

**Nota sobre campos JSON:**
Dado que el schema actual usa SQLite, los campos que conceptualmente son JSON (`tags`, `preferences`, `summaryMetrics`, `metadata`) se almacenan como cadenas de texto (`String`) y se serializa/deserializa en los controladores. Las respuestas de la API siempre devuelven `tags` como array.

---

## 6. Flujo de autenticación y autorización

1. **Registro/Login:** El backend emite un JWT firmado con `JWT_SECRET` (expira en 7 días). **Tanto `/register` como `/login` devuelven `{ token, user: { id, email, displayName, role } }`.**
2. **Frontend:** El token se gestiona exclusivamente mediante Zustand `persist` bajo la clave `ocean-auth` en `localStorage`. El cliente HTTP (`api/client.ts`) lo lee de esa clave. No se usa `localStorage.setItem('ocean_token', ...)` en ningún lugar del código.
3. **Middleware:** `authMiddleware` verifica el JWT y **consulta la BD en cada petición** para obtener el rol y status actuales del usuario. Si el usuario no existe o su status no es `Active`, devuelve 401. El rol del JWT se ignora; se usa siempre el rol de BD.
4. **Roles:** `requireRole(['Curator', 'Admin'])` protege endpoints sensibles como la validación de propuestas docentes.
5. **Logout automático:** Si el backend responde 401, el cliente elimina la clave `ocean-auth` de `localStorage` y recarga la página.

---

## 7. Máquina de estados de casos

Las transiciones de `statusClinical` están restringidas. `PATCH /cases/:id/status` rechaza con 400 cualquier transición no permitida:

```
Draft      → Requested, Archived
Requested  → Draft, InReview, Archived
InReview   → Resolved, Archived
Resolved   → Archived
Archived   → (ninguna)
```

La transición `Draft → Requested` también ocurre automáticamente al crear una `ReviewRequest` desde `Draft`.

---

## 8. Almacenamiento de paquetes EEG

Los paquetes EEG están cifrados client-side con AES-256-GCM antes de salir del navegador. El servidor nunca ve la clave de descifrado.

- **Subida:** `POST /packages/upload` (multipart). Multer escribe el archivo temporalmente en disco (`UPLOAD_DIR/tmp/`), calcula el SHA-256 por streaming, lo mueve al almacenamiento final y elimina el temporal. El límite de tamaño es 2 GB pero **no se carga en memoria**.
- **Descarga:** `GET /packages/download/:caseId`. Solo accesible para el owner del caso o revisores con solicitud aceptada.
- **Almacenamiento:** filesystem local (desarrollo) o S3/MinIO (producción). Configurado por `STORAGE_TYPE` en `.env`.
- **Retención:** los paquetes `Temporal72h` se eliminan automáticamente por el cron hourly. Los paquetes `Teaching` no expiran. Las `ReviewRequest` pendientes con `expiresAt` pasado se marcan como `Expired` por el mismo cron.

---

## 9. Jobs de limpieza (cron)

Definidos en `utils/cleanup.ts`, arrancan con `startCleanupJob()` al iniciar el servidor:

| Frecuencia | Acción |
|---|---|
| Cada hora | Marcar como `Expired` las `ReviewRequest` con `status=Pending` y `expiresAt < now` |
| Cada hora | Eliminar `CasePackage` con `expiresAt < now` y `retentionPolicy != Teaching` |
| Diario (03:00) | Eliminar paquetes `UntilReviewClose` de casos `Archived` sin propuesta docente, con más de 7 días desde `resolvedAt` |

---

## 10. Guía de estilo y convenciones

- **Idioma:** Todo el código fuente de la UI y los mensajes de error de la API están en **español**. Los nombres de variables, funciones y tipos están en inglés siguiendo convenciones TypeScript habituales.
- **TypeScript:** Ambos proyectos usan `strict: true`.
- **Backend:**
  - Módulos CommonJS (`"module": "commonjs"`).
  - Importaciones con sintaxis ES (`import`/`export`) gracias a `esModuleInterop`.
  - Rutas Express: manejo manual de `async/await` con `return` para evitar enviar múltiples respuestas.
  - Serialización de respuestas: usar spread explícito (`{ ...obj, campo: valor }`) en lugar de `JSON.parse(JSON.stringify(obj))`.
  - Escrituras múltiples en BD: siempre dentro de `prisma.$transaction`.
- **Frontend:**
  - Módulos ES (`"type": "module"`).
  - Componentes funcionales con hooks.
  - Estilos preferentemente en `index.css`; estilos locales permitidos mediante bloques `<style>` dentro del JSX.
- **No hay configurado ESLint ni Prettier.** Si se añaden, deben respetar el estilo existente.

---

## 11. Testing

### Backend (`ocean-platform/backend/`)

- **Framework:** Jest 29 + Supertest
- **Base de datos de tests:** SQLite `:memory:` vía `DATABASE_URL=file::memory:` en `setup.ts`
- **Setup:** `tests/setup.ts` crea el schema ejecutando el DDL completo antes de todos los tests; trunca todas las tablas después de cada test individual.
- **Comando:** `npm test` → **65 tests de integración** en 5 suites

```bash
cd ocean-platform/backend
npm test
```

**Suites de test:**

| Suite | Tests | Qué cubre |
|---|---|---|
| `auth.test.ts` | 10 | Registro (devuelve token), login, `/me`, usuario inactivo bloqueado, token con rol stale rechazado |
| `cases.test.ts` | 14 | CRUD, listado, tags como array, campos `status`/`teachingStatus`, acceso de revisor, audit event, todas las transiciones válidas e inválidas de la máquina de estados |
| `requests.test.ts` | 12 | Crear solicitud, validaciones (sin destinatario, no-owner), aceptar/rechazar, `/pending`, `/active`, acceso de terceros bloqueado, doble-accept bloqueado |
| `comments.test.ts` | 9 | Añadir comentario, revisor aceptado puede comentar, intruder bloqueado en GET y POST, body vacío, campo `content` en respuesta |
| `teaching.test.ts` | 20 | Proponer, duplicado bloqueado (fix TOCTOU), acceso sin permiso, recomendar, doble recomendación bloqueada, umbral 2→Recommended, validar, rechazar con motivo, statusTeaching actualizado, biblioteca filtrada, tags como array |

> **Nota:** No existe `packages.test.ts`. El endpoint `/packages/upload` y `/packages/download` no tienen tests de integración todavía (requieren ficheros binarios y stub de almacenamiento).

**Helpers disponibles en `tests/helpers.ts`:**
- `createUser({ email, displayName, role?, password? })` — crea usuario con `status: Active`
- `createCase(ownerId, data?)` — crea caso en estado `Draft` por defecto
- `createReviewRequest({ caseId, requestedBy, targetUserId })` — crea solicitud `Pending`
- `generateToken(userId, email, role)` — genera JWT de test (secreto: `test-secret-...`)
- `prisma` — instancia Prisma para manipulación directa en tests

### Frontend (`ocean-platform/frontend/`)

- **Framework:** Vitest + React Testing Library
- **Setup:** `src/test/setup.ts` — mock de `localStorage` y `matchMedia` para jsdom
- **Mocks de red:** `src/test/mocks.ts` — helpers `mockFetch`, `mockFetchSequence` (usa `vi.stubGlobal` y devuelve la referencia al mock para inspeccionar llamadas)
- **Comando:** `npm test` → **38 tests en 4 suites**

```bash
cd ocean-platform/frontend
npm test
```

**Suites de test:**

| Suite | Tests | Qué cubre |
|---|---|---|
| `Login.test.tsx` | 3 | Renderizado, login exitoso, credenciales inválidas |
| `CaseNew.test.tsx` | 3 | Formulario, validación de campos, POST al crear |
| `Dashboard.test.tsx` | 12 | Carga inicial, revisiones pendientes/activas, **aceptar/rechazar llaman a `/accept` y `/reject` (no `/accepted`/`/rejected`)**, refresco de lista tras acción |
| `CaseDetail.test.tsx` | 20 | Carga, metadatos, badges de estado, owner vs no-owner, botones de cambio de estado, PATCH al hacer clic, comentarios (POST + lista + limpieza), sección de paquete EEG visible/oculta |

### Convenciones de testing

- Credenciales de prueba (todas con contraseña `ocean123`):
  - `clinician@ocean.local`, `reviewer@ocean.local`, `curator@ocean.local`, `admin@ocean.local`
- Tests de backend usan `afterEach` para truncar tablas entre tests (aislamiento total).
- Tests de frontend: **no hay llamadas de red reales**. Se mockea `fetch` con `vi.stubGlobal`.
  - Para una sola respuesta: `mockFetch(data)`.
  - Para secuencias de múltiples llamadas (carga paralela + acciones): `const fetchMock = mockFetchSequence([...])`. La función devuelve la referencia al mock; úsala para inspeccionar `fetchMock.mock.calls` en lugar de leer `global.fetch`.
  - Los módulos con estado externo (`useAuthStore`, `useParams`) se mockean con `vi.mock(...)` a nivel de fichero de test.

---

## 12. Consideraciones de seguridad

- **JWT_SECRET:** En producción debe ser una cadena larga y aleatoria. No tiene fallback a un valor conocido en producción; se debe configurar obligatoriamente en `.env`.
- **Re-validación de roles:** El `authMiddleware` consulta la BD en **cada petición** para obtener el rol y status del usuario. Un token válido de un usuario degradado o desactivado es rechazado inmediatamente con 401.
- **CORS:** En desarrollo se permite explícitamente `http://localhost:5173`. En producción el origen debe restringirse.
- **Contraseñas:** Hasheadas con bcrypt a 10 rounds.
- **Validación de entrada:** Zod en todos los endpoints que reciben body.
- **Autorización:** Verificación de propiedad del caso (`ownerId`) o participación en la revisión (`ReviewRequest`) antes de permitir lectura/escritura sobre casos, comentarios y paquetes.
- **Paquetes EEG:** Cifrado AES-256-GCM client-side. El servidor almacena únicamente el blob cifrado; nunca ve la clave de descifrado.
- **MinIO/S3:** El bucket `ocean-cases` **no tiene acceso anónimo**. Toda descarga pasa por el endpoint autenticado del backend.
- **SQL Injection:** Mitigado por el uso de Prisma ORM (queries parametrizadas).
- **`.env`:** Excluido del control de versiones mediante `.gitignore`. Usar `.env.example` como plantilla.

---

## 13. Documentación adicional

En la raíz del repositorio existen tres archivos de especificación en español que detallan los objetivos, principios de diseño y alcance funcional de la plataforma:

- `# Especificación de la plataforma OCEAN.md`
- `OCEAN_Especificaciones_Fusion.md`
- `OCEAN_Especificaciones_Plataforma.md`

Son la referencia de dominio para entender el propósito de cada funcionalidad (gestión de casos, flujo de revisión, curación docente, auditoría, etc.).
