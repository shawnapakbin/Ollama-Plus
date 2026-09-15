/**
 * Ollama + — MCP status probe helpers
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Pure, side-effect-free helpers extracted from `electron/main.js`'s
 * `probeMcpServices()` so the composition logic can be unit- and
 * property-tested without importing the Electron main entry point.
 */

/** Maximum length (in characters) of any probe note. */
export const PROBE_NOTE_MAX_LENGTH = 200;

/**
 * Normalize a probe note to a non-empty string of at most 200 characters.
 * Trims whitespace, substitutes the fallback when empty, and truncates overflow.
 * @param {unknown} text - Candidate note text.
 * @param {string} [fallback='Unavailable.'] - Non-empty replacement when text is empty.
 * @returns {string} A non-empty string of length <= 200.
 */
export function clampNote(text, fallback = 'Unavailable.') {
  let note = typeof text === 'string' ? text.trim() : '';
  if (!note) {
    note = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : 'Unavailable.';
  }
  if (note.length > PROBE_NOTE_MAX_LENGTH) {
    note = note.slice(0, PROBE_NOTE_MAX_LENGTH);
  }
  return note;
}

/**
 * @typedef {Object} RootCheck
 * @property {boolean} ok    - Whether the configured root path is reachable.
 * @property {string}  root  - The resolved root path.
 * @property {string}  note  - A note describing the root check outcome.
 */

/**
 * @typedef {Object} DockerCheck
 * @property {boolean} ok   - Whether Docker is available.
 * @property {string}  note - A note describing the Docker check outcome.
 */

/**
 * Compose the Python_Sandbox_Tool status entry from the actual sandbox-root and
 * Docker check results.
 *
 * The reported availability reflects real reachability — `ok` is true if and
 * only if BOTH the sandbox root is reachable AND Docker is available — regardless
 * of how long the enclosing probe took to run. When unavailable, the note names
 * the precondition that failed:
 *   - sandbox root unreachable → the root check's own note (describes the root issue)
 *   - root reachable but Docker down → "Sandbox root ready but Docker unavailable."
 *
 * @param {RootCheck} pythonRoot - Result of checking the sandbox root path.
 * @param {DockerCheck} docker   - Result of the Docker availability check.
 * @returns {{ ok: boolean, root: string, docker: string, note: string }}
 */
export function composePythonAvailability(pythonRoot, docker) {
  const ok = Boolean(pythonRoot.ok && docker.ok);
  return {
    ok,
    root: pythonRoot.root,
    docker: docker.note,
    note: clampNote(
      pythonRoot.ok
        ? (docker.ok ? 'Python sandbox ready.' : 'Sandbox root ready but Docker unavailable.')
        : pythonRoot.note,
      ok ? 'Python sandbox ready.' : 'Python sandbox unavailable.'
    )
  };
}

/**
 * The exact set of service keys reported by the status probe, in a stable order.
 * One gateway entry plus these six services makes the fixed seven-entry shape.
 * @type {readonly ['browser', 'terminal', 'folder', 'python', 'openscad', 'blender_plate']}
 */
export const PROBE_SERVICE_KEYS = Object.freeze([
  'browser',
  'terminal',
  'folder',
  'python',
  'openscad',
  'blender_plate'
]);

/**
 * @typedef {Object} ServiceEntries
 * @property {object} browser       - The Browser_Tool status entry.
 * @property {object} terminal      - The Terminal_Tool status entry.
 * @property {object} folder        - The Folder_Tool status entry.
 * @property {object} python        - The Python_Sandbox_Tool status entry.
 * @property {object} openscad      - The OpenSCAD_Tool status entry.
 * @property {object} blender_plate - The Blender_Plate_Tool status entry.
 */

/**
 * Assemble the fixed seven-entry probe result shape from a gateway entry and the
 * six per-service status entries.
 *
 * The result always contains exactly one gateway entry plus one entry for each
 * of the six services in {@link PROBE_SERVICE_KEYS} — never more, never fewer —
 * regardless of the contents of the supplied entries. Extra keys present on the
 * `services` input are ignored: only the six canonical service keys are copied
 * into the result. This keeps `probeMcpServices()`'s output shape pinned to the
 * seven-entry contract (Requirement 11.1).
 *
 * @param {object} gateway           - The gateway status entry.
 * @param {ServiceEntries} services  - The per-service status entries.
 * @param {string} [checkedAt]       - ISO timestamp for when the probe ran.
 * @returns {{ checkedAt: string, gateway: object, services: ServiceEntries }}
 */
export function assembleProbeShape(gateway, services, checkedAt = new Date().toISOString()) {
  const src = services && typeof services === 'object' ? services : {};
  const assembledServices = {};
  for (const key of PROBE_SERVICE_KEYS) {
    assembledServices[key] = src[key];
  }
  return {
    checkedAt,
    gateway,
    services: assembledServices
  };
}
