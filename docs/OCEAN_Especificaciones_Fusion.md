# OCEAN — Especificaciones de Plataforma (Documento Fusión)
## Integración con KAPPA para revisión clínica, discusión y curación docente de EEG

**Versión:** 0.3 — Fusión de visión fundacional + estado actual  
**Fecha:** 2026-04-29  
**Autores:** Documento fundacional + especificación técnica fusionados  
**Relación con KAPPA:** Cliente colaborativo / Backend de coordinación

---

## 0. Estado actual implementado

Desde la redacción inicial de este documento, OCEAN ya ha incorporado una parte relevante de la capa operativa prevista y además varias funciones nuevas.

### 0.1 Funciones hoy presentes
- Visor EEG web integrado en OCEAN.
- Persistencia del estado del visor por usuario y `blobHash`.
- Caché local del paquete cifrado en navegador.
- Custodia de la clave EEG en OCEAN, con recuperación mediante contraseña del usuario.
- Revelación controlada de la clave por parte del propietario del caso.
- Anonimización de cabecera EDF antes del cifrado en la subida.
- `EegRecord` reutilizable con deduplicación por hash.
- Panel propio de `EEGs`.
- `Galerías` de EEGs públicos o completamente anonimizados.
- Importación de galerías desde directorio local del servidor preparado por herramientas externas.
- Área de `Admin` separada, sin perder el flujo clínico normal.

### 0.2 Qué sigue siendo cierto
Siguen siendo válidos los principios de sobriedad clínica, control de acceso, trazabilidad y separación entre discusión profesional y repositorio indiscriminado.

### 0.3 Cómo leer el resto del documento
El resto debe leerse como **documento de intención y arquitectura**, complementado por este estado actual.

## 1. Resumen ejecutivo

OCEAN es la capa colaborativa del ecosistema KAPPA. Mientras KAPPA es la estación de trabajo local para apertura, revisión, filtrado y análisis qEEG, OCEAN es la plataforma que permite:

- Solicitar revisiones de casos EEG a colegas o grupos.
- Gestionar el ciclo de vida de esa petición (solicitada → aceptada → revisada → resuelta).
- Conservar la discusión clínica asociada a cada caso de forma estructurada y trazable.
- Promover casos de especial interés a una biblioteca docente validada por la comunidad.

OCEAN **no** es un repositorio masivo indiscriminado de EEGs, ni una red social médica, ni un motor de IA diagnóstica. Es una **infraestructura de coordinación clínica** cuya unidad básica es la **petición de revisión de un caso**, aunque hoy también incorpora visor web, registros EEG reutilizables y galerías curadas.

> **Promesa de seguridad:** OCEAN garantiza control, dificultad de extracción y trazabilidad. No garantiza DRM perfecto ni imposibilidad metafísica de copia. La promesa correcta es profesional, no mágica.

---

## 2. Alcance y límites

### 2.1 Dentro del alcance (MVP)
- Registro de usuarios y gestión de identidad profesional.
- Creación de casos de revisión con metadatos mínimos.
- Envío de solicitudes de revisión a usuarios o grupos.
- Aceptación/rechazo de solicitudes.
- Transferencia o habilitación de acceso al paquete de caso (EEG + metadatos) mediante **buzón central cifrado**.
- Comentarios y conclusiones vinculados al caso.
- Estados clínicos del caso con trazabilidad completa.
- Propuesta de casos para docencia.
- Sistema de recomendaciones y validación docente ligera (1-2 curadores).
- Tags docentes básicos (patrón, artefacto, pediatría, UCI, etc.).
- Auditoría básica de eventos.

### 2.2 Fuera del alcance (MVP)
- Almacenamiento permanente centralizado de todos los EEGs de todos los usuarios.
- Interpretación automática o asistencia por IA.
- Mensajería directa desvinculada de casos.
- Publicaciones científicas o foros abiertos.
- Transferencia P2P compleja (post-MVP).
- Sincronización multiusuario avanzada.
- Comentarios anclados a trazado con precisión de muestra.
- Recomendador sofisticado.
- Marketplace de plugins.
- Repositorio abierto masivo.

> **Nota de actualización:** el visor EEG web ya forma parte del sistema real. KAPPA sigue siendo el entorno local más completo para trabajo avanzado.

---

## 3. Principios de diseño

### 3.1 Centralidad del caso
La unidad principal del sistema no es el archivo aislado, sino la **petición de revisión de un caso**.

