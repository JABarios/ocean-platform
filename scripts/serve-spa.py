#!/usr/bin/env python3
"""Servidor HTTP estático con SPA fallback.
Sirve archivos del directorio actual. Si la ruta no existe,
devuelve index.html (para que React Router maneje la URL).

Uso: python3 serve-spa.py [puerto] [--bind IP]
"""
import sys
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

class SPAHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.translate_path(self.path)
        # Si no existe el archivo/directorio, servir index.html
        if not os.path.exists(path) or os.path.isdir(path):
            self.path = '/index.html'
        return super().do_GET()

    def end_headers(self):
        # Desactivar cache para desarrollo
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    bind = sys.argv[2] if len(sys.argv) > 2 else '0.0.0.0'
    # Usa el directorio actual (donde se ejecuta), no el del script
    server = HTTPServer((bind, port), SPAHandler)
    print(f"SPA server en http://{bind}:{port} | dir: {os.getcwd()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
