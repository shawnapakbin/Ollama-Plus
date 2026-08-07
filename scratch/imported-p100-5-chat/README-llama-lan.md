# llama.cpp LAN deployment for frozen NVIDIA stack

This folder now includes scripts to build and run llama.cpp as a systemd service on LAN using the existing frozen GPU environment.

## What was added

- build-llama-cpp.sh: builds CUDA-enabled llama-server and llama-cli against CUDA 12.2.
- install-llama.sh: installs scripts, service units, and default environment config.
- llama-server.service: systemd service for the inference server.
- llama-server-start.sh: wrapper that maps env vars to llama-server flags.
- llama-healthcheck.sh: endpoint and GPU sanity probe.
- llama-healthcheck.service + llama-healthcheck.timer: periodic health execution.
- llama-profiles/coder-q6-16k.env: coding-focused Q6 profile with 16k context.
- llama-profiles/coder-q6-64k.env: coding-focused Q6 profile with 64k context.
- activate-llama-profile.sh: applies a profile to /etc/llama.cpp/server.env and restarts service.
- system-prompt.txt: server-wide system prompt copied to /etc/llama.cpp/system-prompt.txt and posted on startup.

## Requirements

- nvidia-driver-580-server + cuda-toolkit-12-2 already installed and frozen.
- A GGUF model file available.

## Install and build

1. Install service assets:

   sudo bash install-llama.sh

2. Build llama.cpp binaries:

   /usr/local/sbin/build-llama-cpp.sh

3. Copy your model:

   sudo cp /path/to/model.gguf /opt/llama.cpp/models/model.gguf
   sudo chown llama:llama /opt/llama.cpp/models/model.gguf

4. Tune server parameters if needed:

   sudoedit /etc/llama.cpp/server.env

   Edit the global system prompt here:

   sudoedit /etc/llama.cpp/system-prompt.txt

   The launcher re-posts this file to /props every time the server starts, so changes persist across restarts.

   Or apply a prepared profile:

   ./activate-llama-profile.sh coder-q6-16k.env
   ./activate-llama-profile.sh coder-q6-64k.env

5. Start service:

   sudo systemctl start llama-server.service

## Verify

- Service status:

  sudo systemctl status llama-server.service --no-pager

- Health timer status:

  sudo systemctl status llama-healthcheck.timer --no-pager

- Local health endpoint:

  curl -fsS http://127.0.0.1:8000/health

## LAN test from another machine

Run against the target host IP:

curl -s http://HOST_IP:8000/v1/models

## Notes

- The default config binds 0.0.0.0:8000, enables metrics and slot management flags, and reapplies /etc/llama.cpp/system-prompt.txt on startup via /props.
- For strict subnet binding, set LLAMA_HOST to the host LAN interface IP.
- For multi-GPU balancing, set LLAMA_TENSOR_SPLIT in /etc/llama.cpp/server.env.
