# Husos2: especificación del modo realmente implementado

## 1. Alcance

`Husos2` es el modo de detección automática de husos rápidos que existe hoy en el visor EEG de OCEAN, dentro de `Trigger Avg`.

No es un detector general de husos lentos + rápidos ni un sistema dual frontal/parietal. La implementación actual está centrada en:

- husos rápidos parietales
- promedio regional parietal
- uso dentro del flujo de promedio desencadenado del visor

Su objetivo práctico es:

- encontrar husos rápidos visibles y espectralmente plausibles
- generar una lista de eventos para el promedio multicanal
- permitir un rescate controlado de eventos limítrofes sin degradar demasiado la precisión

---

## 2. Comportamiento de producto en la UI

En `Trigger Avg`, cuando el modo de detección es `Husos2`:

- el promedio se fuerza automáticamente sobre el registro entero
- el usuario ya no tiene que marcar `Promediar registro entero`
- el canal trigger se conserva solo como referencia visual del promedio
- la detección real se hace sobre el promedio regional parietal

Además, el panel visible se ha dejado en modo producto:

- se muestran contadores generales de candidatos, aceptados y usados
- no se muestran por defecto los bloques extensos de debug interno

---

## 3. Entrada real del detector

El detector usa:

- EEG multicanal crudo
- frecuencia de muestreo del registro
- nombres de canal del EDF

El motor construye un promedio regional parietal usando los canales disponibles del grupo:

- `P3`
- `P4`
- `Pz`

La detección exige al menos 2 canales parietales válidos para que el promedio regional sea procesable.

---

## 4. Parámetros por defecto actualmente implementados

### 4.1 Banda y contexto

- sigma rápida: `12.5–16.0 Hz`
- banda ancha de referencia: `4.5–30.0 Hz`
- NREM lenta: `0.5–8.0 Hz`
- NREM rápida: `16.0–30.0 Hz`
- umbral de contexto NREM: `ratio > 0.9`

### 4.2 Barrido y duración

- ventana de búsqueda: `0.3 s`
- avance: `0.1 s`
- línea base local: `30 s`
- duración mínima: `0.3 s`
- duración máxima: `2.5 s`

### 4.3 Umbrales principales

- `zAbsSigPow > 0.5`
- `Iσ > 4.0` en la pasada conservadora
- `zSigmaCov > 1.3`
- `sigmaCorr > 0.69`

### 4.4 Refino temporal

- fragmento espectral Barios: `1.0 s`
- umbral de borde del envelope sigma z: `1.5`
- suavizado del envelope para borde: `100 ms`

---

## 5. Flujo real del algoritmo

### Fase 1. Promedio regional parietal

Se construye una señal regional parietal promediando los canales parietales disponibles.

Si el número de canales válidos es insuficiente, el detector se detiene.

### Fase 2. Contexto NREM

Sobre la señal regional se calcula, por ventanas de `30 s`, el cociente:

- potencia lenta `0.5–8 Hz`
- frente a potencia rápida `16–30 Hz`

Solo se procesan las ventanas cuya razón supera `0.9`.

### Fase 3. Candidatos por potencia sigma

Dentro del contexto NREM:

- se filtra la señal sigma rápida `12.5–16 Hz`
- se hace barrido con ventana `0.3 s` y avance `0.1 s`
- se calcula `AbsSigPow`
- se normaliza con línea base local de `30 s`

Una ventana entra como candidata si:

- `zAbsSigPow > 0.5`

Las ventanas contiguas o solapadas se fusionan en un evento candidato.

### Fase 4. Núcleo sigma por `best-window`

Cada candidato ya no se evalúa solo en `onset` ni solo en `peak`.

El motor busca la mejor ventana interna de `1 s`:

- desliza un fragmento de `1 s` dentro del candidato
- calcula `Iσ` en cada posición
- se queda con la posición que maximiza ese índice

Ese valor se guarda como:

- `Iσ_best`

La pasada espectral conservadora usa precisamente ese valor:

- `Iσ_best > 4.0`

### Fase 5. Redefinición de `onset` y `offset`

El evento final no usa ya el borde bruto del candidato ni la antigua regla basada en fracción del pico.

El procedimiento actual es:

- tomar el centro del `best-window`
- calcular el envelope sigma suavizado
- retroceder hasta el cruce de `z-envelope = 1.5`
- avanzar hasta el cruce de `z-envelope = 1.5`

Eso redefine:

- `onset`
- `offset`
- duración final del evento

### Fase 6. Filtro morfológico

Tras pasar el gate espectral base, el evento debe cumplir también:

