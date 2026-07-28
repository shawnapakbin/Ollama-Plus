import { useCallback, useRef, useState } from 'react';
import { ipcService } from '../../../services/ipcService';
import type { OllamaFinalResponse, ToolCall } from '../types';

interface StreamResult {
  content: string;
  toolCalls: ToolCall[] | null;
  finalRes: OllamaFinalResponse | null;
  completed: boolean;
}

interface RunStreamOptions {
  hostUrl: string;
  endpoint: string;
  payload: unknown;
  onChunk?: (content: string) => void;
}

interface OllamaPsModel {
  name?: string;
}

interface OllamaPsResponse {
  models?: OllamaPsModel[];
}

interface PayloadOptions {
  num_ctx?: unknown;
}

interface OllamaStreamPayload {
  model?: unknown;
  options?: PayloadOptions;
}

interface StreamAccumulatorState {
  content: string;
  toolCalls: ToolCall[] | null;
  finalRes: OllamaFinalResponse | null;
  lineBuffer: string;
  textContent: string;
  thinkingContent: string;
  thinkingOpen: boolean;
}

const STREAM_INACTIVITY_TIMEOUT_MS = 180_000;
const STREAM_BASE_MAX_DURATION_MS = 3 * 60_000;
const STREAM_BASE_CONTEXT_WINDOW = 8_192;
const STREAM_MAX_DURATION_CAP_MS = 15 * 60_000;
const STREAM_MAX_TRANSIENT_RETRIES = 2;
const STREAM_RETRY_BASE_DELAY_MS = 400;
const STREAM_RETRY_MAX_DELAY_MS = 2_000;

export function computeRetryDelayMs(attemptIndex: number): number {
  if (attemptIndex <= 0) return STREAM_RETRY_BASE_DELAY_MS;
  const delay = STREAM_RETRY_BASE_DELAY_MS * (2 ** attemptIndex);
  return Math.min(STREAM_RETRY_MAX_DELAY_MS, delay);
}

export function isRetryableStreamError(message: string): boolean {
  const text = (message || '').toLowerCase();
  if (!text) return false;
  if (/\b(user|manual)\s*(stop|cancel)|stopped by user|interrupt-send\b/.test(text)) return false;
  return /(timed out|timeout|econnreset|enetunreach|ehostunreach|socket hang up|network|connection|temporar|unavailable|reset by peer)/.test(text);
}

function getPayloadModel(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const model = (payload as { model?: unknown }).model;
  return typeof model === 'string' ? model.trim() : '';
}

