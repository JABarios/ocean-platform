#!/bin/bash
# Instala OCEAN como servicio systemd usando ocean.sh
# Uso: sudo ./scripts/install-service.sh

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Ejecutar con sudo"
  exit 1
fi

cp /home/juan/ocean-platform/scripts/ocean.service /etc/systemd/system/ocean.service
systemctl daemon-reload
systemctl enable ocean
systemctl start ocean

echo "Servicio instalado. Comandos:"
echo "  sudo systemctl start ocean"
echo "  sudo systemctl stop ocean"
echo "  sudo systemctl status ocean"
echo "  sudo journalctl -u ocean -f"
