import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import { parse as parseCSV } from 'csv-parse/sync';
import { createRequire } from 'module';
import { create, all } from 'mathjs';
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
const rateWindows = new Map();
const pendingPolicyDecisions = new Map();

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
  'evaluate'
]);

const SHELL_RISKY_PATTERNS = [
  /(^|\s)(rm|rmdir|del|erase|format|shutdown|reboot|Restart-Computer)(\s|$)/i,
  /(^|\s)(Remove-Item|Set-ExecutionPolicy|reg\s+add|reg\s+delete|diskpart)(\s|$)/i,
  /(^|\s)(curl|Invoke-WebRequest|Invoke-Expression|iex)(\s|$)/i,
  /(^|\s)(Start-Process|Stop-Process|taskkill|sc\.exe)(\s|$)/i
];

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

function sanitizeUserPath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('Path is required.');
  }
  if (inputPath.includes('\0')) {
    throw new Error('Invalid path.');
  }
  return inputPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveWikiPath(filePath) {
  const wikiRoot = path.resolve(path.join(app.getPath('userData'), 'wiki'));
  const relative = sanitizeUserPath(filePath);
  const fullPath = path.resolve(path.join(wikiRoot, relative));
  if (fullPath !== wikiRoot && !fullPath.startsWith(`${wikiRoot}${path.sep}`)) {
    throw new Error('Access denied for path.');
  }
  return { wikiRoot, fullPath };
}

function isSafeHttpUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

function isRiskyCommand(command) {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return SHELL_RISKY_PATTERNS.some((pattern) => pattern.test(trimmed));
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
  const pending = pendingPolicyDecisions.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingPolicyDecisions.delete(requestId);

  const safeSelection = pending.allowedIds.has(selectionId) ? selectionId : pending.defaultOptionId;
  pending.resolve({ selectionId: safeSelection, decisionToken: `policy-${requestId}` });
  return true;
});

// Persistent Playwright Browser
let persistentBrowser = null;
let persistentContext = null;
let persistentPage = null;

