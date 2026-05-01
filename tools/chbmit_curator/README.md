# CHB-MIT Curator

Utilidad Python para preparar fragmentos EEG más útiles a partir de CHB-MIT ya reconstruido para OCEAN/KAPPA.

## Qué hace

Trabaja sobre EDFs ya reconstruidos (`*_reconstructed.edf`) y genera, por cada niño/caso:

- fragmentos de **crisis** con:
  - `3 min antes`
  - `crisis`
  - `3 min después`
- uno o varios fragmentos de **NREM claro**
- opcionalmente, fragmentos de:
  - `indeterminate_fast`
  - `indeterminate_slow`
  - `preictal_like`
  - `ictal_core_like`
  - `postictal_like`
- un `manifest.json` con procedencia y metadatos

Está pensado como curación pragmática para galerías, no como estadiaje de sueño clínico completo.

## Idea de diseño

- **Crisis**: se extraen desde `chbNN-summary.txt`
- **NREM claro**: se ancla por lento + sigma/husos
- **indeterminate_fast**: bloque relativamente rápido, útil como referencia pre-sueño, pero sin afirmar vigilia limpia
- **indeterminate_slow**: bloque relativamente lento/somnoliento, pero sin afirmar NREM claro
- **preictal_like**: ventana no anotada que se parece al tramo previo de las crisis del propio caso
- **ictal_core_like**: ventana corta, no anotada, parecida al núcleo ictal de las crisis del caso
- **postictal_like**: ventana no anotada parecida a la lentificación/recuperación posterior a las crisis
- **REM**: no se intenta de primeras

## Dependencias

```bash
pip install -r requirements.txt
```

La **versión 2** añade YASA, MNE y comparación de hipnogramas:

```bash
pip install -r requirements-v2.txt
```

## Uso rápido

```bash
cd ocean-platform/tools/chbmit_curator

python3 curate_chbmit_fragments.py \
  --input-dir ~/tmp/mitfiles/out \
  --output-dir ~/tmp/mit-curated \
  --overwrite
```

El script intentará inferir el `caseCode` (`chb01`, `chb02`, etc.) a partir de los nombres de archivo reconstruidos y descargará por defecto:

- `https://physionet.org/files/chbmit/1.0.0/chbNN/chbNN-summary.txt`
- `https://physionet.org/files/chbmit/1.0.0/SUBJECT-INFO`

## Versión 2: comparación heurística vs YASA

Existe una segunda utilidad, separada de la v1, que no sustituye el flujo original:

```bash
python3 curate_chbmit_fragments_v2.py \
  --input-dir ~/tmp/mitfiles/out \
  --output-dir ~/tmp/mit-curated-v2 \
  --overwrite
```

La versión 2:

- conserva la extracción de crisis `-3 min / +3 min`
- mantiene la misma taxonomía principal:
  - `nrem_clear`
  - `indeterminate_fast`
  - `indeterminate_slow`
- usa YASA como comparación y apoyo, no como verdad absoluta
- exige una confianza mínima de YASA (`--yasa-confidence`, por defecto `0.80`)
- genera dos hipnogramas CSV:
  - `*_heuristic_hypnogram.csv`
  - `*_yasa_hypnogram.csv`
- y además una figura:
  - `*_hypnogram_compare.png`
- marca las epochs que pisan una **crisis anotada** como `EXCLUDED`
  - no se usan para elegir fragmentos
  - no cuentan para la concordancia entre heurística y YASA

Esto está pensado para comparar enfoques, no para vender la salida como estadiaje de sueño validado.

## Versión 3: staging + detector ictal sujeto-específico

La `v3` formaliza la línea de trabajo actual:

- mantiene la comparación con YASA, pero no la trata como verdad absoluta
- conserva `N2/N3` como referencia útil de comparación
- separa el `staging` del detector ictal sujeto-específico
- exporta candidatos:
  - `preictal_like`
  - `ictal_core_like`
  - `postictal_like`
- marca en `manifest.json`:
  - `curatorVersion: "v3"`
  - `stagingMethod: "v3-heuristic+yasa+subject-ictal-split"`

Uso:

```bash
python3 curate_chbmit_fragments_v3.py \
  --input-dir /Volumes/DATOS/chbmit-reconstructed/mit-reconstructed-v2/chb01 \
  --output-dir /Volumes/DATOS/mit-curated-v3 \
  --summary-file /Volumes/DATOS/chb-mit/chb01/chb01-summary.txt \
  --subject-info-file /Volumes/DATOS/chb-mit/SUBJECT-INFO \
  --overwrite
```

## Ejecutar todos los casos `chbNN`

Si ya tienes el dataset local completo y quieres repetir el flujo sobre todos los casos, existe un runner batch:

```bash
python3 run_chbmit_batch.py \
  --dataset-root /Volumes/DATOS/chb-mit \
  --reconstructed-root /Volumes/DATOS/chbmit-reconstructed \
  --curated-root /Volumes/DATOS/chbmit-curated-v2 \
  --version v2 \
  --overwrite
```

Si vas justo de espacio en el disco interno, es preferible trabajar siempre sobre el disco externo:

```bash
python3 run_chbmit_batch.py \
  --dataset-root /Volumes/DATOS/chb-mit \
  --reconstructed-root /Volumes/DATOS/chbmit-reconstructed \
  --curated-root /Volumes/DATOS/chbmit-curated-v2 \
  --version v2 \
  --overwrite
```

