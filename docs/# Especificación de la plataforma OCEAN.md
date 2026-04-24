# Especificación de la plataforma OCEAN

## Integración con KAPPA para revisión clínica, discusión y curación docente de EEG

**Versión:** borrador 0.1
**Propósito:** definir la plataforma colaborativa que trabajará junto a KAPPA para permitir revisión de casos EEG, discusión estructurada y evolución hacia una biblioteca docente.

---

## 1. Objeto del documento

Este documento define las especificaciones de la plataforma **OCEAN**, entendida como el entorno colaborativo que interactúa con **KAPPA** para gestionar casos EEG en un contexto profesional.

KAPPA será la estación de trabajo local: abrir, revisar, filtrar, cuantificar, anonimizar y preparar casos.

OCEAN será la capa de coordinación y colaboración: identidad, permisos, peticiones de revisión, entrega de casos, discusión, recomendaciones y curación docente.

La idea central no es crear un repositorio masivo de EEG, sino un **sistema de peticiones de revisión de casos**, con trazabilidad y una capa superior de conocimiento compartido.

---

## 2. Objetivos de la plataforma

La plataforma debe cumplir cinco objetivos principales:

1. Permitir que un usuario prepare un caso en KAPPA y solicite revisión a otros colegas o grupos.
2. Gestionar identidad, autenticación, permisos y aceptación de revisiones.
3. Facilitar la transferencia o préstamo controlado del caso EEG al revisor.
4. Conservar la discusión clínica, recomendaciones y conclusión del caso.
5. Permitir que algunos casos evolucionen hacia material docente validado.

---

## 3. Principios de diseño

### 3.1 Centralidad del caso

La unidad principal del sistema no es el archivo aislado, sino el **caso de revisión**.

### 3.2 Separación clara de responsabilidades

KAPPA y OCEAN tienen funciones distintas:

* **KAPPA**: tratamiento local del EEG
* **OCEAN**: coordinación, discusión, permisos y memoria compartida

### 3.3 Privacidad y control

La plataforma no debe obligar a un almacenamiento central permanente del EEG en claro. El modelo preferente es de **caso cifrado + acceso controlado + entrega bajo aceptación**.

### 3.4 Sobriedad profesional

OCEAN debe parecer una plataforma clínica/académica, no una red social generalista.

### 3.5 Curación progresiva

La biblioteca docente debe surgir de casos revisados y recomendados, no de acumulación indiscriminada.

---

## 4. Alcance funcional

OCEAN debe cubrir estas áreas:

### 4.1 Gestión de usuarios y grupos

* alta y autenticación de usuarios
* perfiles profesionales
* grupos cerrados de revisión
* roles y permisos

### 4.2 Gestión de casos

* registro de un nuevo caso preparado desde KAPPA
* metadatos clínicos mínimos
* estado del caso
* propietarios, revisores y participantes

### 4.3 Flujo de revisión

* solicitud de revisión
* aceptación o rechazo
* entrega del caso
* revisión local en KAPPA
* comentarios y cierre

### 4.4 Discusión profesional

* hilo estructurado de comentarios
* recomendaciones
* marcación de caso interesante
* resumen final

### 4.5 Curación docente

* propuesta para docencia
* recomendaciones cualificadas
* validación
* incorporación a biblioteca docente

### 4.6 Auditoría y trazabilidad

* quién solicitó
* quién aceptó
* quién accedió
* cuándo se transfirió
* cuándo se comentó
* estado final

---

## 5. Arquitectura conceptual

## 5.1 Visión general

La arquitectura se divide en dos planos:

### A. Plano de control central

Gestionado por OCEAN. Incluye:

* identidad y autenticación
* permisos
* peticiones de revisión
* estados de casos
* comentarios y discusión
* recomendaciones y curación docente
* auditoría
* notificaciones
* señalización de transferencias

### B. Plano de datos clínicos

Gestiona el paquete EEG del caso:

* transferencia directa entre clientes cuando sea posible
* o almacenamiento temporal cifrado en un buzón central
* apertura local desde KAPPA
* sin persistencia en claro por defecto

