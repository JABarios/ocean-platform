# OCEAN — Especificaciones de Plataforma
## Documento técnico de visión, arquitectura y requisitos
**Versión:** 0.1 — Visión fundacional  
**Fecha:** 2026-04-23  
**Relación con KAPPA:** Cliente colaborativo / Backend de coordinación

---

## 1. Resumen ejecutivo

OCEAN es la capa colaborativa del ecosistema KAPPA. Mientras KAPPA es la estación de trabajo local para apertura, revisión, filtrado y análisis qEEG, OCEAN es la plataforma que permite:

- Solicitar revisiones de casos EEG a colegas o grupos.
- Gestionar el ciclo de vida de esa petición (solicitada → aceptada → revisada → resuelta).
- Conservar la discusión clínica asociada a cada caso de forma estructurada y trazable.
- Promover casos de especial interés a una biblioteca docente validada por la comunidad.

OCEAN **no** es un repositorio masivo de EEGs, ni una red social médica, ni un motor de IA diagnóstica. Es una **infraestructura de coordinación clínica** cuya unidad básica es la **petición de revisión de un caso**.

---

## 2. Alcance y límites

### 2.1 Dentro del alcance (V1)
- Registro de usuarios y gestión de identidad profesional.
- Creación de casos de revisión con metadatos mínimos.
- Envío de solicitudes de revisión a usuarios o grupos.
- Aceptación/rechazo de solicitudes.
- Transferencia o habilitación de acceso al paquete de caso (EEG + metadatos).
- Comentarios y conclusiones vinculados al caso.
- Estados clínicos del caso con trazabilidad completa.
- Propuesta de casos para docencia.
- Sistema de recomendaciones y validación docente ligera (1-2 curadores).
- Tags docentes básicos (patrón, artefacto, pediatría, UCI, etc.).

### 2.2 Fuera del alcance (V1)
- Almacenamiento permanente centralizado de todos los EEGs de todos los usuarios.
- Visor de EEG integrado en navegador (la señal se abre en KAPPA local).
- Interpretación automática o asistencia por IA.
- Mensajería directa desvinculada de casos.
- Publicaciones científicas o foros abiertos.
- Integración con EHR/historia clínica del hospital.

---

## 3. Arquitectura de sistema

### 3.1 Principio arquitectónico: coordinación, no acumulación
OCEAN opera como un **orquestador de relaciones clínicas**. El EEG no es un activo permanente del servidor salvo en casos puntuales (buffer temporal o biblioteca docente validada).

```
┌─────────────────────────────────────────────────────────────┐
│                         OCEAN CLOUD                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Identity &  │  │  Case State  │  │  Social/Teaching │  │
│  │  Permissions │  │  Machine     │  │  Layer           │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  APIs: GraphQL / REST                                       │
└─────────────────────────────────────────────────────────────┘
         ▲                           ▲
         │                           │
┌────────┴────────┐         ┌────────┴────────┐
│   KAPPA LOCAL   │◄───────►│  KAPPA LOCAL    │
│  (Solicitante)  │  P2P /  │   (Revisor)     │
│                 │  Buffer  │                 │
└─────────────────┘         └─────────────────┘
```

### 3.2 Componentes del núcleo central

| Componente | Responsabilidad |
|-----------|-----------------|
| **Identity Service** | Registro, autenticación, perfiles profesionales, grupos/centros. |
| **Case State Service** | Estados clínicos y docentes, transiciones, auditoría. |
| **Request Service** | Creación, envío, aceptación y rechazo de peticiones de revisión. |
| **Comment Service** | Comentarios estructurados por caso, conclusiones, hilos. |
| **Teaching Service** | Propuestas docentes, recomendaciones, validación curatorial, tags. |
| **Transfer Service** | Señalización de disponibilidad, coordinación de entrega de paquetes. |
| **Notification Service** | Alertas de solicitudes, comentarios, cambios de estado. |

### 3.3 Modalidades de transferencia de caso
1. **P2P directo:** Ambos usuarios en línea, transferencia cifrada punto a punto.
2. **Buffer temporal cifrado:** El paquete se almacena cifrado en el servidor durante un tiempo limitado (ej. 72h) hasta que el revisor lo recoge.
3. **Prestamo de acceso:** El caso permanece en posesión del solicitante; el revisor obtiene un token de acceso temporal para abrirlo desde su KAPPA local.

