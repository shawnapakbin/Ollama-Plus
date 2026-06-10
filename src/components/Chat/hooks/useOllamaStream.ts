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

interface StreamAccumulatorState {
  content: string;
  toolCalls: ToolCall[] | null;
  finalRes: OllamaFinalResponse | null;
  lineBuffer: string;
  textContent: string;
  thinkingContent: string;
  thinkingOpen: boolean;
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
        const sId = ipcService.invokeOllamaStream(hostUrl, endpoint, payload, {
          onData: (chunkText: string) => {
            applyOllamaStreamChunk(streamState, chunkText, onChunk);
          },
          onEnd: () => {
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
            activeStreamIdRef.current = null;
            setActiveStreamId(null);
            reject(new Error(err));
          }
        });
        activeStreamIdRef.current = sId;
        setActiveStreamId(sId);
      });
    },
    []
  );

  return { runStream, stop, activeStreamId };
}