---

## 6. Componentes principales del sistema

## 6.1 OCEAN Control Server

Servidor central responsable de:

* autenticación
* autorización
* usuarios y grupos
* casos
* solicitudes de revisión
* estado del caso
* comentarios
* recomendaciones
* tags docentes
* logs y auditoría

## 6.2 OCEAN Transfer/Mailbox Service

Servicio de transferencia de paquetes de caso.

Debe permitir dos modos:

### Modo MVP

* almacenamiento temporal cifrado en servidor
* entrega al revisor autorizado cuando se conecte

### Modo avanzado

* transferencia directa cliente a cliente con señalización central
* fallback a buzón cifrado si el peer está offline

## 6.3 KAPPA Client Integration Layer

Capa dentro de KAPPA encargada de:

* autenticarse frente a OCEAN
* preparar el paquete del caso
* subir manifiesto y blob cifrado
* consultar solicitudes y revisiones asignadas
* descargar casos autorizados
* abrirlos localmente
* enviar comentarios y resultados

## 6.4 Comment and Discussion Service

Servicio que conserva:

* comentarios por caso
* recomendaciones
* resumen de revisión
* propuesta docente
* resolución final

## 6.5 Teaching Curation Service

Servicio para:

* registrar propuestas para docencia
* contar apoyos cualificados
* validar el caso
* asignar tags docentes
* publicarlo en la biblioteca docente

## 6.6 Audit and Compliance Service

Servicio de trazabilidad:

* eventos de acceso
* aceptación de revisión
* descarga o entrega
* cierre del caso
* cambios de estatus
* nominación docente

---

## 7. Roles de usuario

### 7.1 Autor del caso

Usuario que prepara el caso en KAPPA y solicita revisión.

Puede:

* crear caso
* definir contexto clínico mínimo
* seleccionar revisores o grupos
* cerrar caso si es propietario
* proponer caso para docencia

### 7.2 Revisor

Usuario que acepta una petición de revisión.

Puede:

* aceptar o rechazar revisión
* recibir acceso al caso
* abrirlo en KAPPA
* comentar
* emitir conclusión
* recomendarlo para docencia

### 7.3 Curador docente

Usuario con permisos adicionales.

Puede:

* revisar propuestas docentes
* validar o rechazar incorporación docente
* clasificar casos por categoría

### 7.4 Administrador de grupo / plataforma

Gestiona:

* grupos
* membresía
* políticas de acceso
* incidencias y auditoría

---

## 8. Modelo de datos principal

## 8.1 Entidad User

Campos mínimos:

* user_id
* nombre visible
* email profesional
* afiliación
* rol
* estado
* clave pública o identidad criptográfica
* preferencias

## 8.2 Entidad Group

* group_id
* nombre
* descripción
* tipo
* miembros
* reglas de acceso

## 8.3 Entidad Case

Representa el caso clínico.

Campos:

* case_id
* owner_user_id
* created_at
* title
* clinical_context
* modality
* tags
* status_clinical
* status_teaching
* visibility
* package_id
* summary_metrics
* resolution_summary

## 8.4 Entidad ReviewRequest

* request_id
* case_id
* requested_by
* target_user_id o target_group_id
* created_at
* status
* accepted_at
* expires_at

## 8.5 Entidad CasePackage

Representa el paquete técnico del caso.

Campos:

* package_id
* case_id
* package_format_version
* encryption_mode
* blob_location
* blob_hash
* size_bytes
* upload_status
* retention_policy

## 8.6 Entidad Comment

* comment_id
* case_id
* author_id
* created_at
* body
* type
* optional_anchor

## 8.7 Entidad Recommendation

* recommendation_id
* case_id
* author_id
* created_at
* type
* rationale

## 8.8 Entidad AuditEvent

* event_id
* actor_id
* case_id
* action
* timestamp
* target
* metadata

---

## 9. Estados del caso

Conviene separar dos dimensiones.

## 9.1 Estado clínico

