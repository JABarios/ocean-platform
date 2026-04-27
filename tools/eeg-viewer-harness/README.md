# EEG Viewer Test Harness

Standalone test harness for the EEG viewer. Runs the WASM viewer module against a local EDF file without requiring the full OCEAN backend, database, or authentication.

## Usage

```bash
python server.py /path/to/recording.edf [port]
```

Example:

```bash
python server.py ~/data/sample.edf 8765
```

Then open `http://localhost:8765` in a browser.

## What it does

1. Serves a vanilla-JS EEG viewer page (`index.html` + `viewer.js`).
2. Exposes the EDF file at `/edf`.
3. Serves the WASM module (`kappa_wasm.js` + `kappa_wasm.wasm`) from the repository.
4. The browser loads the WASM module, fetches the EDF, mounts it to MEMFS, and renders it with the same pipeline used in production.

## Features

- All core viewer controls: HP/LP/notch filters, window size (10/20/30/150 s), gain (0.1×–4×).
- EEG montage selector with `promedio`, `doble_banana`, `transversal`, `linked_mastoids`, `hjorth`.
- z-score normalization toggle for non-EEG channels.
- Keyboard navigation: ← → paginate, ↑ ↓ adjust gain.
- Mouse cursor with time tooltip.
- Draggable scale bar (µV).
- Real-time axis derived from the actual record duration (`nSamples / sfreq`), not from the nominal page label.
- Zero-phase HP/LP filtering in the WASM module (forward+backward with warmup), plus forward-only notch.

## Intentional differences vs. the React viewer

- The harness is meant for fast local debugging of the rendering pipeline, not full UI parity.
- It does not include the OCEAN decryption flow.
- It does not currently expose the React-only DSA panel or the artifact strip above it.
- It does not include the compact top toolbar or the hover-only metadata pill used in `/cases/:id/eeg`.

## File layout

```
tools/eeg-viewer-harness/
├── server.py      # Python HTTP server (no deps)
├── index.html     # Viewer page
├── viewer.js      # Vanilla-JS viewer logic (ported from EEGViewer.tsx)
└── README.md
```

## Notes

- The server expects the WASM files to exist at `frontend/public/wasm/` relative to the repository root.
- No encryption/decryption is performed — the EDF is served raw. This harness is for local viewer development only.
- CORS headers are added so the page works even if opened via a different origin during testing.
- If you rebuild the parent `kappa` WASM module, copy the refreshed `kappa_wasm.js/.wasm` into `frontend/public/wasm/` before testing from OCEAN.
