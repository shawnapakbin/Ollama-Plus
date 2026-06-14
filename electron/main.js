import { app, BrowserWindow, dialog, ipcMain, Menu, shell as electronShell, clipboard } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { chromium } from 'playwright-core';
import { parse as parseCSV } from 'csv-parse/sync';
import { createRequire } from 'module';
import { create, all } from 'mathjs';
import {
  closeAllSessions as closeMcpTerminalSessions,
  closeTerminalSession as closeMcpTerminalSession,
  createTerminalSession as createMcpTerminalSession,
  executeTerminalCommand as executeMcpTerminalCommand,
  listTerminalSessions as listMcpTerminalSessions,
  readTerminalOutput as readMcpTerminalOutput,
  sweepIdleTerminalSessions as sweepMcpTerminalSessions,
  writeTerminalInput as writeMcpTerminalInput
} from '../mcp/lib/terminalSessions.mjs';
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
import { createGateway } from '../mcp/lib/gateway.mjs';
import { checkOpenScadHealth, compileOpenScad } from '../mcp/lib/openscad.mjs';
import { checkBlenderPlateHealth, buildBlenderPlate } from '../mcp/lib/blenderPlate.mjs';
import {
  isSafeHttpUrl,
  isRiskyCommand,
  assertValidSessionId,
  resolveChatFile as resolveChatFileImpl,
  resolveWikiPath as resolveWikiPathImpl
} from './lib/validation.js';
import {
  isValidWikiAutonomyMode,
  isValidWikiKnowledgePolicy,
  normalizeWikiConfig,
  shouldRequireWikiApproval,
  evaluateWikiKnowledgePolicy
} from './lib/wikiPolicy.js';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const mathEngine = create(all, {
  number: 'BigNumber',
  precision: 64
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// Store active terminals and streams
const terminals = {};
const activeStreams = {};
const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 20_000;
const rateWindows = new Map();
const pendingPolicyDecisions = new Map();
const DISCOVERABLE_MODEL_EXTENSIONS = new Set(['.obj', '.stl', '.gltf', '.glb', '.scad']);
const IMPORTABLE_MODEL_EXTENSIONS = new Set(['.obj', '.stl', '.gltf', '.glb']);
let cachedMcpFolderRoot = null;
let cachedMcpWikiConfig = null;
let cachedMcpBlenderBin = null;
let defaultBrowserSessionId = null;
let mcpGateway = null;
const OPENSCAD_FEATURE_ENABLED = process.env.MCP_OPENSCAD_ENABLED !== '0';
const BLENDER_PLATE_FEATURE_ENABLED = process.env.MCP_BLENDER_PLATE_ENABLED !== '0';

process.on('uncaughtException', (err) => {
  console.error('Main process uncaught exception:', sanitizeError(err));
});

process.on('unhandledRejection', (reason) => {
  console.error('Main process unhandled rejection:', sanitizeError(reason));
});

const ALLOWED_BROWSER_ACTIONS = new Set([
  'goto',
  'click',
  'type',
  'press',
  'scroll',
  'wait',
  'screenshot',
  'content',
  'extract-text',
  'evaluate',
  'back',
  'forward',
  'reload',
  'set-headers',
  'get-cookies',
  'set-cookies',
  'reset'
]);

setInterval(() => {
  sweepMcpTerminalSessions();
}, 60_000).unref();
setInterval(() => {
  void sweepIdleBrowserSessions();
}, 60_000).unref();

function sanitizeError(err) {
  const fallback = 'Operation failed.';
  const raw = err && typeof err.message === 'string' ? err.message : String(err || fallback);
  const safe = raw
    .replace(new RegExp(app.getPath('userData').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[userData]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 280);
  return safe || fallback;
}

function assertRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const existing = rateWindows.get(key) || [];
  const fresh = existing.filter((ts) => now - ts < windowMs);
  if (fresh.length >= limit) {
    throw new Error('Rate limit reached. Please wait and retry.');
  }
  fresh.push(now);
  rateWindows.set(key, fresh);
}

function resolveWikiPath(filePath) {
  return resolveWikiPathImpl(getConfiguredWikiRoot().root, filePath);
}

function resolveChatFile(sessionId) {
  return resolveChatFileImpl(app.getPath('userData'), sessionId);
}

function runCommandCapture(command, args = []) {
  return spawnSync(command, args, {
    encoding: 'utf-8',
    windowsHide: true,
    env: process.env
  });
}

function getPythonTerminalConfig() {
  const candidates = [];
  if (typeof process.env.PYTHON === 'string' && process.env.PYTHON.trim()) {
    candidates.push({ shell: process.env.PYTHON.trim(), args: ['-i'], source: 'PYTHON env var' });
  }
  if (process.platform === 'win32') {
    candidates.push(
      { shell: 'python', args: ['-i'], source: 'PATH' },
      { shell: 'py', args: ['-3', '-i'], source: 'Windows py launcher' },
      { shell: 'python3', args: ['-i'], source: 'PATH' }
    );
  } else {
    candidates.push(
      { shell: 'python3', args: ['-i'], source: 'PATH' },
      { shell: 'python', args: ['-i'], source: 'PATH' }
    );
  }

  for (const candidate of candidates) {
    const checkArgs = candidate.shell === 'py' ? ['-3', '--version'] : ['--version'];
    const probe = runCommandCapture(candidate.shell, checkArgs);
    if (probe.error || probe.status !== 0) continue;

    const versionText = String(probe.stdout || probe.stderr || '').trim();
    return {
      ok: true,
      interpreter: `${candidate.shell} ${candidate.args.join(' ')}`,
      shell: candidate.shell,
      args: candidate.args,
      source: candidate.source,
      version: versionText || 'Python available',
      note: candidate.source === 'Windows py launcher'
        ? 'Found Python through the Windows py launcher.'
        : 'Found a local Python interpreter on PATH.'
    };
  }

  const fallback = candidates[0] || { shell: process.platform === 'win32' ? 'python' : 'python3', args: ['-i'], source: 'PATH' };
  let installHint = 'Install Python 3 from python.org or your OS package manager, then reopen the app.';
  if (process.platform === 'win32') {
    const pyCheck = runCommandCapture('py', ['-0p']);
    if (!pyCheck.error && pyCheck.status === 0 && String(pyCheck.stdout || '').trim()) {
      installHint = 'Python is installed, but no default interpreter was resolved. Set the PYTHON env var or repair PATH.';
    }
  }
  return {
    ok: false,
    interpreter: `${fallback.shell} ${fallback.args.join(' ')}`,
    shell: fallback.shell,
    args: fallback.args,
    source: fallback.source,
    version: '',
    note: installHint
  };
}

function getMcpFolderRootStatePath() {
  return path.join(app.getPath('userData'), 'mcp-folder-root.json');
}

function getMcpWikiConfigStatePath() {
  return path.join(app.getPath('userData'), 'mcp-wiki-config.json');
}

function getMcpBlenderConfigStatePath() {
  return path.join(app.getPath('userData'), 'mcp-blender-config.json');
}

function getDefaultWikiRoot() {
  return path.join(app.getPath('documents'), 'WIKI');
}

function loadMcpWikiConfigFromDisk() {
  if (cachedMcpWikiConfig !== null) return cachedMcpWikiConfig;
  try {
    const statePath = getMcpWikiConfigStatePath();
    if (!fs.existsSync(statePath)) {
      cachedMcpWikiConfig = normalizeWikiConfig({});
      return cachedMcpWikiConfig;
    }
    const raw = fs.readFileSync(statePath, 'utf-8');
    cachedMcpWikiConfig = normalizeWikiConfig(JSON.parse(raw));
  } catch {
    cachedMcpWikiConfig = normalizeWikiConfig({});
  }
  return cachedMcpWikiConfig;
}

function persistMcpWikiConfig(partial) {
  const current = loadMcpWikiConfigFromDisk();
  cachedMcpWikiConfig = normalizeWikiConfig({ ...current, ...(partial || {}) });
  const statePath = getMcpWikiConfigStatePath();
  fs.writeFileSync(statePath, JSON.stringify(cachedMcpWikiConfig, null, 2), 'utf-8');
}

function getConfiguredWikiRoot() {
  const cfg = loadMcpWikiConfigFromDisk();
  const fallback = path.resolve(getDefaultWikiRoot());
  const selected = typeof cfg.root === 'string' ? cfg.root.trim() : '';
  const base = selected ? path.resolve(selected) : fallback;
  try {
    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  } catch {
    // fall through to fallback recovery below
  }

  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    if (selected) persistMcpWikiConfig({ root: '' });
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return { root: fallback, isCustom: false };
  }

  return { root: base, isCustom: Boolean(selected) };
}

function resolveWithinWikiRoot(relativePath = '.') {
  const { root } = getConfiguredWikiRoot();
  const target = path.resolve(root, relativePath || '.');
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes selected wiki folder: ${relativePath}`);
  }
  return { root, target, relPath: rel.replace(/\\/g, '/') || '.' };
}

function buildSpellingMenuItems(params) {
  if (!params?.isEditable || params?.spellcheckEnabled === false) return [];

  const suggestions = Array.isArray(params.dictionarySuggestions)
    ? params.dictionarySuggestions.filter((suggestion) => typeof suggestion === 'string' && suggestion.trim().length > 0)
    : [];

  if (!params.misspelledWord || suggestions.length === 0) return [];

  return [
    {
      label: 'Spelling',
      submenu: suggestions.map((suggestion) => ({
        label: suggestion,
        click: () => {
          mainWindow?.webContents.replaceMisspelling(suggestion);
        }
      }))
    }
  ];
}

function listWikiMarkdownFiles(dir, wikiRoot, out, maxEntries = 4000) {
  if (out.length >= maxEntries) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= maxEntries) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listWikiMarkdownFiles(full, wikiRoot, out, maxEntries);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    out.push(path.relative(wikiRoot, full).replace(/\\/g, '/'));
  }
}

function assertWikiMarkdownPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Wiki path is required.');
  }
  if (!relativePath.toLowerCase().endsWith('.md')) {
    throw new Error('Wiki path must target a .md file.');
  }
}

async function enforceWikiPolicy(action, payload, cfg) {
  if (!shouldRequireWikiApproval(action, payload, cfg.autonomyMode)) return null;
  const target = String(payload.path || payload.toPath || 'unknown');
  const decision = await requestUserDecision({
    title: 'Wiki Update Approval',
    markdown: `### Wiki write request\n\nAction: ${action}\nTarget: ${target}\n\nAutonomy mode: ${cfg.autonomyMode}`,
    options: [
      { id: 'deny', label: 'Deny', description: 'Block this wiki change.', recommended: true },
      { id: 'allow', label: 'Allow Once', description: 'Approve this single wiki change.' }
    ],
    defaultOptionId: 'deny'
  });
  return {
    decisionToken: decision.decisionToken,
    selectionId: decision.selectionId
  };
}