### 3.2 Separación de responsabilidades
- **KAPPA**: tratamiento local del EEG (abrir, filtrar, cuantificar, anonimizar).
- **OCEAN**: coordinación, discusión, permisos y memoria compartida.

### 3.3 Privacidad y control
OCEAN no obliga a almacenamiento central permanente del EEG en claro. El modelo preferente es: **caso cifrado + acceso controlado + entrega bajo aceptación explícita**.

### 3.4 Sobriedad profesional
OCEAN debe parecer una plataforma clínica/académica, no una red social generalista.

### 3.5 Curación progresiva
La biblioteca docente debe surgir de casos revisados y recomendados, no de acumulación indiscriminada.

### 3.6 Utilidad antes que grandilocuencia
La primera misión es ser útil para la práctica profesional. Las capas más ambiciosas se construyen sobre esa utilidad real.

---

## 4. Arquitectura de sistema

### 4.1 Principio arquitectónico: coordinación, no acumulación
OCEAN opera como un **orquestador de relaciones clínicas**. El EEG no es un activo permanente del servidor salvo en casos puntuales (buffer temporal o biblioteca docente validada con consentimiento explícito).

```
┌─────────────────────────────────────────────────────────────┐
│                      OCEAN CONTROL CLOUD                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Identity &  │  │  Case State  │  │  Social/Teaching │  │
│  │  Permissions │  │  Machine     │  │  Layer           │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Comment &   │  │  Audit &     │  │  Notification    │  │
│  │  Discussion  │  │  Compliance  │  │  Service         │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  APIs: REST / GraphQL                                       │
└─────────────────────────────────────────────────────────────┘
         ▲                           ▲
         │                           │
┌────────┴────────┐         ┌────────┴────────┐
│   KAPPA LOCAL   │◄───────►│  KAPPA LOCAL    │
│  (Solicitante)  │  P2P /  │   (Revisor)     │
│                 │  Buffer  │                 │
└─────────────────┘         └─────────────────┘
```

### 4.2 Componentes del núcleo central

| Componente | Responsabilidad |
|-----------|-----------------|
| **Identity Service** | Registro, autenticación, perfiles profesionales, grupos/centros. |
| **Case State Service** | Estados clínicos y docentes, transiciones, auditoría. |
| **Request Service** | Creación, envío, aceptación y rechazo de peticiones de revisión. |
| **Comment Service** | Comentarios estructurados por caso, conclusiones, hilos. |
| **Teaching Service** | Propuestas docentes, recomendaciones, validación curatorial, tags. |
| **Transfer/Mailbox Service** | Almacenamiento temporal cifrado, entrega autorizada, señalización y custodia controlada de claves. |
| **Notification Service** | Alertas de solicitudes, comentarios, cambios de estado. |
| **Audit Service** | Eventos de acceso, aceptación, descarga, cierre, cambios de estado. |
| **EEG Record Service** | Dedupe por hash, reutilización y trazabilidad de blobs EEG. |
| **Gallery Service** | Gestión de colecciones curadas de EEGs anónimos o públicos. |

### 4.3 Modalidades de transferencia de caso
1. **Buffer temporal cifrado (MVP):** El paquete se almacena cifrado en el servidor durante un tiempo limitado (ej. 72h) hasta que el revisor lo recoge. El servidor no puede descifrarlo.
2. **P2P directo (post-MVP):** Ambos usuarios en línea, transferencia cifrada punto a punto.
3. **Préstamo de acceso (post-MVP):** El caso permanece en posesión del solicitante; el revisor obtiene un token de acceso temporal.

> **Decisión de diseño:** El servidor OCEAN nunca almacena EEGs en claro de forma permanente. Mantiene blobs cifrados, metadatos, estados, comentarios, auditoría, referencias, registros EEG reutilizables y galerías cuando procede.

---

## 5. Modelo de datos

### 5.1 Entidades principales

#### `User` (Profesional)
```
user_id             UUID
email               String (único, verificado)
display_name        String
institution         String (opcional)
specialty           Enum: [Neurofisiología, Neurología, Pediatría, ...]
role                Enum: [Clinician, Reviewer, Curator, Admin]
public_key          String (para cifrado de claves de caso)
preferences         JSON
status              Enum: [Active, Pending, Suspended]
created_at          Timestamp
```

