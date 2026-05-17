# Husos2: diseño metodológico e implementación actual

## 1. Propósito de este documento

Este documento tiene dos capas distintas y complementarias:

1. `Diseño metodológico previsto`
   Describe la idea general de `Husos2` como detector neurofisiológicamente razonable de husos de sueño, incluyendo la visión más amplia que motivó el trabajo.

2. `Implementación actual real`
   Describe lo que hoy está realmente desplegado en OCEAN/KAPPA dentro del visor EEG, aunque todavía no cubra toda la visión original.

La intención es no perder ni la metodología que queríamos construir ni el estado real del código.

---

## 2. Diseño metodológico previsto

### 2.1 Idea general

`Husos2` nace como un algoritmo determinista para detección automática de husos de sueño que combine dos exigencias:

- pureza físico-espectral del evento
- visibilidad morfológica en el EEG

La visión original no era hacer un detector puramente umbralado sobre una sola métrica, sino un sistema que integrara:

- contexto NREM
- energía sigma local
- pureza espectral tipo Barios
- forma del evento tipo A7 / Lacourse
- distinción topográfica entre husos lentos y rápidos

### 2.2 Base metodológica

La idea de `Husos2` mezcla dos familias de criterios:

- **Barios**
  Aporta el análisis espectral con DFT de alta resolución y el `Índice Sigma (Iσ)` como criterio de pureza frecuencial.

- **A7 / Lacourse et al.**
  Aporta el barrido continuo, el contexto NREM, la normalización por línea base local y los filtros morfológicos por covarianza y correlación sigma.

### 2.3 Visión fisiológica prevista

La visión original contemplaba dos subtipos:

| Subtipo | Banda principal | Topografía esperada |
|---|---|---|
| Huso lento | ~11–13.5 Hz | frontal |
| Huso rápido | ~12.5–16 Hz | parietal |

Eso justificaba, al menos conceptualmente:

- un detector frontal para husos lentos
- un detector parietal para husos rápidos
- y eventualmente una integración unificada de ambos

### 2.4 Arquitectura metodológica prevista

La arquitectura que teníamos en mente se puede resumir así:

1. construir señales regionales estables por promedio espacial
2. clasificar el contexto NREM
3. detectar candidatos por incremento local de potencia sigma
4. verificar pureza espectral con `Iσ`
5. verificar morfología con medidas tipo `zSigmaCov` y `sigmaCorr`
6. unir la información en un detector más parecido al criterio humano que a un simple threshold aislado

### 2.5 Diferencia entre visión y código actual

Esa visión sigue siendo útil como marco conceptual, pero hoy la implementación real todavía no es el detector dual completo lento+rápido. La versión productiva actual está especializada en el subtipo rápido parietal.

---

## 3. Implementación actual real en OCEAN/KAPPA

## 3.1 Alcance real

El `Husos2` que existe hoy en el visor EEG de OCEAN es:

- un detector de **husos rápidos parietales**
- integrado en `Trigger Avg`
- pensado para seleccionar eventos útiles para promedio desencadenado

No es todavía:

- un detector general lento+rápido
- un sistema dual frontal/parietal completo
- un clasificador universal de todos los husos del registro

### 3.2 Comportamiento de producto en la UI

Cuando el modo de detección es `Husos2`:

- la detección real se hace sobre el promedio regional parietal
- el canal trigger se mantiene solo como referencia visual
- el promedio del registro entero se fuerza automáticamente
- el usuario ya no tiene que marcar `Promediar registro entero`
- el bloque largo de debug ya no se muestra en la UX normal

---

## 4. Entrada real del detector

El detector usa:

- EEG multicanal crudo
- frecuencia de muestreo del EDF
- nombres de canal

La señal efectiva del detector se construye como promedio regional parietal con los canales disponibles de:

- `P3`
- `P4`
- `Pz`

Se exige al menos:

- `2 canales parietales válidos`

para que el promedio regional sea procesable.

---

## 5. Parámetros actualmente implementados

### 5.1 Bandas y contexto

- sigma rápida: `12.5–16.0 Hz`
- banda ancha de referencia: `4.5–30.0 Hz`
- banda lenta NREM: `0.5–8.0 Hz`
- banda rápida NREM: `16.0–30.0 Hz`
- umbral de contexto NREM: `ratio > 0.9`

### 5.2 Barrido temporal

- ventana de búsqueda: `0.3 s`
- avance: `0.1 s`
- línea base local: `30 s`
- duración mínima: `0.3 s`
- duración máxima: `2.5 s`

### 5.3 Umbrales base

- `zAbsSigPow > 0.5`
- `Iσ > 4.0` en la pasada conservadora
- `zSigmaCov > 1.3`
- `sigmaCorr > 0.69`

### 5.4 Refino temporal

- fragmento espectral Barios: `1.0 s`
- suavizado de envelope para bordes: `100 ms`
- umbral de borde: `z-envelope = 1.5`

---

## 6. Flujo real del algoritmo

### Fase 1. Promedio regional parietal

Se construye una señal regional parietal promediando los canales válidos disponibles.

Si el grupo no tiene suficientes canales útiles, el detector se detiene.

### Fase 2. Contexto NREM

Por ventanas de `30 s`, sobre la señal regional:

- se calcula potencia lenta `0.5–8 Hz`
- se calcula potencia rápida `16–30 Hz`
- se evalúa su razón

Solo se procesan las ventanas con:

- `ratio_NREM > 0.9`

### Fase 3. Candidatos por potencia sigma

Dentro del contexto NREM:

- se filtra la señal sigma rápida `12.5–16 Hz`
- se barre con ventanas de `0.3 s` y salto `0.1 s`
- se calcula `AbsSigPow`
- se normaliza con línea base local de `30 s`

