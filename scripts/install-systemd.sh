#!/bin/bash
# Instala OCEAN como servicio systemd para arrancar automáticamente
# Uso: sudo ./scripts/install-systemd.sh

set -e

USER_NAME=${SUDO_USER:-$USER}
OCEAN_DIR="/home/$USER_NAME/ocean-platform"

echo "=== Instalando OCEAN como servicio systemd ==="
echo "  Usuario: $USER_NAME"
echo "  Directorio: $OCEAN_DIR"

# Verificar que existe el directorio
if [ ! -d "$OCEAN_DIR" ]; then
  echo "ERROR: No existe $OCEAN_DIR"
  exit 1
fi

# Copiar servicio (con el nombre del usuario)
sed "s|%I|$USER_NAME|g" "$OCEAN_DIR/scripts/ocean-dev.service" > /etc/systemd/system/ocean-dev.service

# Recargar y habilitar
systemctl daemon-reload
systemctl enable ocean-dev

echo ""
echo "Servicio instalado. Comandos:"
echo "  sudo systemctl start ocean-dev    # Arrancar ahora"
echo "  sudo systemctl stop ocean-dev     # Parar"
echo "  sudo systemctl status ocean-dev   # Ver estado"
echo "  sudo journalctl -u ocean-dev -f   # Ver logs"
echo ""
echo "OCEAN se arrancará automáticamente al iniciar Minerva."