async function getPersistentPage() {
  const executablePath = os.platform() === 'win32' 
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : '/usr/bin/google-chrome';

  if (!persistentBrowser) {
    persistentBrowser = await chromium.launch({ executablePath, headless: true });
    persistentContext = await persistentBrowser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
    persistentPage = await persistentContext.newPage();
  }
  return persistentPage;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // For local files if needed
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
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Ollama API Proxy (Bypasses CORS)
ipcMain.handle('ollama-request', async (event, hostUrl, endpoint, data) => {
  try {
    const url = `${hostUrl.replace(/\/$/, '')}${endpoint}`;
    const response = await fetch(url, {
      method: data ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('Ollama Error:', err);
    throw err;
  }
});

ipcMain.on('ollama-stream', async (event, streamId, hostUrl, endpoint, data) => {
  const controller = new AbortController();
  activeStreams[streamId] = controller;
  
  try {
    const url = `${hostUrl.replace(/\/$/, '')}${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
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
      event.sender.send(`ollama-error-${streamId}`, err.message);
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

// Terminal Handlers
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

ipcMain.handle('spawn-terminal', (event, type) => {
  const id = Math.random().toString(36).substring(7);
  
  let command = shell;
  let args = [];
  
  if (type === 'python') {
    command = os.platform() === 'win32' ? 'python' : 'python3';
    args = ['-i']; // interactive
  } else if (type === 'java') {
    command = 'jshell'; // Java REPL
  }

  const proc = spawn(command, args, {
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: process.env,
    shell: true
  });

  terminals[id] = {
    proc,
    type,
    lineBuffer: ''
  };

  proc.stdout.on('data', (data) => {
    mainWindow.webContents.send('terminal-output', id, data.toString().replace(/\n/g, '\r\n'));
  });

  proc.stderr.on('data', (data) => {
    mainWindow.webContents.send('terminal-output', id, data.toString().replace(/\n/g, '\r\n'));
  });

  return id;
});

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
    markdown: `### Risky shell command detected\n\n\\`\\`\\`powershell\n${command}\n\\`\\`\\`\n\nChoose how to proceed.`,
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
        markdown: `### Risky shell command detected\n\n\\`\\`\\`powershell\n${normalizedCommand}\n\\`\\`\\`\n\nChoose how to proceed.`,
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
    const proc = spawn(shell, [], {
      cwd: process.env.HOME || process.env.USERPROFILE,
      env: process.env,
      shell: true
    });

    terminals[id] = {
      proc,
      type: 'shell',
      lineBuffer: ''
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
ipcMain.handle('browser-action', async (event, options) => {
  try {
    assertRateLimit('browser-action', 80, 60_000);

    const { action, url, selector, text, key, wait_for, script } = options || {};
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

    let policyMeta = null;

    if (action === 'evaluate') {
      const decision = await requestUserDecision({
        title: 'Browser Script Approval',
        markdown: `### Browser evaluate request\n\nThe model wants to execute script code in the page context.\n\n\\`\\`\\`javascript\n${String(script || '').slice(0, 600)}\n\\`\\`\\``,
        options: [
          { id: 'deny', label: 'Deny', description: 'Do not run this script.', recommended: true },
          { id: 'allow', label: 'Allow Once', description: 'Run this script one time.' }
        ],
        defaultOptionId: 'deny'
      });
      policyMeta = {
        decisionToken: decision.decisionToken,
        selectionId: decision.selectionId
      };
      if (decision.selectionId !== 'allow') {
        return { error: 'Action denied by user.', policy: policyMeta };
      }
    }

    if (action === 'goto' && url) {
      const parsed = new URL(url);
      const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
      if (!isLocal) {
        const decision = await requestUserDecision({
          title: 'External Navigation Approval',
          markdown: `### External website request\n\nTarget URL:\n\n\\`\\`\\`text\n${url}\n\\`\\`\\`\n\nAllow navigation?`,
          options: [
            { id: 'deny', label: 'Deny', description: 'Block navigation.', recommended: true },
            { id: 'allow', label: 'Allow Once', description: 'Navigate to this URL now.' }
          ],
          defaultOptionId: 'deny'
        });
        policyMeta = {
          decisionToken: decision.decisionToken,
          selectionId: decision.selectionId
        };
        if (decision.selectionId !== 'allow') {
          return { error: 'Navigation denied by user.', policy: policyMeta };
        }
      }
    }

    const page = await getPersistentPage();
    
    let result = "";

    switch (action) {
      case 'goto':
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        result = `Navigated to ${url}`;
        break;
      case 'click':
        await page.click(selector, { timeout: 10000 });
        result = `Clicked ${selector}`;
        break;
      case 'type':
        await page.fill(selector, text, { timeout: 10000 });
        result = `Typed "${text}" into ${selector}`;
        break;
      case 'press':
        await page.press(selector || 'body', key, { timeout: 10000 });
        result = `Pressed ${key}`;
        break;
      case 'scroll':
        if (selector) {
          await page.locator(selector).scrollIntoViewIfNeeded();
          result = `Scrolled to ${selector}`;
        } else {
          await page.evaluate((dir) => window.scrollBy(0, dir === 'down' ? 500 : -500), text || 'down');
          result = `Scrolled ${text || 'down'}`;
        }
        break;
      case 'wait':
        if (wait_for?.startsWith('http')) {
          await page.waitForURL(wait_for, { timeout: 15000 });
        } else if (wait_for) {
          await page.waitForSelector(wait_for, { timeout: 15000 });
        } else {
          await page.waitForTimeout(parseInt(text) || 2000);
        }
        result = "Wait completed";
        break;
      case 'evaluate':
        const evalRes = await page.evaluate(script);
        result = `Evaluation result: ${JSON.stringify(evalRes)}`;
        break;
      case 'screenshot':
        const screenshot = await page.screenshot({ encoding: 'base64' });
        return {
          screenshot: `data:image/png;base64,${screenshot}`,
          url: page.url(),
          title: await page.title(),
          policy: policyMeta
        };
      case 'content':
      case 'extract-text':
      default:
        const innerText = await page.evaluate(() => document.body.innerText);
        result = innerText.substring(0, 10000);
        break;
    }

    return {
      result,
      url: page.url(),
      title: await page.title(),
      policy: policyMeta
    };
  } catch (err) {
    console.error('Browser Action Error:', err);
    return { error: sanitizeError(err), url: persistentPage ? persistentPage.url() : '' };
  }
});

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
    const wikiPath = path.join(app.getPath('userData'), 'wiki');
    if (!fs.existsSync(wikiPath)) return [];
    
    const walk = (dir) => {
      let results = [];
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(walk(fullPath));
        } else if (file.endsWith('.md')) {
          results.push(path.relative(wikiPath, fullPath).replace(/\\/g, '/'));
        }
      });
      return results;
    };
    return walk(wikiPath);
  } catch (err) {
    return [];
  }
});

// Chat Session Handlers
ipcMain.handle('save-chat', async (event, sessionId, messages) => {
  try {
    const chatsPath = path.join(app.getPath('userData'), 'chats');
    if (!fs.existsSync(chatsPath)) fs.mkdirSync(chatsPath, { recursive: true });
    const filePath = path.join(chatsPath, `${sessionId}.json`);
    let title = messages.length > 0 ? (messages[0].content.substring(0, 40) + '...') : 'New Chat';
    
    // Preserve existing title if it's not "New Chat"
    if (fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (existing.title && existing.title !== 'New Chat') {
          title = existing.title;
        }
      } catch (e) {
        console.error('Error reading existing chat for title preservation:', e);
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
    console.error('Save Chat Error:', err);
    return false;
  }
});

ipcMain.handle('rename-chat', async (event, sessionId, newTitle) => {
  try {
    const chatsPath = path.join(app.getPath('userData'), 'chats');
    const filePath = path.join(chatsPath, `${sessionId}.json`);
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.title = newTitle;
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    }
    return false;
  } catch (err) {
    console.error('Rename Chat Error:', err);
    return false;
  }
});

ipcMain.handle('load-chat', async (event, sessionId) => {
  try {
    const filePath = path.join(app.getPath('userData'), 'chats', `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('Load Chat Error:', err);
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
    const filePath = path.join(app.getPath('userData'), 'chats', `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Delete Chat Error:', err);
    return false;
  }
});

ipcMain.handle('parse-file', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    
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
    console.error('File Parse Error:', err);
    return `Error parsing file: ${err.message}`;
  }
});

// Parse file from raw buffer bytes (used by drag-and-drop in renderer)
ipcMain.handle('parse-file-buffer', async (event, ext, byteArray) => {
  try {
    const buffer = Buffer.from(byteArray);

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
    console.error('File Buffer Parse Error:', err);
    return `Error parsing file: ${err.message}`;
  }
});

ipcMain.handle('unload-models', async (event, hostUrl) => {
  try {
    const url = hostUrl.replace(/\/$/, '');
    const psRes = await fetch(`${url}/api/ps`);
    const data = await psRes.json();
    
    if (data.models) {
      for (const m of data.models) {
        await fetch(`${url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name, keep_alive: 0 })
        });
      }
    }
    return true;
  } catch (err) {
    console.error('Unload Error:', err);
    return false;
  }
});