> **Decisión de diseño:** El servidor OCEAN nunca almacena EEGs en claro de forma permanente. Solo mantiene metadatos, estados, comentarios y referencias.

---

## 4. Modelo de datos

### 4.1 Entidades principales

#### `User` (Profesional)
```
id              UUID
email           String (único, verificado)
display_name    String
institution     String (opcional)
specialty       Enum: [Neurofisiología, Neurología, Pediatría, ...]
role            Enum: [Clinician, Reviewer, Curator, Admin]
created_at      Timestamp
```

#### `Group` (Equipo / Servicio / Centro)
```
id              UUID
name            String
members         User[]
admin           User
is_open         Boolean (¿acepta solicitudes externas?)
```

#### `Case` (Caso clínico)
```
id                  UUID
owner_id            UUID -> User
title               String (breve, opcional en borrador)
clinical_context    Text (resumido)
age_range           Enum: [Neonato, Lactante, Niño, Adolescente, Adulto, >65]
study_reason        Text
anonimized          Boolean
metadata_complete   Boolean
status_clinical     Enum -> ver §5.1
status_teaching     Enum -> ver §5.2
created_at          Timestamp
resolved_at         Timestamp (nullable)
```

#### `CasePackage` (Paquete de datos)
```
case_id             UUID -> Case
file_manifest       JSON [{filename, hash, size, format}]
storage_mode        Enum: [P2P, Buffer, AccessToken]
storage_reference   String (hash o token, según modo)
expires_at          Timestamp (para buffer)
```

#### `ReviewRequest` (Petición de revisión)
```
id                  UUID
case_id             UUID -> Case
requester_id        UUID -> User
recipient_id        UUID -> User (o group_id)
status              Enum: [Pending, Accepted, Rejected, Completed, Expired]
message             Text (contexto de la petición)
accepted_at         Timestamp
completed_at        Timestamp
```

#### `Comment` (Comentario / Conclusión)
```
id                  UUID
case_id             UUID -> Case
author_id           UUID -> User
request_id          UUID -> ReviewRequest (nullable, si está ligado a una revisión concreta)
content             Text
is_conclusion       Boolean (marca si es la interpretación final del revisor)
created_at          Timestamp
```

#### `TeachingProposal` (Propuesta docente)
```
id                  UUID
case_id             UUID -> Case
proposer_id         UUID -> User
status              Enum: [Proposed, Recommended, Validated, Rejected]
summary             Text (resumen docente, qué enseña este caso)
key_findings        Text
learning_points     Text
difficulty          Enum: [Introductory, Intermediate, Advanced]
tags                String[]
recommended_by      User[]
validated_by        User[] (curadores)
validated_at        Timestamp
```

### 4.2 Relaciones
```
User 1---* Case (owner)
User 1---* ReviewRequest (requester)
User 1---* ReviewRequest (recipient)
Case 1---* ReviewRequest
Case 1---* Comment
Case 1---1 CasePackage
Case 1---* TeachingProposal
Group *---* User
```

---

## 5. Estados y flujos de vida

### 5.1 Estado clínico del caso (`status_clinical`)

| Estado | Descripción | Transiciones posibles |
|--------|-------------|----------------------|
| `Draft` | El caso se está preparando en KAPPA, aún no se ha solicitado revisión. | → `Requested` |
| `Requested` | Se ha enviado al menos una petición de revisión. | → `InReview`, → `Archived` (cancelado) |
| `InReview` | Un revisor ha aceptado; el caso está en análisis activo. | → `Resolved`, → `Requested` (más opiniones) |
| `Resolved` | Se ha alcanzado una conclusión o se cierra el ciclo de revisión. | → `Archived`, → `ProposedForTeaching` |
| `Archived` | Cerrado definitivamente, sin más acción prevista. | — (fin) |

> **Regla:** Un caso debe tener al menos una `ReviewRequest` aceptada para pasar a `InReview`. Un caso `Resolved` puede volver a `Requested` si se solicita una nueva opinión.