* Draft
* Submitted
* Requested
* Accepted
* In transfer
* Available for review
* Under review
* Commented
* Resolved
* Archived

## 9.2 Estado docente

* None
* Proposed for teaching
* Recommended
* Validated for teaching
* Featured
* Rejected for teaching

---

## 10. Paquete de caso que KAPPA enviará a OCEAN

La integración entre ambos sistemas gira alrededor de un **paquete de caso**.

## 10.1 Contenido mínimo

El paquete debería contener:

* EEG anonimizado en EDF/EDF+ o formato acordado
* manifest del caso
* metadatos clínicos mínimos
* resumen cuantitativo
* review inicial opcional
* QC mínimo
* hash de integridad
* versión del pipeline KAPPA

## 10.2 Estructura lógica sugerida

Un caso podría empaquetarse como contenedor cifrado con:

* `signal.edf`
* `manifest.json`
* `clinical_summary.json`
* `metrics.json`
* `qc.json`
* `review_seed.json`
* `preview.png` opcional

## 10.3 Requisitos del manifest

Debe incluir como mínimo:

* case_id
* patient surrogate id o hash local
* timestamp de creación
* versión de KAPPA
* configuración del pipeline
* hash del EEG
* canales
* duración
* muestreo
* estado de anonimización

## 10.4 Requisitos criptográficos

El paquete debe almacenarse y transferirse cifrado.

Modelo propuesto:

* una clave simétrica por caso
* esa clave se protege para usuarios autorizados
* el servidor central puede almacenar el blob cifrado sin necesidad de leerlo
* KAPPA lo abre solo bajo sesión autorizada

---

## 11. Interacción funcional entre KAPPA y OCEAN

## 11.1 Casos de uso principales

### Caso de uso 1: crear caso desde KAPPA

1. El usuario abre EEG en KAPPA.
2. Lo anonimiza/prepara.
3. Introduce contexto clínico.
4. Solicita revisión.
5. KAPPA genera paquete cifrado.
6. KAPPA registra el caso en OCEAN.
7. KAPPA sube paquete o metadatos según flujo.

### Caso de uso 2: aceptar revisión

1. OCEAN notifica solicitud a revisor.
2. Revisor acepta.
3. OCEAN habilita acceso al paquete.
4. KAPPA del revisor descarga o recibe el caso.
5. Lo abre localmente.

### Caso de uso 3: comentar caso

1. Revisor analiza caso en KAPPA.
2. Desde KAPPA u OCEAN añade comentarios.
3. El hilo queda asociado al caso.
4. Puede emitir conclusión o dejarlo abierto.

### Caso de uso 4: proponer para docencia

1. Un usuario autorizado propone el caso.
2. Otros recomiendan o apoyan.
3. Curador valida.
4. OCEAN asigna tag docente.
5. El caso pasa a biblioteca docente.

---

## 12. API lógica entre OCEAN y KAPPA

No es una especificación REST cerrada todavía, pero sí debe haber una API clara con estas familias de operación.

## 12.1 Autenticación

* iniciar sesión
* refrescar sesión
* registrar dispositivo KAPPA
* obtener identidad y permisos

## 12.2 Casos

* crear caso
* actualizar metadatos
* consultar caso
* listar casos del usuario
* listar revisiones pendientes

## 12.3 Solicitudes de revisión

* crear solicitud
* aceptar
* rechazar
* reasignar
* cancelar

## 12.4 Paquetes

* registrar paquete
* subir blob cifrado
* consultar disponibilidad
* descargar blob autorizado
* confirmar recepción
* confirmar apertura

## 12.5 Comentarios y resolución

* crear comentario
* responder
* marcar conclusión
* cerrar caso

## 12.6 Docencia

* proponer para docencia
* recomendar
* validar
* consultar biblioteca docente

---

## 13. Seguridad y privacidad

## 13.1 Requisitos mínimos

* autenticación robusta
* sesiones con expiración
* autorización por caso y por grupo
* cifrado en tránsito
* cifrado del paquete en reposo
* auditoría de accesos
* revocación de acceso cuando proceda

