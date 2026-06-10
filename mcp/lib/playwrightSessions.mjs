import os from 'os';
import { chromium } from 'playwright-core';
import { clampNumber, randomId } from './security.mjs';

const sessions = new Map();
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function resolveExecutablePath(overridePath) {
  if (typeof overridePath === 'string' && overridePath.trim()) return overridePath.trim();
  if (typeof process.env.MCP_PLAYWRIGHT_EXECUTABLE === 'string' && process.env.MCP_PLAYWRIGHT_EXECUTABLE.trim()) {
    return process.env.MCP_PLAYWRIGHT_EXECUTABLE.trim();
  }
  if (os.platform() === 'win32') {
    return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  }
  return '/usr/bin/google-chrome';
}

function sessionSummary(session) {
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    activePageId: session.activePageId,
    pageCount: session.pages.size,
    headless: session.headless,
    exited: session.exited
  };
}

function pageSummary(pageRec) {
  return {
    pageId: pageRec.id,
    createdAt: pageRec.createdAt,
    lastActivityAt: pageRec.lastActivityAt,
    title: pageRec.title,
    url: pageRec.url,
    closed: pageRec.closed
  };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown browser session: ${sessionId}`);
  }
  if (session.exited) {
    throw new Error(`Browser session has exited: ${sessionId}`);
  }
  return session;
}

function getPageRecord(session, pageId) {
  const chosenId = pageId || session.activePageId;
  if (!chosenId) throw new Error('No active browser page found.');
  const rec = session.pages.get(chosenId);
  if (!rec || rec.closed) {
    throw new Error(`Unknown browser page: ${chosenId}`);
  }
  return rec;
}

async function createPageRecord(session, options = {}) {
  const page = await session.context.newPage();
  const id = randomId('page');
  const rec = {
    id,
    page,
    createdAt: nowIso(),
    lastActivityAt: nowIso(),
    title: '',
    url: 'about:blank',
    closed: false
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      rec.url = page.url();
      rec.lastActivityAt = nowIso();
      session.lastActivityAt = nowIso();
    }
  });
  page.on('close', () => {
    rec.closed = true;
    rec.lastActivityAt = nowIso();
    session.lastActivityAt = nowIso();
    if (session.activePageId === id) {
      const replacement = Array.from(session.pages.values()).find((it) => !it.closed && it.id !== id);
      session.activePageId = replacement ? replacement.id : null;
    }
  });

  session.pages.set(id, rec);
  session.activePageId = id;

  if (typeof options.url === 'string' && options.url.trim()) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: clampNumber(options.timeoutMs, 1000, 60_000, 30_000) });
  }

  rec.url = page.url();
  try {
    rec.title = await page.title();
  } catch {
    rec.title = '';
  }
  return rec;
}

export async function createBrowserSession(options = {}) {
  const headless = options.headless !== false;
  const executablePath = resolveExecutablePath(options.executablePath);
  const browser = await chromium.launch({ executablePath, headless });
  const context = await browser.newContext({
    userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: options.viewport || { width: 1280, height: 800 },
    acceptDownloads: true
  });

  const id = randomId('browser');
  const session = {
    id,
    browser,
    context,
    pages: new Map(),
    activePageId: null,
    startedAt: nowIso(),
    lastActivityAt: nowIso(),
    headless,
    exited: false
  };

  sessions.set(id, session);

  const firstPage = await createPageRecord(session, options.firstPage || {});
  return {
    session: sessionSummary(session),
    page: pageSummary(firstPage)
  };
}

export function listBrowserSessions() {
  return Array.from(sessions.values()).map(sessionSummary);
}

export async function closeBrowserSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { sessionId, closed: false, missing: true };
  }
  session.exited = true;
  try {
    await session.context.close();
  } catch {
    // ignore
  }
  try {
    await session.browser.close();
  } catch {
    // ignore
  }
  sessions.delete(sessionId);
  return { sessionId, closed: true };
}

export async function closeAllBrowserSessions() {
  const ids = Array.from(sessions.keys());
  for (const id of ids) {
    await closeBrowserSession(id);
  }
  return ids;
}

export async function createBrowserPage(sessionId, options = {}) {
  const session = getSession(sessionId);
  const rec = await createPageRecord(session, options);
  session.lastActivityAt = nowIso();
  return {
    session: sessionSummary(session),
    page: pageSummary(rec)
  };
}

export function listBrowserPages(sessionId) {
  const session = getSession(sessionId);
  const pages = Array.from(session.pages.values()).map(pageSummary);
  return {
    session: sessionSummary(session),
    pages
  };
}

export async function closeBrowserPage(sessionId, pageId) {
  const session = getSession(sessionId);
  const rec = getPageRecord(session, pageId);
  await rec.page.close();
  rec.closed = true;
  rec.lastActivityAt = nowIso();
  session.lastActivityAt = nowIso();
  return {
    session: sessionSummary(session),
    closedPageId: rec.id
  };
}

export function activateBrowserPage(sessionId, pageId) {
  const session = getSession(sessionId);
  const rec = getPageRecord(session, pageId);
  session.activePageId = rec.id;
  session.lastActivityAt = nowIso();
  rec.lastActivityAt = nowIso();
  return {
    session: sessionSummary(session),
    activePage: pageSummary(rec)
  };
}

export async function executeBrowserSessionAction(sessionId, options = {}) {
  const session = getSession(sessionId);
  const action = String(options.action || '').toLowerCase();
  const rec = getPageRecord(session, options.pageId || session.activePageId);
  const page = rec.page;
  const timeout = clampNumber(options.timeoutMs, 1000, 60_000, 15_000);

  let result = '';
  const payload = {};

  switch (action) {
    case 'goto':
      await page.goto(String(options.url || ''), { waitUntil: 'domcontentloaded', timeout });
      result = `Navigated to ${String(options.url || '')}`;
      break;
    case 'click':
      await page.click(String(options.selector || ''), { timeout });
      result = `Clicked ${String(options.selector || '')}`;
      break;
    case 'type':
      await page.fill(String(options.selector || ''), String(options.text || ''), { timeout });
      result = `Typed text into ${String(options.selector || '')}`;
      break;
    case 'press':
      await page.press(String(options.selector || 'body'), String(options.key || 'Enter'), { timeout });
      result = `Pressed ${String(options.key || 'Enter')}`;
      break;
    case 'scroll':
      if (typeof options.selector === 'string' && options.selector.trim()) {
        await page.locator(options.selector).scrollIntoViewIfNeeded({ timeout });
        result = `Scrolled to ${options.selector}`;
      } else {
        await page.evaluate((dir) => window.scrollBy(0, dir === 'down' ? 500 : -500), String(options.text || 'down'));
        result = `Scrolled ${String(options.text || 'down')}`;
      }
      break;
    case 'wait':
      if (typeof options.wait_for === 'string' && options.wait_for.startsWith('http')) {
        await page.waitForURL(options.wait_for, { timeout });
      } else if (typeof options.wait_for === 'string' && options.wait_for.trim()) {
        await page.waitForSelector(options.wait_for, { timeout });
      } else {
        await page.waitForTimeout(clampNumber(options.ms || options.text, 100, 60_000, 2_000));
      }
      result = 'Wait completed';
      break;
    case 'back':
      await page.goBack({ timeout, waitUntil: 'domcontentloaded' });
      result = 'Navigated back';
      break;
    case 'forward':
      await page.goForward({ timeout, waitUntil: 'domcontentloaded' });
      result = 'Navigated forward';
      break;
    case 'reload':
      await page.reload({ timeout, waitUntil: 'domcontentloaded' });
      result = 'Reloaded page';
      break;
    case 'evaluate': {
      const evalRes = await page.evaluate(String(options.script || ''));
      payload.evaluation = evalRes;
      result = `Evaluation result: ${JSON.stringify(evalRes)}`;
      break;
    }
    case 'screenshot': {
      const screenshot = await page.screenshot({
        encoding: 'base64',
        fullPage: Boolean(options.fullPage)
      });
      payload.screenshot = `data:image/png;base64,${screenshot}`;
      result = 'Captured screenshot';
      break;
    }
    case 'content':
      payload.content = await page.content();
      result = 'Captured HTML content';
      break;
    case 'extract-text': {
      const innerText = await page.evaluate(() => document.body.innerText);
      payload.text = innerText.substring(0, 10000);
      result = 'Extracted text content';
      break;
    }
    case 'set-headers': {
      const headers = options.headers && typeof options.headers === 'object' ? options.headers : {};
      await session.context.setExtraHTTPHeaders(headers);
      result = 'Updated extra HTTP headers';
      break;
    }
    case 'get-cookies': {
      const cookies = await session.context.cookies();
      payload.cookies = cookies;
      result = `Read ${cookies.length} cookie(s)`;
      break;
    }
    case 'set-cookies': {
      const cookies = Array.isArray(options.cookies) ? options.cookies : [];
      if (cookies.length > 0) {
        await session.context.addCookies(cookies);
      }
      result = `Set ${cookies.length} cookie(s)`;
      break;
    }
    default:
      throw new Error(`Unknown browser action: ${action}`);
  }

  session.lastActivityAt = nowIso();
  rec.lastActivityAt = nowIso();
  rec.url = page.url();
  try {
    rec.title = await page.title();
  } catch {
    rec.title = '';
  }

  return {
    session: sessionSummary(session),
    page: pageSummary(rec),
    action,
    result,
    ...payload
  };
}

export function getBrowserRuntimeStatus() {
  const sessionList = listBrowserSessions();
  return {
    activeSessionCount: sessionList.length,
    sessions: sessionList
  };
}

export async function sweepIdleBrowserSessions() {
  const timeoutMs = clampNumber(process.env.MCP_BROWSER_IDLE_TIMEOUT_MS, 60_000, 24 * 60 * 60 * 1000, DEFAULT_IDLE_TIMEOUT_MS);
  const now = Date.now();
  const closed = [];
  for (const [id, session] of sessions.entries()) {
    const last = Date.parse(session.lastActivityAt);
    if (!Number.isFinite(last)) continue;
    if (now - last < timeoutMs) continue;
    await closeBrowserSession(id);
    closed.push(id);
  }
  return closed;
}