#### `Group` (Equipo / Servicio / Centro)
```
group_id            UUID
name                String
description         Text
type                Enum: [Open, Closed, InviteOnly]
members             User[]
admin               User
is_open             Boolean (¿acepta solicitudes externas?)
rules               JSON
```

#### `Case` (Caso clínico)
```
case_id             UUID
owner_user_id       UUID -> User
title               String (breve, opcional en borrador)
clinical_context    Text (resumido)
age_range           Enum: [Neonato, Lactante, Niño, Adolescente, Adulto, >65]
study_reason        Text
modality            String (EEG, V-EEG, cEEG, etc.)
tags                String[]
status_clinical     Enum -> ver §6.1
status_teaching     Enum -> ver §6.2
visibility          Enum: [Private, Shared, Teaching]
package_id          UUID -> CasePackage
summary_metrics     JSON (resumen cuantitativo KAPPA)
resolution_summary  Text (conclusión final del caso)
created_at          Timestamp
resolved_at         Timestamp (nullable)
```

#### `CasePackage` (Paquete de datos)
```
package_id          UUID
case_id             UUID -> Case
package_format_version String
encryption_mode     Enum: [AES256-GCM, ...]
blob_location       String (referencia al storage)
blob_hash           String (hash de integridad SHA-256)
size_bytes          Integer
upload_status       Enum: [Uploading, Ready, Delivered, Expired]
retention_policy    Enum: [UntilReviewClose, Teaching, Temporal72h, ManualDelete]
expires_at          Timestamp
```

#### `ReviewRequest` (Petición de revisión)
```
request_id          UUID
case_id             UUID -> Case
requested_by        UUID -> User
target_user_id      UUID -> User (nullable si es grupo)
target_group_id     UUID -> Group (nullable si es usuario)
status              Enum: [Pending, Accepted, Rejected, Completed, Expired]
message             Text (contexto de la petición)
created_at          Timestamp
accepted_at         Timestamp
completed_at        Timestamp
expires_at          Timestamp (7 días por defecto)
```

#### `Comment` (Comentario / Conclusión)
```
comment_id          UUID
case_id             UUID -> Case
author_id           UUID -> User
request_id          UUID -> ReviewRequest (nullable)
body                Text
type                Enum: [Comment, Conclusion, TeachingNote]
optional_anchor     String (referencia temporal o canal, post-MVP)
created_at          Timestamp
```

#### `TeachingProposal` (Propuesta docente)
```
proposal_id         UUID
case_id             UUID -> Case
proposer_id         UUID -> User
status              Enum: [Proposed, Recommended, Validated, Rejected]
summary             Text (resumen docente, qué enseña este caso)
key_findings        Text
learning_points     Text
difficulty          Enum: [Introductory, Intermediate, Advanced]
tags                String[]
recommended_by      User[]
validated_by        UUID -> User (curador)
validated_at        Timestamp
rejection_reason    Text
```

#### `AuditEvent` (Evento de auditoría)
```
event_id            UUID
actor_id            UUID -> User
case_id             UUID -> Case (nullable)
action              Enum: [CaseCreated, RequestSent, RequestAccepted, RequestRejected, PackageUploaded, PackageDownloaded, CaseOpened, Commented, CaseResolved, TeachingProposed, TeachingValidated, TeachingRejected, StatusChanged, Deleted]
timestamp           Timestamp
target              String (qué se vio afectado)
metadata            JSON (IP, user-agent, etc.)
```

### 5.2 Relaciones
```
User 1---* Case (owner)
User 1---* ReviewRequest (requested_by)
User 1---* ReviewRequest (target_user_id)
Case 1---* ReviewRequest
Case 1---* Comment
Case 1---1 CasePackage
Case 1---* TeachingProposal
Group *---* User
```

---

## 6. Estados y flujos de vida

### 6.1 Estado clínico del caso (`status_clinical`)

| Estado | Descripción | Transiciones posibles |
|--------|-------------|----------------------|
| `Draft` | El caso se está preparando en KAPPA, aún no se ha solicitado revisión. | → `Requested` |
| `Requested` | Se ha enviado al menos una petición de revisión. | → `InReview`, → `Archived` (cancelado) |
| `InReview` | Un revisor ha aceptado; el caso está en análisis activo. | → `Resolved`, → `Requested` (más opiniones) |
| `Resolved` | Se ha alcanzado una conclusión o se cierra el ciclo de revisión. | → `Archived`, → `ProposedForTeaching` |
| `Archived` | Cerrado definitivamente, sin más acción prevista. | — (fin) |