- `zSigmaCov > 1.3`
- `sigmaCorr > 0.69`

Los eventos que pasan ambos filtros forman el conjunto:

- `seed`

Este conjunto es la referencia de alta confianza del registro.

---

## 6. Segunda pasada adaptativa (`pass 2`)

### 6.1 Objetivo

La segunda pasada no detecta desde cero. Parte de los candidatos ya evaluados y trata de rescatar eventos parecidos a los `seed`, pero algo más débiles o incompletos.

### 6.2 Activación

Solo se activa si hay suficientes eventos semilla:

- mínimo actual: `5 seed`

### 6.3 Umbrales adaptativos derivados de los `seed`

El `pass 2` aprende del propio registro usando percentiles de los `seed`.

Hoy se derivan:

- `Iσ_min`
- `zAbs_min`
- `zCov_min`
- `corr_min`
- rango de duración

Con barandillas duras para evitar dos problemas:

- que el rescate se vuelva demasiado laxo
- que se vuelva más estricto que la pasada base

Implementación actual:

- `Iσ_min = max(3.0, min(3.5, p10(seed Iσ)))`
- `corr_min = max(0.55, min(0.63, p10(seed corr) - 0.02))`
- `zCov_min` y `zAbs_min` también se derivan de percentiles con suelo y techo

### 6.4 Score adaptativo combinado

Además de los umbrales suaves, el `pass 2` usa un score combinado de similitud al prototipo de los `seed`.

El score actual mezcla:

- `Iσ_best`
- `sigmaCorr`
- `zSigmaCov`

Con pesos:

- `Iσ`: `0.50`
- `corr`: `0.30`
- `zCov`: `0.20`

El rescate final exige:

1. pasar una malla mínima de seguridad
2. y además:
   - pasar los umbrales adaptativos suaves, o
   - superar `score_min`

Valores de seguridad actuales:

- `Iσ_floor = 2.8`
- `corr_floor = 0.55`
- `zCov_floor = 0.25`
- `score_min = 1.05`

Los eventos aceptados por esta vía quedan etiquetados internamente como:

- `adaptive_ok`

---

## 7. Qué significan hoy los contadores internos

Aunque el bloque largo de debug ya no se muestra en la UI normal, el motor sigue trabajando con esta semántica:

- `seed`: eventos aceptados por la pasada conservadora
- `rescued`: eventos añadidos por la segunda pasada adaptativa
- `aceptados`: `seed + rescued`
- `usados en promedio`: aceptados finales tras excluir los que caen en artefacto si esa opción está activada

Importante:

- `detectados` y `aceptados` se calculan a nivel de registro entero
- `usados` depende además de filtros de artefacto y del ámbito del promedio
- en `Husos2`, el ámbito ya queda fijado al registro entero

---

## 8. Qué no hace esta versión

La implementación actual no hace todavía:

- detector separado de husos lentos frontales
- fusión explícita de dos detectores lento/rápido
- apertura de candidatos extra con una segunda puerta `zAbs` más baja sobre todo el registro
- clasificación clínica de sueño completa
- interfaz de tuning clínico estable para los parámetros adaptativos

Tampoco se debe leer este modo como un “detector universal de husos”, sino como:

- un detector rápido parietal pragmático
- afinado para el flujo del visor y del promedio desencadenado

---

## 9. Estado recomendado

A fecha actual, la estrategia que mejor está funcionando en el visor es:

- pasada conservadora por `best-window`
- refinado temporal por `z-envelope`
- rescate adaptativo por `seed`
- score combinado en `pass 2`

Si se retoma la optimización más adelante, el siguiente paso lógico no es volver a endurecer umbrales fijos, sino:

- validar visualmente los `adaptive_ok`
- y, si hace falta, ajustar `score_min` o abrir una segunda entrada de candidatos solo para `pass 2`

---

## 10. Archivos relevantes

Motor:

- [spindle_raster_analysis.h](/Users/juan/Documents/kappa/src/analysis/spindle_raster_analysis.h)
- [spindle_raster_analysis.cpp](/Users/juan/Documents/kappa/src/analysis/spindle_raster_analysis.cpp)
- [kappa_wasm.cpp](/Users/juan/Documents/kappa/src/wasm/kappa_wasm.cpp)

Frontend:

- [EEGViewer.tsx](/Users/juan/Documents/kappa/ocean/ocean-platform/frontend/src/pages/EEGViewer.tsx)
- [eegViewerUtils.ts](/Users/juan/Documents/kappa/ocean/ocean-platform/frontend/src/pages/eegViewerUtils.ts)

