# EEG Viewer Harness

Harness local para probar el visor EEG sin depender del backend completo de OCEAN.

## Opciones de trabajo

### 1. Visor real de la app

La forma más fiel al producto actual:

```bash
cd /Users/juan/Documents/kappa/ocean/ocean-platform/frontend
npm install
npm run dev
```

Abrir después:

```text
http://localhost:5173/open
```

Ese flujo:
- abre un EDF local desde el navegador;
- no sube nada al servidor;
- permite probar el visor real, incluyendo `Trigger Avg`.

### 2. Harness standalone

La forma más rápida para depurar el visor/WASM con un EDF concreto:

```bash
cd /Users/juan/Documents/kappa/ocean/ocean-platform/frontend
npm run viewer:harness -- /ruta/al/archivo.edf 8765
```

Después abrir:

```text
http://localhost:8765/
```

Notas:
- el segundo argumento (`8765`) es opcional;
- el harness sirve el EDF por `/edf`;
- carga el WASM desde `frontend/public/wasm`;
- no necesita backend.

Ejemplo real:

```bash
cd /Users/juan/Documents/kappa/ocean/ocean-platform/frontend
npm run viewer:harness -- /Users/juan/Documents/kappa/test/test_generator.edf
```

## Cuándo usar cada uno

- Usa `/open` si quieres probar la experiencia real de la app.
- Usa el harness si quieres depurar rápido render, filtros, navegación o WASM con un EDF fijo.
