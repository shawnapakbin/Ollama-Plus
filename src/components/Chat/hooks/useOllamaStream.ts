import { useCallback, useRef, useState } from 'react';
import { ipcService } from '../../../services/ipcService';
import type { OllamaFinalResponse, ToolCall } from '../types';

interface StreamResult {
  content: string;
  toolCalls: ToolCall[] | null;
  finalRes: OllamaFinalResponse | null;
}

interface RunStreamOptions {
  hostUrl: string;
  endpoint: string;
  payload: unknown;
  onChunk?: (content: string) => void;
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
      let content = '';
      let toolCalls: ToolCall[] | null = null;
      let finalRes: OllamaFinalResponse | null = null;

      return new Promise<StreamResult>((resolve, reject) => {
        const sId = ipcService.invokeOllamaStream(hostUrl, endpoint, payload, {
          onData: (chunkText: string) => {
            const lines = chunkText.split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message) {
                  if (parsed.message.content) {
                    content += parsed.message.content;
                    onChunk?.(content);
                  }
                  if (parsed.message.tool_calls) {
                    toolCalls = parsed.message.tool_calls;
                  }
                }
                if (parsed.done) {
                  finalRes = parsed;
                }
              } catch (e) {
                /* ignore malformed JSON lines */
              }
            }
          },
          onEnd: () => {
            activeStreamIdRef.current = null;
            setActiveStreamId(null);
            resolve({ content, toolCalls, finalRes });
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