> **Regla:** Un caso debe tener al menos una `ReviewRequest` aceptada para pasar a `InReview`.
> **Regla:** Un caso `Resolved` puede volver a `Requested` si se solicita una nueva opinión.
> **Nota:** Eventos técnicos como `In transfer`, `Available for review` o `Commented` se registran en `AuditEvent`, no como estados clínicos visibles al usuario.

### 6.2 Estado docente del caso (`status_teaching`)

| Estado | Descripción |
|--------|-------------|
| `None` | Sin propuesta docente. Estado por defecto. |
| `Proposed` | Alguien ha propuesto el caso para docencia. Visible en cola de propuestas. |
| `Recommended` | Ha recibido al menos N recomendaciones de colegas (configurable, ej. N=2). |
| `Validated` | Un curador ha validado oficialmente. Recibe tag docente y pasa a biblioteca. |
| `Rejected` | Un curador ha decidido que no aporta suficientemente. |
| `Featured` | Caso destacado por comité curador (post-MVP). |

> **Regla:** Solo un caso en estado `Resolved` o `Archived` puede ser propuesto para docencia.  
> **Regla:** El cambio `Recommended` → `Validated` requiere acción explícita de un `Curator`.  
> **Regla:** Un caso `Rejected` puede re-proponerse si se mejora la documentación.

### 6.3 Diagrama de flujo combinado

```
[DRAFT] ──► [REQUESTED] ──► [IN REVIEW] ──► [RESOLVED] ──► [ARCHIVED]
                                              │
                                              ▼
                                       [PROPOSED FOR TEACHING]
                                              │
                                              ▼
                                       [RECOMMENDED]
                                              │
                                              ▼
                                       [VALIDATED TEACHING CASE]
                                              │
                                              ▼
                                    Biblioteca docente OCEAN
```

---

## 7. Roles de usuario

### 7.1 Autor del caso
Usuario que prepara el caso en KAPPA y solicita revisión.

- Crear caso
- Definir contexto clínico mínimo
- Seleccionar revisores o grupos
- Cerrar caso si es propietario
- Proponer caso para docencia

### 7.2 Revisor
Usuario que acepta una petición de revisión.

- Aceptar o rechazar revisión
- Recibir acceso al caso
- Abrirlo en KAPPA
- Comentar
- Emitir conclusión
- Recomendarlo para docencia

### 7.3 Curador docente (`Curator`)
Usuario con permisos adicionales.

- Revisar propuestas docentes
- Validar o rechazar incorporación docente
- Clasificar casos por categoría
- Asignar tags docentes oficiales

### 7.4 Administrador de grupo / plataforma
Gestiona grupos, membresía, políticas de acceso, incidencias y auditoría.

---

## 8. Requisitos funcionales

### 8.1 RF-IDENT — Identidad y permisos
- **RF-IDENT-01:** Registro con email profesional o institucional verificado.
- **RF-IDENT-02:** Los usuarios pueden crear o unirse a grupos (servicios, centros, redes).
- **RF-IDENT-03:** Los grupos pueden ser abiertos (aceptan solicitudes) o cerrados (solo por invitación).
- **RF-IDENT-04:** Roles base: `Clinician`, `Reviewer`, `Curator`, `Admin`.
- **RF-IDENT-05:** Registro de dispositivo KAPPA vinculado al usuario.

### 8.2 RF-CASE — Gestión de casos
- **RF-CASE-01:** Desde KAPPA: "Preparar caso para OCEAN" → anonimizar, añadir contexto, generar `Case` en estado `Draft`.
- **RF-CASE-02:** Metadatos obligatorios: contexto clínico resumido, rango de edad, motivo de estudio, confirmación de anonimización.
- **RF-CASE-03:** Edición permitida solo en `Draft`. Post-solicitud: solo comentarios o cancelación.
- **RF-CASE-04:** El sistema bloquea el envío si los metadatos mínimos no están completos.

### 8.3 RF-REQ — Peticiones de revisión
- **RF-REQ-01:** El solicitante elige uno o varios destinatarios (usuarios o grupos) y redacta un mensaje de contexto.
- **RF-REQ-02:** El destinatario recibe notificación y puede: Aceptar, Rechazar, o Ignorar (expira en 7 días).
- **RF-REQ-03:** Si se acepta, OCEAN habilita el acceso al paquete cifrado en el buzón.
- **RF-REQ-04:** El revisor descarga el paquete y lo abre en KAPPA local.
- **RF-REQ-05:** El revisor puede dejar comentarios y/o una conclusión formal.
- **RF-REQ-06:** El solicitante recibe notificación de nuevos comentarios/conclusiones.
- **RF-REQ-07:** El caso admite múltiples revisiones concurrentes o secuenciales.

