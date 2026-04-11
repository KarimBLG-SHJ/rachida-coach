#!/bin/bash
# Lance le coach en arrière-plan
# Les rappels Mac tournent automatiquement
cd "$(dirname "$0")"
nohup node index.js daemon > logs/daemon.log 2>&1 &
echo $! > .daemon.pid
echo "✅ Rachida Health Coach — rappels actifs (PID: $(cat .daemon.pid))"