function getPayloadContextWindow(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = (payload as OllamaStreamPayload).options?.num_ctx;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function computeStreamMaxDurationMs(payload: unknown): number {
  const contextWindow = getPayloadContextWindow(payload) ?? STREAM_BASE_CONTEXT_WINDOW;
  const scale = Math.max(1, contextWindow / STREAM_BASE_CONTEXT_WINDOW);
  const scaledDuration = Math.round(STREAM_BASE_MAX_DURATION_MS * scale);
  return Math.min(STREAM_MAX_DURATION_CAP_MS, scaledDuration);
}

function modelAppearsLoaded(psRes: unknown, modelName: string): boolean {
  if (!modelName) return false;
  const models = Array.isArray((psRes as OllamaPsResponse | null | undefined)?.models)
    ? (psRes as OllamaPsResponse).models
    : [];
  const expected = modelName.toLowerCase();
  return models.some((entry) => {
    const candidate = typeof entry?.name === 'string' ? entry.name.toLowerCase() : '';
    return candidate === expected || expected.startsWith(candidate) || candidate.startsWith(expected);
  });
}

function composeDisplayContent(state: StreamAccumulatorState): string {
  const thinkPart = state.thinkingContent
    ? `<think>${state.thinkingContent}${state.thinkingOpen ? '' : '</think>'}`
    : '';
  return thinkPart + state.textContent;
}

function emitIfChanged(
  state: StreamAccumulatorState,
  nextContent: string,
  onChunk?: (content: string) => void
) {
  if (state.content === nextContent) return;
  state.content = nextContent;
  onChunk?.(nextContent);
}

function applyParsedLine(
  state: StreamAccumulatorState,
  line: string,
  onChunk?: (content: string) => void
) {
  if (!line.trim()) return;

  const parsed = JSON.parse(line);
  if (parsed.message) {
    if (typeof parsed.message.thinking === 'string' && parsed.message.thinking.length > 0) {
      state.thinkingContent += parsed.message.thinking;
      state.thinkingOpen = true;
      emitIfChanged(state, composeDisplayContent(state), onChunk);
    }

    if (parsed.message.content) {
      // When content tokens begin, close any active thinking stream.
      if (state.thinkingOpen) state.thinkingOpen = false;
      state.textContent += parsed.message.content;
      emitIfChanged(state, composeDisplayContent(state), onChunk);
    }
    if (parsed.message.tool_calls) {
      state.toolCalls = parsed.message.tool_calls;
    }
  }
  if (parsed.done) {
    state.finalRes = parsed;
  }
}

export function applyOllamaStreamChunk(
  state: StreamAccumulatorState,
  chunkText: string,
  onChunk?: (content: string) => void
) {
  state.lineBuffer += chunkText;
  const lines = state.lineBuffer.split('\n');
  state.lineBuffer = lines.pop() ?? '';

  for (const line of lines) {
    try {
      applyParsedLine(state, line, onChunk);
    } catch {
      /* ignore malformed JSON lines */
    }
  }
}

export function flushOllamaStreamChunkBuffer(
  state: StreamAccumulatorState,
  onChunk?: (content: string) => void
) {
  if (state.lineBuffer.trim()) {
    try {
      applyParsedLine(state, state.lineBuffer, onChunk);
    } catch {
      /* ignore malformed final JSON line */
    } finally {
      state.lineBuffer = '';
    }
  }

  if (state.thinkingOpen) {
    state.thinkingOpen = false;
    emitIfChanged(state, composeDisplayContent(state), onChunk);
  }
}

/**
 * Wraps `invokeOllamaStream` into a Promise-returning runner and exposes a
 * stable `stop()` that aborts the active stream. The streamed content is
 * surfaced incrementally via `onChunk` so the caller can update its message
 * list, and the full accumulated content + any tool_calls + final metrics are
 * returned when the stream ends.
 */
export function useOllamaStream() {
  const activeStreamIdRef = useRef<string | null>(null);
  const userStopRequestedRef = useRef(false);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);

  const stop = useCallback(() => {
    userStopRequestedRef.current = true;
    const id = activeStreamIdRef.current;
    if (id) {
      ipcService.stopOllamaStream(id);
      activeStreamIdRef.current = null;
      setActiveStreamId(null);
    }
  }, []);

  const runStream = useCallback(
    ({ hostUrl, endpoint, payload, onChunk }: RunStreamOptions): Promise<StreamResult> => {
      userStopRequestedRef.current = false;
      const streamState: StreamAccumulatorState = {
        content: '',
        toolCalls: null,
        finalRes: null,
        lineBuffer: '',
        textContent: '',
        thinkingContent: '',
        thinkingOpen: false
      };

      return new Promise<StreamResult>((resolve, reject) => {
        let attempt = 0;
        let settled = false;
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
        let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const maxDurationMs = computeStreamMaxDurationMs(payload);

        const cleanupTimers = () => {
          if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
          }
          if (maxDurationTimer) {
            clearTimeout(maxDurationTimer);
            maxDurationTimer = null;
          }
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
        };

        const finalizeError = (message: string) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          const activeId = activeStreamIdRef.current;
          if (activeId) ipcService.stopOllamaStream(activeId);
          activeStreamIdRef.current = null;
          setActiveStreamId(null);
          reject(new Error(message));
        };

        const scheduleRetryOrFail = (message: string) => {
          if (settled) return;
          if (retryTimer) return;
          cleanupTimers();
          const manualStop = userStopRequestedRef.current;
          if (!manualStop && attempt < STREAM_MAX_TRANSIENT_RETRIES && isRetryableStreamError(message)) {
            const delayMs = computeRetryDelayMs(attempt);
            attempt += 1;
            retryTimer = setTimeout(() => {
              if (settled) return;
              startAttempt();
            }, delayMs);
            return;
          }
          finalizeError(message);
        };

        const handleInactivityTimeout = async () => {
          if (settled) return;

          let message =
            'Ollama stream timed out due to inactivity. Try a smaller model, shorter prompt, or lower context window.';
          const requestedModel = getPayloadModel(payload);

          if (requestedModel) {
            try {
              const psRes = await ipcService.invokeOllama(hostUrl, '/api/ps', undefined, 4_000);
              if (!modelAppearsLoaded(psRes, requestedModel)) {
                message =
                  `Ollama stream stalled and model "${requestedModel}" appears to have been unloaded mid-generation. `
                  + 'Disable Keep Alive auto-unload, avoid parallel app instances, and retry.';
              }
            } catch {
              // Ignore diagnostics failures and fall back to the generic timeout message.
            }
          }

          scheduleRetryOrFail(message);
        };

        const resetInactivityTimer = () => {
          if (settled) return;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            void handleInactivityTimeout();
          }, STREAM_INACTIVITY_TIMEOUT_MS);
        };

        const startAttempt = () => {
          if (settled) return;
          cleanupTimers();
          if (attempt > 0) {
            streamState.content = '';
            streamState.toolCalls = null;
            streamState.finalRes = null;
            streamState.lineBuffer = '';
            streamState.textContent = '';
            streamState.thinkingContent = '';
            streamState.thinkingOpen = false;
            onChunk?.('');
          }
          const previousId = activeStreamIdRef.current;
          if (previousId) ipcService.stopOllamaStream(previousId);
          const sId = ipcService.invokeOllamaStream(hostUrl, endpoint, payload, {
            onData: (chunkText: string) => {
              if (settled) return;
              resetInactivityTimer();
              applyOllamaStreamChunk(streamState, chunkText, onChunk);
            },
            onEnd: () => {
              if (settled) return;
              settled = true;
              cleanupTimers();
              flushOllamaStreamChunkBuffer(streamState, onChunk);
              activeStreamIdRef.current = null;
              setActiveStreamId(null);
              userStopRequestedRef.current = false;
              resolve({
                content: streamState.content,
                toolCalls: streamState.toolCalls,
                finalRes: streamState.finalRes,
                completed: Boolean(streamState.finalRes?.done)
              });
            },
            onError: (err: string) => {
              if (settled) return;
              cleanupTimers();
              activeStreamIdRef.current = null;
              setActiveStreamId(null);
              scheduleRetryOrFail(err);
            }
          });

          activeStreamIdRef.current = sId;
          setActiveStreamId(sId);
          resetInactivityTimer();
          maxDurationTimer = setTimeout(() => {
            scheduleRetryOrFail(
              'Ollama stream exceeded the maximum generation time for the active context window. Try a smaller model, shorter prompt, or lower context window.'
            );
          }, maxDurationMs);
        };

        startAttempt();
      });
    },
    []
  );

  return { runStream, stop, activeStreamId };
}