### 8.4 RF-COMM — Comentarios y discusión
- **RF-COMM-01:** Los comentarios están siempre vinculados a un `Case`.
- **RF-COMM-02:** Un comentario puede marcarse como `Conclusion` por el revisor.
- **RF-COMM-03:** Visibilidad: solicitante, revisor/es del caso, y curadores (si hay flujo docente).
- **RF-COMM-04:** No hay "likes". Solo comentarios textuales y recomendaciones para docencia.

### 8.5 RF-TEACH — Curación docente
- **RF-TEACH-01:** Cualquier usuario con acceso puede proponer para docencia si el caso está `Resolved` o `Archived`.
- **RF-TEACH-02:** Al proponer: resumen docente, hallazgo principal, puntos de enseñanza, nivel de dificultad.
- **RF-TEACH-03:** Otros usuarios con acceso pueden "recomendar" la propuesta (opcionalmente con matización).
- **RF-TEACH-04:** Un `Curator` valida o rechaza. Si valida, el caso pasa a `Validated` y recibe tags.
- **RF-TEACH-05:** Casos validados visibles en biblioteca docente OCEAN.
- **RF-TEACH-06:** Biblioteca con filtrado por: tags, dificultad, rango de edad, revisor, fecha.

### 8.6 RF-NOTIF — Notificaciones
- **RF-NOTIF-01:** Solicitud de revisión recibida.
- **RF-NOTIF-02:** Caso aceptado, comentado o resuelto.
- **RF-NOTIF-03:** Propuesta/recomendación/validación docente.
- **RF-NOTIF-04:** Resumen semanal opcional de actividad pendiente.

---

## 9. Paquete de caso que KAPPA enviará a OCEAN

### 9.1 Contenido mínimo
El paquete es un contenedor cifrado que incluye:

- `signal.edf` — EEG anonimizado en EDF/EDF+
- `manifest.json` — índice del caso
- `clinical_summary.json` — metadatos clínicos estructurados
- `metrics.json` — resumen cuantitativo qEEG (KAPPA)
- `qc.json` — control de calidad mínimo
- `review_seed.json` — notas iniciales opcionales del autor
- `preview.png` — vista previa opcional

### 9.2 Requisitos del manifest
```json
{
  "case_id": "uuid",
  "format_version": "1.0",
  "patient_surrogate_id": "hash_local",
  "timestamp_creation": "ISO8601",
  "kappa_version": "x.y.z",
  "pipeline_config": {},
  "files": [
    {"path": "signal.edf", "hash": "sha256:...", "size_bytes": 123456}
  ],
  "channels": 32,
  "duration_seconds": 3600,
  "sampling_rate_hz": 256,
  "anonymized": true
}
```

### 9.3 Requisitos criptográficos
- Una **clave simétrica por caso** (AES-256-GCM).
- Esa clave se cifra con la clave pública de cada usuario autorizado.
- El servidor almacena el blob cifrado sin capacidad de descifrado.
- KAPPA solo descifra bajo sesión autorizada del usuario.

---

## 10. Seguridad y privacidad

### 10.1 Requisitos mínimos
- Autenticación robusta (JWT con expiración).
- Autorización por caso y por grupo.
- Cifrado en tránsito (TLS 1.3).
- Cifrado del paquete en reposo (AES-256-GCM).
- Auditoría de accesos (`AuditEvent`).
- Revocación de acceso cuando proceda.

### 10.2 Modelo realista de protección
**La plataforma promete:**
- No persistencia en claro por defecto.
- Acceso solo mediante autorización explícita.
- Cifrado del paquete.
- Apertura local controlada desde KAPPA.
- Logging completo de accesos.

**La plataforma NO promete:**
- Imposibilidad absoluta de copia.
- DRM perfecto.
- Imposibilidad total de captura de contenido.

La promesa correcta es **control, dificultad de extracción y trazabilidad**, no imposibilidad metafísica.

