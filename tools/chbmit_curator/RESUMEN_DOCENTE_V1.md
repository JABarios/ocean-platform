# CHB-MIT — Resumen Docente V1

## Objetivo

Definir un formato simple y repetible para generar, a partir de la `salida V3`, un **EDF resumen docente por niño** acompañado de un índice estructurado.

La idea no es representar todo el caso, sino reunir en un único paquete los fragmentos más útiles para:

- revisión rápida
- docencia
- comparación entre sujetos
- navegación futura desde un plugin del visor

---

## 1. Principio de diseño

El **resumen docente** no es un “EDF completo resumido”.

Es una **selección narrativa de fragmentos** del caso, en un orden que ayude a entender:

1. cómo es el fondo del niño
2. cómo es su sueño útil
3. cómo son sus transiciones lentas o dudosas
4. cómo es la actividad relacionada con crisis del propio sujeto
5. cómo son sus crisis anotadas

Por tanto, el resumen docente debe considerarse:

- **material de revisión/enseñanza**
- **derivado de la salida V3**
- **no equivalente al registro original**

---

## 2. Entradas

El generador debe partir de la `salida V3` de cada caso:

- `manifest.json`
- fragmentos `nrem_clear`
- fragmentos `indeterminate_fast`
- fragmentos `indeterminate_slow`
- fragmentos `preictal_like`
- fragmentos `ictal_core_like`
- fragmentos `postictal_like`
- fragmentos `seizures`

La referencia principal es siempre el `manifest.json`.

---

## 3. Salidas

Por cada caso `chbNN`, generar:

- `chbNN_teaching_summary.edf`
- `chbNN_teaching_summary_index.json`

Opcionalmente:

- `chbNN_teaching_summary_index.csv`
- `chbNN_teaching_summary_notes.md`

---

## 4. Contenido mínimo

El resumen docente V1 debe intentar incluir:

- `1` fragmento `nrem_clear`
- `1` fragmento `indeterminate_slow`
- `1` fragmento `preictal_like`
- `1` fragmento `ictal_core_like`
- `1` fragmento `postictal_like`
- `1-2` crisis anotadas representativas

Si una categoría no existe, se omite sin romper el flujo.

Ejemplos:

- Si no hay crisis anotadas, como en `chb06`, no habrá bloques ictales.
- Si no hay `preictal_like`, el resumen puede seguir siendo válido solo con fondo/sueño/crisis.

---

## 5. Orden recomendado de segmentos

Orden por defecto:

1. `nrem_clear`
2. `indeterminate_slow`
3. `indeterminate_fast` si existe
4. `preictal_like`
5. `ictal_core_like`
6. `postictal_like`
7. `seizure_01`
8. `seizure_02` si se incluye una segunda crisis

Este orden cuenta una historia clínica:

- primero el fondo y el sueño
- luego el patrón epileptiforme relacionado con el sujeto
- al final la(s) crisis real(es)

---

## 6. Duración objetivo por tipo

Regla V1:

- `nrem_clear`: usar duración completa del fragmento V3, típicamente `180 s`
- `indeterminate_slow`: duración completa, típicamente `180 s`
- `indeterminate_fast`: duración completa, típicamente `180 s`
- `preictal_like`: duración completa, típicamente `180 s`
- `ictal_core_like`: duración completa del candidato, aunque sea más corto, típicamente `60 s`
- `postictal_like`: duración completa, típicamente `180 s`
- `seizure`: conservar la ventana V3 completa `pre + ictal + post`

No recortar más en V1 salvo necesidad técnica.

---

## 7. Separación entre bloques

Entre segmentos concatenados conviene introducir una separación explícita.

Opciones:

- `A.` solo índice externo
- `B.` anotaciones EDF+
- `C.` pequeña pausa técnica entre bloques

Recomendación V1:

- mantener **índice externo obligatorio**
- si es sencillo, añadir **anotación EDF+**
- no insertar silencios ni señal artificial de momento

---

## 8. Índice JSON

El archivo `chbNN_teaching_summary_index.json` debe ser la pieza central.

