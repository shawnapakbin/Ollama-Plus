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
      state.content = composeDisplayContent(state);
      onChunk?.(state.content);
    }

    if (parsed.message.content) {
      // When content tokens begin, close any active thinking stream.
      if (state.thinkingOpen) state.thinkingOpen = false;
      state.textContent += parsed.message.content;
      state.content = composeDisplayContent(state);
      onChunk?.(state.content);
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
    state.content = composeDisplayContent(state);
    onChunk?.(state.content);
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
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);

  const stop = useCallback(() => {
    const id = activeStreamIdRef.current;
    if (id) {
      ipcService.stopOllamaStream(id);
      activeStreamIdRef.current = null;
      setActiveStreamId(null);
    }
  }, []);

  const runStream = useCallback(
    ({ hostUrl, endpoint, payload, onChunk }: RunStreamOptions): Promise<StreamResult> => {
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
        let settled = false;
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
        let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
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
        };

        const failStream = (message: string) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          const activeId = activeStreamIdRef.current;
          if (activeId) ipcService.stopOllamaStream(activeId);
          activeStreamIdRef.current = null;
          setActiveStreamId(null);
          reject(new Error(message));
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

          failStream(message);
        };

        const resetInactivityTimer = () => {
          if (settled) return;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            void handleInactivityTimeout();
          }, STREAM_INACTIVITY_TIMEOUT_MS);
        };

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
            resolve({
              content: streamState.content,
              toolCalls: streamState.toolCalls,
              finalRes: streamState.finalRes,
              completed: Boolean(streamState.finalRes?.done)
            });
          },
          onError: (err: string) => {
            if (settled) return;
            settled = true;
            cleanupTimers();
            activeStreamIdRef.current = null;
            setActiveStreamId(null);
            reject(new Error(err));
          }
        });
        activeStreamIdRef.current = sId;
        setActiveStreamId(sId);
        resetInactivityTimer();
        maxDurationTimer = setTimeout(() => {
          failStream(
            'Ollama stream exceeded the maximum generation time for the active context window. Try a smaller model, shorter prompt, or lower context window.'
          );
        }, maxDurationMs);
      });
    },
    []
  );

  return { runStream, stop, activeStreamId };
}
