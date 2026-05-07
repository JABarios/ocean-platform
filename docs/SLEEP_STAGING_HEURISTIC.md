# Heurística De Estadiaje Basada En FMD

## Objetivo

Construir un estadiaje heurístico útil para EEG de sueño sin hipnograma formal,
priorizando `fmd_4_12` como criterio principal y usando el resto de métricas
solo para resolver dudas locales.

La salida actual del visor usa cinco clases:

- `Wake-like`
- `N1 / Activated`
- `N2-like`
- `N3-like`
- `Unreliable`

Limitación actual importante:

- Con el montaje y pipeline actuales para este hipnograma heurístico (`EEG` central, sin `EOG` ni `EMG`), **no se intenta separar `REM` como clase propia**.
- Los tramos tipo `REM` deben caer, como mucho, en la zona **`N1 / Activated`** o en **`Unreliable`**, pero no contaminar `N2-like`.

## Principio central

La referencia del registro es la **mediana limpia de `fmd_4_12`**.

Esa mediana se interpreta como el centro aproximado de `N2` para ese archivo,
siempre calculada tras descontar épocas muy artefactadas.

Esto evita usar cortes absolutos de adulto que fallan especialmente en EEG
infantil.

## Cálculo de la referencia

Se calcula:

- `n2ReferenceFmd = mediana(fmd_4_12)` sobre épocas válidas

Una época se considera válida para esa mediana si:

- `validFraction >= 0.50`
- `rejectedFraction <= 0.40`

## Umbrales derivados

A partir de `n2ReferenceFmd`:

- `Wake threshold = n2ReferenceFmd + 0.6`
- `N1 threshold   = n2ReferenceFmd + 0.2`
- `N3 threshold   = n2ReferenceFmd - 0.2`
- `N4 threshold   = n2ReferenceFmd - 0.4`

Visualmente, `N4` no se pinta aparte: se agrupa dentro de `N3-like`.

## Regla principal de clasificación

La `fmd_4_12` manda.

Pseudológica:

```text
if invalid -> Unreliable
else if fmd >= median + 0.6 -> Wake-like
else if fmd <= median - 0.4 and delta lenta fuerte -> N3-like
else if fmd <= median - 0.2 and delta lenta fuerte -> N3-like
else if fmd >= median + 0.2 -> N1 / Activated
else -> N2-like
```

Regla clínica importante:

- **Nunca llamar `Wake-like` a una época con `fmd_4_12` por debajo de la mediana de N2 del propio registro.**

## Resolución de la zona rápida

La zona por encima de `median + 0.2` es la banda rápida del registro.

Ahí se separa:

- `Wake-like` si la `fmd` llega al umbral alto (`median + 0.6`)
- `N1 / Activated` si la `fmd` está por encima de `median + 0.2` pero no
  alcanza vigilia clara

Las métricas rápidas se usan solo como apoyo:

- `relBeta`
- `posteriorAlpha`
- `arousalFraction`

Sirven para reforzar `N1 / Activated` o la confianza, pero no deben convertir
en `Wake-like` una época con `fmd` baja.

## Protección del sueño lento

La lentitud debe imponerse solo si además de `fmd` baja existe soporte
espectral lento real:

- `relDelta` alta
- `frontCentralDelta` alta

Por eso `N3-like` exige:

- `fmd <= median - 0.2` o `fmd <= median - 0.4`
- y además lentitud suficiente

## Artefactos y confianza

El cálculo interno usa subépocas de `2 s`:

- `REJECTED` se excluyen del espectro de la época de `30 s`
- `SUSPECT` se mantienen, pero bajan la confianza

Features exportadas por época:

- `validFraction`
- `suspectFraction`
- `rejectedFraction`
- `spindleSupportFraction`
- `slowWaveFraction`
- `arousalFraction`
- `confidence`

Una época pasa a `Unreliable` si:

- `validFraction < 0.50`
- o `rejectedFraction > 0.40`

## Papel de otras features

`fmd_4_12` es el criterio mayor.

El resto quedan como apoyo:

- `relDelta`, `frontCentralDelta`: sostienen `N3-like`
- `slowWaveFraction`: cuantifica cuántos subbloques limpios de `2 s` están
  dominados por lentitud compatible con sueño profundo
