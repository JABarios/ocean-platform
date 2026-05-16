#!/usr/bin/env python3
"""
Standalone EEG viewer test harness.

Usage:
    python server.py /path/to/file.edf [port]

Serves a vanilla-JS EEG viewer that loads the WASM module and displays
an EDF file without requiring the full OCEAN backend.
"""

import http.server
import os
import sys
from pathlib import Path

# Resolve paths relative to this script
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent.parent.resolve()
WASM_DIR = REPO_ROOT / "frontend" / "public" / "wasm"

EDF_PATH: Path | None = None
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SCRIPT_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Quieter logging
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        # Serve WASM files from repo
        if self.path.startswith("/wasm/"):
            wasm_file = WASM_DIR / self.path[len("/wasm/"):]
            if wasm_file.exists():
                self.send_response(200)
                if self.path.endswith(".wasm"):
                    self.send_header("Content-Type", "application/wasm")
                else:
                    self.send_header("Content-Type", "application/javascript")
                self.send_header("Content-Length", str(wasm_file.stat().st_size))
                self.end_headers()
                with open(wasm_file, "rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, f"WASM file not found: {wasm_file}")
                return

        # Serve EDF file
        if self.path == "/edf":
            if not EDF_PATH or not EDF_PATH.exists():
                self.send_error(404, "EDF file not configured or missing")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(EDF_PATH.stat().st_size))
            self.send_header("Content-Disposition", f'inline; filename="{EDF_PATH.name}"')
            self.end_headers()
            with open(EDF_PATH, "rb") as f:
                self.wfile.write(f.read())
            return

        # SPA fallback for /viewer or any unknown path
        local_path = self.translate_path(self.path)
        if not os.path.exists(local_path) or os.path.isdir(local_path):
            self.path = "/index.html"

        return super().do_GET()


def main():
    global EDF_PATH
    if len(sys.argv) < 2:
        print("Usage: python server.py /path/to/file.edf [port]", file=sys.stderr)
        sys.exit(1)

    EDF_PATH = Path(sys.argv[1]).expanduser().resolve()
    if not EDF_PATH.exists():
        print(f"EDF file not found: {EDF_PATH}", file=sys.stderr)
        sys.exit(1)

    if not WASM_DIR.exists():
        print(f"WASM directory not found: {WASM_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"Harness root : {SCRIPT_DIR}")
    print(f"EDF file     : {EDF_PATH}")
    print(f"WASM dir     : {WASM_DIR}")
    print(f"Listening on : http://0.0.0.0:{PORT}")
    print(f"Open         : http://localhost:{PORT}/")

    http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
