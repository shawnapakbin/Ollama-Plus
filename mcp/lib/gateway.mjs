export function createGateway(options = {}) {
  const routes = new Map();
  const sanitizeError = typeof options.sanitizeError === 'function'
    ? options.sanitizeError
    : (err) => (err && typeof err.message === 'string' ? err.message : String(err || 'Operation failed.'));

  let statusProvider = async () => ({ ok: true });

  function routeKey(server, action) {
    return `${String(server || '').toLowerCase()}::${String(action || '').toLowerCase()}`;
  }

  function register(server, action, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Gateway handler must be a function.');
    }
    const key = routeKey(server, action);
    routes.set(key, handler);
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
    const handler = routes.get(key);
    if (!handler) {
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

  return {
    register,
    setStatusProvider,
    dispatch,
    dispatchSafe,
    statusSafe
  };
}