function loadMcpFolderRootFromDisk() {
  if (cachedMcpFolderRoot !== null) return cachedMcpFolderRoot;
  try {
    const statePath = getMcpFolderRootStatePath();
    if (!fs.existsSync(statePath)) {
      cachedMcpFolderRoot = '';
      return cachedMcpFolderRoot;
    }
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedMcpFolderRoot = typeof parsed?.root === 'string' ? parsed.root : '';
  } catch {
    cachedMcpFolderRoot = '';
  }
  return cachedMcpFolderRoot;
}

function loadMcpBlenderBinFromDisk() {
  if (cachedMcpBlenderBin !== null) return cachedMcpBlenderBin;
  try {
    const statePath = getMcpBlenderConfigStatePath();
    if (!fs.existsSync(statePath)) {
      cachedMcpBlenderBin = '';
      return cachedMcpBlenderBin;
    }
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedMcpBlenderBin = typeof parsed?.bin === 'string' ? parsed.bin.trim() : '';
  } catch {
    cachedMcpBlenderBin = '';
  }
  return cachedMcpBlenderBin;
}

function persistMcpBlenderBin(bin) {
  cachedMcpBlenderBin = typeof bin === 'string' ? bin.trim() : '';
  const statePath = getMcpBlenderConfigStatePath();
  fs.writeFileSync(statePath, JSON.stringify({ bin: cachedMcpBlenderBin }, null, 2), 'utf-8');
}

function getConfiguredBlenderBin() {
  const saved = loadMcpBlenderBinFromDisk();
  if (saved) {
    const resolved = path.resolve(saved);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return { bin: resolved, isCustom: true, source: 'saved' };
    }
    persistMcpBlenderBin('');
  }

  const envOverride = String(process.env.MCP_BLENDER_BIN || '').trim();
  if (envOverride) {
    return { bin: envOverride, isCustom: true, source: 'env' };
  }

  return { bin: '', isCustom: false, source: 'default' };
}

function applyConfiguredBlenderBin() {
  const configured = getConfiguredBlenderBin();
  if (configured.bin) {
    process.env.MCP_BLENDER_BIN = configured.bin;
  } else {
    delete process.env.MCP_BLENDER_BIN;
  }
  return configured;
}

function persistMcpFolderRoot(root) {
  cachedMcpFolderRoot = root || '';
  const statePath = getMcpFolderRootStatePath();
  fs.writeFileSync(statePath, JSON.stringify({ root: cachedMcpFolderRoot }, null, 2), 'utf-8');
}

function getConfiguredMcpFolderRoot() {
  const selected = loadMcpFolderRootFromDisk();
  const fallback = path.resolve(process.cwd());
  if (!selected) return { root: fallback, isCustom: false };

  const resolved = path.resolve(selected);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    persistMcpFolderRoot('');
    return { root: fallback, isCustom: false };
  }

  return { root: resolved, isCustom: true };
}

function resolveWithinMcpFolder(relativePath = '.') {
  const { root } = getConfiguredMcpFolderRoot();
  const target = path.resolve(root, relativePath || '.');
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes selected MCP folder: ${relativePath}`);
  }
  return { root, target, relPath: rel.replace(/\\/g, '/') || '.' };
}

function walkModelFiles(dir, baseRoot, output, maxEntries = 500) {
  if (output.length >= maxEntries) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= maxEntries) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkModelFiles(full, baseRoot, output, maxEntries);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!DISCOVERABLE_MODEL_EXTENSIONS.has(ext)) continue;
    const stat = fs.statSync(full);
    output.push({
      path: path.relative(baseRoot, full).replace(/\\/g, '/'),
      name: entry.name,
      ext,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
}

function requestRendererDecision(payload) {
  const { title, markdown, options, defaultOptionId = 'deny' } = payload;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ selectionId: defaultOptionId, decisionToken: null });
  }

  const requestId = `decision-${Math.random().toString(36).slice(2, 10)}`;
  const decisionToken = `policy-${requestId}`;
  const safeOptions = Array.isArray(options) && options.length > 0
    ? options
    : [{ id: 'deny', label: 'Deny', description: 'Block this action.' }];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPolicyDecisions.delete(requestId);
      resolve({ selectionId: defaultOptionId, decisionToken });
    }, 120_000);

    pendingPolicyDecisions.set(requestId, {
      resolve,
      timeout,
      allowedIds: new Set(safeOptions.map((opt) => opt.id)),
      defaultOptionId
    });

    mainWindow.webContents.send('policy-decision-request', {
      requestId,
      title,
      markdown,
      options: safeOptions,
      decisionToken,
      createdAt: new Date().toISOString()
    });
  });
}

async function requestUserDecision(payload) {
  return requestRendererDecision(payload);
}

ipcMain.handle('policy-decision-response', async (_event, requestId, selectionId) => {
  if (typeof requestId !== 'string' || typeof selectionId !== 'string') return false;
  const pending = pendingPolicyDecisions.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingPolicyDecisions.delete(requestId);

  const safeSelection = pending.allowedIds.has(selectionId) ? selectionId : pending.defaultOptionId;
  pending.resolve({ selectionId: safeSelection, decisionToken: `policy-${requestId}` });
  return true;
});

async function ensureDefaultBrowserSession() {
  const sessions = listBrowserSessions();
  if (defaultBrowserSessionId && sessions.some((session) => session.sessionId === defaultBrowserSessionId)) {
    return defaultBrowserSessionId;
  }

  const created = await createBrowserSession({ headless: true });
  defaultBrowserSessionId = created.session.sessionId;
  return defaultBrowserSessionId;
}

function browserPolicyActionName(action) {
  if (action === 'evaluate') return 'evaluate';
  if (action === 'goto') return 'goto';
  return '';
}

async function requestBrowserPolicyIfNeeded(action, options = {}) {
  const policyAction = browserPolicyActionName(action);
  if (!policyAction) return null;

  if (policyAction === 'evaluate') {
    const script = String(options.script || '');
    const decision = await requestUserDecision({
      title: 'Browser Script Approval',
      markdown: `### Browser evaluate request\n\nThe model wants to execute script code in the page context.\n\n\`\`\`javascript\n${script.slice(0, 600)}\n\`\`\``,
      options: [
        { id: 'deny', label: 'Deny', description: 'Do not run this script.', recommended: true },
        { id: 'allow', label: 'Allow Once', description: 'Run this script one time.' }
      ],
      defaultOptionId: 'deny'
    });
    if (decision.selectionId !== 'allow') {
      return {
        denied: true,
        policy: {
          decisionToken: decision.decisionToken,
          selectionId: decision.selectionId
        }
      };
    }
    return {
      denied: false,
      policy: {
        decisionToken: decision.decisionToken,
        selectionId: decision.selectionId
      }
    };
  }

  const url = String(options.url || '');
  if (!url) return null;

  const parsed = new URL(url);
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (isLocal) return null;

  const decision = await requestUserDecision({
    title: 'External Navigation Approval',
    markdown: `### External website request\n\nTarget URL:\n\n\`\`\`text\n${url}\n\`\`\`\n\nAllow navigation?`,
    options: [
      { id: 'deny', label: 'Deny', description: 'Block navigation.', recommended: true },
      { id: 'allow', label: 'Allow Once', description: 'Navigate to this URL now.' }
    ],
    defaultOptionId: 'deny'
  });
  if (decision.selectionId !== 'allow') {
    return {
      denied: true,
      policy: {
        decisionToken: decision.decisionToken,
        selectionId: decision.selectionId
      }
    };
  }
  return {
    denied: false,
    policy: {
      decisionToken: decision.decisionToken,
      selectionId: decision.selectionId
    }
  };
}