- `relBeta`, `posteriorAlpha`: ayudan a distinguir activación rápida
- `spindleSupportFraction`: dato a favor de `N2-like`
- `arousalFraction`: dato a favor de `N1 / Activated`
- `peakHz`: auxiliar de debug, no criterio principal

## Carga Lenta Y Separación N2/N3

`N2` y `N3` no se separan por una regla simplista de “hay husos / no hay
husos”.

En sueño real:

- `N2` puede contener complejos `K` y lentitud ocasional
- `N3` puede seguir conteniendo husos débiles u ocasionales

Por eso la implementación actual introduce `slowWaveFraction`:

- fracción de bloques limpios de `2 s`
- con `relDelta` claramente alta
- y `relBeta` baja

La idea fisiológica es:

- `N2-like`: lentitud presente pero no dominante en la mayor parte de la época
- `N3-like`: lentitud dominante en una fracción sustancial de la época

En la heurística actual:

- `N3-like` exige no solo `fmd` baja y delta frontal/central alta
- también una `slowWaveFraction` suficiente

Esto permite:

- que `N2` tolere complejos `K`
- que `N3` siga siendo `N3` aunque conserve husos ocasionales

## Soporte De Husos

`spindleSupportFraction` ya no intenta inferir husos a partir de una sigma
sostenida a lo largo de toda la época.

Ahora trabaja por bloques limpios de `2 s` y busca **elevaciones locales**
compatibles con ráfagas discretas:

- se calcula un `sigmaRmsRatio` por bloque
- `sigmaRmsRatio = RMS(sigma 11–16 Hz) / RMS(banda 1–30 Hz)`
- un bloque cuenta como spindle-like si rompe al alza la mediana de ese ratio
  dentro de la propia época, y además mantiene:
  - `relBeta` baja
  - `fmd_4_12` no rápida

Esto evita confundir:

- `sigma` continua o tónica
- con husos reales, breves y waxing-waning

En el staging, `spindleSupportFraction` no manda sobre `fmd_4_12`, pero sí:

- puede empujar casos fronterizos `N1 ↔ N2` hacia `N2-like`
- y aumenta la confianza de `N2-like` cuando hay husos discretos compatibles

## Motivo de diseño

Esta heurística está pensada para:

- no depender de tablas absolutas adultas
- adaptarse a registros pediátricos
- separar calidad técnica de fisiología
- usar una regla interpretable y estable en el visor

## Estado actual

La implementación vigente vive en:

- `kappa/src/analysis/sleep_sketch_analysis.*`
- `kappa/src/wasm/kappa_wasm.cpp`
- `ocean-platform/frontend/src/pages/EEGViewer.tsx`

El visor muestra:

- barras de debug espectral
- `F4-12`
- `Hyp`
- popup de hipnograma heurístico

con los labels ya remuestreados a la rejilla del DSA cuando el número de
épocas no coincide exactamente.

## Validación Sintética

La heurística ya no está validada solo a ojo en el visor.

En `kappa/tests/` existen ahora:

- tests sintéticos por fase aislada (`Wake`, `N1`, `N2`, `N3`)
- tests de sigma continua frente a husos discretos
- una noche sintética larga con reestadiaje completo
- una noche sintética de `70` épocas con artefactos musculares y de
  movimiento inyectados a propósito
- tests específicos donde:
  - `N2` conserva su clase pese a lentitud ocasional tipo complejo `K`
  - `N3` conserva su clase pese a husos débiles u ocasionales

La noche sintética canónica comprueba que el sistema puede reconstruir una
secuencia completa `Wake → N1 → N2 → N3 → N2 → N1 → Wake` con alta
consistencia, usando el mismo pipeline real de `SleepSketch`.

## Validación Real En Sleep-EDF ST

Además de la batería sintética, la heurística se ha contrastado contra `5`
sujetos reales del subconjunto `Sleep-EDF Telemetry (ST)` usando solo el canal
`EEG Fpz-Cz` y comparando contra el hipnograma experto por épocas de `30 s`.

Importante:

