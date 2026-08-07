import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeService } from './runtime/runtimeService.js';

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

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
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
ipcMain.handle('lang-runtime:get-chat-config', async () => runtimeService.getChatConfig());
ipcMain.handle('lang-runtime:save-chat-config', async (_event, input) => runtimeService.saveChatConfig(input));
ipcMain.handle('lang-runtime:list-ollama-models', async (_event, endpoint) => runtimeService.listOllamaModels(endpoint));
ipcMain.handle('lang-runtime:list-messages', async (_event, sessionId) => runtimeService.listMessages(sessionId));
ipcMain.handle('lang-runtime:send-chat-message', async (_event, input) => runtimeService.sendChatMessage(input));
ipcMain.handle('lang-runtime:send-chat-message-stream', async (event, input) => runtimeService.sendChatMessageStream(input, (payload) => {
  event.sender.send('lang-runtime:chat-stream', payload);
}));
ipcMain.handle('lang-runtime:list-runs', async (_event, sessionId) => runtimeService.listRuns(sessionId));
ipcMain.handle('lang-runtime:start-run', async (_event, graphId, sessionId) => runtimeService.startRun(graphId, sessionId));
ipcMain.handle('lang-runtime:execute-run', async (_event, runId) => runtimeService.executeRun(runId));
ipcMain.handle('lang-runtime:resume-run', async (_event, runId) => runtimeService.resumeRun(runId));
ipcMain.handle('lang-runtime:step-run', async (_event, runId) => runtimeService.stepRun(runId));
ipcMain.handle('lang-runtime:cancel-run', async (_event, runId) => runtimeService.cancelRun(runId));
ipcMain.handle('lang-runtime:approve-run', async (_event, runId, decision) => runtimeService.approveRun(runId, decision));
ipcMain.handle('lang-runtime:deny-run', async (_event, runId, decision) => runtimeService.denyRun(runId, decision));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});