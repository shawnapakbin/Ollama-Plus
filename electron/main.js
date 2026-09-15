/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 */
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntimeService } from './runtime/runtimeService.js';
import { createOllamaLifecycle } from './runtime/ollamaLifecycle.js';
import { initAgentRuntime } from './runtime/agent/agentRuntime.js';
import { registerAgentChatHandlers } from './runtime/agent/agentChatHandlers.js';
import { initAutoUpdater } from './updater.js';
import { createGateway } from '../mcp/lib/gateway.mjs';
import { registerGatewayRoutes } from '../mcp/lib/registerGatewayRoutes.mjs';
import { checkBlenderPlateHealth, buildBlenderPlate } from '../mcp/lib/blenderPlate.mjs';
import { checkOpenScadHealth, compileOpenScad } from '../mcp/lib/openscad.mjs';
import {
  checkDockerAvailable,
  listSandboxRuns,
  readRunArtifact,
  runSandboxedPython
} from '../mcp/lib/pythonSandbox.mjs';
import {
  createTextFile,
  deletePath,
  listDirectory,
  readTextFile,
  renamePath,
  writeTextFile
} from '../mcp/lib/folderOps.mjs';
import {
  activateBrowserPage,
  closeAllBrowserSessions,
  closeBrowserPage,
  closeBrowserSession,
  createBrowserPage,
  createBrowserSession,
  executeBrowserSessionAction,
  getBrowserRuntimeStatus,
  listBrowserPages,
  listBrowserSessions,
  sweepIdleBrowserSessions
} from '../mcp/lib/playwrightSessions.mjs';
import { getFileRoot, getSandboxRoot, getTerminalRoot, resolveInsideRoot } from '../mcp/lib/security.mjs';
import { assembleProbeShape, clampNote, composePythonAvailability } from '../mcp/lib/probeHelpers.mjs';
import {
  closeTerminalSession,
  createTerminalSession,
  executeTerminalCommand,
  listTerminalSessions,
  readTerminalOutput,
  writeTerminalInput
} from '../mcp/lib/terminalSessions.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const runtimeService = createRuntimeService({
  statePath: path.join(app.getPath('userData'), 'lang-runtime', 'state.json'),
  appVersion: app.getVersion(),
  mode: isDev ? 'development' : 'production',
  workspaceRoot: process.cwd(),
  versions: process.versions,
  langsmithConfigured: Boolean(process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY)
});
const mcpGateway = createGateway();

// Lifecycle_Service (ollama-lifecycle-management). Constructed once at startup
// with production defaults (real fetch, child_process.spawn, process.platform).
// It probes reachability and starts a local `ollama serve` process; the IPC
// handlers below delegate to it, defaulting the endpoint to the current
// chatConfig.endpoint when the renderer passes none. Requirements: 1.5, 4.1.
const ollamaLifecycle = createOllamaLifecycle();

/** @type {ReturnType<typeof initAgentRuntime>|null} */
let agentRuntime = null;

/** @type {ReturnType<typeof registerAgentChatHandlers>|null} */
let agentChatHandlers = null;

