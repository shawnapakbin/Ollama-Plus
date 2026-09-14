/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildRunBlueprint, getGraphCatalog } from './graphCatalog.js';
import { executeRunLifecycle } from './graphExecutor.js';
import { enumerateGpus, DEFAULT_ENUMERATION_TIMEOUT_MS } from './gpuService.js';
import { normalizeGpuConfig } from './stateSchema.js';
import { DEFAULT_OLLAMA_BASE_URL, deriveInferenceOptions, listOllamaModels, normalizeOllamaBaseUrl, requestOllamaChat, requestOllamaChatStream } from './ollamaClient.js';
import {
  appendMemoryRecord,
  appendMessage,
  createRun,
  createSession,
  deleteMessage as deleteStoredMessage,
  deleteSession as deleteStoredSession,
  getChatConfig,
  getGpuConfig,
  getOllamaServerById,
  getRunById,
  getSessionById,
  listMemoryRecords as listStoredMemoryRecords,
  listMessages,
  listOllamaServers as listStoredOllamaServers,
  listRuns,
  listSessions,
  removeOllamaServer as removeStoredOllamaServer,
  renameSession as renameStoredSession,
  readRuntimeState,
  saveOllamaServer as saveStoredOllamaServer,
  updateMessage as updateStoredMessage,
  updateChatConfig,
  updateGpuConfig,
  updateRun
} from './runtimeStore.js';

function getBootstrapPlan() {
  return {
    pillars: [
      {
        id: 'langgraph',
        title: 'LangGraph runtime in Node',
        detail: 'Graph orchestration, checkpoints, and durable runs live behind Electron IPC instead of React hooks.'
      },
      {
        id: 'langchain',
        title: 'LangChain adapter boundary',
        detail: 'Models, tools, retrieval, and memory are exposed through a single adapter layer for local-first execution.'
      },
      {
        id: 'langflow',
        title: 'LangFlow inside the product',
        detail: 'Flow editing becomes an in-app surface bound to local graph definitions rather than a separate dev-only artifact.'
      },
      {
        id: 'langsmith',
        title: 'Optional LangSmith observability',
        detail: 'Tracing, prompts, and dataset evaluations attach when configured, without changing offline execution.'
      }
    ],
    milestones: [
      'Replace renderer-owned chat orchestration with a Node-side runtime service.',
      'Add local checkpoint persistence for resumable sessions and approvals.',
      'Introduce the first chat graph with model, tool, and memory nodes.',
      'Embed flow authoring and optional LangSmith tracing.'
    ]
  };
}

function normalizeApprovalDecision(decision) {
  const operator = typeof decision?.operator === 'string' && decision.operator.trim()
    ? decision.operator.trim().slice(0, 80)
    : 'unknown-operator';
  const operatorRole = typeof decision?.operatorRole === 'string' && decision.operatorRole.trim()
    ? decision.operatorRole.trim().slice(0, 80)
    : 'runtime-reviewer';
  const reason = typeof decision?.reason === 'string' && decision.reason.trim()
    ? decision.reason.trim().slice(0, 300)
    : 'No reason provided.';

  return {
    operator,
    operatorRole,
    reason
  };
}

function pickTitleCandidate(content) {
  if (typeof content !== 'string') return '';
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const labeled = lines.find((line) => /^title\s*:/i.test(line));
  const raw = labeled ? labeled.replace(/^title\s*:/i, '').trim() : lines[0];
  return raw.replace(/^["']|["']$/g, '').trim().slice(0, 80);
}

function ensureRunFinalizedFooter(output, completedAt) {
  const footer = `Run finalized at ${completedAt}`;
  if (typeof output === 'string' && output.includes('Run finalized at')) {
    return output;
  }
  const base = typeof output === 'string' && output.trim() ? output.trim() : '';
  return base ? `${base}\n${footer}` : footer;
}

function toNonNegativeIntegerSet(values) {
  const result = new Set();
  if (!Array.isArray(values)) return result;
  for (const value of values) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0) {
      result.add(index);
    }
  }
  return result;
}

/**
 * Reconcile a persisted GpuConfig against the set of currently detected device
 * indices, producing the effective selection used for display and inference
 * derivation. This is a pure function: it never writes to the store and does
 * not mutate either input (Requirement 5.5).
 *
 * Reconciliation rules (design "Reconciliation rules", Requirements 3.5-3.9,
 * 5.1-5.3, 5.6):
 *   1. available = allowedIndices ∩ detected; unavailable = allowedIndices \ detected.
 *   2. Unset sentinel (empty allowedIndices, cpuOnly=false) or unreadable config
 *      → mode: 'all' (default-to-all).
 *   3. cpuOnly === true → mode: 'cpu-only' regardless of detection (sticky, R5.6).
 *   4. Otherwise, non-empty available → mode: 'subset' with the available indices
 *      (single-device retention R3.8, partial availability R5.3).
 *   5. Otherwise (explicit selection, none currently detected) → mode: 'cpu-only'
 *      for this session (R5.2); the persisted config is left unchanged.
 *
 * @param {{ allowedIndices?: number[], cpuOnly?: boolean } | null | undefined} config
 * @param {Iterable<number> | null | undefined} detectedIndices
 * @returns {{ mode: 'all' | 'subset' | 'cpu-only', availableIndices: number[], unavailableIndices: number[] }}
 */