### 5.2 Estado docente del caso (`status_teaching`)

| Estado | Descripción |
|--------|-------------|
| `None` | Sin propuesta docente. Estado por defecto. |
| `Proposed` | Alguien ha propuesto el caso para docencia. Visible en cola de propuestas. |
| `Recommended` | Ha recibido al menos N recomendaciones de colegas (configurable, ej. N=2). |
| `Validated` | Un curador ha validado oficialmente. Recibe tag docente y pasa a biblioteca. |
| `Rejected` | Un curador ha decidido que no aporta suficientemente. |

> **Regla:** Solo un caso en estado `Resolved` o `Archived` puede ser propuesto para docencia.  
> **Regla:** El cambio `Recommended` → `Validated` requiere acción explícita de un `Curator`.

### 5.3 Diagrama de flujo combinado

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

## 6. Requisitos funcionales

### 6.1 RF-IDENT — Identidad y permisos
- **RF-IDENT-01:** Los usuarios se registran con email institucional o verificado.
- **RF-IDENT-02:** Los usuarios pueden crear o unirse a grupos (servicios, centros, redes).
- **RF-IDENT-03:** Los grupos pueden ser abiertos (aceptan solicitudes) o cerrados (solo por invitación).
- **RF-IDENT-04:** Tres roles base: `Clinician` (solicita), `Reviewer` (revisa), `Curator` (valida docencia).

### 6.2 RF-CASE — Gestión de casos
- **RF-CASE-01:** Desde KAPPA, el usuario puede "preparar caso para OCEAN": anonimizar, añadir contexto y generar un `Case` en estado `Draft`.
- **RF-CASE-02:** El caso debe incluir: contexto clínico resumido, rango de edad, motivo de estudio, confirmación de anonimización.
- **RF-CASE-03:** El usuario puede editar un caso en `Draft`. Una vez solicitada revisión, solo puede añadir comentarios o cancelar.
- **RF-CASE-04:** El sistema verifica que los metadatos mínimos estén completos antes de permitir el envío de la solicitud.

### 6.3 RF-REQ — Peticiones de revisión
- **RF-REQ-01:** El solicitante elige uno o varios destinatarios (usuarios o grupos) y redacta un mensaje de contexto.
- **RF-REQ-02:** El destinatario recibe notificación y puede: Aceptar, Rechazar, o Ignorar (expira en 7 días).
- **RF-REQ-03:** Si se acepta, OCEAN coordina la transferencia del `CasePackage` según la modalidad configurada.
- **RF-REQ-04:** El revisor puede abrir el caso en su KAPPA local una vez aceptada.
- **RF-REQ-05:** El revisor puede dejar comentarios y/o una conclusión formal vinculada a la revisión.
- **RF-REQ-06:** El solicitante recibe notificación de nuevos comentarios/conclusiones.
- **RF-REQ-07:** El caso puede tener múltiples revisiones concurrentes o secuenciales.

### 6.4 RF-COMM — Comentarios y discusión
- **RF-COMM-01:** Los comentarios están siempre vinculados a un `Case`.
- **RF-COMM-02:** Un comentario puede marcarse explícitamente como `conclusión` por parte del revisor.
- **RF-COMM-03:** Los comentarios son visibles para: solicitante, revisor/es del caso, y curadores (si el caso está en flujo docente).
- **RF-COMM-04:** No hay "likes". Solo comentarios textuales y, opcionalmente, indicadores de "recomendar para docencia".

### 6.5 RF-TEACH — Curación docente
- **RF-TEACH-01:** Cualquier usuario con acceso al caso puede pulsar "Proponer para docencia" si el caso está `Resolved` o `Archived`.
- **RF-TEACH-02:** Al proponer, el usuario debe redactar: resumen docente, hallazgo principal, puntos de enseñanza, nivel de dificultad sugerido.
- **RF-TEACH-03:** Los demás usuarios con acceso pueden "recomendar" la propuesta (sin texto obligatorio, pero con opción de matizar).
- **RF-TEACH-04:** Un `Curator` puede validar o rechazar la propuesta. Si la valida, el caso pasa a `Validated` y recibe tags docentes.
- **RF-TEACH-05:** Los casos validados son visibles en la biblioteca docente OCEAN.
- **RF-TEACH-06:** La biblioteca docente permite filtrado por: tags, nivel de dificultad, rango de edad, revisor principal, fecha.

