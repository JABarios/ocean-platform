# Bipolar EDF Reconstruction

Herramienta batch en Python para:

- descargar EDFs desde un directorio de PhysioNet u otra URL índice,
- guardarlos en un directorio local de entrada/cache,
- reconstruir canales “pseudo-monopolares” a partir de registros puramente bipolares,
- escribir EDFs nuevos compatibles con OCEAN/KAPPA en un directorio de salida,
- y registrar un CSV con el resultado de cada archivo.

## Caso de uso

Pensado especialmente para bases como CHB-MIT, donde algunos registros se distribuyen con canales etiquetados como diferencias (`F3-F7`, `F7-T3`, etc.). OCEAN puede leer esos EDF, pero sus montajes clínicos no funcionan bien mientras no existan canales por electrodo.

La herramienta reconstruye una solución consistente por nodos usando mínimos cuadrados. No recupera el “original verdadero”, pero sí una representación utilizable para:

- `promedio`
- `doble_banana`
- `transversal`
- otros montajes dependientes de electrodos individuales

## Dependencias

```bash
pip install -r requirements.txt
```

## Uso rápido

```bash
cd ocean-platform/tools/bipolar_edf_reconstruction

python3 convert_physionet_bipolar.py \
  --source-url "https://physionet.org/content/chbmit/1.0.0/chb01/" \
  --download-dir /ruta/a/chbmit_cache/chb01 \
  --output-dir /ruta/a/chbmit_reconstructed/chb01
```

## Qué hace

1. Lee la página índice indicada por `--source-url`
2. Detecta enlaces `.edf`
3. Descarga los archivos faltantes a `--download-dir`
4. Si encuentra un supuesto `.edf` cacheado que en realidad es HTML u otro archivo inválido, lo refresca automáticamente
5. Recorre los `.edf` del directorio de entrada
6. Reconstruye canales por electrodo desde señales bipolares
7. Exporta un EDF nuevo a `--output-dir`
8. Guarda un CSV `conversion_report.csv`

## Opciones útiles

```bash
python3 convert_physionet_bipolar.py --help
```

Opciones principales:

- `--source-url`: URL del directorio web con enlaces `.edf`
- `--download-dir`: directorio local donde se guardan/cachan los originales
- `--output-dir`: directorio donde se escriben los EDF convertidos
- `--limit N`: procesa solo N archivos
- `--overwrite`: reescribe salidas ya existentes
- `--skip-download`: usa solo los EDF ya presentes en `--download-dir`

## Notas

- La base CHB-MIT ya viene anonimizada por PhysioNet; esta herramienta no hace de-identificación, sino normalización de montaje.
- Los canales auxiliares no bipolares (`ECG`, `VNS`, etc.) se copian como passthrough si están presentes.
- Los canales “dummy” (`-`) se ignoran.
- La reconstrucción fija una solución por mínimos cuadrados y después recentra las señales a media instantánea cero para evitar depender de una referencia arbitraria.
- Las etiquetas de salida se normalizan a una nomenclatura compatible con los montajes clásicos de OCEAN/KAPPA (`Fp1`, `Fz`, `Cz`, `Pz`, `T3/T4/T5/T6`).

## Salida

Por cada EDF se generan:

- `archivo_reconstructed.edf`
- una fila en `conversion_report.csv` con:
  - archivo origen
  - archivo salida
  - estado
  - número de pares bipolares
  - número de nodos reconstruidos
  - canales auxiliares conservados
  - error RMS de reconstrucción