export function reconcileSelection(config, detectedIndices) {
  // normalizeGpuConfig coerces absent/unreadable/malformed input into the unset
  // sentinel ({ allowedIndices: [], cpuOnly: false }), covering rule 2's
  // "unreadable" branch (Requirement 3.5).
  const normalized = normalizeGpuConfig(config);
  const allowed = normalized.allowedIndices;
  const detected = toNonNegativeIntegerSet(detectedIndices);

  const availableIndices = allowed.filter((index) => detected.has(index));
  const unavailableIndices = allowed.filter((index) => !detected.has(index));

  // Rule 3: intentional CPU-only is sticky and takes precedence over detection.
  if (normalized.cpuOnly) {
    return { mode: 'cpu-only', availableIndices, unavailableIndices };
  }

  // Rule 2: unset sentinel (no explicit device choice) defaults to allow-all.
  if (allowed.length === 0) {
    return { mode: 'all', availableIndices, unavailableIndices };
  }

  // Rule 4: an explicit selection with at least one currently-detected device
  // runs on exactly those devices (single-device retention, partial availability).
  if (availableIndices.length > 0) {
    return { mode: 'subset', availableIndices, unavailableIndices };
  }

  // Rule 5: an explicit selection whose devices have all vanished falls back to
  // CPU-only for this session, leaving the persisted config untouched.
  return { mode: 'cpu-only', availableIndices, unavailableIndices };
}

/**
 * Default real GPU-probe spawn implementation. `enumerateGpus` invokes this
 * once per probe strategy with a `(command, args)` pair and expects a
 * spawn-like result `{ status, stdout, stderr, error }`. We wrap the
 * synchronous `spawnSync` in a resolved promise so it satisfies the async
 * `spawnImpl` contract without blocking on a separate process abstraction, and
 * bound each individual probe with a per-spawn timeout — the same
 * `spawnSync(..., { timeout })` precedent used for the MCP tool probes in
 * `electron/main.js`. The overall enumeration is additionally raced against
 * `enumerateGpus`'s own `timeoutMs` bound.
 *
 * `spawnSync` never throws for a missing/failed binary; it reports the failure
 * on `result.error`, which `enumerateGpus` treats as a failed probe. We keep
 * `windowsHide` on so no console window flashes on Windows.
 *
 * @param {number} perSpawnTimeoutMs Per-probe timeout in milliseconds.
 * @returns {(command: string, args: string[]) => Promise<{ status?: number, stdout?: string, stderr?: string, error?: Error }>}
 */
function createDefaultGpuSpawnImpl(perSpawnTimeoutMs) {
  return (command, args) => {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: perSpawnTimeoutMs
    });
    return Promise.resolve({
      status: result.status,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      error: result.error
    });
  };
}

