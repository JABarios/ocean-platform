#!/bin/bash
# OCEAN — Control de arranque/parada para Minerva
# Uso: source ~/ocean-platform/scripts/ocean.sh
#        ocean_up    # Arranca backend + frontend
#        ocean_down  # Detiene todo

ocean_down() {
  echo "Parando OCEAN..."
  pkill -f "tsx watch" 2>/dev/null
  pkill -f "node.*index.ts" 2>/dev/null
  pkill -f "python.*http.server" 2>/dev/null
  sleep 2
  local pid4000=$(lsof -ti:4000 2>/dev/null)
  if [ -n "$pid4000" ]; then
    kill -9 $pid4000 2>/dev/null
    sleep 1
  fi
  local pid5173=$(lsof -ti:5173 2>/dev/null)
  if [ -n "$pid5173" ]; then
    kill -9 $pid5173 2>/dev/null
    sleep 1
  fi
  echo "OCEAN detenido"
}

ocean_up() {
  ocean_down >/dev/null 2>&1
  (cd ~/ocean-platform/backend && nohup npm run dev >/dev/null 2>&1 &)
  sleep 3
  (cd ~/ocean-platform/frontend/dist && nohup python -m http.server 5173 --bind 0.0.0.0 >/dev/null 2>&1 &)
  sleep 1
  echo "OCEAN arrancado: http://localhost:5173"
}