async function executeBrowserAction(options) {
  try {
    assertRateLimit('browser-action', 80, 60_000);

    const {
      action,
      sessionId,
      pageId,
      url,
      selector,
      text,
      key,
      wait_for,
      script,
      timeoutMs,
      headers,
      cookies,
      fullPage
    } = options || {};

    if (!ALLOWED_BROWSER_ACTIONS.has(action)) {
      throw new Error('Unsupported browser action.');
    }

    if (url && !isSafeHttpUrl(url)) {
      throw new Error('Only http/https URLs are allowed.');
    }

    if (wait_for && wait_for.startsWith('http') && !isSafeHttpUrl(wait_for)) {
      throw new Error('Invalid wait URL.');
    }

    if (selector && selector.length > 300) {
      throw new Error('Selector is too long.');
    }

    if (typeof script === 'string' && script.length > 2000) {
      throw new Error('Evaluate script is too long.');
    }

    if (action === 'reset') {
      if (sessionId) {
        await closeBrowserSession(String(sessionId));
      } else {
        const ids = listBrowserSessions().map((item) => item.sessionId);
        for (const id of ids) {
          await closeBrowserSession(id);
        }
        defaultBrowserSessionId = null;
      }
      return {
        result: 'Browser session reset (cookies, storage, and cache cleared).',
        url: 'about:blank',
        title: '',
        sessionId: sessionId || defaultBrowserSessionId,
        policy: null
      };
    }

    const policyMeta = await requestBrowserPolicyIfNeeded(action, { url, script });
    if (policyMeta?.denied) {
      return { error: 'Action denied by user.', policy: policyMeta.policy };
    }

    const activeSessionId = sessionId ? String(sessionId) : await ensureDefaultBrowserSession();
    const result = await executeBrowserSessionAction(activeSessionId, {
      action,
      pageId,
      url,
      selector,
      text,
      key,
      wait_for,
      script,
      timeoutMs,
      headers,
      cookies,
      fullPage
    });

    return {
      ...result,
      sessionId: activeSessionId,
      url: result.page?.url || '',
      title: result.page?.title || '',
      policy: policyMeta?.policy || null
    };
  } catch (err) {
    console.error('Browser Action Error:', err);
    return { error: sanitizeError(err), url: '' };
  }
}

function createWindow() {
  console.log('Creating main window');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      sandbox: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#141619',
      symbolColor: '#f1f3f4',
      height: 40
    }
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

  if (isDev) {
    const devServerUrl = String(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    mainWindow.loadURL(devServerUrl);
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    console.log('Main window close requested');
    if (process.env.DEBUG_KEEP_WINDOW_OPEN === '1') {
      console.log('Preventing close because DEBUG_KEEP_WINDOW_OPEN=1');
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    console.log('Main window closed');
    mainWindow = null;
  });

  mainWindow.on('show', () => {
    console.log('Main window shown');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Main window finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Main window failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason, details.exitCode);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('Main window became unresponsive');
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length > 0);
    const isEditable = Boolean(params.isEditable);
    const hasLink = Boolean(params.linkURL);

    const template = [];

    if (isEditable) {
      template.push(
        { label: 'Undo', role: 'undo', enabled: Boolean(params.editFlags?.canUndo) },
        { label: 'Redo', role: 'redo', enabled: Boolean(params.editFlags?.canRedo) },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: Boolean(params.editFlags?.canCut) },
        { label: 'Copy', role: 'copy', enabled: Boolean(params.editFlags?.canCopy) },
        { label: 'Paste', role: 'paste', enabled: Boolean(params.editFlags?.canPaste) },
        { label: 'Select All', role: 'selectAll' }
      );

      const spellingItems = buildSpellingMenuItems(params);
      if (spellingItems.length > 0) {
        template.push({ type: 'separator' }, ...spellingItems);
      }
    } else if (hasSelection) {
      template.push({ label: 'Copy', role: 'copy' });
      template.push({ type: 'separator' });
      template.push({ label: 'Select All', role: 'selectAll' });
    }

    if (hasLink) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push(
        {
          label: 'Open Link',
          click: () => {
            if (isSafeHttpUrl(params.linkURL)) {
              void electronShell.openExternal(params.linkURL);
            }
          }
        },
        {
          label: 'Copy Link Address',
          click: () => clipboard.writeText(params.linkURL)
        }
      );
    }

    if (template.length === 0) {
      template.push({ label: 'Reload', role: 'reload' });
    }

    if (isDev) {
      template.push({ type: 'separator' });
      template.push({ label: 'Inspect Element', role: 'inspect' });
    }

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  try {
    for (const id of Object.keys(terminals)) {
      try { terminals[id]?.proc?.kill(); } catch { /* ignore */ }
    }
    closeMcpTerminalSessions();
    await closeAllBrowserSessions();
  } catch (err) {
    console.error('Cleanup error on quit:', sanitizeError(err));
  }
});

function buildOllamaUrl(hostUrl, endpoint) {
  if (typeof hostUrl !== 'string' || !isSafeHttpUrl(hostUrl)) {
    throw new Error('Invalid Ollama host URL.');
  }
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
    throw new Error('Invalid Ollama endpoint.');
  }
  const base = hostUrl.replace(/\/$/, '');
  const url = `${base}${endpoint}`;
  if (!isSafeHttpUrl(url)) {
    throw new Error('Invalid Ollama URL.');
  }
  return url;
}

function parseFetchCause(err) {
  const cause = err && typeof err === 'object' ? err.cause : null;
  if (!cause || typeof cause !== 'object') return { code: '', address: '', port: '' };
  return {
    code: typeof cause.code === 'string' ? cause.code : '',
    address: typeof cause.address === 'string' ? cause.address : '',
    port: typeof cause.port === 'number' ? String(cause.port) : ''
  };
}

function formatOllamaFetchError(err, hostUrl) {
  const safe = sanitizeError(err);
  if (/^HTTP\s\d+/i.test(safe)) return safe;

  const { code, address, port } = parseFetchCause(err);
  const target = address ? `${address}${port ? `:${port}` : ''}` : '';

  if (code === 'ECONNREFUSED') {
    return `Cannot connect to Ollama at ${hostUrl}${target ? ` (${target})` : ''}. Start Ollama or update the host URL.`;
  }
  if (code === 'ETIMEDOUT') {
    return `Connection to Ollama timed out at ${hostUrl}${target ? ` (${target})` : ''}. Verify Ollama is running and reachable.`;
  }
  if (code === 'ENOTFOUND') {
    return `Cannot resolve Ollama host ${hostUrl}. Check the host URL.`;
  }
  if (safe.toLowerCase().includes('fetch failed')) {
    return `Cannot reach Ollama at ${hostUrl}. Start Ollama and verify the host URL (for local Windows setups, try http://127.0.0.1:11434).`;
  }
  return safe;
}

async function fetchOllama(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase() !== 'localhost') throw err;
      parsed.hostname = '127.0.0.1';
      return await fetch(parsed.toString(), init);
    } catch {
      throw err;
    }
  }
}

async function buildHttpError(response) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  const snippet = body.replace(/[\r\n]+/g, ' ').trim().slice(0, 220);
  return snippet
    ? `HTTP ${response.status} ${response.statusText}: ${snippet}`
    : `HTTP ${response.status} ${response.statusText}`;
}

// Ollama API Proxy (Bypasses CORS)
ipcMain.handle('ollama-request', async (event, hostUrl, endpoint, data, timeoutMs) => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const requestedTimeout = Number(timeoutMs);
  const effectiveTimeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(Math.max(Math.trunc(requestedTimeout), 1000), 120_000)
    : DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, effectiveTimeoutMs);
  timeoutHandle.unref?.();

  console.log(`[ollama-request] start endpoint=${String(endpoint || '')} timeoutMs=${effectiveTimeoutMs}`);
  try {
    const url = buildOllamaUrl(hostUrl, endpoint);
    const response = await fetchOllama(url, {
      method: data ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal
    });

    if (!response.ok) throw new Error(await buildHttpError(response));
    const json = await response.json();
    const elapsedMs = Date.now() - startedAt;
    console.log(`[ollama-request] ok endpoint=${String(endpoint || '')} elapsedMs=${elapsedMs}`);
    return json;
  } catch (err) {
    if (err && typeof err === 'object' && err.name === 'AbortError') {
      const elapsedMs = Date.now() - startedAt;
      console.warn(`[ollama-request] timeout endpoint=${String(endpoint || '')} elapsedMs=${elapsedMs}`);
      throw new Error(`Ollama request timed out after ${effectiveTimeoutMs}ms.`);
    }
    console.error('Ollama Error:', sanitizeError(err));
    throw new Error(formatOllamaFetchError(err, hostUrl));
  } finally {
    clearTimeout(timeoutHandle);
  }
});

