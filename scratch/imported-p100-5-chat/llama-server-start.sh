#!/bin/bash
set -euo pipefail

# systemd EnvironmentFile variables are available in this process.

LLAMA_BIN="${LLAMA_BIN:-/opt/llama.cpp/bin/llama-server}"
LLAMA_MODEL="${LLAMA_MODEL:-/opt/llama.cpp/models/model.gguf}"
LLAMA_HOST="${LLAMA_HOST:-0.0.0.0}"
LLAMA_PORT="${LLAMA_PORT:-8000}"
LLAMA_CTX="${LLAMA_CTX:-8192}"
LLAMA_THREADS="${LLAMA_THREADS:-$(nproc)}"
LLAMA_PARALLEL="${LLAMA_PARALLEL:-2}"
LLAMA_NGL="${LLAMA_NGL:-999}"
LLAMA_BATCH="${LLAMA_BATCH:-1024}"
LLAMA_UBATCH="${LLAMA_UBATCH:-512}"
LLAMA_CONT_BATCHING="${LLAMA_CONT_BATCHING:-1}"
LLAMA_CACHE_TYPE_K="${LLAMA_CACHE_TYPE_K:-q8_0}"
LLAMA_CACHE_TYPE_V="${LLAMA_CACHE_TYPE_V:-q8_0}"
LLAMA_TENSOR_SPLIT="${LLAMA_TENSOR_SPLIT:-}"
LLAMA_EXTRA_ARGS="${LLAMA_EXTRA_ARGS:-}"

export LD_LIBRARY_PATH="/opt/llama.cpp/lib:/opt/llama.cpp/bin:${LD_LIBRARY_PATH:-}"

if [ ! -x "$LLAMA_BIN" ]; then
  echo "ERROR: llama-server binary not found at $LLAMA_BIN"
  exit 1
fi

if [ ! -r "$LLAMA_MODEL" ]; then
  echo "ERROR: model not readable at $LLAMA_MODEL"
  exit 1
fi

ARGS=(
  --model "$LLAMA_MODEL"
  --host "$LLAMA_HOST"
  --port "$LLAMA_PORT"
  --ctx-size "$LLAMA_CTX"
  --threads "$LLAMA_THREADS"
  --parallel "$LLAMA_PARALLEL"
  --n-gpu-layers "$LLAMA_NGL"
  --batch-size "$LLAMA_BATCH"
  --ubatch-size "$LLAMA_UBATCH"
  --cache-type-k "$LLAMA_CACHE_TYPE_K"
  --cache-type-v "$LLAMA_CACHE_TYPE_V"
)

if [ "$LLAMA_CONT_BATCHING" = "1" ]; then
  ARGS+=(--cont-batching)
fi

if [ -n "$LLAMA_TENSOR_SPLIT" ]; then
  ARGS+=(--tensor-split "$LLAMA_TENSOR_SPLIT")
fi

if [ -n "$LLAMA_EXTRA_ARGS" ]; then
  # shellcheck disable=SC2206
  EXTRA=( $LLAMA_EXTRA_ARGS )
  ARGS+=("${EXTRA[@]}")
fi

exec "$LLAMA_BIN" "${ARGS[@]}"