### 6.6 RF-NOTIF — Notificaciones
- **RF-NOTIF-01:** Notificar al destinatario cuando recibe una solicitud de revisión.
- **RF-NOTIF-02:** Notificar al solicitante cuando su caso es aceptado, comentado o resuelto.
- **RF-NOTIF-03:** Notificar cuando un caso es propuesto/recomendado/validado para docencia.
- **RF-NOTIF-04:** Resumen semanal opcional de actividad pendiente.

---

## 7. Requisitos no funcionales

### 7.1 Seguridad y privacidad
- **RNF-SEC-01:** Toda comunicación caso-servidor y P2P debe ser cifrada (TLS 1.3, cifrado de paquetes).
- **RNF-SEC-02:** El servidor nunca almacena EEGs desencriptados permanentemente (salvo biblioteca docente con consentimiento explícito).
- **RNF-SEC-03:** Los casos deben estar anonimizados antes de salir de KAPPA. OCEAN no anonimiza; verifica.
- **RNF-SEC-04:** El acceso al caso es siempre por invitación/aceptación explícita. No hay casos públicos en V1.
- **RNF-SEC-05:** Auditoría de acciones clave: quién solicitó, quién aceptó, quién descargó/abrió, quién comentó.
- **RNF-SEC-06:** Cumplimiento GDPR / HIPAA-ready (consentimiento explícito, derecho al olvido, exportación de datos).

### 7.2 Rendimiento y disponibilidad
- **RNF-PERF-01:** La API de estado y comentarios debe responder en < 200ms (p95).
- **RNF-PERF-02:** La coordinación de transferencia debe soportar paquetes de hasta 2GB (EEG largos).
- **RNF-PERF-03:** Disponibilidad objetivo: 99.5% (horario laboral crítico).

### 7.3 Usabilidad
- **RNF-UX-01:** Solicitar una revisión desde KAPPA no debe requerir más de 3 pasos tras la preparación del caso.
- **RNF-UX-02:** El lenguaje de la interfaz debe ser clínico y sobrio: "Solicitar revisión", no "Subir archivo"; "Recibir caso", no "Descargar".
- **RNF-UX-03:** No hay sistema de "likes", "votos" ni métricas sociales. Solo estados profesionales y recomendaciones cualificadas.

### 7.4 Escalabilidad
- **RNF-SCAL-01:** Arquitectura preparada para sharding por región/institución si crece.
- **RNF-SCAL-02:** La capa de coordinación debe escalar independientemente de la capa de transferencia de ficheros.

---

## 8. Interfaz KAPPA ↔ OCEAN

### 8.1 Flujo de integración

```
1. Usuario abre EEG en KAPPA
        │
        ▼
2. KAPPA: "Preparar para OCEAN"
   - Anonimizar
   - Añadir contexto clínico
   - Generar CasePackage local
        │
        ▼
3. KAPPA llama a OCEAN API: POST /cases
   - Crea Case en estado Draft
   - Sube manifest y metadatos
        │
        ▼
4. Usuario en KAPPA (o web OCEAN) elige revisores
   - POST /requests
   - Case pasa a Requested
        │
        ▼
5. Revisor recibe notificación
   - Acepta en app/web OCEAN
   - OCEAN coordina transferencia
        │
        ▼
6. KAPPA del revisor recibe/recupera CasePackage
   - Usuario abre y revisa localmente
        │
        ▼
7. Revisor envía comentarios/conclusión
   - POST /cases/{id}/comments
        │
        ▼
8. Caso resuelto → opción "Proponer para docencia"
   - POST /teaching-proposals
```

### 8.2 API mínima (endpoints principales)

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
| GET | `/teaching-library` | Biblioteca docente pública (casos validados) |

### 8.3 Formato de intercambio de caso

