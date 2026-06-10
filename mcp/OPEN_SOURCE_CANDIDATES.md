# Open Source Candidates for Reuse (Terminal + Python 3D Sandbox)

Goal: avoid writing everything from scratch, while keeping licensing and attribution clean.

## Recommended Candidates

| Component | Project | License | Use | Status |
| --- | --- | --- | --- | --- |
| Model Context Protocol SDK | `modelcontextprotocol/typescript-sdk` | MIT | MCP server protocol plumbing for tools/resources. | Already used in this implementation. |
| node-pty | `microsoft/node-pty` | MIT | Persistent punchout terminal sessions across Windows/Linux. | Already used in this implementation. |
| Trimesh | `mikedh/trimesh` | MIT | Scriptable 3D mesh generation, transforms, exports (`.stl`, `.obj`, `.glb`). | Suggested for sandbox Python image. |
| Pyrender | `mmatl/pyrender` | MIT | Offscreen rendering in Python for previews. | Suggested for sandbox Python image. |
| Blender (headless) | Blender Foundation / blender | GPL-3.0-or-later | High-quality rendering and procedural modeling via Python scripts. | Optional, best in a separate container image due larger footprint and GPL obligations. |

## Optional Security Hardening Components

| Component | Project | License | Use |
| --- | --- | --- | --- |
| gVisor | `google/gvisor` | Apache-2.0 | Stronger container syscall isolation. |
| nsjail | `google/nsjail` | Apache-2.0 | Process-level sandboxing with seccomp/cgroups. |

## Adoption Checklist Before Vendoring/Reusing

1. Confirm license compatibility with this repo distribution model.
2. Add package/tool entry to `THIRD_PARTY_NOTICES.md`.
3. Preserve original copyright and license text.
4. Document modifications if code is copied/adapted.
5. Pin versions and hash-lock images/dependencies.

## Current Recommendation

- Keep protocol/session code in-repo.
- Reuse `@modelcontextprotocol/sdk` and `node-pty` directly.
- For Python 3D work, build a dedicated Docker image on top of Python 3.11 with `trimesh` and `pyrender` pinned.
- Add Blender image only if physically-based rendering quality is required.
