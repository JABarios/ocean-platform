# OCEAN — Ingesta y formato de galerías EEG

## Objetivo

Dejar por escrito el flujo repetible para incorporar galerías de EEGs públicos o completamente anonimizados, y precisar qué metadatos debería soportar bien el modelo de galería.

Este documento nace a partir del primer caso real de uso con **CHB-MIT / PhysioNet**.

---

## 1. Principio de diseño

Una **galería** no es un caso clínico.

Debe representar una **colección navegable de EEGs reutilizables**:
- públicos, o
- completamente anonimizados, o
- preparados para docencia / benchmarking / exploración técnica

La galería debe poder:
- abrir cada EEG en el visor
- conservar trazabilidad de procedencia
- describir bien el dataset de origen
- permitir reimportaciones o ampliaciones sin ambigüedad

---

## 2. Flujo actual recomendado

### 2.1 Preparación fuera de OCEAN

La descarga y el procesado **no** deben hacerse dentro de OCEAN.

Pipeline recomendado:

1. Descargar dataset con script externo.
2. Procesar / reconstruir / anonimizar fuera de OCEAN si hace falta.
3. Dejar los EDF resultantes en un directorio local.
4. Copiarlos al servidor OCEAN dentro del árbol permitido de importación.
5. Importar la galería desde la web indicando la ruta del servidor.

### 2.2 Caso CHB-MIT ya usado

Ejemplo real trabajado:

1. Descarga local a:
   - `~/tmp/mitfiles/in`
2. Reconstrucción de EDFs bipolares a EDFs compatibles con OCEAN/KAPPA:
   - salida en `~/tmp/mitfiles/out`
3. Copia al servidor en:
   - `~/ocean-platform/backend/gallery-imports/chb01`
4. Importación web usando la ruta del contenedor:
   - `/app/gallery-imports/chb01`

### 2.3 Restricción importante

El campo de importación en OCEAN **no acepta rutas del portátil del usuario**.

Debe usarse una ruta accesible por el backend dentro de:

- `/app/gallery-imports/...`

Esto está restringido por `GALLERY_IMPORT_ROOT`.

---

## 3. Qué hicimos con CHB-MIT chb01

### 3.1 Dataset fuente

Fuente:
- PhysioNet — `CHB-MIT Scalp EEG Database` v1.0.0
- URL base: `https://physionet.org/content/chbmit/1.0.0/`

### 3.2 Textos fuente útiles detectados

Para este dataset hay tres niveles de información:

1. **Dataset general**
   - descripción global
   - licencia
   - tamaño
   - número de casos/sujetos
   - notas de anonimización

2. **`SUBJECT-INFO`**
   - sexo y edad por caso (`chb01`, `chb02`, etc.)

3. **`chbNN-summary.txt`**
   - montaje del caso
   - nombre de cada EDF
   - hora de inicio/fin
   - número de crisis por archivo
   - ventanas de crisis en segundos desde el inicio del EDF

### 3.3 Ajuste manual ya realizado

En la galería `chb01` ya se actualizó manualmente:
- título
- descripción
- fuente
- licencia
- tags

con texto basado en PhysioNet.

---

## 4. Evaluación del formato actual de galería

## 4.1 Lo que ya funciona bien

El modelo actual ya permite:
- `Gallery`
  - `title`
  - `description`
  - `source`
  - `license`
  - `visibility`
  - `tags`
- `GalleryRecord`
  - `label`
  - `sortOrder`
  - `metadata`
  - `tags`
  - enlace a `EegRecord`

Esto ya basta para:
- importar una colección
- navegarla
- abrir un EEG
- reusar blobs por hash

## 4.2 Lo que falta o conviene precisar

Para datasets reales como PhysioNet, el formato actual se queda corto en dos niveles.

### A. Metadatos de galería

Serían útiles estos campos, aunque sea dentro de `metadata` si no queremos migración inmediata:

- `datasetId`
  - ejemplo: `chbmit`
- `datasetVersion`
  - ejemplo: `1.0.0`
- `datasetUrl`
- `caseCode`
  - ejemplo: `chb01`
- `citation`
- `completeness`
  - `partial` / `complete`
- `recordExpectedCount`
- `recordImportedCount`
- `subjectAgeYears`
- `subjectSex`
- `notes`

### B. Metadatos por registro

Aquí está la mejora más valiosa.

Cada `GalleryRecord` debería poder guardar:

- `originalFilename`
- `sourceCaseCode`
  - ejemplo: `chb01`
- `sourceDataset`
  - ejemplo: `CHB-MIT`
- `startTime`
- `endTime`
- `durationSeconds`
- `seizureCount`
- `seizureWindows`
  - lista tipo `[{ startSec, endSec }]`
- `samplingRateHz`
- `channelCount`
- `montage`
- `sourceUrl`
- `importBatch`
- `notes`

---

## 5. Recomendación de evolución

### 5.1 Sin migración inmediata

La opción pragmática es:
- seguir usando `GalleryRecord.metadata`
- pero con un esquema interno estable

Ejemplo de `metadata` recomendado:

```json
{
  "originalFilename": "chb01_03.edf",
  "sourceDataset": "CHB-MIT",
  "sourceCaseCode": "chb01",
  "startTime": "13:43:04",
  "endTime": "14:43:04",
  "durationSeconds": 3600,
  "samplingRateHz": 256,
  "channelCount": 23,
  "montage": "bipolar 10-20",
  "seizureCount": 1,
  "seizureWindows": [
    { "startSec": 2996, "endSec": 3036 }
  ]
}
```

### 5.2 Mejora UI derivada

Si se rellena ese `metadata`, la galería podría mostrar por registro:
- badge `Crisis`
- número de crisis
- duración
- hora del bloque
- origen / filename

Eso haría las galerías mucho más útiles que una simple rejilla de archivos.

---

## 6. Flujo repetible propuesto para PhysioNet / datasets similares

1. Descargar dataset fuera de OCEAN.
2. Si hace falta, convertirlo o reconstruirlo con script externo.
3. Guardar EDFs finales en una carpeta limpia.
4. Copiar esa carpeta al servidor dentro de `backend/gallery-imports/...`
5. Importar la galería desde OCEAN.
6. Reescribir la ficha de galería con:
   - nombre correcto del dataset
   - licencia
   - descripción
   - tags
   - si es parcial o completa
7. Parsear archivos de descripción del dataset (`summary`, `manifest`, etc.) para enriquecer `GalleryRecord.metadata`.

---

## 7. Siguiente mejora lógica

Automatizar la fase 7:

- parser de `chb01-summary.txt`
- actualización automática de `GalleryRecord.metadata`
- opcionalmente, generación de tags automáticos como:
  - `seizure`
  - `hour-long`
  - `pediatric`
  - `physionet`

Eso nos permitiría repetir la operación para:
- `chb02`
- `chb03`
- otros datasets públicos

sin rehacer manualmente el enriquecimiento registro a registro.
