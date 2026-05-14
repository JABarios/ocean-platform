# EEG Viewer Notes

Resumen operativo del visor EEG web actual en `frontend/src/pages/EEGViewer.tsx`.

## Escala y sensibilidad

- La lectura física del EDF sigue en microvoltios.
- La visualización no usa una traducción rígida de `uV -> mm` del navegador.
- La escala automática ya no se recalcula en cada pantalla visible.
- La referencia de autoescala se estima de forma robusta sobre ventanas repartidas por todo el registro y luego se mantiene fija al navegar.
- Esto evita que un artefacto puntual aplaste toda la señal en una sola página.
- El selector de sensibilidad expone valores clínicos (`3`, `7`, `10`, `15`, `150`, `500 uV/mm`) como una equivalencia estable sobre la heurística visual del visor.

## Barrido

- El control de barrido se presenta como velocidad clínica:
  - `30 mm/s`
  - `15 mm/s`
  - `10 mm/s`
  - `5 mm/s`
- Internamente equivale a ventanas aproximadas de:
  - `10 s`
  - `20 s`
  - `30 s`
  - `60 s`

## Anotaciones EDF+

- Las anotaciones EDF+ pueden mostrarse en una columna lateral izquierda.
- Cuando esa columna se cierra, el EEG vuelve a ocupar todo el ancho disponible.
- Las anotaciones siguen marcándose también en la barra temporal.

## Barra superior

- La banda superior prioriza controles clínicos rápidos:
  - `LFF`
  - `HFF`
  - `Notch`
  - `Sens`
  - `Barrido`
  - `Mont`
- Los `select` pierden el foco automáticamente tras cambiar de opción para reducir cambios accidentales con rueda o flechas.
- Las opciones avanzadas de montaje se agrupan en el menú `Montaje`.

## Menú Montaje

- El menú `Montaje` agrupa:
  - selección de canales de la referencia media
  - canales extra del montaje
  - `Norm z`
  - `Reset`
- Las secciones internas se despliegan bajo demanda para no abrir listas largas al entrar.

## Montaje promedio

- En el montaje promedio se ha aumentado la separación visual entre:
  - último canal izquierdo y línea media
  - línea media y primer canal derecho
- A la vez se han compactado ligeramente los grupos izquierdo, de línea media y derecho.
- El reparto vertical conserva la altura total del panel, sin dejar hueco libre abajo.

## DSA, sueño y espectros

- El visor mantiene el `DSA` como capa visual principal de tiempo-frecuencia.
- El analizador de sueño y la ventana de espectros usan cálculo perezoso (`lazy-load`) para no bloquear la apertura inicial del EDF.
- El panel de sueño indica la fuente de la `FMD`:
  - `qEEG global`
  - o `SleepSketch fallback`
- La escala vertical de `FMD`, `delta` y `sigma/beta` usa un rango robusto por percentiles para evitar que outliers extremos deformen la gráfica.