KAPPA empaqueta el caso como:
```
case-package/
├── manifest.json       # metadatos, hashes, referencias
├── eeg/                # archivos de señal (EDF, BDF, etc.)
├── annotations/        # anotaciones de KAPPA si aplica
└── context.md          # contexto clínico en texto plano
```

El `manifest.json` incluye:
```json
{
  "case_id": "uuid",
  "format_version": "1.0",
  "files": [
    {"path": "eeg/xxx.edf", "hash": "sha256:...", "size_bytes": 123456}
  ],
  "anonymized": true,
  "metadata": {
    "age_range": "Adult",
    "study_reason": "...",
    "clinical_context": "..."
  }
}
```

---

## 9. Lenguaje del producto y UX

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

## 10. Criterios de calidad para validación docente

### 10.1 Requisitos mínimos para proponer
- [ ] Caso en estado `Resolved` o `Archived`
- [ ] Al menos un comentario o conclusión de un revisor
- [ ] Anonimización verificada
- [ ] Metadatos mínimos completos (edad, motivo, contexto)
- [ ] Conclusión clínica o interpretación final comprensible
- [ ] Calidad técnica suficiente del registro

### 10.2 Señales de valor docente
- Genera discusión rica (múltiples comentarios cualificados)
- Ilustra un patrón claro (epiléptico, encefalopático, etc.)
- Enseña un error frecuente o un artefacto importante
- Muestra una variante normal relevante
- Tiene utilidad demostrable para residentes o especialistas
- Ha recibido recomendaciones de al menos 2 colegas distintos

### 10.3 Validación curatorial
- Un `Curator` revisa la propuesta y los comentarios.
- Puede: **Validar** (pasa a biblioteca), **Rechazar** (con feedback), **Solicitar mejoras**.
- El caso validado recibe tags docentes y un resumen editorial curado.

---

## 11. Roadmap de maduración

### Fase 1 — Núcleo de revisión (MVP)
- Registro, identidad, grupos básicos
- Creación de caso desde KAPPA
- Solicitud, aceptación y rechazo de revisiones
- Comentarios y conclusiones
- Notificaciones básicas
- Transferencia P2P / buffer temporal

### Fase 2 — Discusión estructurada
- Múltiples revisores por caso
- Hilos de comentarios
- Estados clínicos completos
- Historial de auditoría
- Búsqueda de casos propios y compartidos

### Fase 3 — Capa docente
- "Proponer para docencia"
- Sistema de recomendaciones
- Rol de Curator
- Biblioteca docente con filtros
- Tags docentes básicos

### Fase 4 — Consolidación
- Colecciones temáticas curadas
- Rutas docentes (ej. "EEG para residentes: nivel 1")
- Casos relacionados / similares
- Métricas de uso docente (anónimas)
- Exportación de casos docentes para congresos / formación

### Fase 5 — Expansión (futuro lejano)
- Apertura controlada a investigación (corpus estructurado)
- Benchmarking inter-centros (anónimo)
- Integración con herramientas computacionales futuras
- APIs para partners académicos

---

## 12. Glosario

| Término | Definición |
|---------|-----------|
| **OCEAN** | Plataforma de coordinación clínica y docente para EEG. |
| **KAPPA** | Estación de trabajo local para apertura, visualización y análisis qEEG. |
| **Caso** | Unidad básica: un EEG + contexto + estado en OCEAN. |
| **Petición de revisión** | Solicitud formal de un colega para que otro revise un caso. |
| **CasePackage** | Paquete de datos (EEG + metadatos) preparado para transferencia. |
| **Curator** | Revisor experimentado con capacidad de validar casos docentes. |
| **Biblioteca docente** | Colección pública de casos validados con valor de enseñanza. |

---

## 13. Declaración de visión técnica

> OCEAN no es una nube de EEGs. Es una infraestructura de coordinación clínica donde los casos circulan de forma controlada, las revisiones quedan trazadas y el conocimiento de valor emerge progresivamente para formar una biblioteca docente profesional.
>
> KAPPA prepara el caso. OCEAN lo pone en circulación clínica y docente.

---

*Documento preparado para definición técnica del proyecto. Siguiente paso sugerido: diseño detallado de base de datos y contrato API v1.*
