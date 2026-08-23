import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntimeService } from './runtime/runtimeService.js';
import { initAutoUpdater } from './updater.js';
import { createGateway } from '../mcp/lib/gateway.mjs';
import { checkBlenderPlateHealth } from '../mcp/lib/blenderPlate.mjs';
import { checkOpenScadHealth } from '../mcp/lib/openscad.mjs';
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
import { getFileRoot, getSandboxRoot, getTerminalRoot } from '../mcp/lib/security.mjs';

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

function probeMcpServices() {
  const browserRuntime = getBrowserRuntimeStatus();
  const openScad = checkOpenScadHealth();
  const blenderPlate = checkBlenderPlateHealth();
  const terminalRoot = checkRootPath(getTerminalRoot());
  const folderRoot = checkRootPath(getFileRoot());
  const pythonRoot = checkRootPath(getSandboxRoot());
  const docker = checkDockerHealth();

  return {
    checkedAt: new Date().toISOString(),
    gateway: {
      ok: true,
      note: 'MCP gateway ready.'
    },
    services: {
      browser: {
        ok: true,
        activeSessionCount: browserRuntime.activeSessionCount,
        sessions: browserRuntime.sessions
      },
      terminal: terminalRoot,
      folder: folderRoot,
      python: {
        ok: pythonRoot.ok && docker.ok,
        root: pythonRoot.root,
        docker: docker.note,
        note: pythonRoot.ok ? (docker.ok ? 'Python sandbox ready.' : 'Sandbox root ready but Docker unavailable.') : pythonRoot.note
      },
      openscad: {
        ok: openScad.ok,
        executable: openScad.executable,
        note: openScad.ok ? openScad.version : (openScad.note || 'OpenSCAD unavailable.')
      },
      blender_plate: {
        ok: blenderPlate.ok,
        executable: blenderPlate.executable,
        note: blenderPlate.ok ? blenderPlate.version : (blenderPlate.note || 'Blender unavailable.')
      }
    }
  };
}

mcpGateway.register('browser', 'create_session', async (payload) => createBrowserSession(payload));
mcpGateway.register('browser', 'list_sessions', async () => listBrowserSessions());
mcpGateway.register('browser', 'close_session', async (payload) => closeBrowserSession(String(payload.sessionId || '')));
mcpGateway.register('browser', 'create_page', async (payload) => createBrowserPage(String(payload.sessionId || ''), payload));
mcpGateway.register('browser', 'list_pages', async (payload) => listBrowserPages(String(payload.sessionId || '')));
mcpGateway.register('browser', 'activate_page', async (payload) => activateBrowserPage(String(payload.sessionId || ''), String(payload.pageId || '')));
mcpGateway.register('browser', 'close_page', async (payload) => closeBrowserPage(String(payload.sessionId || ''), String(payload.pageId || '')));
mcpGateway.register('browser', 'action', async (payload) => executeBrowserSessionAction(String(payload.sessionId || ''), payload));

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
ipcMain.handle('mcp-gateway-call', async (_event, request) => mcpGateway.dispatchSafe(request));
ipcMain.handle('mcp-gateway-status', async () => mcpGateway.statusSafe());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const mainWindow = await createMainWindow();

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
  await closeAllBrowserSessions();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});