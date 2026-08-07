#!/bin/bash
set -euo pipefail

cd "$HOME/llama"

sudo id -u llama >/dev/null 2>&1 || sudo useradd -r -m -s /usr/sbin/nologin llama

sudo install -d -m 0755 /opt/llama.cpp/bin
sudo install -d -m 0755 /opt/llama.cpp/models
sudo install -d -m 0755 /opt/llama.cpp/meta
sudo install -d -m 0755 /etc/llama.cpp

sudo install -m 0755 build-llama-cpp.sh /usr/local/sbin/build-llama-cpp.sh
sudo install -m 0755 llama-server-start.sh /usr/local/sbin/llama-server-start.sh
sudo install -m 0755 llama-healthcheck.sh /usr/local/sbin/llama-healthcheck.sh
sudo install -m 0644 system-prompt.txt /etc/llama.cpp/system-prompt.txt
if [ -n "${SUDO_USER:-}" ]; then
  sudo chown "$SUDO_USER:$SUDO_USER" /etc/llama.cpp/system-prompt.txt
fi

sudo install -m 0644 llama-server.service /etc/systemd/system/llama-server.service
sudo install -m 0644 llama-healthcheck.service /etc/systemd/system/llama-healthcheck.service
sudo install -m 0644 llama-healthcheck.timer /etc/systemd/system/llama-healthcheck.timer

if [ ! -f /etc/llama.cpp/server.env ]; then
  cat <<'EOF' | sudo tee /etc/llama.cpp/server.env >/dev/null
# Network and endpoint
LLAMA_HOST=0.0.0.0
LLAMA_PORT=8000

# Binaries and model
LLAMA_BIN=/opt/llama.cpp/bin/llama-server
LLAMA_MODEL=/opt/llama.cpp/models/model.gguf

# Performance baseline for large models (tune later)
LLAMA_CTX=8192
LLAMA_THREADS=32
LLAMA_PARALLEL=2
LLAMA_NGL=999
LLAMA_BATCH=1024
LLAMA_UBATCH=512
LLAMA_CONT_BATCHING=1
LLAMA_CACHE_TYPE_K=q8_0
LLAMA_CACHE_TYPE_V=q8_0

# Optional: comma-separated fractions matching GPU count, example below
# LLAMA_TENSOR_SPLIT=1,1,1,1,1

# Optional additional server flags
LLAMA_EXTRA_ARGS=--jinja --mlock --metrics --slots --props

# Global system prompt file applied automatically on startup.
LLAMA_SYSTEM_PROMPT_FILE=/etc/llama.cpp/system-prompt.txt

# Health probe settings
LLAMA_HEALTH_PATH=/health
LLAMA_TEMP_WARN_C=85
EOF
fi

sudo chown -R llama:llama /opt/llama.cpp

sudo systemctl daemon-reload
sudo systemctl enable llama-server.service
sudo systemctl enable --now llama-healthcheck.timer

echo "=== install complete ==="
echo "1) Build: /usr/local/sbin/build-llama-cpp.sh"
echo "2) Place model at /opt/llama.cpp/models/model.gguf"
echo "3) Start service: sudo systemctl start llama-server.service"
echo "4) Check: sudo systemctl status llama-server.service --no-pager"
