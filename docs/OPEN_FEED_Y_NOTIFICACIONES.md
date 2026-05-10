# OCEAN — Feed abierto y notificaciones

## 1. Propósito

OCEAN ya cubre bien el flujo **privado y dirigido**:

- un clínico crea un caso
- solicita revisión a un usuario o grupo concreto
- el caso se discute dentro de ese perímetro

Lo que falta es la segunda mitad del producto:

- el flujo de **consulta abierta a la comunidad**
- un sistema básico de **notificaciones**

Este documento define esa capa sin cambiar la naturaleza de OCEAN:

- sigue siendo una plataforma clínica colaborativa
- no se convierte en una red social médica abierta
- no expone casos a usuarios no autenticados

## 2. Objetivo funcional

La nueva capacidad se resume en esta pregunta:

> "Tengo este caso. ¿Alguien de la comunidad OCEAN quiere verlo?"

Eso implica dos piezas:

1. **Feed de casos abiertos**
2. **Notificaciones**

## 3. Principio de diseño

La capa abierta debe **sumarse** al flujo privado existente, no sustituirlo.

OCEAN tendrá dos modos de colaboración:

- **Dirigido**
  - el owner pide revisión a alguien concreto
- **Abierto**
  - el owner publica el caso como visible para cualquier usuario autenticado

Ambos modos pueden coexistir sobre el mismo caso.

## 4. Feed de casos abiertos

### 4.1. Definición

Un caso entra en el feed abierto cuando:

- `Case.visibility = Public`

Ese caso debe poder ser visto por:

- cualquier usuario autenticado con cuenta activa

### 4.2. Qué no significa `Public`

En OCEAN, `Public` **no** significa:

- indexable por buscadores
- visible sin login
- abierto a Internet

`Public` significa:

- visible para la comunidad autenticada de OCEAN

### 4.3. Qué ofrece el feed

El feed abierto debe permitir:

- descubrir casos comunitarios
- filtrar por modalidad, tags, estado clínico y fecha
- abrir el caso
- comentar si el usuario considera que puede aportar valor

### 4.4. UX mínima

Nueva pantalla:

- `/cases/open`

Contenido mínimo:

- listado de casos con `visibility = Public`
- título
- modalidad
- tags
- owner
- fecha de creación
- estado clínico
- número de comentarios
- indicador visual `Public`

Filtros mínimos:

- búsqueda libre
- modalidad
- estado clínico
- tags
- fecha reciente

### 4.5. Comportamiento esperado

Casos típicos:

1. Un clínico quiere opinión amplia sobre un EEG raro.
2. Publica el caso como `Public`.
3. El caso aparece en el feed comunitario.
4. Cualquier usuario autenticado puede abrirlo y comentar.
5. Si además quiere revisión formal, puede seguir creando `ReviewRequest` dirigidas.

## 5. Reglas de acceso

### 5.1. Caso `Private`

Visible para:

- owner
- revisores con relación válida al caso según flujo actual
- administradores si el modelo actual ya lo permite

### 5.2. Caso `Institutional` (`Grupo` en la UI)

`Institutional` pasa a significar:

- caso compartido con un **grupo cerrado** de OCEAN
- creado por un usuario
- con miembros invitados explícitamente
- donde cada invitado debe aceptar su entrada

Visible para:

- owner
- miembros aceptados del grupo destinatario
- administradores si el modelo actual ya lo permite

No aparece en el feed abierto.

En la interfaz, esta visibilidad debe mostrarse como `Grupo`.

Esto permite una capa intermedia muy útil entre:

- `Private`: te lo mando a ti o al perímetro mínimo
- `Public`: lo dejo abierto a toda la comunidad autenticada

El detalle del flujo de grupos e invitaciones queda descrito en:

- [GRUPOS_Y_VISIBILIDAD.md](./GRUPOS_Y_VISIBILIDAD.md)

### 5.3. Caso `Public`

Visible para:

- cualquier usuario autenticado y activo

Acciones mínimas permitidas:

- ver detalle del caso
- ver comentarios
- añadir comentarios

Acciones que siguen restringidas:

- editar el caso
- cambiar su estado clínico
- modificar el paquete EEG
- archivarlo
- borrarlo

Esas acciones siguen dependiendo de ownership, rol o workflow dirigido.

## 6. Comentarios en casos abiertos

Cuando un caso es `Public`, cualquier usuario autenticado puede:

- leer comentarios
- añadir comentarios

Esto crea el modo real de:

- “consulta abierta a la comunidad”

Los comentarios comunitarios deben seguir cumpliendo:

- autor identificado
- timestamp
- auditabilidad
- mismas validaciones de contenido que el sistema actual

## 7. Notificaciones

## 7.1. Objetivo

Una vez existen casos abiertos y más interacción comunitaria, OCEAN necesita avisar de:

- nuevas solicitudes de revisión
- aceptación o rechazo de solicitudes
- nuevos comentarios relevantes
- actividad docente relevante

Sin notificaciones, la colaboración se vuelve opaca y fácil de perder.

## 7.2. Modelo mínimo

Nueva entidad:

- `Notification`

Campos mínimos recomendados:

- `id`
- `userId`
- `kind`
- `title`
- `body`
- `caseId` opcional
- `reviewRequestId` opcional
- `commentId` opcional
- `actorUserId` opcional
- `readAt` opcional
- `createdAt`

No hace falta introducir un motor complejo.
Para MVP basta con persistencia en BD y lectura por polling.

## 7.3. Tipos mínimos de notificación

Primera tanda recomendada:

- `review_request_received`
- `review_request_accepted`
- `review_request_rejected`
- `comment_on_owned_case`
- `comment_on_requested_case`
- `comment_on_public_case_followed`
- `teaching_proposal_created`
- `teaching_proposal_recommended`
- `teaching_proposal_validated`

## 7.4. Regla de relevancia

No todo comentario debe notificar a todo el mundo.

Destinatarios mínimos por evento:

- **solicitud de revisión**
  - destinatario de la solicitud
- **aceptación/rechazo**
  - solicitante
- **comentario en caso privado o dirigido**
  - owner del caso
  - participantes directos en la revisión
- **comentario en caso público**
  - owner del caso
  - usuarios que sigan el caso, si más adelante existe `follow`

Para MVP, si aún no existe `follow`, se puede simplificar:

- notificar al owner
- notificar a participantes directos
- no notificar masivamente a todos los usuarios

## 8. UX mínima de notificaciones

### 8.1. Superficie mínima

Dos piezas:

- campana en la barra superior
- bandeja `/notifications`

### 8.2. Campana

Debe mostrar:

- contador de no leídas

No hace falta tiempo real por websocket al principio.
Puede refrescarse:

- al cargar la app
- al navegar
- cada cierto intervalo corto

### 8.3. Bandeja

Listado cronológico con:

- tipo de notificación
- actor
- caso asociado
- fecha
- estado leída/no leída

Acciones mínimas:

- abrir destino
- marcar una como leída
- marcar todas como leídas

## 9. Endpoints mínimos recomendados

### 9.1. Feed abierto

- `GET /cases/open`

Devuelve:

- casos `Public`
- solo para usuarios autenticados

Filtros sugeridos:

- `q`
- `modality`
- `statusClinical`
- `tag`
- `page`
- `limit`

### 9.2. Cambios de visibilidad

- `PATCH /cases/:id/visibility`

Body:

- `visibility: 'Private' | 'Institutional' | 'Public'`

Solo puede hacerlo:

- owner del caso
- o admin si así se decide

### 9.3. Notificaciones

- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/:id/read`
- `POST /notifications/read-all`

## 10. Cambios de backend

### 10.1. Casos

Añadir una ruta específica para feed abierto:

- evita mezclarla con el dashboard privado
- permite filtros y paginación propios

### 10.2. Comentarios

Actualizar control de acceso para que:

- si `case.visibility === 'Public'`
- cualquier usuario autenticado activo pueda hacer `GET` y `POST`

### 10.3. Requests

No requiere rediseño.

Las `ReviewRequest` siguen siendo el canal de revisión formal y dirigida.
El feed abierto es un canal adicional de conversación, no su reemplazo.

### 10.4. Notificaciones

Crear en backend:

- modelo Prisma
- helpers de creación
- generación de eventos al:
  - crear review request
  - aceptar/rechazar
  - comentar
  - crear o mover propuestas docentes

## 11. Cambios de frontend

### 11.1. Nueva pantalla

- `OpenCasesFeed.tsx`

Con ruta:

- `/cases/open`

### 11.2. Navegación

Añadir en la barra principal:

- `Casos abiertos`

### 11.3. Caso detalle

Si el caso es `Public` y el usuario está autenticado:

- permitir comentar aunque no exista review request

### 11.4. Notificaciones

Añadir:

- icono de campana en `Layout`
- página `Notifications.tsx`

## 12. Auditoría

La nueva capa debe seguir siendo auditable.

Conviene registrar en `AuditEvent` al menos:

- cambio de visibilidad del caso
- publicación de caso en feed abierto
- retirada de caso del feed abierto

No hace falta auditar como evento separado cada lectura del feed en MVP.

## 13. No objetivos para esta fase

Quedan fuera de esta primera implementación:

- acceso público sin login
- comentarios anónimos
- reputación o scoring de usuarios
- likes, votos o reacciones sociales
- push en tiempo real por websocket
- suscripciones complejas por tags o especialidad

La meta es clínica y operativa, no social.

## 14. Orden recomendado de implementación

### Fase 1

- `GET /cases/open`
- nueva página `Casos abiertos`
- comentarios permitidos en casos `Public`

### Fase 2

- modelo `Notification`
- generación de notificaciones en requests y comments
- campana + bandeja

### Fase 3

- marcar como leído
- contador de no leídas
- seguimiento opcional de casos públicos (`follow`)

## 15. Resultado esperado

Cuando esta pieza exista, OCEAN dejará de ser solo:

- “tengo un caso para este revisor”

y pasará también a ser:

- “tengo un caso interesante; la comunidad OCEAN puede verlo y comentar”

Eso completa la capa colaborativa que ahora mismo falta:

- **flujo privado y dirigido**
- **flujo abierto y comunitario**
- **notificaciones para no perder la actividad**
