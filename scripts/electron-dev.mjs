import net from 'node:net';
import process from 'node:process';
import { spawn } from 'node:child_process';

const BASE_PORT = 5173;
const MAX_PORT_TRIES = 30;
const PORT_WAIT_TIMEOUT_MS = 30_000;

function isPortReachable(port) {
  const hosts = ['127.0.0.1', '::1', 'localhost'];
  return new Promise((resolve) => {
    let settled = false;
    let pending = hosts.length;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    for (const host of hosts) {
      const socket = net.createConnection({ port, host });
      socket.setTimeout(350);
      socket.on('connect', () => {
        socket.end();
        finish(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        pending -= 1;
        if (pending === 0) finish(false);
      });
      socket.on('error', () => {
        socket.destroy();
        pending -= 1;
        if (pending === 0) finish(false);
      });
      socket.on('close', () => {
        if (settled) return;
      });
    }
  });
}

async function checkPortAvailable(port) {
  if (await isPortReachable(port)) return false;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(start, maxTries) {
  for (let i = 0; i < maxTries; i += 1) {
    const port = start + i;
    if (await checkPortAvailable(port)) return port;
  }
  throw new Error(`Unable to find an available dev port starting at ${start}.`);
}

function waitForPort(port, timeoutMs) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      try {
        const res = await fetch(`http://localhost:${port}`, {
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok || res.status === 404) {
          resolve();
          return;
        }
      } catch {
        clearTimeout(timer);
      }

      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Timed out waiting for Vite dev server on port ${port}.`));
        return;
      }
      setTimeout(() => {
        void attempt();
      }, 250);
    };

    void attempt();
  });
}

function spawnVite(port) {
  return spawn(`npm run dev -- --port ${port} --strictPort`, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      BROWSER: 'none'
    }
  });
}

function spawnElectron(devUrl) {
  const remoteDebugPort = String(process.env.ELECTRON_REMOTE_DEBUGGING_PORT || '').trim();
  const remoteDebugArg = remoteDebugPort ? ` --remote-debugging-port=${remoteDebugPort}` : '';
  return spawn(`npm exec -- electron .${remoteDebugArg}`, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl
    }
  });
}

async function main() {
  const port = await findAvailablePort(BASE_PORT, MAX_PORT_TRIES);
  const devUrl = `http://localhost:${port}`;
  console.log(`[electron:dev] Starting Vite on ${devUrl}`);

  const vite = spawnVite(port);
  let electron = null;
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (electron && !electron.killed) {
      electron.kill();
    }
    if (!vite.killed) {
      vite.kill();
    }
    setTimeout(() => process.exit(code), 10);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  vite.on('exit', (code) => {
    if (shuttingDown) return;
    if (code !== 0) {
      console.error(`[electron:dev] Vite exited with code ${code}.`);
      shutdown(code ?? 1);
      return;
    }
    shutdown(0);
  });

  try {
    await waitForPort(port, PORT_WAIT_TIMEOUT_MS);
    console.log(`[electron:dev] Launching Electron against ${devUrl}`);
    electron = spawnElectron(devUrl);

    electron.on('exit', (code) => {
      shutdown(code ?? 0);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[electron:dev] ${message}`);
    shutdown(1);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[electron:dev] ${message}`);
  process.exit(1);
});