ipcMain.on('ollama-stream', async (event, streamId, hostUrl, endpoint, data) => {
  const controller = new AbortController();
  activeStreams[streamId] = controller;

  try {
    const url = buildOllamaUrl(hostUrl, endpoint);
    const response = await fetchOllama(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(await buildHttpError(response));
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      event.sender.send(`ollama-data-${streamId}`, decoder.decode(value, { stream: true }));
    }
    event.sender.send(`ollama-end-${streamId}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`Stream ${streamId} aborted`);
      event.sender.send(`ollama-end-${streamId}`);
    } else {
      event.sender.send(`ollama-error-${streamId}`, formatOllamaFetchError(err, hostUrl));
    }
  } finally {
    delete activeStreams[streamId];
  }
});

ipcMain.on('abort-stream', (event, streamId) => {
  const controller = activeStreams[streamId];
  if (controller) {
    controller.abort();
    delete activeStreams[streamId];
  }
});

function isPrivateIPv4(ip) {
  if (typeof ip !== 'string') return false;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return false;
}

function collectScanTargets() {
  const interfaces = os.networkInterfaces();
  const targets = new Set();
  const localIps = new Set();
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (!isPrivateIPv4(addr.address)) continue;
      localIps.add(addr.address);
      const parts = addr.address.split('.');
      if (parts.length !== 4) continue;
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
      for (let i = 1; i <= 254; i++) targets.add(prefix + i);
    }
  }
  return [...targets].filter((ip) => !localIps.has(ip));
}

async function probeOllamaHost(ip, port, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:${port}/api/tags`, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.models)) return null;
    return {
      host: `http://${ip}:${port}`,
      address: ip,
      models: json.models
        .filter((m) => m && typeof m.name === 'string')
        .map((m) => ({ name: m.name }))
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      const value = await worker(items[current]);
      if (value !== null && value !== undefined) results.push(value);
    }
  });
  await Promise.all(runners);
  return results;
}

ipcMain.handle('scan-lan-ollama', async () => {
  try {
    assertRateLimit('scan-lan-ollama', 3, 30_000);
    const port = 11434;
    const timeoutMs = 700;
    const concurrency = 64;
    const targets = collectScanTargets();
    if (targets.length === 0) return [];
    const results = await runPool(targets, concurrency, (ip) => probeOllamaHost(ip, port, timeoutMs));
    const localIps = new Set();
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const addr of addrs || []) {
        if (addr.family === 'IPv4') localIps.add(addr.address);
      }
    }
    const filtered = results.filter((entry) => !localIps.has(entry.address));
    filtered.sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
    return filtered;
  } catch (err) {
    console.error('LAN scan error:', sanitizeError(err));
    throw new Error(sanitizeError(err));
  }
});

// Terminal Handlers
const isWindows = os.platform() === 'win32';
const shell = isWindows ? 'powershell.exe' : 'bash';
const shellArgs = isWindows ? ['-NoLogo', '-NoProfile'] : ['-i'];

function flushTerminalInputQueue(terminal) {
  if (!terminal || terminal.policyPending) return;
  while (terminal.inputQueue && terminal.inputQueue.length > 0) {
    const next = terminal.inputQueue.shift();
    if (terminal.proc?.stdin?.writable) {
      try { terminal.proc.stdin.write(next); } catch { /* ignore */ }
    }
  }
}

