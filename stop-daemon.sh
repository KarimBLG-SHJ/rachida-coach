#!/bin/bash
if [ -f .daemon.pid ]; then
  kill $(cat .daemon.pid) && rm .daemon.pid
  echo "⏹ Rappels arrêtés"
else
  echo "Aucun daemon actif"
fi
