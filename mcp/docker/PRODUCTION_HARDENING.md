# Production Hardening Notes

The default Python sandbox uses Docker isolation with no network, dropped capabilities, a read-only root filesystem, and resource limits. For higher-assurance deployments, layer one of the following underneath or alongside Docker.

## Option 1: gVisor

Use gVisor when you want stronger syscall isolation for untrusted Python workloads.

High-level approach:

1. Install and enable gVisor on the host.
2. Configure Docker to use the gVisor runtime for the sandbox image.
3. Keep the same `mcp/python-sandbox-server.mjs` interface and point `MCP_PY_IMAGE` at a pinned image.

Example host-level idea:

```bash
docker run --runtime=runsc --rm --network none --read-only ...
```

## Option 2: nsjail

Use nsjail when you want process-level containment with explicit seccomp/cgroup controls.

High-level approach:

1. Wrap the sandboxed Python process in nsjail instead of invoking Docker directly.
2. Keep the Python code mounted to a run directory with no host write access outside that directory.
3. Combine with the existing blocked-pattern pre-checks and timeout enforcement.

## Recommended Order

1. Docker defaults for local development.
2. gVisor for stronger container isolation.
3. nsjail when you want process-level policy control and can manage a custom jail profile.