### 10.3 Políticas de retención
Cada paquete tiene política configurable:
- `Temporal` — caduca automáticamente (ej. 72h).
- `UntilReviewClose` — se elimina al cerrar la revisión.
- `Teaching` — retenido para biblioteca docente (con consentimiento).
- `ManualDelete` — el autor puede eliminarlo en cualquier momento (si no está validado docente).

### 10.4 Cumplimiento
- GDPR-ready: consentimiento explícito, derecho al olvido, exportación de datos.
- HIPAA-ready: auditoría, cifrado, control de acceso.

---

## 11. Interacción funcional KAPPA ↔ OCEAN

### 11.1 Flujo de integración

```
1. Usuario abre EEG en KAPPA
        │
        ▼
2. KAPPA: "Preparar para OCEAN"
   - Anonimizar
   - Añadir contexto clínico
   - Generar CasePackage cifrado
        │
        ▼
3. KAPPA llama a OCEAN API: POST /cases
   - Crea Case en estado Draft
   - Sube manifest y blob cifrado al buzón
        │
        ▼
4. Usuario elige revisores (KAPPA o web OCEAN)
   - POST /requests
   - Case pasa a Requested
        │
        ▼
5. Revisor recibe notificación
   - Acepta en app/web OCEAN
   - OCEAN habilita descarga del paquete
        │
        ▼
6. KAPPA del revisor descarga paquete cifrado
   - Descifra localmente
   - Usuario abre y revisa
        │
        ▼
7. Revisor envía comentarios/conclusión
   - POST /cases/{id}/comments
        │
        ▼
8. Caso resuelto → opción "Proponer para docencia"
   - POST /teaching-proposals
```

