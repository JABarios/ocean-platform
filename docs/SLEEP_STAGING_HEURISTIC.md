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