- `REM` no se puntúa como clase propia
- `N1` no se puntúa como exactitud primaria
- la comparación agregada principal se hace sobre:
  - `Wake`
  - `N2`
  - `N3`

Resultado agregado actual:

- exactitud global `Wake/N2/N3`: `311 / 551 = 56.4%`
- `Cohen's kappa`: `0.377`

Desglose por clase:

- `Wake`: `63 / 95`
- `N2`: `125 / 233`
- `N3`: `123 / 223`

Kappa por sujeto:

- `ST7012`: `0.299`
- `ST7021`: `0.279`
- `ST7022`: `0.288`
- `ST7041`: `0.594`
- `ST7051`: `0.373`

Matriz de confusión agregada (`filas = experto`, `columnas = KAPPA`), agrupando
`N1Activated` y demás salidas no puntuadas como `Other`:

- `Wake (95)`:
  - `Wake = 63`
  - `N2 = 6`
  - `N3 = 7`
  - `Other = 19`
- `N2 (233)`:
  - `Wake = 27`
  - `N2 = 125`
  - `N3 = 34`
  - `Other = 47`
- `N3 (223)`:
  - `Wake = 25`
  - `N2 = 57`
  - `N3 = 123`
  - `Other = 18`

Lectura práctica del benchmark real:

- `Wake` ya no falla de forma aleatoria; el error dominante es `Wake -> N1/Other`
- `N2` sufre sobre todo por fuga a `N1/Other`, y en segundo lugar a `N3`
- `N3` se confunde principalmente con `N2`

Esto justifica la evolución actual de la heurística:

- `FMD` sigue siendo el eje principal
- `relTheta`, `relBeta` y `Hjorth Mobility/Complexity` corrigen fronteras
- `slowWaveFraction` se mantiene como apoyo, pero no como puerta dura, porque en
  `Sleep-EDF ST` todavía discrimina peor de lo esperado

Evolución medida en `Sleep-EDF ST`:

1. heurística inicial:
   - `254 / 551`
   - `46.1%`
2. heurística multivariable v1:
   - `310 / 551`
   - `56.3%`
3. heurística actual:
   - `311 / 551`
   - `56.4%`
   - `kappa = 0.377`

## Clasificador Supervisado De Referencia

Además del estadiaje heurístico manual, existe ya un benchmark supervisado
basado en **regresión logística multinomial regularizada** evaluado sobre los
mismos `5` sujetos `Sleep-EDF ST`.

Importante:

- este modelo nació como benchmark supervisado y ahora puede alimentar el
  `Hyp` del visor como modo principal experimental
- sigue actuando como referencia para saber hasta dónde puede llegar un clasificador
  simple usando exactamente las mismas features por época
- la validación se hace en modo **leave-one-subject-out**:
  - se entrena con `4` sujetos
  - se prueba sobre el quinto

Clases usadas por este benchmark:

- `Wake`
- `N1/REM-like`
- `N2`
- `N3`

El colapso `N1 + REM` en una sola clase es deliberado:

- con `EEG Fpz-Cz` solo
- y sin `EOG/EMG`
- no es honesto exigir una separación robusta `N1` vs `REM`

Features usadas por época:

- `relDelta`
- `relTheta`
- `relAlpha`
- `relSigma`
- `relBeta`
- `fmd4to12`
- `thetaAlphaRatio`
- `deltaAlphaRatio`
- `posteriorAlpha`
- `frontCentralDelta`
- `validFraction`
- `suspectFraction`
- `rejectedFraction`
- `spindleSupportFraction`
- `slowWaveFraction`
- `arousalFraction`
- `hjorthMobility`
- `hjorthComplexity`

Resultado agregado del clasificador logístico:

- exactitud 4 clases: `65.7%`
- `Cohen's kappa`: `0.536`

Comparación con otros clasificadores sobrios sobre el mismo protocolo
`leave-one-subject-out`:

- heurística manual:
  - `accuracy = 52.4%`
  - `kappa = 0.366`
- `Gaussian Naive Bayes`:
  - `accuracy = 57.9%`
  - `kappa = 0.419`
- `kNN (k = 5)`:
  - `accuracy = 57.0%`
  - `kappa = 0.407`
- **regresión logística multinomial**:
  - `accuracy = 65.7%`
  - `kappa = 0.536`

