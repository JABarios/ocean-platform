# OCEAN — Grupos e invitaciones

## 1. Propósito

OCEAN necesita tres niveles de circulación para un caso:

- `Private`
- `Institutional`
- `Public`

En la interfaz de usuario se muestran como:

- `Privado`
- `Grupo`
- `Público`

`Public` ya cubre la consulta abierta a toda la comunidad autenticada.
Lo que faltaba era dar un significado fuerte a `Institutional`.

La decisión funcional es esta:

- `Private` = se lo mando a una persona concreta o queda en perímetro mínimo
- `Institutional` = se comparte dentro de un **grupo cerrado de trabajo**
- `Public` = se abre a toda la comunidad autenticada de OCEAN

`Institutional` se mantiene como nombre interno del enum para no romper compatibilidad, pero en producto debe leerse como `Grupo`.

## 2. Modelo de grupo

Los grupos funcionan como círculos cerrados de colaboración clínica, con una lógica cercana a los grupos de WhatsApp:

1. un usuario crea el grupo
2. invita a quien quiere
3. cada invitado acepta o rechaza
4. solo los que aceptan pasan a ser miembros reales

## 3. Roles dentro del grupo

- `admin`
  - crea el grupo
  - invita miembros
  - elimina miembros
- `member`
  - participa en los casos del grupo

Por ahora no se introduce una tercera capa `owner/admin/member`.
Con `admin/member` basta para esta fase.

## 4. Estados de pertenencia

Cada relación usuario-grupo tiene uno de estos estados:

- `Pending`
- `Accepted`

`Pending`
- el usuario ha sido invitado
- aún no puede ver el grupo como miembro operativo
- aún no cuenta para solicitudes al grupo

`Accepted`
- el usuario ya pertenece al grupo
- ve el grupo en su lista
- puede actuar sobre solicitudes dirigidas al grupo

## 5. Flujo de invitación

### 5.1. Crear grupo

Un usuario autenticado puede:

- crear un grupo
- poner nombre
- añadir descripción opcional

El creador entra automáticamente como:

- miembro `Accepted`
- con rol `admin`

### 5.2. Invitar

Un admin del grupo puede:

- invitar a otro usuario

La invitación crea una pertenencia:

- `status = Pending`

### 5.3. Aceptar o rechazar

Cada usuario ve sus invitaciones pendientes.

Puede:

- aceptar
- rechazar

Si acepta:

- la pertenencia pasa a `Accepted`

Si rechaza:

- la invitación desaparece

## 6. Enviar casos a grupo

Un caso puede dirigirse:

- a un usuario
- a un grupo
- o abrirse en `Public`

Regla importante:

- un usuario solo puede enviar un caso a un grupo **si pertenece a ese grupo**

Esto evita usar grupos ajenos como destino arbitrario.

## 7. Qué pasa cuando un caso se envía a un grupo

Cuando existe una `ReviewRequest` con `targetGroupId`:

- los miembros `Accepted` del grupo pueden verla
- los miembros `Accepted` pueden aceptarla
- el caso pasa a estar dentro del perímetro de trabajo del grupo

Eso implica:

- lectura del caso
- lectura de comentarios
- comentario en el caso
- acceso al EEG según las reglas del paquete

## 8. Semántica final de visibilidad

### `Private`

Caso privado o dirigido.

Lo ven:

- owner
- destinatarios directos
- participantes explícitos en la revisión

### `Institutional` (`Grupo` en la UI)

Caso compartido con un grupo cerrado de trabajo.

Sirve para:

- equipos temáticos
- unidades funcionales
- grupos de interés clínico

Ejemplos:

- `Epilepsia Valencia`
- `Sueño pediátrico`
- `Urgencias EEG`

### `Public`

Caso abierto a la comunidad autenticada completa.

Sirve para:

- “¿alguien quiere ver esto?”
- consulta abierta no dirigida

## 9. Superficie mínima de producto

### Ya implementado en esta fase

- panel `Grupos`
- crear grupo
- listar grupos aceptados
- ver invitaciones pendientes
- aceptar/rechazar invitaciones
- invitar usuarios a un grupo
- enviar un caso a grupo desde el detalle del caso

### Queda para más adelante

- editar nombre/descripción del grupo desde UI
- salir voluntariamente del grupo
- reintentar invitaciones rechazadas
- archivado o cierre de grupo
- notificaciones específicas de grupo
- cola propia del grupo

## 10. Resultado esperado

Con esta capa, OCEAN deja de tener solo:

- revisión 1:1
- apertura comunitaria total

y gana la capa intermedia realmente útil:

- **grupos cerrados de colaboración**

Eso convierte `Institutional` en algo operativo y comprensible para el sistema, y `Grupo` en algo comprensible para el usuario:

- no es un concepto abstracto
- no es solo “más privado que public”
- es un caso compartido con un grupo concreto de trabajo