function checkRootPath(rootPath) {
  try {
    const resolved = path.resolve(rootPath);
    const exists = fs.existsSync(resolved);
    const stats = exists ? fs.statSync(resolved) : null;
    return {
      ok: exists && Boolean(stats?.isDirectory()),
      root: resolved,
      note: exists ? 'Directory available.' : 'Directory does not exist.'
    };
  } catch (error) {
    return {
      ok: false,
      root: String(rootPath || ''),
      note: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkDockerHealth() {
  const now = Date.now();

  const cache = checkDockerHealth.cache;

  if (cache && now - cache.checkedAt < 60_000) {

    return cache.result;

  }



  const probe = spawnSync('docker', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,

    timeout: 1_500

  });

  const result = (!probe.error && probe.status === 0)

    ? {

        ok: true,

        note: String(probe.stdout || probe.stderr || 'Docker available').trim()

      }

    : {

        ok: false,

        note: probe.error

          ? (probe.error.message || 'Docker CLI unavailable.')

          : String(probe.stderr || probe.stdout || 'Docker CLI unavailable.').trim()

      };



  checkDockerHealth.cache = { checkedAt: now, result };

  return result;

}

/**
 * Probe the health of every MCP service and the gateway.
 *
 * Responsiveness budget: this probe targets completion within ~5 seconds. Each
 * underlying check is individually bounded so the aggregate stays within budget:
 * the OpenSCAD/Blender `--version` probes are bounded (1.5 s per spawnSync), and
 * the Docker check is cached (60 s) and bounded (1.5 s spawnSync). Because these
 * checks are synchronous and individually bounded, availability is derived from
 * the actual check results, never from whether the probe as a whole exceeded the
 * 5-second budget. In particular, `python.ok` reflects real availability
 * (`pythonRoot.ok && docker.ok`) regardless of response time, so a slow probe can
 * never report Python unavailable when Docker and the sandbox root are reachable.
 *
 * Returns a fixed seven-entry shape: one gateway entry plus one each for
 * browser, terminal, folder, python, openscad, and blender_plate. Every note
 * (gateway plus each string service note) is clamped non-empty and to <= 200
 * characters via {@link clampNote}.
 */
function probeMcpServices() {
  const browserRuntime = getBrowserRuntimeStatus();
  const openScad = checkOpenScadHealth();
  const blenderPlate = checkBlenderPlateHealth();
  const terminalRoot = checkRootPath(getTerminalRoot());
  const folderRoot = checkRootPath(getFileRoot());
  const pythonRoot = checkRootPath(getSandboxRoot());
  const docker = checkDockerHealth();

  return assembleProbeShape(
    {
      ok: true,
      note: clampNote('MCP gateway ready.', 'MCP gateway ready.')
    },
    {
      browser: {
        ok: true,
        activeSessionCount: browserRuntime.activeSessionCount,
        sessions: browserRuntime.sessions
      },
      terminal: {
        ...terminalRoot,
        note: clampNote(
          terminalRoot.note,
          terminalRoot.ok ? 'Terminal root available.' : 'Terminal root unavailable.'
        )
      },
      folder: {
        ...folderRoot,
        note: clampNote(
          folderRoot.note,
          folderRoot.ok ? 'Folder root available.' : 'Folder root unavailable.'
        )
      },
      // Actual availability: Docker available AND sandbox root reachable,
      // independent of overall probe response time.
      python: composePythonAvailability(pythonRoot, docker),
      openscad: {
        ok: openScad.ok,
        executable: openScad.executable,
        note: clampNote(
          openScad.ok ? openScad.version : (openScad.note || 'OpenSCAD unavailable.'),
          openScad.ok ? 'OpenSCAD available.' : 'OpenSCAD unavailable.'
        )
      },
      blender_plate: {
        ok: blenderPlate.ok,
        executable: blenderPlate.executable,
        note: clampNote(
          blenderPlate.ok ? blenderPlate.version : (blenderPlate.note || 'Blender unavailable.'),
          blenderPlate.ok ? 'Blender available.' : 'Blender unavailable.'
        )
      }
    }
  );
}

registerGatewayRoutes(mcpGateway, {
  // Browser (playwrightSessions.mjs)
  createBrowserSession,
  listBrowserSessions,
  closeBrowserSession,
  createBrowserPage,
  listBrowserPages,
  activateBrowserPage,
  closeBrowserPage,
  executeBrowserSessionAction,
  // Terminal (terminalSessions.mjs)
  createTerminalSession,
  listTerminalSessions,
  readTerminalOutput,
  writeTerminalInput,
  executeTerminalCommand,
  closeTerminalSession,
  // Folder (folderOps.mjs)
  listDirectory,
  readTextFile,
  writeTextFile,
  createTextFile,
  deletePath,
  renamePath,
  // Python sandbox (pythonSandbox.mjs)
  checkDockerAvailable,
  runSandboxedPython,
  listSandboxRuns,
  readRunArtifact,
  // OpenSCAD (openscad.mjs)
  checkOpenScadHealth,
  compileOpenScad,
  // Blender Plate (blenderPlate.mjs)
  checkBlenderPlateHealth,
  buildBlenderPlate,
  // Path confinement (security.mjs + node:path)
  getFileRoot,
  resolveInsideRoot,
  relativePath: (from, to) => path.relative(from, to)
});

mcpGateway.setStatusProvider(async () => probeMcpServices());

let browserSweepTimer = null;

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0d1216',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return mainWindow;
  }

  await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return mainWindow;
}