function initMcpGateway() {
  const gateway = createGateway({ sanitizeError });

  gateway.register('terminal', 'create', async (payload) => createMcpTerminalSession(payload || {}));
  gateway.register('terminal', 'list', async () => listMcpTerminalSessions());
  gateway.register('terminal', 'read', async (payload) =>
    readMcpTerminalOutput(String(payload.sessionId || ''), payload.maxChars, payload.clear !== false)
  );
  gateway.register('terminal', 'write', async (payload) =>
    writeMcpTerminalInput(String(payload.sessionId || ''), String(payload.input || ''))
  );
  gateway.register('terminal', 'execute', async (payload) =>
    executeMcpTerminalCommand(String(payload.sessionId || ''), String(payload.command || ''), payload.options || {})
  );
  gateway.register('terminal', 'close', async (payload) => closeMcpTerminalSession(String(payload.sessionId || '')));

  gateway.register('python', 'health', async () => getPythonTerminalConfig());
  gateway.register('python', 'create', async (payload) => {
    const python = getPythonTerminalConfig();
    if (!python.ok) return { blocked: true, reason: python.note, session: null };
    return createMcpTerminalSession({
      shell: payload.shell || python.shell,
      args: Array.isArray(payload.args) ? payload.args : python.args,
      cwd: payload.cwd
    });
  });
  gateway.register('python', 'list', async () => {
    const sessions = listMcpTerminalSessions();
    return sessions.filter((session) => {
      const shell = String(session.shell || '').toLowerCase();
      return shell.includes('python') || shell === 'py';
    });
  });
  gateway.register('python', 'read', async (payload) =>
    readMcpTerminalOutput(String(payload.sessionId || ''), payload.maxChars, payload.clear !== false)
  );
  gateway.register('python', 'write', async (payload) =>
    writeMcpTerminalInput(String(payload.sessionId || ''), String(payload.input || ''))
  );
  gateway.register('python', 'execute', async (payload) =>
    executeMcpTerminalCommand(String(payload.sessionId || ''), String(payload.command || ''), {
      ...(payload.options || {}),
      approveRisky: true
    })
  );
  gateway.register('python', 'run', async (payload) => {
    const python = getPythonTerminalConfig();
    if (!python.ok) {
      return { blocked: true, reason: python.note, session: null };
    }
    const session = createMcpTerminalSession({
      shell: payload.shell || python.shell,
      args: Array.isArray(payload.args) ? payload.args : python.args,
      cwd: payload.cwd
    });
    return executeMcpTerminalCommand(session.id, String(payload.code || payload.command || ''), {
      timeoutMs: typeof payload.timeoutSec === 'number' ? payload.timeoutSec * 1000 : undefined,
      settleMs: typeof payload.settleMs === 'number' ? payload.settleMs : 400,
      approveRisky: true
    });
  });
  gateway.register('python', 'list_runs', async () => {
    const sessions = listMcpTerminalSessions();
    return sessions.filter((session) => {
      const shell = String(session.shell || '').toLowerCase();
      return shell.includes('python') || shell === 'py';
    });
  });
  gateway.register('python', 'read_artifact', async (payload) => {
    const sessionId = String(payload.sessionId || payload.runId || '');
    const result = readMcpTerminalOutput(sessionId, 64_000, false);
    return {
      runId: sessionId,
      fileName: 'stdout',
      bytes: result.output.length,
      mimeType: 'text/plain',
      encoding: 'utf8',
      content: result.output
    };
  });
  gateway.register('python', 'close', async (payload) => closeMcpTerminalSession(String(payload.sessionId || '')));

  gateway.register('folder', 'root', async () => getConfiguredMcpFolderRoot());
  gateway.register('folder', 'clear_root', async () => {
    persistMcpFolderRoot('');
    return getConfiguredMcpFolderRoot();
  });
  gateway.register('folder', 'select_root', async () => {
    const { root } = getConfiguredMcpFolderRoot();
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select MCP Folder Root',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: root
    });
    if (res.canceled || !res.filePaths?.[0]) {
      return { ...getConfiguredMcpFolderRoot(), canceled: true };
    }
    const selected = path.resolve(res.filePaths[0]);
    persistMcpFolderRoot(selected);
    return { ...getConfiguredMcpFolderRoot(), canceled: false };
  });
  gateway.register('folder', 'list', async (payload) => {
    assertRateLimit('mcp-folder-list', 240, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '.';
    const { root, target, relPath } = resolveWithinMcpFolder(relativePath);
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error('Target is not a directory.');
    const entries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
      const full = path.join(target, entry.name);
      const fullStat = fs.statSync(full);
      return {
        name: entry.name,
        path: path.relative(root, full).replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
        bytes: entry.isDirectory() ? 0 : fullStat.size,
        modifiedAt: fullStat.mtime.toISOString()
      };
    });
    return { root, path: relPath, entries };
  });
  gateway.register('folder', 'read', async (payload) => {
    assertRateLimit('mcp-folder-read-text', 180, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '';
    const { root, target } = resolveWithinMcpFolder(relativePath);
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('Target is not a file.');
    if (stat.size > 4 * 1024 * 1024) throw new Error('File exceeds 4 MB text limit.');
    const content = fs.readFileSync(target, 'utf-8');
    return {
      root,
      path: path.relative(root, target).replace(/\\/g, '/'),
      bytes: stat.size,
      content
    };
  });
  gateway.register('folder', 'write', async (payload) => {
    assertRateLimit('mcp-folder-write-text', 120, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '';
    const content = payload.content;
    if (typeof content !== 'string') throw new Error('Content must be a string.');
    const { root, target } = resolveWithinMcpFolder(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    const stat = fs.statSync(target);
    return {
      root,
      path: path.relative(root, target).replace(/\\/g, '/'),
      bytes: stat.size
    };
  });
  gateway.register('folder', 'delete', async (payload) => {
    assertRateLimit('mcp-folder-delete-path', 120, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '';
    const { target } = resolveWithinMcpFolder(relativePath);
    if (!fs.existsSync(target)) return { deleted: false, missing: true };
    fs.rmSync(target, { recursive: true, force: true });
    return { deleted: true };
  });
  gateway.register('folder', 'rename', async (payload) => {
    assertRateLimit('mcp-folder-rename-path', 120, 60_000);
    const from = resolveWithinMcpFolder(payload.fromPath || '');
    const to = resolveWithinMcpFolder(payload.toPath || '');
    fs.mkdirSync(path.dirname(to.target), { recursive: true });
    fs.renameSync(from.target, to.target);
    return {
      from: from.relPath,
      to: to.relPath
    };
  });
  gateway.register('folder', 'mkdir', async (payload) => {
    assertRateLimit('mcp-folder-mkdir', 120, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '';
    const { root, target } = resolveWithinMcpFolder(relativePath);
    fs.mkdirSync(target, { recursive: true });
    return { root, path: path.relative(root, target).replace(/\\/g, '/') };
  });
  gateway.register('folder', 'list_models', async (payload) => {
    assertRateLimit('mcp-folder-list-models', 80, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '.';
    const { root, target } = resolveWithinMcpFolder(relativePath);
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error('Target is not a directory.');
    const models = [];
    walkModelFiles(target, root, models, 500);
    return { root, models };
  });
  gateway.register('folder', 'read_model', async (payload) => {
    assertRateLimit('mcp-folder-read-model', 60, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '';
    const { root, target } = resolveWithinMcpFolder(relativePath);
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('Target is not a file.');
    const ext = path.extname(target).toLowerCase();
    if (!IMPORTABLE_MODEL_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported model format: ${ext}`);
    }
    if (stat.size > 120 * 1024 * 1024) {
      throw new Error('Model exceeds 120 MB limit.');
    }
    const raw = fs.readFileSync(target);
    return {
      root,
      path: path.relative(root, target).replace(/\\/g, '/'),
      name: path.basename(target),
      ext,
      bytes: stat.size,
      base64: raw.toString('base64')
    };
  });

  gateway.register('wiki', 'root', async () => {
    const cfg = loadMcpWikiConfigFromDisk();
    const root = getConfiguredWikiRoot();
    return {
      ...root,
      autonomyMode: cfg.autonomyMode,
      knowledgePolicy: cfg.knowledgePolicy
    };
  });
  gateway.register('wiki', 'set_root', async (payload) => {
    if (typeof payload.path === 'string' && payload.path.trim()) {
      persistMcpWikiConfig({ root: path.resolve(payload.path.trim()) });
      const cfg = loadMcpWikiConfigFromDisk();
      const root = getConfiguredWikiRoot();
      return {
        ...root,
        autonomyMode: cfg.autonomyMode,
        knowledgePolicy: cfg.knowledgePolicy,
        canceled: false
      };
    }
    const { root } = getConfiguredWikiRoot();
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Wiki Folder Root',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: root
    });
    if (res.canceled || !res.filePaths?.[0]) {
      const cfg = loadMcpWikiConfigFromDisk();
      return {
        ...getConfiguredWikiRoot(),
        autonomyMode: cfg.autonomyMode,
        knowledgePolicy: cfg.knowledgePolicy,
        canceled: true
      };
    }
    persistMcpWikiConfig({ root: path.resolve(res.filePaths[0]) });
    const cfg = loadMcpWikiConfigFromDisk();
    const nextRoot = getConfiguredWikiRoot();
    return {
      ...nextRoot,
      autonomyMode: cfg.autonomyMode,
      knowledgePolicy: cfg.knowledgePolicy,
      canceled: false
    };
  });
  gateway.register('wiki', 'clear_root', async () => {
    persistMcpWikiConfig({ root: '' });
    const cfg = loadMcpWikiConfigFromDisk();
    const root = getConfiguredWikiRoot();
    return {
      ...root,
      autonomyMode: cfg.autonomyMode,
      knowledgePolicy: cfg.knowledgePolicy
    };
  });
  gateway.register('wiki', 'set_autonomy', async (payload) => {
    const mode = String(payload.mode || '').toLowerCase();
    if (!isValidWikiAutonomyMode(mode)) {
      throw new Error('Invalid wiki autonomy mode. Use auto, review, or hybrid.');
    }
    persistMcpWikiConfig({ autonomyMode: mode });
    const cfg = loadMcpWikiConfigFromDisk();
    return {
      ...getConfiguredWikiRoot(),
      autonomyMode: cfg.autonomyMode,
      knowledgePolicy: cfg.knowledgePolicy
    };
  });
  gateway.register('wiki', 'set_policy', async (payload) => {
    const level = String(payload.level || '').toLowerCase();
    if (!isValidWikiKnowledgePolicy(level)) {
      throw new Error('Invalid wiki knowledge policy. Use strict, balanced, or aggressive.');
    }
    persistMcpWikiConfig({ knowledgePolicy: level });
    const cfg = loadMcpWikiConfigFromDisk();
    return {
      ...getConfiguredWikiRoot(),
      autonomyMode: cfg.autonomyMode,
      knowledgePolicy: cfg.knowledgePolicy
    };
  });
  gateway.register('wiki', 'list', async (payload) => {
    assertRateLimit('mcp-wiki-list', 240, 60_000);
    const relativePath = payload.path ?? payload.relativePath ?? '.';
    const { root, target, relPath } = resolveWithinWikiRoot(relativePath);
    if (!fs.existsSync(target)) {
      if (relPath === '.') return { root, path: '.', files: [] };
      throw new Error('Wiki target does not exist.');
    }
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error('Target is not a directory.');
    const files = [];
    listWikiMarkdownFiles(target, root, files, 4000);
    files.sort((a, b) => a.localeCompare(b));
    return { root, path: relPath, files };
  });
  gateway.register('wiki', 'read', async (payload) => {
    assertRateLimit('mcp-wiki-read', 240, 60_000);
    const relativePath = String(payload.path ?? payload.relativePath ?? '');
    assertWikiMarkdownPath(relativePath);
    const { root, target } = resolveWithinWikiRoot(relativePath);
    if (!fs.existsSync(target)) return { root, path: relativePath, content: '', exists: false };
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('Target is not a file.');
    if (stat.size > 4 * 1024 * 1024) throw new Error('Wiki file exceeds 4 MB text limit.');
    return {
      root,
      path: path.relative(root, target).replace(/\\/g, '/'),
      bytes: stat.size,
      exists: true,
      content: fs.readFileSync(target, 'utf-8')
    };
  });
  gateway.register('wiki', 'upsert_note', async (payload) => {
    assertRateLimit('mcp-wiki-upsert', 180, 60_000);
    const relativePath = String(payload.path ?? payload.relativePath ?? '');
    assertWikiMarkdownPath(relativePath);
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (!content.trim()) throw new Error('Wiki note content cannot be empty.');
    if (content.length > 2_000_000) throw new Error('Wiki note exceeds 2 MB limit.');
    const cfg = loadMcpWikiConfigFromDisk();
    const policyEval = evaluateWikiKnowledgePolicy(payload, cfg.knowledgePolicy);
    if (!policyEval.allowed) {
      return { ok: false, denied: true, reason: policyEval.reason || 'Denied by knowledge policy.' };
    }
    const policy = await enforceWikiPolicy('upsert_note', payload, cfg);
    if (policy && policy.selectionId !== 'allow') {
      return { ok: false, denied: true, policy, message: 'Wiki upsert denied by policy.' };
    }
    const { root, target } = resolveWithinWikiRoot(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    const stat = fs.statSync(target);
    return {
      ok: true,
      root,
      path: path.relative(root, target).replace(/\\/g, '/'),
      bytes: stat.size,
      policy
    };
  });
  gateway.register('wiki', 'append_entry', async (payload) => {
    assertRateLimit('mcp-wiki-append', 180, 60_000);
    const now = new Date();
    const relativePath = String(payload.path || `journal/${now.toISOString().slice(0, 7)}.md`);
    assertWikiMarkdownPath(relativePath);
    const entry = typeof payload.entry === 'string' ? payload.entry.trim() : '';
    if (!entry) throw new Error('Wiki journal entry cannot be empty.');
    const cfg = loadMcpWikiConfigFromDisk();
    const policyEval = evaluateWikiKnowledgePolicy(payload, cfg.knowledgePolicy);
    if (!policyEval.allowed) {
      return { ok: false, denied: true, reason: policyEval.reason || 'Denied by knowledge policy.' };
    }
    const policy = await enforceWikiPolicy('append_entry', payload, cfg);
    if (policy && policy.selectionId !== 'allow') {
      return { ok: false, denied: true, policy, message: 'Wiki append denied by policy.' };
    }
    const { root, target } = resolveWithinWikiRoot(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const heading = typeof payload.heading === 'string' && payload.heading.trim()
      ? payload.heading.trim()
      : now.toISOString();
    const block = `\n## ${heading}\n\n${entry}\n`;
    fs.appendFileSync(target, block, 'utf-8');
    const stat = fs.statSync(target);
    return {
      ok: true,
      root,
      path: path.relative(root, target).replace(/\\/g, '/'),
      bytes: stat.size,
      policy
    };
  });
  gateway.register('wiki', 'search', async (payload) => {
    assertRateLimit('mcp-wiki-search', 120, 60_000);
    const query = String(payload.query || '').trim().toLowerCase();
    if (!query) return { results: [] };
    const maxResults = Math.max(1, Math.min(50, Number(payload.maxResults) || 12));
    const { root } = getConfiguredWikiRoot();
    if (!fs.existsSync(root)) return { results: [] };
    const files = [];
    listWikiMarkdownFiles(root, root, files, 4000);
    const results = [];
    for (const rel of files) {
      if (results.length >= maxResults) break;
      const full = path.join(root, rel);
      const content = fs.readFileSync(full, 'utf-8');
      const idx = content.toLowerCase().indexOf(query);
      if (idx < 0) continue;
      const start = Math.max(0, idx - 120);
      const end = Math.min(content.length, idx + query.length + 120);
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
      results.push({ path: rel, snippet });
    }
    return { results };
  });
  gateway.register('wiki', 'delete', async (payload) => {
    assertRateLimit('mcp-wiki-delete', 120, 60_000);
    const relativePath = String(payload.path ?? payload.relativePath ?? '');
    if (!relativePath.trim()) throw new Error('Wiki delete path is required.');
    const cfg = loadMcpWikiConfigFromDisk();
    const policy = await enforceWikiPolicy('delete', payload, cfg);
    if (policy && policy.selectionId !== 'allow') {
      return { deleted: false, denied: true, policy };
    }
    const { target } = resolveWithinWikiRoot(relativePath);
    if (!fs.existsSync(target)) return { deleted: false, missing: true, policy };
    fs.rmSync(target, { recursive: true, force: true });
    return { deleted: true, policy };
  });
  gateway.register('wiki', 'rename', async (payload) => {
    assertRateLimit('mcp-wiki-rename', 120, 60_000);
    const cfg = loadMcpWikiConfigFromDisk();
    const policy = await enforceWikiPolicy('rename', payload, cfg);
    if (policy && policy.selectionId !== 'allow') {
      return { renamed: false, denied: true, policy };
    }
    const from = resolveWithinWikiRoot(String(payload.fromPath || ''));
    const to = resolveWithinWikiRoot(String(payload.toPath || ''));
    fs.mkdirSync(path.dirname(to.target), { recursive: true });
    fs.renameSync(from.target, to.target);
    return { renamed: true, from: from.relPath, to: to.relPath, policy };
  });
  gateway.register('wiki', 'reindex', async () => {
    const { root } = getConfiguredWikiRoot();
    const files = [];
    if (fs.existsSync(root)) {
      listWikiMarkdownFiles(root, root, files, 4000);
    }
    return {
      indexedAt: new Date().toISOString(),
      fileCount: files.length
    };
  });

  gateway.register('browser', 'create_session', async (payload) => {
    const created = await createBrowserSession(payload || {});
    defaultBrowserSessionId = created.session.sessionId;
    return created;
  });
  gateway.register('browser', 'list_sessions', async () => ({ sessions: listBrowserSessions() }));
  gateway.register('browser', 'close_session', async (payload) => {
    const closed = await closeBrowserSession(String(payload.sessionId || ''));
    if (closed.sessionId === defaultBrowserSessionId) {
      defaultBrowserSessionId = null;
    }
    return closed;
  });
  gateway.register('browser', 'create_page', async (payload) => createBrowserPage(String(payload.sessionId || ''), payload || {}));
  gateway.register('browser', 'list_pages', async (payload) => listBrowserPages(String(payload.sessionId || '')));
  gateway.register('browser', 'close_page', async (payload) => closeBrowserPage(String(payload.sessionId || ''), String(payload.pageId || '')));
  gateway.register('browser', 'activate_page', async (payload) => activateBrowserPage(String(payload.sessionId || ''), String(payload.pageId || '')));
  gateway.register('browser', 'action', async (payload) => executeBrowserAction(payload || {}));
  gateway.register('browser', 'status', async () => getBrowserRuntimeStatus());
  gateway.register('browser', 'reset', async () => executeBrowserAction({ action: 'reset' }));

  gateway.register('openscad', 'health', async () => {
    if (!OPENSCAD_FEATURE_ENABLED) {
      return {
        ok: false,
        executable: '',
        version: '',
        checkedAt: new Date().toISOString(),
        note: 'OpenSCAD feature is disabled by MCP_OPENSCAD_ENABLED=0.'
      };
    }
    return checkOpenScadHealth();
  });
  gateway.register('openscad', 'compile', async (payload) => {
    assertRateLimit('mcp-openscad-compile', 40, 60_000);
    if (!OPENSCAD_FEATURE_ENABLED) {
      return {
        ok: false,
        errorCategory: 'FEATURE_DISABLED',
        error: 'OpenSCAD feature is disabled by MCP_OPENSCAD_ENABLED=0.'
      };
    }
    return compileOpenScad(payload || {}, {
      resolveSourcePath: (relativePath) => resolveWithinMcpFolder(String(relativePath || '')),
      tempRoot: path.join(app.getPath('temp'), 'ollama-plus-openscad')
    });
  });

  gateway.register('blender_plate', 'health', async () => {
    if (!BLENDER_PLATE_FEATURE_ENABLED) {
      return {
        ok: false,
        executable: '',
        version: '',
        checkedAt: new Date().toISOString(),
        note: 'Blender Plate feature is disabled by MCP_BLENDER_PLATE_ENABLED=0.'
      };
    }
    applyConfiguredBlenderBin();
    return checkBlenderPlateHealth();
  });

  gateway.register('blender_plate', 'config_get', async () => {
    const configured = applyConfiguredBlenderBin();
    return {
      ok: true,
      bin: configured.bin,
      isCustom: configured.isCustom,
      source: configured.source
    };
  });

  gateway.register('blender_plate', 'config_set', async (payload) => {
    const raw = String(payload?.bin || '').trim();
    if (!raw) {
      throw new Error('Blender executable path is required.');
    }
    const unquoted = raw.replace(/^"|"$/g, '');
    const resolved = path.resolve(unquoted);
    if (!fs.existsSync(resolved)) {
      throw new Error('Blender executable path does not exist.');
    }
    if (!fs.statSync(resolved).isFile()) {
      throw new Error('Blender executable path must be a file.');
    }
    persistMcpBlenderBin(resolved);
    const configured = applyConfiguredBlenderBin();
    const health = checkBlenderPlateHealth();
    return {
      ok: true,
      bin: configured.bin,
      isCustom: configured.isCustom,
      source: configured.source,
      health
    };
  });

  gateway.register('blender_plate', 'config_clear', async () => {
    persistMcpBlenderBin('');
    const configured = applyConfiguredBlenderBin();
    const health = checkBlenderPlateHealth();
    return {
      ok: true,
      bin: configured.bin,
      isCustom: configured.isCustom,
      source: configured.source,
      health
    };
  });

  gateway.register('blender_plate', 'config_select_bin', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window is unavailable for file selection.');
    }
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Blender Executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executable', extensions: ['exe', 'com', 'cmd', 'bat'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (selection.canceled || !selection.filePaths?.[0]) {
      const configured = applyConfiguredBlenderBin();
      return {
        ok: true,
        canceled: true,
        bin: configured.bin,
        isCustom: configured.isCustom,
        source: configured.source
      };
    }
    const picked = path.resolve(selection.filePaths[0]);
    persistMcpBlenderBin(picked);
    const configured = applyConfiguredBlenderBin();
    const health = checkBlenderPlateHealth();
    return {
      ok: true,
      canceled: false,
      bin: configured.bin,
      isCustom: configured.isCustom,
      source: configured.source,
      health
    };
  });

  gateway.register('blender_plate', 'build', async (payload) => {
    assertRateLimit('mcp-blender-plate-build', 20, 60_000);
    if (!BLENDER_PLATE_FEATURE_ENABLED) {
      return {
        ok: false,
        errorCategory: 'FEATURE_DISABLED',
        error: 'Blender Plate feature is disabled by MCP_BLENDER_PLATE_ENABLED=0.'
      };
    }
    applyConfiguredBlenderBin();
    return buildBlenderPlate(payload || {}, {
      resolveSourcePath: (relativePath) => resolveWithinMcpFolder(String(relativePath || '')),
      tempRoot: path.join(app.getPath('temp'), 'ollama-plus-blender-plate')
    });
  });

  gateway.setStatusProvider(async () => {
    const terminalSessions = listMcpTerminalSessions();
    const python = getPythonTerminalConfig();
    const folder = getConfiguredMcpFolderRoot();
    const wikiRoot = getConfiguredWikiRoot();
    const wikiCfg = loadMcpWikiConfigFromDisk();
    const browser = getBrowserRuntimeStatus();
    const openscad = checkOpenScadHealth();
    const blenderConfig = applyConfiguredBlenderBin();
    const blenderPlate = checkBlenderPlateHealth();
    return {
      terminalSessionCount: terminalSessions.length,
      pythonReady: python.ok,
      pythonInterpreter: python.interpreter,
      pythonVersion: python.version,
      pythonSource: python.source,
      pythonNote: python.note,
      folderRoot: folder.root,
      folderCustom: folder.isCustom,
      wikiRoot: wikiRoot.root,
      wikiCustom: wikiRoot.isCustom,
      wikiAutonomyMode: wikiCfg.autonomyMode,
      wikiKnowledgePolicy: wikiCfg.knowledgePolicy,
      browserSessionCount: browser.activeSessionCount,
      blenderPlateEnabled: BLENDER_PLATE_FEATURE_ENABLED,
      blenderPlateReady: blenderPlate.ok,
      blenderPlateExecutable: blenderPlate.executable,
      blenderPlateVersion: blenderPlate.version,
      blenderPlateNote: blenderPlate.note || '',
      blenderPlateConfiguredBin: blenderConfig.bin,
      blenderPlateBinCustom: blenderConfig.isCustom,
      openscadEnabled: OPENSCAD_FEATURE_ENABLED,
      openscadReady: openscad.ok,
      openscadExecutable: openscad.executable,
      openscadVersion: openscad.version,
      openscadNote: openscad.note || '',
      checkedAt: new Date().toISOString()
    };
  });

  return gateway;
}

function dispatchMcpGateway(request) {
  return mcpGateway.dispatch(request || {});
}

ipcMain.handle('spawn-terminal', (event, type) => {
  const id = Math.random().toString(36).substring(7);

  let command = shell;
  let args = shellArgs;

  if (type === 'python') {
    command = isWindows ? 'python' : 'python3';
    args = ['-i']; // interactive
  } else if (type === 'java') {
    command = 'jshell'; // Java REPL
    args = [];
  }

  const proc = spawn(command, args, {
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: process.env
  });

  terminals[id] = {
    proc,
    type,
    lineBuffer: '',
    inputQueue: [],
    policyPending: false
  };

  proc.stdout.on('data', (data) => {
    mainWindow.webContents.send('terminal-output', id, data.toString().replace(/\n/g, '\r\n'));
  });

  proc.stderr.on('data', (data) => {
    mainWindow.webContents.send('terminal-output', id, data.toString().replace(/\n/g, '\r\n'));
  });

  return id;
});

applyConfiguredBlenderBin();
mcpGateway = initMcpGateway();

ipcMain.handle('mcp-gateway-call', async (_event, request) => {
  return mcpGateway.dispatchSafe(request || {});
});

ipcMain.handle('mcp-gateway-status', async () => {
  return mcpGateway.statusSafe();
});

ipcMain.handle('mcp-terminal-create-session', async (_event, options) =>
  dispatchMcpGateway({ server: 'terminal', action: 'create', payload: options || {} })
);
ipcMain.handle('mcp-terminal-list-sessions', async () =>
  dispatchMcpGateway({ server: 'terminal', action: 'list', payload: {} })
);
ipcMain.handle('mcp-terminal-read-output', async (_event, sessionId, maxChars, clear) =>
  dispatchMcpGateway({ server: 'terminal', action: 'read', payload: { sessionId, maxChars, clear } })
);
ipcMain.handle('mcp-terminal-write-input', async (_event, sessionId, input) =>
  dispatchMcpGateway({ server: 'terminal', action: 'write', payload: { sessionId, input } })
);
ipcMain.handle('mcp-terminal-execute', async (_event, sessionId, command, options) =>
  dispatchMcpGateway({ server: 'terminal', action: 'execute', payload: { sessionId, command, options: options || {} } })
);
ipcMain.handle('mcp-terminal-close-session', async (_event, sessionId) =>
  dispatchMcpGateway({ server: 'terminal', action: 'close', payload: { sessionId } })
);

ipcMain.handle('mcp-python-health', async () => dispatchMcpGateway({ server: 'python', action: 'health', payload: {} }));
ipcMain.handle('mcp-python-run', async (_event, payload) => {
  const result = await dispatchMcpGateway({ server: 'python', action: 'run', payload: payload || {} });
  if (result?.session && typeof result.session.id === 'string') {
    return {
      blocked: Boolean(result.blocked),
      reason: result.reason,
      session: result.session,
      output: result.output || '',
      sessionId: result.session.id
    };
  }
  return {
    blocked: Boolean(result?.blocked),
    reason: result?.reason,
    session: result?.session || null,
    output: result?.output || '',
    sessionId: result?.session?.id
  };
});
ipcMain.handle('mcp-python-list-runs', async () => {
  return dispatchMcpGateway({ server: 'python', action: 'list_runs', payload: {} });
});
ipcMain.handle('mcp-python-read-artifact', async (_event, sessionId) => {
  return dispatchMcpGateway({ server: 'python', action: 'read_artifact', payload: { sessionId } });
});

ipcMain.handle('mcp-folder-get-root', async () => dispatchMcpGateway({ server: 'folder', action: 'root', payload: {} }));
ipcMain.handle('mcp-folder-clear-root', async () => dispatchMcpGateway({ server: 'folder', action: 'clear_root', payload: {} }));
ipcMain.handle('mcp-folder-select-root', async () => dispatchMcpGateway({ server: 'folder', action: 'select_root', payload: {} }));
ipcMain.handle('mcp-folder-list', async (_event, relativePath = '.') =>
  dispatchMcpGateway({ server: 'folder', action: 'list', payload: { relativePath } })
);
ipcMain.handle('mcp-folder-read-text', async (_event, relativePath) =>
  dispatchMcpGateway({ server: 'folder', action: 'read', payload: { relativePath } })
);
ipcMain.handle('mcp-folder-write-text', async (_event, relativePath, content) =>
  dispatchMcpGateway({ server: 'folder', action: 'write', payload: { relativePath, content } })
);
ipcMain.handle('mcp-folder-delete-path', async (_event, relativePath) =>
  dispatchMcpGateway({ server: 'folder', action: 'delete', payload: { relativePath } })
);
ipcMain.handle('mcp-folder-rename-path', async (_event, fromPath, toPath) =>
  dispatchMcpGateway({ server: 'folder', action: 'rename', payload: { fromPath, toPath } })
);
ipcMain.handle('mcp-folder-mkdir', async (_event, relativePath) =>
  dispatchMcpGateway({ server: 'folder', action: 'mkdir', payload: { relativePath } })
);
ipcMain.handle('mcp-folder-list-models', async (_event, relativePath = '.') =>
  dispatchMcpGateway({ server: 'folder', action: 'list_models', payload: { relativePath } })
);
ipcMain.handle('mcp-folder-read-model', async (_event, relativePath) =>
  dispatchMcpGateway({ server: 'folder', action: 'read_model', payload: { relativePath } })
);

ipcMain.on('terminal-input', (event, id, data) => {
  const terminal = terminals[id];
  if (!terminal?.proc || !terminal.proc.stdin) return;

  try {
    assertRateLimit(`terminal-input-${id}`, 6000, 60_000);
  } catch (err) {
    mainWindow.webContents.send('terminal-output', id, `\r\n[Policy] ${sanitizeError(err)}\r\n`);
    return;
  }

  if (terminal.type !== 'shell') {
    terminal.proc.stdin.write(data);
    return;
  }

  terminal.lineBuffer += data;
  const hasEnter = /\r|\n/.test(data);
  if (!hasEnter) {
    terminal.proc.stdin.write(data);
    return;
  }

  const command = terminal.lineBuffer.replace(/[\r\n]+/g, '').trim();
  terminal.lineBuffer = '';

  if (!command) {
    terminal.proc.stdin.write(data);
    return;
  }

  if (command.length > 2000) {
    mainWindow.webContents.send('terminal-output', id, '\r\n[Policy] Command is too long.\r\n');
    return;
  }

  if (!isRiskyCommand(command)) {
    terminal.proc.stdin.write(data);
    return;
  }

  requestUserDecision({
    title: 'Shell Command Approval',
    markdown: `### Risky shell command detected\n\n\`\`\`powershell\n${command}\n\`\`\`\n\nChoose how to proceed.`,
    options: [
      { id: 'deny', label: 'Deny', description: 'Block this command.', recommended: true },
      { id: 'allow', label: 'Allow Once', description: 'Run this command one time.' }
    ],
    defaultOptionId: 'deny'
  })
    .then((decision) => {
      if (decision.selectionId === 'allow') {
        terminal.proc.stdin.write(data);
      } else {
        mainWindow.webContents.send('terminal-output', id, '\r\n[Policy] Command denied by user.\r\n');
      }
    })
    .catch((err) => {
      mainWindow.webContents.send('terminal-output', id, `\r\n[Policy] ${sanitizeError(err)}\r\n`);
    });
});

ipcMain.handle('run-shell-command', async (_event, command) => {
  try {
    assertRateLimit('run-shell-command', 80, 60_000);
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error('Command is required.');
    }

    const normalizedCommand = command.replace(/[\r\n]+/g, ' ').trim();
    if (normalizedCommand.length > 2000) {
      throw new Error('Command is too long.');
    }

    let decisionMeta = { selectionId: 'auto-allow', decisionToken: null };
    if (isRiskyCommand(normalizedCommand)) {
      decisionMeta = await requestUserDecision({
        title: 'Shell Command Approval',
        markdown: `### Risky shell command detected\n\n\`\`\`powershell\n${normalizedCommand}\n\`\`\`\n\nChoose how to proceed.`,
        options: [
          { id: 'deny', label: 'Deny', description: 'Block this command.', recommended: true },
          { id: 'allow', label: 'Allow Once', description: 'Run this command one time.' }
        ],
        defaultOptionId: 'deny'
      });

      if (decisionMeta.selectionId !== 'allow') {
        return {
          ok: false,
          denied: true,
          message: 'Command denied by user.',
          policy: {
            decisionToken: decisionMeta.decisionToken,
            selectionId: decisionMeta.selectionId
          }
        };
      }
    }

    const id = Math.random().toString(36).substring(7);
    const proc = spawn(shell, shellArgs, {
      cwd: process.env.HOME || process.env.USERPROFILE,
      env: process.env
    });

    terminals[id] = {
      proc,
      type: 'shell',
      lineBuffer: '',
      inputQueue: [],
      policyPending: false
    };

    proc.stdout.on('data', (data) => {
      mainWindow.webContents.send('terminal-output', id, data.toString().replace(/\n/g, '\r\n'));
    });

    proc.stderr.on('data', (data) => {
      mainWindow.webContents.send('terminal-output', id, data.toString().replace(/\n/g, '\r\n'));
    });

    proc.stdin.write(`${normalizedCommand}\r`);

    return {
      ok: true,
      terminalId: id,
      message: 'Command started in terminal.',
      policy: {
        decisionToken: decisionMeta.decisionToken,
        selectionId: decisionMeta.selectionId
      }
    };
  } catch (err) {
    return {
      ok: false,
      denied: false,
      message: sanitizeError(err)
    };
  }
});

// Playwright Web Access
ipcMain.handle('browser-action', async (_event, options) => executeBrowserAction(options));

ipcMain.handle('run-playwright', async (event, url, action) => {
  try {
    const page = await getPersistentPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    if (action === 'extract-text') {
      const text = await page.evaluate(() => document.body.innerText);
      return text.substring(0, 5000);
    }
    
    return "Page loaded successfully";
  } catch (err) {
    console.error('Playwright Error:', err);
    return `Error accessing ${url}: ${err.message}`;
  }
});

ipcMain.handle('web-search', async (event, query) => {
  let browser;
  try {
    const executablePath = os.platform() === 'win32' 
      ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      : '/usr/bin/google-chrome';
      
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    await page.goto(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const results = await page.evaluate(() => {
      const output = [];
      const items = Array.from(document.querySelectorAll('.snippet'));
      items.forEach(item => {
        const titleEl = item.querySelector('.title');
        const linkEl = item.querySelector('a.l1');
        const snippetEl = item.querySelector('.content');
        
        if (titleEl && linkEl) {
          output.push({
            title: titleEl.innerText,
            url: linkEl.href,
            snippet: snippetEl ? snippetEl.innerText : ''
          });
        }
      });
      return output.slice(0, 5);
    });
    
    if (results.length === 0) return "No results found.";
    
    return results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\n---`).join('\n');
  } catch (err) {
    console.error('Search Error:', err);
    return `Error searching for ${query}: ${err.message}`;
  } finally {
    if (browser) await browser.close();
  }
});

function formatMathValue(value) {
  try {
    return mathEngine.format(value, { precision: 64 });
  } catch {
    return String(value);
  }
}

ipcMain.handle('get-clock', async (_event, opts = {}) => {
  const now = new Date();
  const tz =
    typeof opts.timezone === 'string' && opts.timezone.trim()
      ? opts.timezone.trim()
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = typeof opts.locale === 'string' && opts.locale.trim() ? opts.locale.trim() : 'en-US';
  try {
    const lines = [
      `iso_utc: ${now.toISOString()}`,
      `unix_epoch_ms: ${now.getTime()}`,
      `timezone: ${tz}`,
      `local_long: ${now.toLocaleString(locale, {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'long'
      })}`,
      `date_ymd: ${now.toLocaleDateString(locale, { timeZone: tz })}`,
      `time_24h: ${now.toLocaleTimeString(locale, { timeZone: tz, hour12: false })}`
    ];
    return lines.join('\n');
  } catch (err) {
    return `Error formatting time for timezone "${tz}": ${err.message}`;
  }
});

ipcMain.handle('engineering-calculator', async (_event, payload = {}) => {
  try {
    const expression = payload.expression ?? payload.expr;
    if (expression === undefined || expression === null || String(expression).trim() === '') {
      throw new Error('expression is required (mathjs syntax: + - * / ^, sqrt(), sin(), cos(), det(), inv(), e, pi, i, etc.)');
    }
    const exprStr = String(expression).trim();
    const scope =
      payload.scope && typeof payload.scope === 'object' && !Array.isArray(payload.scope)
        ? payload.scope
        : {};
    const raw = mathEngine.evaluate(exprStr, scope);
    const text = formatMathValue(raw);
    const type = raw && typeof raw === 'object' && raw.constructor?.name ? raw.constructor.name : typeof raw;
    return `type: ${type}\nvalue: ${text}`;
  } catch (err) {
    return `Calculator error: ${err.message || err}`;
  }
});

// Wiki Handlers
ipcMain.handle('read-wiki', async (event, filePath) => {
  try {
    assertRateLimit('wiki-read', 200, 60_000);
    const { fullPath } = resolveWikiPath(filePath);
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (err) {
    return null;
  }
});

ipcMain.handle('write-wiki', async (event, filePath, content) => {
  try {
    assertRateLimit('wiki-write', 120, 60_000);
    const { fullPath } = resolveWikiPath(filePath);
    if (typeof content !== 'string') {
      throw new Error('Invalid content payload.');
    }
    if (content.length > 2_000_000) {
      throw new Error('Content exceeds allowed size.');
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error('Write wiki error:', sanitizeError(err));
    return false;
  }
});

ipcMain.handle('list-wiki', async (event) => {
  try {
    const { root: wikiPath } = getConfiguredWikiRoot();
    if (!fs.existsSync(wikiPath)) return [];
    const files = [];
    listWikiMarkdownFiles(wikiPath, wikiPath, files, 4000);
    files.sort((a, b) => a.localeCompare(b));
    return files;
  } catch (err) {
    return [];
  }
});

// Chat Session Handlers
ipcMain.handle('save-chat', async (event, sessionId, messages) => {
  try {
    const { chatsRoot, fullPath } = resolveChatFile(sessionId);
    if (!Array.isArray(messages)) throw new Error('Invalid messages payload.');
    if (!fs.existsSync(chatsRoot)) fs.mkdirSync(chatsRoot, { recursive: true });
    const filePath = fullPath;
    const firstContent = messages.length > 0 && typeof messages[0]?.content === 'string' ? messages[0].content : '';
    let title = firstContent ? `${firstContent.substring(0, 40)}...` : 'New Chat';

    // Preserve existing title if it's not "New Chat"
    if (fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (existing.title && existing.title !== 'New Chat') {
          title = existing.title;
        }
      } catch (e) {
        console.error('Error reading existing chat for title preservation:', sanitizeError(e));
      }
    }

    const data = {
      id: sessionId,
      updatedAt: new Date().toISOString(),
      messages: messages,
      title: title
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Save Chat Error:', sanitizeError(err));
    return false;
  }
});

ipcMain.handle('rename-chat', async (event, sessionId, newTitle) => {
  try {
    const { fullPath } = resolveChatFile(sessionId);
    if (typeof newTitle !== 'string' || newTitle.length === 0 || newTitle.length > 200) {
      throw new Error('Invalid title.');
    }
    const filePath = fullPath;

    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.title = newTitle;
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    }
    return false;
  } catch (err) {
    console.error('Rename Chat Error:', sanitizeError(err));
    return false;
  }
});

ipcMain.handle('load-chat', async (event, sessionId) => {
  try {
    const { fullPath } = resolveChatFile(sessionId);
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  } catch (err) {
    console.error('Load Chat Error:', sanitizeError(err));
    return null;
  }
});

ipcMain.handle('list-chats', async (event) => {
  try {
    const chatsPath = path.join(app.getPath('userData'), 'chats');
    if (!fs.existsSync(chatsPath)) return [];
    
    const files = fs.readdirSync(chatsPath).filter(f => f.endsWith('.json'));
    const chats = files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(chatsPath, f), 'utf-8'));
      return {
        id: content.id,
        title: content.title,
        updatedAt: content.updatedAt
      };
    });
    
    return chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (err) {
    console.error('List Chats Error:', err);
    return [];
  }
});

ipcMain.handle('delete-chat', async (event, sessionId) => {
  try {
    const { fullPath } = resolveChatFile(sessionId);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Delete Chat Error:', sanitizeError(err));
    return false;
  }
});

ipcMain.handle('parse-file', async (event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
      throw new Error('Invalid file path.');
    }
    assertRateLimit('parse-file', 60, 60_000);
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('Not a regular file.');
    if (stat.size > 50 * 1024 * 1024) throw new Error('File exceeds 50 MB limit.');

    const ext = path.extname(resolved).toLowerCase();
    const buffer = fs.readFileSync(resolved);

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    } else if (ext === '.csv') {
      const records = parseCSV(buffer, { columns: true, skip_empty_lines: true });
      return JSON.stringify(records, null, 2);
    } else if (ext === '.md' || ext === '.txt') {
      return buffer.toString('utf-8');
    } else {
      return `Unsupported file format: ${ext}`;
    }
  } catch (err) {
    console.error('File Parse Error:', sanitizeError(err));
    return `Error parsing file: ${sanitizeError(err)}`;
  }
});

// Parse file from raw buffer bytes (used by drag-and-drop in renderer)
ipcMain.handle('parse-file-buffer', async (event, ext, byteArray) => {
  try {
    if (typeof ext !== 'string' || !/^[a-z0-9]{1,8}$/i.test(ext)) {
      throw new Error('Invalid file extension.');
    }
    assertRateLimit('parse-file-buffer', 60, 60_000);
    const buffer = Buffer.from(byteArray);
    if (buffer.length > 50 * 1024 * 1024) throw new Error('File exceeds 50 MB limit.');

    if (ext === 'pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    } else if (ext === 'csv') {
      const records = parseCSV(buffer, { columns: true, skip_empty_lines: true });
      return JSON.stringify(records, null, 2);
    } else {
      return buffer.toString('utf-8');
    }
  } catch (err) {
    console.error('File Buffer Parse Error:', sanitizeError(err));
    return `Error parsing file: ${sanitizeError(err)}`;
  }
});

ipcMain.handle('unload-models', async (event, hostUrl) => {
  try {
    if (typeof hostUrl !== 'string' || !isSafeHttpUrl(hostUrl)) {
      throw new Error('Invalid Ollama host URL.');
    }
    const url = hostUrl.replace(/\/$/, '');
    const psRes = await fetchOllama(`${url}/api/ps`);
    const data = await psRes.json();

    if (data.models) {
      for (const m of data.models) {
        await fetchOllama(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name, keep_alive: 0 })
        });
      }
    }
    return true;
  } catch (err) {
    console.error('Unload Error:', formatOllamaFetchError(err, hostUrl));
    return false;
  }
});