## 13.2 Modelo realista de protección

La plataforma debe prometer esto:

* no persistencia en claro por defecto
* acceso solo mediante autorización
* cifrado del paquete
* apertura local controlada desde KAPPA
* logging de accesos

No debe prometer esto:

* imposibilidad absoluta de copia
* DRM perfecto
* imposibilidad total de captura de contenido

La promesa correcta es **control, dificultad de extracción y trazabilidad**, no imposibilidad metafísica.

## 13.3 Políticas de retención

Cada paquete de caso debe tener política configurable:

* temporal
* hasta cierre de revisión
* retenido para docencia
* eliminado automáticamente tras caducidad

---

## 14. Requisitos no funcionales

## 14.1 Rendimiento

* subida y descarga razonables para EEG clínicos habituales
* apertura local fluida en KAPPA
* listado de casos rápido
* comentarios casi en tiempo real o con refresco frecuente

## 14.2 Robustez

* reintentos de transferencia
* tolerancia a peer offline
* integridad verificada por hash
* recuperación de interrupciones

## 14.3 Escalabilidad

MVP orientado a grupos pequeños/medios, con arquitectura ampliable a:

* múltiples servicios
* almacenamiento de blobs escalable
* colas de eventos
* indexación de casos docentes

## 14.4 Compatibilidad

KAPPA debe poder funcionar en:

* Linux
* macOS
* Windows

La capa OCEAN debe diseñarse sin depender de una sola plataforma cliente.

## 14.5 Observabilidad

* métricas de uso
* logs de errores
* tiempos de transferencia
* eventos de aceptación/revisión
* fallos de integración con KAPPA

---

## 15. Especificación funcional del MVP

Para no hipertrofiar el proyecto, el MVP debe ser disciplinado.

## 15.1 Lo que entra en el MVP

* usuarios y autenticación
* grupos básicos
* creación de caso desde KAPPA
* paquete cifrado subido a buzón central
* solicitud de revisión
* aceptación/rechazo
* descarga autorizada por revisor
* apertura local en KAPPA
* comentarios por caso
* cierre de revisión
* propuesta docente simple
* tag docente manual/curado
* auditoría básica

## 15.2 Lo que no entra todavía

* transferencia P2P compleja
* sincronización multiusuario avanzada
* visor EEG completo en navegador
* comentarios anclados a trazado con precisión de muestra
* recomendador sofisticado
* red social general
* IA interpretativa
* marketplace de plugins
* repositorio abierto masivo

---

## 16. Evolución prevista tras el MVP

### Fase 2

* transferencia directa entre clientes cuando sea posible
* fallback automático a relay
* comentarios anclados a ventanas temporales
* dashboard de casos y revisiones

### Fase 3

* biblioteca docente estructurada
* curación más formal
* búsqueda por categorías docentes
* casos destacados

### Fase 4

* recomendaciones más inteligentes
* comparación entre casos
* integración con corpus y pipelines de investigación
* analítica de concordancia

---

## 17. Cuestiones abiertas que conviene decidir pronto

1. ¿El MVP usará solo buzón central cifrado o ya intentará algo de P2P?
2. ¿La apertura del caso será solo desde KAPPA o también desde un cliente OCEAN ligero?
3. ¿Qué metadatos clínicos mínimos serán obligatorios?
4. ¿Qué política de retención tendrá un caso resuelto?
5. ¿Quién valida el tag docente en la primera etapa?
6. ¿Habrá grupos cerrados por hospital/servicio además de usuarios individuales?
7. ¿Qué nivel de anonimización será obligatorio antes de exportar desde KAPPA?

---

## 18. Definición sintética final

OCEAN debe ser una plataforma profesional de **peticiones de revisión de casos EEG**, estrechamente integrada con KAPPA, donde:

* KAPPA prepara y abre localmente el caso
* OCEAN gestiona identidad, permisos y flujo de revisión
* los paquetes EEG se transfieren de forma controlada y cifrada
* la discusión clínica queda preservada
* algunos casos pueden evolucionar a biblioteca docente validada