Estructura mínima:

```json
{
  "caseCode": "chb01",
  "summaryVersion": "teaching-v1",
  "sourceCuratorVersion": "v3",
  "sourceManifest": "manifest.json",
  "segmentCount": 6,
  "segments": [
    {
      "order": 1,
      "segmentType": "nrem_clear",
      "summaryStartSec": 0,
      "summaryEndSec": 180,
      "sourceFile": "chb01_14_reconstructed.edf",
      "sourceStartSec": 1830,
      "sourceEndSec": 2010,
      "durationSeconds": 180,
      "selectionMethod": "heuristic+yasa-consensus",
      "score": 0.91,
      "teachingNote": "NREM relativamente limpio con rasgos útiles de sueño estable"
    }
  ]
}
```

Campos mínimos por segmento:

- `order`
- `segmentType`
- `summaryStartSec`
- `summaryEndSec`
- `sourceFile`
- `sourceStartSec`
- `sourceEndSec`
- `durationSeconds`
- `selectionMethod`
- `score` si existe
- `teachingNote`

Campos recomendados:

- `epileptiformFlag`
- `stage`
- `broadStage`
- `sourceOriginalFilename`
- `clinicalPriority`

---

## 9. Notas docentes por tipo

Las notas docentes deben ser cortas y estables.

Plantillas V1:

- `nrem_clear`
  - `Bloque de sueño relativamente limpio y útil para referencia de fondo.`
- `indeterminate_slow`
  - `Bloque lento o somnoliento útil como transición, sin afirmar sueño bien tipado.`
- `indeterminate_fast`
  - `Bloque relativamente rápido o ligero, útil como contraste, sin afirmar vigilia limpia.`
- `preictal_like`
  - `Fragmento no anotado parecido al patrón previo de crisis del propio sujeto.`
- `ictal_core_like`
  - `Fragmento no anotado parecido al núcleo ictal de las crisis del propio sujeto.`
- `postictal_like`
  - `Fragmento no anotado parecido a la recuperación o lentificación posterior a crisis.`
- `seizure`
  - `Crisis anotada en el summary, conservada con ventana de contexto.`

---

## 10. Selección de crisis anotadas

No hace falta incluir todas las crisis en el resumen docente.

Regla V1:

- incluir `1` crisis si el caso es muy repetitivo
- incluir `2` crisis si muestran buena representatividad o variabilidad útil

Criterios de prioridad:

1. mejor calidad técnica
2. morfología más representativa
3. duración manejable
4. utilidad docente

Si no se automatiza aún, esta elección puede quedar manual.

---

## 11. Casos sin crisis anotadas

Si un caso no tiene crisis anotadas:

- no generar `preictal_like`
- no generar `ictal_core_like`
- no generar `postictal_like`

El resumen docente sigue siendo válido como:

- fondo útil
- sueño útil
- transición lenta/rápida útil

Esto aplica a casos tipo `chb06`.

---

## 12. Relación con OCEAN

El resumen docente se puede usar después de dos maneras:

- como artefacto local para abrir directamente en visor/KAPPA
- como material importable en una galería o librería docente de OCEAN

El índice JSON debe permitir:

- navegar el EDF resumen
- volver del resumen al origen
- presentar etiquetas legibles en un plugin futuro del visor

---

## 13. Criterio de éxito para V1

V1 se considerará útil si consigue:

- producir un EDF breve y coherente por niño
- conservar trazabilidad completa al origen
- mostrar sueño útil y patrones epileptiformes del sujeto
- ser entendible sin tener que abrir 30 EDF distintos

No hace falta que V1:

- resuelva perfectamente `WAKE/N1/REM`
- reemplace el registro completo
- actúe como material final de publicación

---

## 14. Siguiente implementación natural

Cuando se implemente:

1. leer `manifest.json` de la `salida V3`
2. elegir segmentos según estas reglas
3. concatenar EDFs en un `teaching_summary.edf`
4. generar `teaching_summary_index.json`
5. opcionalmente, preparar importación a galería/docencia en OCEAN

