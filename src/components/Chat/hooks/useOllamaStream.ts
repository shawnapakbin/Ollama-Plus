/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import { useCallback, useRef, useState } from 'react';

type StreamPayload = {
  sessionId?: string;
  content: string;
  endpoint?: string;
  model?: string;
  requestId?: string;
};

type RunStreamInput = {
  hostUrl: string;
  payload: StreamPayload;
  onChunk?: (content: string) => void;
};

type OllamaStreamChunk = {
  message?: {
    content?: string;
  };
  done?: boolean;
};

function normalizeEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error('Ollama endpoint is required for streaming.');
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return `http://${trimmed.replace(/\/+$/, '')}`;
}

export function useOllamaStream() {
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runStream = useCallback(async ({ hostUrl, payload, onChunk }: RunStreamInput) => {
    const endpoint = normalizeEndpoint(payload.endpoint || hostUrl);
    if (!payload.model) {
      throw new Error('Select a model before streaming.');
    }

    const streamId = payload.requestId || globalThis.crypto?.randomUUID?.() || `stream-${Date.now()}`;
    const abortController = new AbortController();
    abortRef.current = abortController;
    setActiveStreamId(streamId);

    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          stream: true,
          messages: [{ role: 'user', content: payload.content }]
        }),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ollama stream failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = JSON.parse(trimmed) as OllamaStreamChunk;
          const delta = parsed.message?.content ?? '';
          if (delta) {
            content += delta;
            onChunk?.(content);
          }
        }
      }

      if (buffer.trim()) {
        const parsed = JSON.parse(buffer.trim()) as OllamaStreamChunk;
        const delta = parsed.message?.content ?? '';
        if (delta) {
          content += delta;
          onChunk?.(content);
        }
      }

      return { content, requestId: streamId };
    } finally {
      abortRef.current = null;
      setActiveStreamId(null);
    }
  }, []);

  return {
    runStream,
    stop,
    activeStreamId
  };
}