export function createRuntimeService(config) {
  const {
    statePath,
    appVersion,
    mode,
    workspaceRoot,
    versions,
    langsmithConfigured,
    fetchImpl = globalThis.fetch,
    defaultOllamaEndpoint = DEFAULT_OLLAMA_BASE_URL,
    // GPU enumeration dependencies are injectable so the service is testable
    // without real hardware or a real clock. In production they default to the
    // real `enumerateGpus` driven by a bounded `spawnSync` probe.
    gpuPlatform = process.platform,
    gpuEnumerationTimeoutMs = DEFAULT_ENUMERATION_TIMEOUT_MS,
    gpuSpawnImpl = createDefaultGpuSpawnImpl(gpuEnumerationTimeoutMs),
    enumerateGpusImpl = enumerateGpus
  } = config;

  /**
   * Enumerate the host's GPUs via the injected enumeration implementation,
   * passing through the injected spawn implementation, platform, and timeout.
   * @returns {Promise<{ ok: true, gpus: { index: number, name: string }[] } | { ok: false, error: string, kind: 'timeout' | 'unavailable' }>}
   */
  function runGpuEnumeration() {
    return enumerateGpusImpl({
      spawnImpl: gpuSpawnImpl,
      platform: gpuPlatform,
      timeoutMs: gpuEnumerationTimeoutMs
    });
  }

  /**
   * Derive the `/api/chat` GPU `options` fragment for the current chat request
   * (Requirements 4.1, 4.5, 4.6). This reconciles the persisted GpuConfig
   * against the currently detected devices and translates the effective
   * selection into request options via the pure `deriveInferenceOptions`.
   *
   * The whole derivation is guarded: if enumeration, config loading,
   * reconciliation, or derivation throws, we treat the GPU selection as
   * underivable — passing `gpuOptions = null` (server default device behavior)
   * and logging the derivation issue (Requirement 4.6).
   *
   * The returned `gpuOptions` is either a non-empty options fragment (to be
   * merged as `body.options`) or `null`. An empty fragment (the `mode: 'all'`
   * case, and the not-applied case) is normalized to `null` so the outgoing
   * body omits `options` entirely and remains byte-identical to a GPU-less
   * request (design "buildChatBody"/Requirement 4.4).
   *
   * `applied` is `false` when a non-CPU selection could not be translated into
   * valid options (Requirement 4.5) or when derivation threw (Requirement 4.6),
   * so the caller can surface a "GPU selection could not be applied" indication.
   *
   * @returns {{ gpuOptions: { num_gpu?: number, main_gpu?: number } | null, applied: boolean, reason?: string }}
   */
  async function deriveGpuOptionsForRequest() {
    try {
      const detection = await runGpuEnumeration();
      const detectedIndices = detection.ok ? detection.gpus.map((gpu) => gpu.index) : [];
      const detectedCount = detection.ok ? detection.gpus.length : 0;

      const config = normalizeGpuConfig(getGpuConfig(statePath));
      const effective = reconcileSelection(config, detectedIndices);

      const { options, applied, reason } = deriveInferenceOptions(effective, detectedCount);

      // Omit `options` entirely for an empty fragment so the outgoing body is
      // byte-identical to a GPU-less request (Requirement 4.4). A populated
      // fragment (cpu-only num_gpu:0, or subset main_gpu:index) is passed
      // through to be merged as body.options.
      const gpuOptions = options && Object.keys(options).length > 0 ? options : null;

      return { gpuOptions, applied, reason };
    } catch (error) {
      // Derivation failed entirely: fall back to server default device
      // behavior and log the derivation issue (Requirement 4.6).
      console.error('[runtimeService] Failed to derive GPU inference options; using server defaults.', error);
      return { gpuOptions: null, applied: false, reason: 'derivation-error' };
    }
  }

  return {
    getStatus() {
      const state = readRuntimeState(statePath);
      const latestSession = listSessions(statePath)[0] ?? null;
      return {
        appVersion,
        electronVersion: versions.electron,
        chromeVersion: versions.chrome,
        nodeVersion: versions.node,
        mode,
        workspaceRoot,
        runtimeStoragePath: statePath,
        langsmith: {
          configured: langsmithConfigured,
          mode: langsmithConfigured ? 'optional-enabled' : 'optional-disabled'
        },
        capabilities: {
          offlineFirst: true,
          langGraphRuntime: 'bootstrap',
          langChainAdapters: 'bootstrap',
          langFlowSurface: 'planned',
          approvalCheckpoints: 'bootstrap',
          durableRuns: 'bootstrap'
        },
        sessionCount: state.sessions.length,
        latestSessionAt: latestSession?.updatedAt ?? null,
        runCount: state.runs.length
      };
    },

    getBootstrapPlan,

    getGraphCatalog() {
      return getGraphCatalog();
    },

    listSessions() {
      return listSessions(statePath);
    },

    createSession(title) {
      return createSession(statePath, title);
    },

    renameSession(sessionId, title) {
      return renameStoredSession(statePath, sessionId, title);
    },

    async renameSessionWithAi(sessionId, input = {}) {
      const session = getSessionById(statePath, sessionId);
      if (!session) {
        throw new Error(`Cannot rename unknown session: ${sessionId}`);
      }

      const transcript = listMessages(statePath, session.id)
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join('\n');

      const currentConfig = getChatConfig(statePath);
      const endpoint = normalizeOllamaBaseUrl(input?.endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint);
      const model = typeof input?.model === 'string' && input.model.trim()
        ? input.model.trim()
        : currentConfig.model;
      if (!model) {
        throw new Error('No Ollama model selected. Refresh models and choose one before renaming a session.');
      }

      const response = await requestOllamaChat(fetchImpl, {
        endpoint,
        model,
        messages: [
          {
            role: 'system',
            content: 'Return a concise title for this chat. Output exactly one line in the format: Title: <title>'
          },
          {
            role: 'user',
            content: transcript || session.title
          }
        ]
      });

      const title = pickTitleCandidate(response.content) || session.title;
      const renamed = renameStoredSession(statePath, session.id, title);

      updateChatConfig(statePath, (current) => ({
        ...current,
        endpoint: response.endpoint,
        model: response.model
      }));

      return {
        session: renamed,
        title: renamed.title,
        endpoint: response.endpoint,
        model: response.model
      };
    },

    deleteSession(sessionId) {
      return deleteStoredSession(statePath, sessionId);
    },

    listRuns(sessionId) {
      return listRuns(statePath, sessionId);
    },

    listMessages(sessionId) {
      return listMessages(statePath, sessionId);
    },

    updateMessage(messageId, input = {}) {
      return updateStoredMessage(statePath, messageId, input);
    },

    deleteMessage(messageId) {
      return deleteStoredMessage(statePath, messageId);
    },

    listOllamaServers() {
      return listStoredOllamaServers(statePath);
    },

    saveOllamaServer(input = {}) {
      const endpoint = normalizeOllamaBaseUrl(input.endpoint ?? '');
      return saveStoredOllamaServer(statePath, {
        id: input.id,
        label: input.label,
        endpoint
      });
    },

    removeOllamaServer(serverId) {
      return removeStoredOllamaServer(statePath, serverId);
    },

    async checkOllamaServer(serverId) {
      const server = getOllamaServerById(statePath, serverId);
      if (!server) {
        throw new Error(`Cannot check unknown Ollama server: ${serverId}`);
      }

      const checkedAt = new Date().toISOString();
      try {
        const result = await listOllamaModels(fetchImpl, server.endpoint);
        return {
          ...server,
          endpoint: result.endpoint,
          status: 'online',
          models: result.models,
          checkedAt,
          error: null
        };
      } catch (error) {
        return {
          ...server,
          status: 'offline',
          models: [],
          checkedAt,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    listMemoryRecords(sessionId) {
      return listStoredMemoryRecords(statePath, sessionId);
    },

    getChatConfig() {
      return getChatConfig(statePath);
    },

    saveChatConfig(input = {}) {
      return updateChatConfig(statePath, (current) => ({
        ...current,
        endpoint: input.endpoint ?? current.endpoint ?? defaultOllamaEndpoint,
        model: input.model ?? current.model ?? '',
        systemPrompt: input.systemPrompt ?? current.systemPrompt ?? ''
      }));
    },

    /**
     * Enumerate the GPUs currently reported by the host. This is a thin
     * pass-through to the GPU_Service's `enumerateGpus` (Requirement 1.1):
     * the runtimeService owns the injected spawn/platform/timeout dependencies
     * and returns the discriminated `EnumerationResult` unchanged. It performs
     * no persistence and no reconciliation.
     *
     * @returns {Promise<{ ok: true, gpus: { index: number, name: string }[] } | { ok: false, error: string, kind: 'timeout' | 'unavailable' }>}
     */
    getDetectedGpus() {
      return runGpuEnumeration();
    },

    /**
     * Assemble the reconciled GPU selection state delivered to the UI
     * (Requirements 3.4, 3.7, 5.1, 5.4, 6.1, 6.5, 6.6). This method:
     *   1. enumerates the currently detected devices (GPU_Service),
     *   2. loads the persisted `GpuConfig` (Requirement 3.4),
     *   3. reconciles the two into an `EffectiveSelection` via the pure
     *      `reconcileSelection` (Requirements 3.7, 5.1, 5.4),
     * and returns `{ detection, config, effective, appliedStateAvailable }`.
     *
     * Reconciliation is read-only: this method never writes to the store
     * (Requirement 5.5). The persisted `config` is reported verbatim so the UI
     * can render per-device applied allowed/disallowed state (Requirement 6.1)
     * and the unavailable-device list from `effective.unavailableIndices`
     * (Requirement 5.4).
     *
     * `appliedStateAvailable` is the retain-last-state signal (Requirements
     * 6.5, 6.6): it is `true` only when the applied state was fully determined
     * for this retrieval, and `false` when it could not be (so the UI retains
     * its last successfully displayed state and shows a retrieval-problem
     * indication that clears on the next successful retrieval). Detection is
     * only one input; the applied state also depends on reading the persisted
     * config, so a config-read failure sets the flag to `false` even when
     * detection succeeded. A detection error itself does not by itself make the
     * applied state indeterminable — the effective mode still defaults to
     * `'all'` when the detected set is empty — so detection failures are
     * surfaced through `detection`, while `appliedStateAvailable` guards the
     * cases where the state genuinely could not be assembled.
     *
     * @returns {Promise<{
     *   detection: { ok: true, gpus: { index: number, name: string }[] } | { ok: false, error: string, kind: 'timeout' | 'unavailable' },
     *   config: { allowedIndices: number[], cpuOnly: boolean },
     *   effective: { mode: 'all' | 'subset' | 'cpu-only', availableIndices: number[], unavailableIndices: number[] },
     *   appliedStateAvailable: boolean
     * }>}
     */
    async getGpuSelectionState() {
      const detection = await runGpuEnumeration();

      // The detected indices bound reconciliation. On an enumeration error the
      // detected set is empty (no partial list is ever returned, Requirement
      // 1.4), so a stale explicit selection reconciles to cpu-only and an unset
      // config still defaults to allow-all.
      const detectedIndices = detection.ok
        ? detection.gpus.map((gpu) => gpu.index)
        : [];

      let config;
      let appliedStateAvailable = true;
      try {
        // Load the persisted GpuConfig (Requirement 3.4). normalizeGpuConfig
        // (inside reconcileSelection and here) coerces an absent/unreadable
        // value into the unset sentinel, but a thrown read is a genuine
        // inability to determine the applied state.
        config = normalizeGpuConfig(getGpuConfig(statePath));
      } catch {
        // The persisted config could not be read: the applied state cannot be
        // determined. Fall back to the unset sentinel for a best-effort
        // effective view and flag the retrieval problem (Requirement 6.5).
        config = normalizeGpuConfig();
        appliedStateAvailable = false;
      }

      const effective = reconcileSelection(config, detectedIndices);

      return {
        detection,
        config,
        effective,
        appliedStateAvailable
      };
    },

    /**
     * Validate and persist a proposed GPU selection (Requirements 2.5-2.8,
     * 3.2, 3.3). The flow is:
     *   1. Enumerate the currently detected devices and build the detected
     *      index set (the same enumeration path used by getGpuSelectionState).
     *   2. Normalize the proposed indices to non-negative integers so
     *      validation and persistence operate on clean input.
     *   3. Validate every requested index against the detected set. If any
     *      requested index is not currently detected, reject with
     *      { ok: false, reason: 'unavailable-device', unavailableIndices }
     *      BEFORE touching the store, leaving the persisted config unchanged
     *      (Requirement 2.7, 5.5).
     *   4. Treat an empty allowed set (after normalization) as intentional
     *      CPU-only (Requirement 2.5): persist { allowedIndices: [], cpuOnly:
     *      true } so it reconciles to the sticky cpu-only mode rather than the
     *      unset "allow-all" sentinel.
     *   5. Persist via updateGpuConfig. A thrown persist is caught and
     *      surfaced as { ok: false, reason: 'persist-failed' }; because the
     *      write never completed the previously persisted config is retained
     *      unchanged (Requirements 2.8, 3.2, 3.3).
     *
     * On success returns { ok: true, config, cpuOnly } where config is the
     * normalized, persisted GpuConfig and cpuOnly reflects whether the saved
     * selection is intentional CPU-only.
     *
     * @param {{ allowedIndices?: number[], cpuOnly?: boolean }} [input]
     * @returns {Promise<{ ok: true, config: { allowedIndices: number[], cpuOnly: boolean }, cpuOnly: boolean }
     *   | { ok: false, reason: 'unavailable-device', unavailableIndices: number[] }
     *   | { ok: false, reason: 'persist-failed' }>}
     */
    async saveGpuSelection(input = {}) {
      const detection = await runGpuEnumeration();
      const detectedIndices = detection.ok
        ? toNonNegativeIntegerSet(detection.gpus.map((gpu) => gpu.index))
        : new Set();

      // Normalize proposed indices to a clean, deduplicated non-negative
      // integer list before validating and persisting.
      const requestedIndices = [];
      const seen = new Set();
      if (Array.isArray(input?.allowedIndices)) {
        for (const value of input.allowedIndices) {
          const index = Number(value);
          if (!Number.isInteger(index) || index < 0) continue;
          if (seen.has(index)) continue;
          seen.add(index);
          requestedIndices.push(index);
        }
      }

      // Validate every requested index against the currently detected set
      // before touching the store (Requirement 2.6/2.7).
      const unavailableIndices = requestedIndices.filter((index) => !detectedIndices.has(index));
      if (unavailableIndices.length > 0) {
        return { ok: false, reason: 'unavailable-device', unavailableIndices };
      }

      // An empty allowed set is intentional CPU-only (Requirement 2.5); a
      // non-empty set is an explicit GPU selection.
      const cpuOnly = requestedIndices.length === 0;
      const proposedConfig = { allowedIndices: requestedIndices, cpuOnly };

      try {
        const config = updateGpuConfig(statePath, () => proposedConfig);
        return { ok: true, config, cpuOnly: config.cpuOnly };
      } catch {
        // The write never completed, so the previously persisted config is
        // retained unchanged (Requirements 2.8, 3.2, 3.3).
        return { ok: false, reason: 'persist-failed' };
      }
    },

    async listOllamaModels(endpoint) {
      const currentConfig = getChatConfig(statePath);
      const requestedEndpoint = endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint;
      const result = await listOllamaModels(fetchImpl, requestedEndpoint);
      const selectedModel = currentConfig.model && result.models.some((model) => model.name === currentConfig.model)
        ? currentConfig.model
        : result.models[0]?.name ?? '';

      const nextConfig = updateChatConfig(statePath, (current) => ({
        ...current,
        endpoint: result.endpoint,
        model: selectedModel
      }));

      return {
        ...nextConfig,
        availableModels: result.models
      };
    },

    ensureSession() {
      const existing = listSessions(statePath)[0];
      if (existing) return existing;
      return createSession(statePath, 'Primary rebuild session');
    },

    async sendChatMessage(input) {
      const content = typeof input?.content === 'string' ? input.content.trim() : '';
      if (!content) {
        throw new Error('Enter a message before sending it to Ollama.');
      }

      const session = input?.sessionId
        ? getSessionById(statePath, input.sessionId) ?? this.ensureSession()
        : this.ensureSession();

      const currentConfig = getChatConfig(statePath);
      const endpoint = normalizeOllamaBaseUrl(input?.endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint);
      const model = typeof input?.model === 'string' && input.model.trim()
        ? input.model.trim()
        : currentConfig.model;

      if (!model) {
        throw new Error('No Ollama model selected. Refresh models and choose one before sending a message.');
      }

      const userMessage = appendMessage(statePath, {
        sessionId: session.id,
        role: 'user',
        content,
        model,
        endpoint
      });

      const transcript = listMessages(statePath, session.id)
        .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
        .map((message) => ({
          role: message.role,
          content: message.content
        }));

      // Derive the GPU options for this request from the reconciled selection
      // (Requirements 4.1, 4.5, 4.6). A null gpuOptions falls back to server
      // default device behavior; `applied === false` means the GPU selection
      // could not be applied and is surfaced on the returned result.
      const gpuDerivation = await deriveGpuOptionsForRequest();

      const response = await requestOllamaChat(fetchImpl, {
        endpoint,
        model,
        messages: transcript,
        gpuOptions: gpuDerivation.gpuOptions
      });

      const assistantMessage = appendMessage(statePath, {
        sessionId: session.id,
        role: 'assistant',
        content: response.content,
        model: response.model,
        endpoint: response.endpoint,
        metrics: response.metrics
      });

      updateChatConfig(statePath, (current) => ({
        ...current,
        endpoint: response.endpoint,
        model: response.model
      }));

      return {
        sessionId: session.id,
        endpoint: response.endpoint,
        model: response.model,
        userMessage,
        assistantMessage,
        messages: listMessages(statePath, session.id),
        // Surface the not-applied indication so the UI can inform the user that
        // their GPU selection could not be applied (Requirement 4.5).
        gpuSelectionApplied: gpuDerivation.applied
      };
    },

    async sendChatMessageStream(input, emit) {
      const content = typeof input?.content === 'string' ? input.content.trim() : '';
      if (!content) {
        throw new Error('Enter a message before sending it to Ollama.');
      }

      const session = input?.sessionId
        ? getSessionById(statePath, input.sessionId) ?? this.ensureSession()
        : this.ensureSession();

      const currentConfig = getChatConfig(statePath);
      const endpoint = normalizeOllamaBaseUrl(input?.endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint);
      const model = typeof input?.model === 'string' && input.model.trim()
        ? input.model.trim()
        : currentConfig.model;
      const requestId = typeof input?.requestId === 'string' && input.requestId.trim()
        ? input.requestId.trim()
        : randomUUID();

      if (!model) {
        throw new Error('No Ollama model selected. Refresh models and choose one before sending a message.');
      }

      const userMessage = appendMessage(statePath, {
        sessionId: session.id,
        role: 'user',
        content,
        model,
        endpoint
      });

      emit?.({
        type: 'started',
        requestId,
        sessionId: session.id,
        model,
        endpoint,
        userMessage
      });

      const transcript = listMessages(statePath, session.id)
        .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
        .map((message) => ({
          role: message.role,
          content: message.content
        }));

      // Derive the GPU options for this request from the reconciled selection
      // (Requirements 4.1, 4.5, 4.6). A null gpuOptions falls back to server
      // default device behavior; `applied === false` means the GPU selection
      // could not be applied and is surfaced on the completion emit/result.
      const gpuDerivation = await deriveGpuOptionsForRequest();

      try {
        const response = await requestOllamaChatStream(fetchImpl, {
          endpoint,
          model,
          messages: transcript,
          gpuOptions: gpuDerivation.gpuOptions
        }, {
          onToken: (delta) => {
            emit?.({
              type: 'token',
              requestId,
              sessionId: session.id,
              delta,
              model,
              endpoint
            });
          }
        });

        const assistantMessage = appendMessage(statePath, {
          sessionId: session.id,
          role: 'assistant',
          content: response.content,
          model: response.model,
          endpoint: response.endpoint,
          metrics: response.metrics
        });

        updateChatConfig(statePath, (current) => ({
          ...current,
          endpoint: response.endpoint,
          model: response.model
        }));

        const result = {
          sessionId: session.id,
          requestId,
          endpoint: response.endpoint,
          model: response.model,
          userMessage,
          assistantMessage,
          messages: listMessages(statePath, session.id),
          // Surface the not-applied indication so the UI can inform the user
          // that their GPU selection could not be applied (Requirement 4.5).
          gpuSelectionApplied: gpuDerivation.applied
        };

        emit?.({
          type: 'completed',
          requestId,
          sessionId: session.id,
          assistantMessage,
          model: response.model,
          endpoint: response.endpoint,
          metrics: response.metrics,
          gpuSelectionApplied: gpuDerivation.applied
        });

        return result;
      } catch (error) {
        emit?.({
          type: 'error',
          requestId,
          sessionId: session.id,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    },

    resumeRun(runId) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot resume unknown run: ${runId}`);
      }

      if (targetRun.status === 'completed' || targetRun.status === 'failed' || targetRun.status === 'canceled') {
        throw new Error(`Cannot resume run in terminal state: ${targetRun.status}`);
      }

      if (targetRun.status === 'waiting_approval') {
        throw new Error('Cannot resume run while waiting for approval. Approve or deny first.');
      }

      return updateRun(statePath, runId, (run) => {
        const startedAt = run.startedAt ?? new Date().toISOString();
        const events = Array.isArray(run.events) ? run.events.slice() : [];
        const runningIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'running');
        if (runningIndex >= 0) {
          return {
            status: 'running',
            events,
            nextAction: `Advance checkpoint ${run.checkpoints[runningIndex].order} to continue execution.`,
            startedAt
          };
        }

        const readyIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'ready');
        const pendingIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'pending');
        const activateIndex = readyIndex >= 0 ? readyIndex : pendingIndex;

        if (activateIndex === -1) {
          return {
            status: 'completed',
            summary: `${run.graphName} completed with all checkpoints finalized.`,
            nextAction: 'Run finished. Plan a new run to execute again.',
            completedAt: new Date().toISOString(),
            startedAt
          };
        }

        const checkpoints = run.checkpoints.map((checkpoint, index) => {
          if (index === activateIndex) {
            return {
              ...checkpoint,
              status: 'running'
            };
          }
          return checkpoint;
        });
        events.push(`Started checkpoint ${checkpoints[activateIndex].order}: ${checkpoints[activateIndex].title}`);

        return {
          status: 'running',
          checkpoints,
          events,
          pendingApproval: null,
          nextAction: `Checkpoint ${checkpoints[activateIndex].order} is running. Advance when ready.`,
          startedAt
        };
      });
    },

    stepRun(runId) {
      const currentRun = getRunById(statePath, runId);
      if (!currentRun) {
        throw new Error(`Cannot step unknown run: ${runId}`);
      }

      if (currentRun.status === 'completed' || currentRun.status === 'failed' || currentRun.status === 'canceled') {
        throw new Error(`Cannot step run in terminal state: ${currentRun.status}`);
      }

      if (currentRun.status === 'waiting_approval') {
        throw new Error('Cannot step while waiting approval. Approve or deny the checkpoint first.');
      }

      if (currentRun.status === 'planned' || currentRun.status === 'paused') {
        this.resumeRun(runId);
      }

      return updateRun(statePath, runId, (run) => {
        const runningIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'running');
        if (runningIndex === -1) {
          throw new Error('Run has no active checkpoint to advance. Resume the run first.');
        }

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        const checkpoints = run.checkpoints.map((checkpoint) => ({ ...checkpoint }));

        const activeCheckpoint = checkpoints[runningIndex];

        if (activeCheckpoint.requiresApproval) {
          checkpoints[runningIndex] = {
            ...activeCheckpoint,
            status: 'waiting_approval'
          };
          const requestedAt = new Date().toISOString();
          events.push(`Approval requested at checkpoint ${activeCheckpoint.order}: ${activeCheckpoint.title}`);
          return {
            status: 'waiting_approval',
            checkpoints,
            events,
            summary: `${run.graphName} is paused for operator approval at checkpoint ${activeCheckpoint.order}.`,
            nextAction: 'Approve or deny this checkpoint to continue execution.',
            pendingApproval: {
              checkpointId: activeCheckpoint.id,
              checkpointOrder: activeCheckpoint.order,
              checkpointTitle: activeCheckpoint.title,
              approvalPolicyId: activeCheckpoint.approvalPolicyId,
              requestedAt,
              requiredApproverRole: activeCheckpoint.approvalPolicy?.requiredApproverRole ?? null,
              actionScope: activeCheckpoint.approvalPolicy?.actionScope ?? null,
              minRiskScore: activeCheckpoint.approvalPolicy?.minRiskScore ?? 0
            }
          };
        }

        checkpoints[runningIndex] = {
          ...activeCheckpoint,
          status: 'completed'
        };
        events.push(`Completed checkpoint ${activeCheckpoint.order}: ${activeCheckpoint.title}`);

        const nextIndex = checkpoints.findIndex((checkpoint) => checkpoint.status === 'ready' || checkpoint.status === 'pending');
        if (nextIndex >= 0) {
          checkpoints[nextIndex] = {
            ...checkpoints[nextIndex],
            status: 'ready'
          };
          return {
            status: 'paused',
            checkpoints,
            events,
            pendingApproval: null,
            summary: `${run.graphName} progressed to checkpoint ${checkpoints[nextIndex].order}/${checkpoints.length}.`,
            nextAction: `Resume to run checkpoint ${checkpoints[nextIndex].order}.`
          };
        }

        const completedAt = new Date().toISOString();
        const result = executeRunLifecycle({
          ...run,
          checkpoints
        }, { now: completedAt });
        const output = ensureRunFinalizedFooter(result.output, completedAt);
        events.push(`Run finalized at ${completedAt}`);
        appendMemoryRecord(statePath, {
          sessionId: run.sessionId,
          runId: run.id,
          fact: `${run.graphName} completed.`,
          importanceScore: 20,
          retention: 'short-term',
          tags: [run.graphId, 'run-completed']
        });

        return {
          status: 'completed',
          checkpoints,
          events,
          pendingApproval: null,
          summary: result.summary,
          nextAction: result.nextAction,
          output,
          error: '',
          completedAt
        };
      });
    },

    approveRun(runId, decision) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot approve unknown run: ${runId}`);
      }

      if (targetRun.status !== 'waiting_approval') {
        throw new Error(`Run is not awaiting approval: ${targetRun.status}`);
      }

      const approvalDecision = normalizeApprovalDecision(decision);

      return updateRun(statePath, runId, (run) => {
        const approvalIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'waiting_approval');
        if (approvalIndex === -1) {
          throw new Error('No checkpoint is currently waiting approval.');
        }

        const checkpoints = run.checkpoints.map((checkpoint) => ({ ...checkpoint }));
        const approvedCheckpoint = checkpoints[approvalIndex];
        const requiredRole = approvedCheckpoint.approvalPolicy?.requiredApproverRole;
        if (requiredRole && approvalDecision.operatorRole !== requiredRole) {
          throw new Error(`Approval role mismatch: required ${requiredRole}, received ${approvalDecision.operatorRole}`);
        }
        checkpoints[approvalIndex] = {
          ...approvedCheckpoint,
          status: 'completed'
        };

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        events.push(
          `Approved checkpoint ${approvedCheckpoint.order}: ${approvedCheckpoint.title} | operator=${approvalDecision.operator} | role=${approvalDecision.operatorRole} | reason=${approvalDecision.reason}`
        );

        const nextIndex = checkpoints.findIndex((checkpoint) => checkpoint.status === 'ready' || checkpoint.status === 'pending');
        if (nextIndex >= 0) {
          checkpoints[nextIndex] = {
            ...checkpoints[nextIndex],
            status: 'ready'
          };
          return {
            status: 'paused',
            checkpoints,
            events,
            pendingApproval: null,
            summary: `${run.graphName} approval accepted. Ready for checkpoint ${checkpoints[nextIndex].order}.`,
            nextAction: `Resume to continue from checkpoint ${checkpoints[nextIndex].order}.`
          };
        }

        const completedAt = new Date().toISOString();
        const result = executeRunLifecycle({
          ...run,
          checkpoints
        }, { now: completedAt });
        const output = ensureRunFinalizedFooter(result.output, completedAt);
        events.push(`Run finalized at ${completedAt}`);
        appendMemoryRecord(statePath, {
          sessionId: run.sessionId,
          runId: run.id,
          fact: `${run.graphName} completed.`,
          importanceScore: 20,
          retention: 'short-term',
          tags: [run.graphId, 'run-completed']
        });

        return {
          status: 'completed',
          checkpoints,
          events,
          pendingApproval: null,
          summary: result.summary,
          nextAction: result.nextAction,
          output,
          error: '',
          completedAt
        };
      });
    },

    denyRun(runId, decision) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot deny unknown run: ${runId}`);
      }

      if (targetRun.status !== 'waiting_approval') {
        throw new Error(`Run is not awaiting approval: ${targetRun.status}`);
      }

      const approvalDecision = normalizeApprovalDecision(decision);

      return updateRun(statePath, runId, (run) => {
        const approvalIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'waiting_approval');
        if (approvalIndex === -1) {
          throw new Error('No checkpoint is currently waiting approval.');
        }

        const checkpoints = run.checkpoints.map((checkpoint) => ({ ...checkpoint }));
        const deniedCheckpoint = checkpoints[approvalIndex];
        const requiredRole = deniedCheckpoint.approvalPolicy?.requiredApproverRole;
        if (requiredRole && approvalDecision.operatorRole !== requiredRole) {
          throw new Error(`Approval role mismatch: required ${requiredRole}, received ${approvalDecision.operatorRole}`);
        }
        checkpoints[approvalIndex] = {
          ...deniedCheckpoint,
          status: 'failed'
        };

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        events.push(
          `Denied checkpoint ${deniedCheckpoint.order}: ${deniedCheckpoint.title} | operator=${approvalDecision.operator} | role=${approvalDecision.operatorRole} | reason=${approvalDecision.reason}`
        );

        const completedAt = new Date().toISOString();
        return {
          status: 'failed',
          checkpoints,
          events,
          pendingApproval: null,
          summary: `${run.graphName} failed after approval denial at checkpoint ${deniedCheckpoint.order}.`,
          nextAction: 'Plan a new run or revise policies before retrying.',
          error: `Approval denied at checkpoint ${deniedCheckpoint.order}.`,
          completedAt
        };
      });
    },

    cancelRun(runId) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot cancel unknown run: ${runId}`);
      }

      if (targetRun.status === 'completed' || targetRun.status === 'failed' || targetRun.status === 'canceled') {
        throw new Error(`Cannot cancel run in terminal state: ${targetRun.status}`);
      }

      return updateRun(statePath, runId, (run) => {
        const checkpoints = run.checkpoints.map((checkpoint) => {
          if (checkpoint.status === 'running' || checkpoint.status === 'ready' || checkpoint.status === 'pending') {
            return {
              ...checkpoint,
              status: 'canceled'
            };
          }
          return checkpoint;
        });

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        events.push('Run canceled by operator.');

        const completedAt = new Date().toISOString();
        return {
          status: 'canceled',
          checkpoints,
          events,
          summary: `${run.graphName} was canceled before completion.`,
          nextAction: 'Plan a fresh run to continue development execution.',
          error: 'Canceled by operator.',
          completedAt
        };
      });
    },

    executeRun(runId) {
      let latest = this.resumeRun(runId);
      while (latest.status !== 'completed' && latest.status !== 'failed' && latest.status !== 'canceled' && latest.status !== 'waiting_approval') {
        latest = this.stepRun(runId);
        if (latest.status === 'paused') {
          latest = this.resumeRun(runId);
        }
      }
      return latest;
    },

    startRun(graphId, sessionId) {
      const targetSessionId = sessionId || this.ensureSession().id;
      const blueprint = buildRunBlueprint(graphId);
      return createRun(statePath, {
        sessionId: targetSessionId,
        graphId: blueprint.graphId,
        graphName: blueprint.graphName,
        summary: blueprint.summary,
        nextAction: blueprint.nextAction,
        checkpoints: blueprint.checkpoints
      });
    }
  };
}