Así, tanto los `*_reconstructed.edf` como los fragmentos curados y los hipnogramas quedan fuera de `/private/tmp`.

Qué hace:

- recorre todas las carpetas `chbNN` dentro de `--dataset-root`
- reconstruye cada EDF local con `convert_physionet_bipolar.py --skip-download`
- ignora automáticamente los ficheros `._*` de macOS
- usa `SUBJECT-INFO` y `chbNN-summary.txt` locales
  - ejecuta después el curador `v1`, `v2` o `v3` según `--version`

Opciones útiles:

- `--case chb01 --case chb02`
  - limita el barrido a casos concretos
- `--limit-cases 3`
  - procesa solo los primeros N casos detectados
- `--skip-reconstruct`
  - útil si ya tienes los `*_reconstructed.edf`
- `--skip-curate`
  - deja hecha solo la parte de reconstrucción
- `--dry-run`
  - imprime los comandos sin ejecutarlos

## Parámetros útiles

```bash
python3 curate_chbmit_fragments.py --help
```

Opciones principales:

- `--input-dir`: carpeta con EDFs reconstruidos
- `--output-dir`: carpeta base de salida
- `--summary-file`: usar `chbNN-summary.txt` local
- `--summary-url`: usar URL explícita
- `--subject-info-file`: usar `SUBJECT-INFO` local
- `--pre-seizure-seconds`: por defecto `180`
- `--post-seizure-seconds`: por defecto `180`
- `--state-seconds`: duración objetivo de fragmentos no crisis, por defecto `180`
- `--max-fast`: número máximo de fragmentos `indeterminate_fast`, por defecto `1`
- `--max-slow`: número máximo de fragmentos `indeterminate_slow`, por defecto `1`
- `--max-nrem`: número máximo de fragmentos `nrem_clear`, por defecto `1`
- `--max-preictal-like`: máximo de `preictal_like`, por defecto `1`
- `--max-ictal-core-like`: máximo de `ictal_core_like`, por defecto `1`
- `--max-postictal-like`: máximo de `postictal_like`, por defecto `1`
- `--overwrite`: reescribe salidas ya existentes

## Estructura de salida

```text
chb01/
  seizures/
    chb01_chb01_03_reconstructed_sz01_02816-03216.edf
  nrem_clear/
    chb01_chb01_17_reconstructed_nrem_clear_02400-02580.edf
  indeterminate_fast/
    chb01_chb01_29_reconstructed_indeterminate_fast_00000-00180.edf
  indeterminate_slow/
    chb01_chb01_01_reconstructed_indeterminate_slow_01440-01620.edf
  preictal_like/
    chb01_chb01_19_reconstructed_preictal_like_00990-01170.edf
  ictal_core_like/
    chb01_chb01_32_reconstructed_ictal_core_like_03090-03150.edf
  postictal_like/
    chb01_chb01_22_reconstructed_postictal_like_02640-02820.edf
  manifest.json
```

## Manifest

El `manifest.json` incluye:

- metadatos de la serie/caso
- lista de fragmentos de crisis
- lista de fragmentos `nrem_clear`
- lista de fragmentos `indeterminate_fast`
- lista de fragmentos `indeterminate_slow`
- lista de fragmentos `preictal_like`
- lista de fragmentos `ictal_core_like`
- lista de fragmentos `postictal_like`
- archivo origen
- duración
- método de selección
- score heurístico o híbrido según la categoría
- similitud media con:
  - `preictal`
  - `ictal_core`
  - `postictal`

## Limitaciones conocidas

- No se debe interpretar `indeterminate_fast` como “vigilia confirmada”
- No se debe interpretar `indeterminate_slow` como “sueño confirmado”
- `preictal_like` / `ictal_core_like` / `postictal_like` son **candidatos de revisión**, no nuevas crisis confirmadas
- `nrem_clear` sigue siendo una **heurística conservadora**, no un scoring validado
- REM no se intenta
- Durante la **crisis anotada** y su entorno inmediato, el “estadiaje” no tiene sentido clínico normal
  - en v2 esas epochs se marcan como `EXCLUDED`
- Si un EDF de entrada está truncado o corrupto, `pyedflib` lo rechazará
- Conviene ejecutar esto sobre EDFs ya reconstruidos y sanos

## Próxima mejora natural

Además de la `salida V3`, existe ya una propuesta formal para construir un **EDF resumen docente por niño**:

- [RESUMEN_DOCENTE_V1.md](./RESUMEN_DOCENTE_V1.md)

Esa especificación define:

- qué segmentos incluir
- en qué orden concatenarlos
- qué índice JSON acompañante generar
- y cómo conectar este artefacto con revisión/docencia en OCEAN

También existe ya una utilidad inicial para generarlo directamente desde la `salida V3`:

```bash
python3 generate_teaching_summary.py \
  --input-root /Volumes/DATOS/mit-curated-v3 \
  --case chb01 \
  --overwrite
```

Salida esperada por caso:

- `chbNN_teaching_summary.edf`
- `chbNN_teaching_summary_index.json`

- aceptar también `.seizure` además de `summary.txt`
- guardar confidence más detallada por epoch
- exportar un CSV resumen adicional