ipcMain.handle('lang-runtime:get-status', async () => runtimeService.getStatus());
ipcMain.handle('lang-runtime:get-bootstrap-plan', async () => runtimeService.getBootstrapPlan());
ipcMain.handle('lang-runtime:get-graph-catalog', async () => runtimeService.getGraphCatalog());
ipcMain.handle('lang-runtime:list-sessions', async () => runtimeService.listSessions());
ipcMain.handle('lang-runtime:create-session', async (_event, title) => runtimeService.createSession(title));
ipcMain.handle('lang-runtime:rename-session', async (_event, sessionId, title) => runtimeService.renameSession(sessionId, title));
ipcMain.handle('lang-runtime:rename-session-ai', async (_event, sessionId, input) => runtimeService.renameSessionWithAi(sessionId, input));
ipcMain.handle('lang-runtime:delete-session', async (_event, sessionId) => runtimeService.deleteSession(sessionId));
ipcMain.handle('lang-runtime:get-chat-config', async () => runtimeService.getChatConfig());
ipcMain.handle('lang-runtime:save-chat-config', async (_event, input) => runtimeService.saveChatConfig(input));
ipcMain.handle('lang-runtime:list-ollama-models', async (_event, endpoint) => runtimeService.listOllamaModels(endpoint));
ipcMain.handle('lang-runtime:list-ollama-servers', async () => runtimeService.listOllamaServers());
ipcMain.handle('lang-runtime:save-ollama-server', async (_event, input) => runtimeService.saveOllamaServer(input));
ipcMain.handle('lang-runtime:remove-ollama-server', async (_event, serverId) => runtimeService.removeOllamaServer(serverId));
ipcMain.handle('lang-runtime:check-ollama-server', async (_event, serverId) => runtimeService.checkOllamaServer(serverId));
ipcMain.handle('lang-runtime:list-messages', async (_event, sessionId) => runtimeService.listMessages(sessionId));
ipcMain.handle('lang-runtime:update-message', async (_event, messageId, input) => runtimeService.updateMessage(messageId, input));
ipcMain.handle('lang-runtime:delete-message', async (_event, messageId) => runtimeService.deleteMessage(messageId));
ipcMain.handle('lang-runtime:send-chat-message', async (_event, input) => runtimeService.sendChatMessage(input));
ipcMain.handle('lang-runtime:send-chat-message-stream', async (event, input) => runtimeService.sendChatMessageStream(input, (payload) => {
  event.sender.send('lang-runtime:chat-stream', payload);
}));
ipcMain.handle('lang-runtime:list-runs', async (_event, sessionId) => runtimeService.listRuns(sessionId));
ipcMain.handle('lang-runtime:list-memory-records', async (_event, sessionId) => runtimeService.listMemoryRecords(sessionId));
ipcMain.handle('lang-runtime:start-run', async (_event, graphId, sessionId) => runtimeService.startRun(graphId, sessionId));
ipcMain.handle('lang-runtime:execute-run', async (_event, runId) => runtimeService.executeRun(runId));
ipcMain.handle('lang-runtime:resume-run', async (_event, runId) => runtimeService.resumeRun(runId));
ipcMain.handle('lang-runtime:step-run', async (_event, runId) => runtimeService.stepRun(runId));
ipcMain.handle('lang-runtime:cancel-run', async (_event, runId) => runtimeService.cancelRun(runId));
ipcMain.handle('lang-runtime:approve-run', async (_event, runId, decision) => runtimeService.approveRun(runId, decision));
ipcMain.handle('lang-runtime:deny-run', async (_event, runId, decision) => runtimeService.denyRun(runId, decision));
ipcMain.handle('gpu:list-detected', async () => runtimeService.getDetectedGpus());
ipcMain.handle('gpu:get-selection-state', async () => runtimeService.getGpuSelectionState());
ipcMain.handle('gpu:save-selection', async (_event, input) => runtimeService.saveGpuSelection(input));
ipcMain.handle('mcp-gateway-call', async (_event, request) => mcpGateway.dispatchSafe(request));
ipcMain.handle('mcp-gateway-status', async () => mcpGateway.statusSafe());
// Ollama lifecycle (ollama-lifecycle-management). Probe reachability / start a
// local server, defaulting to the current chatConfig.endpoint when the renderer
// passes no endpoint. Requirements: 1.5, 4.1.
ipcMain.handle('ollama-lifecycle:probe', async (_event, endpoint) => {
  const targetEndpoint = endpoint ?? runtimeService.getChatConfig()?.endpoint;
  return ollamaLifecycle.probeReachability({ endpoint: targetEndpoint });
});
ipcMain.handle('ollama-lifecycle:start', async (_event, endpoint) => {
  const targetEndpoint = endpoint ?? runtimeService.getChatConfig()?.endpoint;
  return ollamaLifecycle.startLocalServer({ endpoint: targetEndpoint });
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const mainWindow = await createMainWindow();

  // Initialize the autonomous agent runtime alongside existing runtime service.
  // The agent runtime registers its own IPC handlers for task submission, execution,
  // approval gates, configuration, and session history.
  // Requirements: 7.7 (working directory authorization), 10.4 (Ollama connectivity), 11.6 (project detection)
  agentRuntime = initAgentRuntime(ipcMain, mainWindow, {
    statePath: path.join(app.getPath('userData'), 'lang-runtime', 'state.json'),
    mcpGateway,
    fetchImpl: globalThis.fetch,
    defaultEndpoint: runtimeService.getChatConfig()?.endpoint || 'http://localhost:11434'
  });

  // Initialize the agent chat handlers (agent-page-redesign).
  // Registers IPC handlers for the conversational chat interface that adapts
  // Agent Runtime events into AgentChatStreamEvent format.
  agentChatHandlers = registerAgentChatHandlers(ipcMain, mainWindow, {
    statePath: path.join(app.getPath('userData'), 'lang-runtime', 'state.json'),
    mcpGateway,
    fetchImpl: globalThis.fetch,
    defaultEndpoint: runtimeService.getChatConfig()?.endpoint || 'http://localhost:11434'
  });

  if (!isDev) {
    initAutoUpdater(mainWindow);
  }

  browserSweepTimer = setInterval(() => {
    void sweepIdleBrowserSessions();
  }, 60_000);
  browserSweepTimer.unref();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('before-quit', async () => {
  if (browserSweepTimer) {
    clearInterval(browserSweepTimer);
    browserSweepTimer = null;
  }
  if (agentRuntime) {
    await agentRuntime.shutdown();
  }
  await closeAllBrowserSessions();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