### 11.2 API mínima v1

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/auth/register` | Registro con verificación |
| POST | `/auth/token` | Login / JWT |
| GET | `/users/me` | Perfil propio |
| POST | `/groups` | Crear grupo |
| POST | `/cases` | Crear caso (desde KAPPA) |
| GET | `/cases/{id}` | Ver caso y estado |
| PATCH | `/cases/{id}/status` | Transición de estado clínico |
| POST | `/requests` | Crear petición de revisión |
| POST | `/requests/{id}/accept` | Aceptar revisión |
| POST | `/requests/{id}/reject` | Rechazar revisión |
| POST | `/cases/{id}/comments` | Añadir comentario/conclusión |
| GET | `/cases/{id}/comments` | Listar comentarios |
| POST | `/teaching-proposals` | Proponer caso para docencia |
| POST | `/teaching-proposals/{id}/recommend` | Recomendar propuesta |
| POST | `/teaching-proposals/{id}/validate` | Validar (curadores) |
| GET | `/teaching-library` | Biblioteca docente (validados) |
| POST | `/packages` | Registrar paquete |
| POST | `/packages/{id}/upload` | Subir blob cifrado |
| GET | `/packages/{id}/download` | Descargar blob autorizado |
| POST | `/packages/{id}/confirm` | Confirmar recepción/apertura |

---

## 12. Lenguaje del producto y UX

| NO usar | USAR en su lugar |
|---------|------------------|
| Subir archivo | Solicitar revisión |
| Descargar EEG | Recibir caso |
| Compartir en la nube | Prestar caso para revisión |
| Postear | Comentar caso |
| Guardar en biblioteca | Proponer para docencia |
| Like / Votar | Recomendar para docencia |
| EEG público | Caso validado docente |
| Amigo / Seguidor | Colega / Revisor |

---

## 13. Criterios de calidad para validación docente

### 13.1 Requisitos mínimos para proponer
- [ ] Caso en estado `Resolved` o `Archived`
- [ ] Al menos un comentario o conclusión de un revisor
- [ ] Anonimización verificada
- [ ] Metadatos mínimos completos (edad, motivo, contexto)
- [ ] Conclusión clínica o interpretación final comprensible
- [ ] Calidad técnica suficiente del registro

### 13.2 Señales de valor docente
- Genera discusión rica (múltiples comentarios cualificados)
- Ilustra un patrón claro (epiléptico, encefalopático, etc.)
- Enseña un error frecuente o un artefacto importante
- Muestra una variante normal relevante
- Tiene utilidad demostrable para residentes o especialistas
- Ha recibido recomendaciones de al menos 2 colegas distintos

### 13.3 Validación curatorial
- Un `Curator` revisa la propuesta y los comentarios.
- Puede: **Validar** (pasa a biblioteca), **Rechazar** (con feedback), **Solicitar mejoras**.
- El caso validado recibe tags docentes y un resumen editorial curado.

---

## 14. Requisitos no funcionales

### 14.1 Rendimiento
- API de estado y comentarios: < 200ms (p95).
- Coordinación de transferencia: soporta paquetes hasta 2GB.
- Listado de casos rápido (< 100ms).
- Comentarios con refresco frecuente o casi en tiempo real.

### 14.2 Robustez
- Reintentos de transferencia.
- Tolerancia a peer offline (buzón cifrado como fallback).
- Integridad verificada por hash.
- Recuperación de interrupciones.

### 14.3 Escalabilidad
- MVP orientado a grupos pequeños/medios.
- Arquitectura ampliable a múltiples servicios, storage de blobs escalable, colas de eventos, indexación docente.

### 14.4 Compatibilidad
- KAPPA debe funcionar en Linux, macOS, Windows.
- OCEAN diseñado sin depender de una sola plataforma cliente.

### 14.5 Observabilidad
- Métricas de uso, logs de errores, tiempos de transferencia.
- Eventos de aceptación/revisión, fallos de integración KAPPA.

### 14.6 Disponibilidad
- Objetivo: 99.5% en horario laboral crítico.

---

## 15. Roadmap de maduración

### Fase 1 — MVP: Núcleo de revisión
- Usuarios, autenticación, grupos básicos
- Creación de caso desde KAPPA
- Paquete cifrado subido a buzón central
- Solicitud, aceptación, rechazo
- Descarga autorizada por revisor
- Apertura local en KAPPA
- Comentarios por caso
- Cierre de revisión
- Propuesta docente simple
- Tag docente manual/curado
- Auditoría básica

### Fase 2 — Discusión estructurada
- Transferencia P2P con fallback a relay
- Comentarios anclados a ventanas temporales
- Dashboard de casos y revisiones
- Múltiples revisores concurrentes
- Hilos de comentarios

### Fase 3 — Capa docente consolidada
- Biblioteca docente estructurada con filtros avanzados
- Curación más formal
- Casos destacados (`Featured`)
- Colecciones temáticas

### Fase 4 — Expansión
- Recomendaciones inteligentes
- Comparación entre casos
- Analítica de concordancia
- Integración con corpus de investigación

### Fase 5 — Ecosistema
- APIs para partners académicos
- Benchmarking inter-centros anónimo
- Integración con herramientas computacionales

---

## 16. Cuestiones abiertas que conviene decidir pronto

1. ¿El MVP usará solo buzón central cifrado o ya intentará algo de P2P?
2. ¿La apertura del caso será solo desde KAPPA o también desde un cliente OCEAN ligero?
3. ¿Qué metadatos clínicos mínimos serán obligatorios?
4. ¿Qué política de retención tendrá un caso resuelto por defecto?
5. ¿Quién valida el tag docente en la primera etapa? (¿un curador designado, o el propio admin?)
6. ¿Habrá grupos cerrados por hospital/servicio además de usuarios individuales?
7. ¿Qué nivel de anonimización será obligatorio antes de exportar desde KAPPA?

---

## 17. Glosario

| Término | Definición |
|---------|-----------|
| **OCEAN** | Plataforma de coordinación clínica y docente para EEG. |
| **KAPPA** | Estación de trabajo local para apertura, visualización y análisis qEEG. |
| **Caso** | Unidad básica: un EEG + contexto + estado en OCEAN. |
| **Petición de revisión** | Solicitud formal de un colega para que otro revise un caso. |
| **CasePackage** | Paquete de datos cifrado (EEG + metadatos) preparado para transferencia. |
| **Buzón cifrado** | Almacenamiento temporal central donde el servidor no puede descifrar. |
| **Curator** | Revisor experimentado con capacidad de validar casos docentes. |
| **Biblioteca docente** | Colección de casos validados con valor de enseñanza. |

---

## 18. Declaración de visión técnica

> OCEAN no es una nube de EEGs. Es una infraestructura de coordinación clínica donde los casos circulan de forma controlada, las revisiones quedan trazadas y el conocimiento de valor emerge progresivamente para formar una biblioteca docente profesional.
>
> KAPPA prepara el caso. OCEAN lo pone en circulación clínica y docente.
>
> La promesa de seguridad es realista: control, dificultad de extracción y trazabilidad. No imposibilidad metafísica.

---

*Documento preparado para implementación. Siguiente paso sugerido: responder las cuestiones abiertas del §16 y proceder al diseño de base de datos + API v1.*