Comparación directa contra la heurística actual:

- heurística 4 clases:
  - `accuracy = 52.4%`
  - `kappa = 0.366`
- logística multinomial:
  - `accuracy = 65.7%`
  - `kappa = 0.536`

Si se mira solo el scoring clásico `Wake/N2/N3`, el benchmark queda así:

- heurística:
  - `311 / 551`
  - `Wake = 63 / 95`
  - `N2 = 125 / 233`
  - `N3 = 123 / 223`
  - `N1REM = 98 / 230`
- logística:
  - `375 / 551`
  - `Wake = 74 / 95`
  - `N2 = 125 / 233`
  - `N3 = 176 / 223`
  - `N1REM = 138 / 230`

Lectura práctica:

- la mejora no viene de un modelo complejo
- viene ya de un clasificador lineal pequeño, regularizado y supervisado
- el salto mayor se observa en:
  - `N3`
  - `Wake`
  - y en la clase conjunta `N1/REM-like`
- `N2` se mantiene aproximadamente igual

## Configuración Ganadora Actual

La mejor configuración probada hasta ahora no es “todas las features”, sino
una logística multinomial con un subconjunto espectral enriquecido con
parámetros de Hjorth.

Ganadora actual:

- modelo:
  - **regresión logística multinomial regularizada**
- validación:
  - **leave-one-subject-out** sobre `5` sujetos `Sleep-EDF ST`
- clases:
  - `Wake`
  - `N1/REM-like`
  - `N2`
  - `N3`
- canal:
  - `EEG Fpz-Cz`

Subset de features vencedor:

- `relDelta`
- `relTheta`
- `relAlpha`
- `relSigma`
- `relBeta`
- `fmd4to12`
- `thetaAlphaRatio`
- `deltaAlphaRatio`
- `posteriorAlpha`
- `frontCentralDelta`
- `hjorthMobility`
- `hjorthComplexity`

Métricas de esta versión vencedora:

- `accuracy = 66.97%`
- `kappa = 0.553`

Comparación de subsets con logística:

- `spectral_plus_hjorth`:
  - `accuracy = 66.97%`
  - `kappa = 0.553`
- `all`:
  - `accuracy = 65.69%`
  - `kappa = 0.536`
- `compact_best_guess`:
  - `accuracy = 65.56%`
  - `kappa = 0.535`
- `fast_vs_slow`:
  - `accuracy = 65.43%`
  - `kappa = 0.534`
- `spectral_core`:
  - `accuracy = 64.28%`
  - `kappa = 0.517`

Lectura práctica:

- las features de **calidad pura** (`valid/suspect/rejected`) no ayudan como
  entradas del clasificador; sirven mejor para gating de confianza que para
  decidir estadio
- `Hjorth Complexity` sí aporta valor real al combinarse con el núcleo
  espectral
- `fmd4to12` sola no domina el problema de 4 clases, pero sigue ayudando en
  combinación

Ranking univariante orientativo con logística:

1. `relBeta`
2. `hjorthComplexity`
3. `relTheta`
4. `relDelta`
5. `frontCentralDelta`
6. `relSigma`
7. `hjorthMobility`

## Qué Significa Y Qué No

Este benchmark logístico es, por ahora, una **prueba de viabilidad**, no un
producto final.

Sí significa:

- que las features actuales contienen bastante más señal discriminativa de la
  que está explotando la heurística manual
- que probablemente el siguiente salto real de rendimiento vendrá de
  clasificadores supervisados y no de seguir añadiendo reglas a mano

No significa:

- que este sea el “mejor logístico posible”
- que ya tengamos el modelo final listo para integración clínica
- que debamos considerar cerrada la comparación con otros clasificadores

Límites actuales del benchmark:

- solo `5` sujetos `Sleep-EDF ST`
- sin ajuste fino de hiperparámetros más allá de regularización básica
- sin selección automática de features
- sin búsqueda de interacciones no lineales
- sin calibración probabilística posterior
- sin validación en otras cohortes o poblaciones clínicas

En otras palabras:

- es un **primer clasificador muy serio**
- claramente mejor que la heurística actual
- pero todavía no es el techo del enfoque supervisado
