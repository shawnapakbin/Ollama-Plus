/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { app, ipcMain } from 'electron';

/**
 * Simple logger that writes to stdout/stderr.
 * electron-updater accepts any object with info/warn/error methods.
 */
const log = {
  info: (...args) => console.log('[updater]', ...args),
  warn: (...args) => console.warn('[updater]', ...args),
  error: (...args) => console.error('[updater]', ...args)
};

// Configure logging for auto-updater
autoUpdater.logger = log;

/**
 * Valid state transitions for the auto-updater state machine.
 * Maps each state to its allowed next states.
 */
const VALID_TRANSITIONS = {
  'idle': ['checking'],
  'checking': ['update-available', 'idle'],
  'update-available': ['downloading', 'idle'],
  'downloading': ['downloaded', 'idle'],
  'downloaded': ['verifying'],
  'verifying': ['ready-to-install', 'idle'],
  'ready-to-install': ['installing', 'idle'],
  'installing': []
};

/**
 * Internal update state.
 * @type {{
 *   status: string,
 *   currentVersion: string,
 *   availableVersion: string | null,
 *   downloadProgress: { percent: number, transferred: number, total: number } | null,
 *   error: string | null,
 *   lastCheckAt: string | null,
 *   updateDeferredVersion: string | null
 * }}
 */
const state = {
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  downloadProgress: null,
  error: null,
  lastCheckAt: null,
  updateDeferredVersion: null
};

/** @type {BrowserWindow | null} */
let mainWindowRef = null;

/**
 * Transition the state machine to the next state if the transition is valid.
 * @param {string} nextState - The desired next state
 * @returns {boolean} Whether the transition was successful
 */
function transition(nextState) {
  const allowed = VALID_TRANSITIONS[state.status];
  if (allowed && allowed.includes(nextState)) {
    state.status = nextState;
    return true;
  }
  log.warn(`[updater] Invalid state transition: ${state.status} → ${nextState}`);
  return false;
}

/**
 * Safely send an IPC message to the renderer process.
 * @param {string} channel - IPC channel name
 * @param {object} payload - Data to send
 */
function sendToRenderer(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}

/**
 * Initialize the auto-updater and wire event handlers.
 * @param {BrowserWindow} mainWindow - The main application window for IPC communication
 */
export function initAutoUpdater(mainWindow) {
  mainWindowRef = mainWindow;
  state.currentVersion = app.getVersion();

  // Configure auto-updater settings
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Integrity verification: electron-updater verifies checksum/signature of
  // downloaded updates by default (verifyUpdateCodeSignature is enabled on Windows).
  // We explicitly do NOT disable it — this satisfies Requirement 8.6.

  // --- Event Handlers ---

  autoUpdater.on('checking-for-update', () => {
    transition('checking');
    state.lastCheckAt = new Date().toISOString();
  });

  autoUpdater.on('update-available', (info) => {
    if (transition('update-available')) {
      state.availableVersion = info.version;

      // If the user previously declined this version (dismissed from update-available
      // state), skip the notification until next application start (Req 8.2).
      // Note: deferred *downloaded* updates (dismissed from ready-to-install) are
      // re-offered via the update-downloaded event path, not here.
      if (state.updateDeferredVersion === info.version) {
        log.info(`[updater] Update ${info.version} was previously declined — skipping until next start`);
        transition('idle');
        return;
      }

      sendToRenderer('updater:update-available', {
        version: info.version,
        releaseDate: info.releaseDate || null
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    transition('idle');
  });

  autoUpdater.on('download-progress', (progress) => {
    state.downloadProgress = {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    };
    sendToRenderer('updater:download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (transition('downloaded')) {
      // Move through verifying state — electron-updater verifies integrity internally
      if (transition('verifying')) {
        // electron-updater already verified the checksum/signature before emitting this event
        if (transition('ready-to-install')) {
          // Always re-offer downloaded updates, even if previously deferred (Req 8.4).
          // Clear the deferred flag so the user is prompted again.
          if (state.updateDeferredVersion === info.version) {
            state.updateDeferredVersion = null;
          }
          sendToRenderer('updater:update-downloaded', {
            version: info.version
          });
        }
      }
    }
  });

  autoUpdater.on('error', (error) => {
    const message = error?.message || 'Unknown update error';
    state.error = message;

    // Classify the error to determine the appropriate response.
    const isNetworkError = /net::|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(message);
    const isIntegrityError = /signature|checksum|hash|verify|integrity|sha512|blockmap/i.test(message);
    const isDownloadError = /download|transfer|write EPIPE|ENOSPC/i.test(message) && !isIntegrityError;

    if (isNetworkError) {
      // Network errors: log silently, retry on next app start (Req 8.5)
      log.info(`[updater] Network error during update check (silent): ${message}`);
    } else if (isIntegrityError) {
      // Integrity verification failure: discard update, inform user, retry next start (Req 8.6)
      log.warn(`[updater] Integrity verification failed — update discarded: ${message}`);
      state.downloadProgress = null;
      sendToRenderer('updater:error', {
        message: 'Update integrity verification failed. The update has been discarded and will be re-downloaded on next start.'
      });
    } else if (isDownloadError) {
      // Download failure/interruption: discard partial, notify user, retry next start (Req 8.7)
      log.warn(`[updater] Download failed — partial download discarded: ${message}`);
      state.downloadProgress = null;
      sendToRenderer('updater:error', {
        message: 'Update download failed. It will be retried on next application start.'
      });
    } else {
      // Other errors: notify user with original message
      sendToRenderer('updater:error', { message });
    }

    // Return to idle on any error — fresh attempt on next app start
    transition('idle');
  });

  // --- IPC Handlers ---

  ipcMain.handle('updater:download-update', () => {
    // Only allow download when an update is available
    if (state.status !== 'update-available') {
      log.warn('[updater] Ignoring download request — no active update notification');
      return;
    }
    if (transition('downloading')) {
      autoUpdater.downloadUpdate();
    }
  });

  ipcMain.handle('updater:install-update', () => {
    // Only allow install when update is ready
    if (state.status !== 'ready-to-install') {
      log.warn('[updater] Ignoring install request — update not ready');
      return;
    }
    if (transition('installing')) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  ipcMain.handle('updater:dismiss', () => {
    // Only dismiss when there's something to dismiss
    if (state.status === 'update-available' || state.status === 'ready-to-install') {
      state.updateDeferredVersion = state.availableVersion;
      transition('idle');
    } else {
      log.warn('[updater] Ignoring dismiss — no active notification');
    }
  });

  // Perform initial update check on app start
  checkForUpdates();
}

/**
 * Trigger a manual update check (e.g., from a menu item).
 */
export function checkForUpdates() {
  if (state.status !== 'idle') {
    log.info(`[updater] Skipping update check — current state: ${state.status}`);
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    log.info(`[updater] Update check failed: ${err?.message || err}`);
  });
}

/**
 * Get the current updater state (useful for testing or diagnostics).
 * @returns {object} Current state snapshot
 */
export function getUpdaterState() {
  return { ...state };
}
