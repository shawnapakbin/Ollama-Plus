export function createGateway(options = {}) {
  const routes = new Map();
  const sanitizeError = typeof options.sanitizeError === 'function'
    ? options.sanitizeError
    : (err) => (err && typeof err.message === 'string' ? err.message : String(err || 'Operation failed.'));

  // Logger is injectable so tests can spy on it; defaults to the module's
  // existing console-based logging path (matching repo convention).
  const logger = options.logger && typeof options.logger.warn === 'function'
    ? options.logger
    : console;

  // Track entries already logged so each offending route is only reported once.
  const loggedMalformed = new Set();

  function logMalformedMetadata(key, offending) {
    if (loggedMalformed.has(key)) {
      return;
    }
    loggedMalformed.add(key);
    // Guarded so a logger failure can never break enumeration.
    try {
      logger.warn('[gateway] Malformed tool metadata for route; substituting defaults.', {
        route: key,
        ...offending
      });
    } catch {
      // Intentionally ignore logger failures.
    }
  }

  let statusProvider = async () => ({ ok: true });

  function routeKey(server, action) {
    return `${String(server || '').toLowerCase()}::${String(action || '').toLowerCase()}`;
  }

  function register(server, action, handler, metadata) {
    if (typeof handler !== 'function') {
      throw new Error('Gateway handler must be a function.');
    }
    const meta = metadata && typeof metadata === 'object' ? metadata : {};
    const description = typeof meta.description === 'string' ? meta.description : '';
    const parameters = meta.parameters
      && typeof meta.parameters === 'object'
      && !Array.isArray(meta.parameters)
      ? meta.parameters
      : { type: 'object', properties: {} };
    const key = routeKey(server, action);
    routes.set(key, { handler, description, parameters });
  }

  function setStatusProvider(provider) {
    if (typeof provider !== 'function') {
      throw new Error('Status provider must be a function.');
    }
    statusProvider = provider;
  }

  async function dispatch(request = {}) {
    const server = String(request.server || '').toLowerCase();
    const action = String(request.action || '').toLowerCase();
    const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};

    if (!server || !action) {
      throw new Error('Gateway request must include server and action.');
    }

    const key = routeKey(server, action);
    const entry = routes.get(key);
    const handler = entry && entry.handler;
    if (!entry || typeof entry.handler !== 'function') {
      throw new Error(`Unknown MCP route: ${server}/${action}`);
    }

    return handler(payload, { server, action, request });
  }

  async function dispatchSafe(request = {}) {
    try {
      return {
        ok: true,
        data: await dispatch(request)
      };
    } catch (err) {
      return {
        ok: false,
        error: sanitizeError(err)
      };
    }
  }

  async function statusSafe() {
    try {
      return {
        ok: true,
        data: await statusProvider()
      };
    } catch (err) {
      return {
        ok: false,
        error: sanitizeError(err)
      };
    }
  }

  function listTools() {
    const tools = [];
    for (const [key, entry] of routes) {
      const separatorIndex = key.indexOf('::');
      const server = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
      const action = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : '';
      const name = `${server}_${action}`;

      const descriptionValid = entry && typeof entry.description === 'string';
      const parametersValid = entry
        && entry.parameters
        && typeof entry.parameters === 'object'
        && !Array.isArray(entry.parameters);

      const description = descriptionValid ? entry.description : '';
      const parameters = parametersValid
        ? entry.parameters
        : { type: 'object', properties: {} };

      // If defaults were substituted for malformed stored metadata, log the
      // offending entry once for debugging (guarded so it cannot break us).
      if (entry && (!descriptionValid || !parametersValid)) {
        const offending = {};
        if (!descriptionValid) {
          offending.description = entry.description;
        }
        if (!parametersValid) {
          offending.parameters = entry.parameters;
        }
        logMalformedMetadata(key, offending);
      }

      tools.push({ name, description, parameters });
    }
    return tools;
  }

  return {
    register,
    setStatusProvider,
    dispatch,
    dispatchSafe,
    statusSafe,
    listTools
  };
}