Una ventana entra como candidata si:

- `zAbsSigPow > 0.5`

Las ventanas contiguas se fusionan en un candidato.

### Fase 4. Núcleo espectral por `best-window`

Este es uno de los cambios importantes respecto a la idea más simple inicial.

Cada candidato:

- no se evalúa ya solo en el `onset`
- ni solo en el `peak` bruto

Ahora el motor:

- desliza una ventana interna de `1 s`
- calcula `Iσ` en múltiples posiciones
- se queda con la mejor (`best-window`)

Ese valor es:

- `Iσ_best`

La pasada conservadora usa:

- `Iσ_best > 4.0`

### Fase 5. Redefinición de `onset` y `offset`

El evento final ya no usa el borde bruto del candidato ni el antiguo criterio basado en una fracción del pico.

Ahora:

1. se toma el centro del `best-window`
2. se calcula el envelope sigma suavizado
3. se retrocede hasta el cruce de `z-envelope = 1.5`
4. se avanza hasta el cruce de `z-envelope = 1.5`

Esto redefine:

- `onset`
- `offset`
- duración real final

### Fase 6. Filtro morfológico conservador

Tras pasar el gate espectral base, el evento debe cumplir:

- `zSigmaCov > 1.3`
- `sigmaCorr > 0.69`

Los eventos que pasan ambos filtros forman el conjunto:

- `seed`

Ese conjunto actúa como referencia de alta confianza para el propio registro.

---

## 7. Segunda pasada adaptativa (`pass 2`)

### 7.1 Objetivo

La segunda pasada no detecta desde cero. Reevalúa candidatos ya existentes para rescatar eventos parecidos a los `seed`, pero algo más débiles o incompletos.

### 7.2 Activación

Solo se activa si hay suficientes semilla:

- mínimo actual: `5 seed`

### 7.3 Umbrales adaptativos derivados del registro

El `pass 2` aprende de los propios husos semilla del registro.

Se derivan, con suelos y techos de seguridad:

- `Iσ_min`
- `zAbs_min`
- `zCov_min`
- `corr_min`
- banda de duración esperada

Estado actual:

- `Iσ_min = max(3.0, min(3.5, p10(seed Iσ)))`
- `corr_min = max(0.55, min(0.63, p10(seed corr) - 0.02))`
- `zCov_min` y `zAbs_min` también se obtienen desde percentiles con límites

### 7.4 Score adaptativo combinado

Además de umbrales suaves, la implementación actual usa un score combinado de similitud al prototipo de los `seed`.

El score mezcla:

- `Iσ_best`
- `sigmaCorr`
- `zSigmaCov`

Pesos actuales:

- `Iσ`: `0.50`
- `corr`: `0.30`
- `zCov`: `0.20`

### 7.5 Red de seguridad

El rescate adaptativo exige una malla mínima de seguridad:

- `Iσ_floor = 2.8`
- `corr_floor = 0.55`
- `zCov_floor = 0.25`
- `score_min = 1.05`

La aceptación final del `pass 2` exige:

1. pasar la red mínima de seguridad
2. y además:
   - pasar los umbrales adaptativos suaves, o
   - superar el `adaptiveScore`

Los aceptados por esta vía quedan marcados internamente como:

- `adaptive_ok`

---

## 8. Semántica actual de contadores

Aunque la UI productiva ya no muestra todo el debug interno, el motor sigue usando esta semántica:

- `seed`: eventos aceptados por la pasada conservadora
- `rescued`: eventos añadidos por la pasada adaptativa
- `aceptados`: `seed + rescued`
- `usados en promedio`: eventos finalmente usados tras exclusión opcional por artefacto

Importante:

- `aceptados` se calcula a nivel de registro entero
- `usados` depende además del filtro de artefactos
- en `Husos2` el promedio se fuerza ya al registro entero

---

## 9. Qué partes de la visión original aún no están implementadas

Todavía no existe en esta versión:

- detector separado de husos lentos frontales
- fusión explícita de detector frontal + detector parietal
- segunda apertura de candidatos con puerta `zAbs` más baja sobre todo el registro
- una interfaz estable de tuning clínico de todos los parámetros internos

Por tanto, hoy conviene entender `Husos2` como:

- un detector rápido parietal pragmático
- alineado con la visión metodológica original
- pero todavía parcial respecto al diseño completo

---

## 10. Estado recomendado actual

La estrategia que mejor está funcionando a día de hoy es:

- pasada conservadora por `best-window`
- refino temporal por `z-envelope`
- `pass 2` adaptativo basado en `seed`
- rescate final por score combinado

Si se continúa el trabajo más adelante, el siguiente paso lógico sería:

- validar visualmente los `adaptive_ok`
- y solo después decidir si conviene abrir más la entrada o extender el modelo a detector dual frontal/parietal

---

## 11. Archivos relevantes

Motor:

- [spindle_raster_analysis.h](/Users/juan/Documents/kappa/src/analysis/spindle_raster_analysis.h)
- [spindle_raster_analysis.cpp](/Users/juan/Documents/kappa/src/analysis/spindle_raster_analysis.cpp)
- [kappa_wasm.cpp](/Users/juan/Documents/kappa/src/wasm/kappa_wasm.cpp)

Frontend:

- [EEGViewer.tsx](/Users/juan/Documents/kappa/ocean/ocean-platform/frontend/src/pages/EEGViewer.tsx)
- [eegViewerUtils.ts](/Users/juan/Documents/kappa/ocean/ocean-platform/frontend/src/pages/eegViewerUtils.ts)
