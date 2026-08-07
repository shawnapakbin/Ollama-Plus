#!/bin/bash
set -euo pipefail

ENV_FILE="/etc/llama.cpp/server.env"
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

LLAMA_HOST="${LLAMA_HOST:-127.0.0.1}"
LLAMA_PORT="${LLAMA_PORT:-8000}"
HEALTH_PATH="${LLAMA_HEALTH_PATH:-/health}"
TEMP_WARN_C="${LLAMA_TEMP_WARN_C:-85}"

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl not installed"
  exit 1
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "ERROR: nvidia-smi not found"
  exit 1
fi

URL="http://${LLAMA_HOST}:${LLAMA_PORT}${HEALTH_PATH}"
if ! curl -fsS --max-time 3 "$URL" >/dev/null; then
  echo "UNHEALTHY: endpoint failed at $URL"
  exit 1
fi

if ! nvidia-smi >/dev/null 2>&1; then
  echo "UNHEALTHY: nvidia-smi failed"
  exit 1
fi

mapfile -t TEMPS < <(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null)
MAX_T=0
for t in "${TEMPS[@]}"; do
  if [ "$t" -gt "$MAX_T" ]; then
    MAX_T="$t"
  fi
done

if [ "$MAX_T" -ge "$TEMP_WARN_C" ]; then
  echo "WARN: max GPU temp ${MAX_T}C >= ${TEMP_WARN_C}C"
else
  echo "OK: endpoint healthy, max GPU temp ${MAX_T}C"
fi
