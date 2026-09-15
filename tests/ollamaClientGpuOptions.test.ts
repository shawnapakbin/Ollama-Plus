import { describe, expect, it } from 'vitest';
import { requestOllamaChat, requestOllamaChatStream } from '../electron/runtime/ollamaClient.js';

/**
 * Unit tests — GPU Selection (Task 6.7): buildChatBody options merge
 *
 * `buildChatBody` is private, so its behavior is exercised through the exported
 * `requestOllamaChat` / `requestOllamaChatStream` by injecting a mock `fetchImpl`
 * that captures the outgoing request body:
 *  - `options` is present and equals the provided fragment when
 *    `input.gpuOptions` is supplied.
 *  - `options` is omitted entirely when `input.gpuOptions` is `null`/absent, and
 *    a GPU-less / tool-less body is byte-identical to `{ model, stream, messages }`.
 *
 * Validates: Requirements 4.1, 4.6
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FetchOptions {
  body: string;
}

/** Non-streaming fetch that records the raw + parsed outgoing body. */
function jsonFetch(payload: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const rawBodies: string[] = [];
  const fetchImpl = async (_url: string, options: FetchOptions) => {
    rawBodies.push(options.body);
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => payload };
  };
  return { fetchImpl, bodies, rawBodies };
}

/** Streaming fetch that records the raw + parsed outgoing body. */
function streamFetch(chunks: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const rawBodies: string[] = [];
  const encoder = new TextEncoder();
  const fetchImpl = async (_url: string, options: FetchOptions) => {
    rawBodies.push(options.body);
    bodies.push(JSON.parse(options.body));
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
          }
          controller.close();
        }
      })
    };
  };
  return { fetchImpl, bodies, rawBodies };
}

const BASE = {
  endpoint: 'http://localhost:11434',
  model: 'qwen3.5:9b',
  messages: [{ role: 'user', content: 'hi' }]
};

// The pre-existing tool-less / GPU-less body shape, used for byte-identity
// assertions. buildChatBody re-maps messages to { role, content } only.
const baselineBody = (stream: boolean) =>
  JSON.stringify({
    model: BASE.model,
    stream,
    messages: BASE.messages.map((m) => ({ role: m.role, content: m.content }))
  });

// ═══════════════════════════════════════════════════════════════════════════════
// requestOllamaChat (non-streaming)
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestOllamaChat: gpuOptions → body.options merge (Req 4.1, 4.6)', () => {
  it('sets body.options to the provided num_gpu fragment', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE, gpuOptions: { num_gpu: 0 } });

    expect(bodies[0].options).toEqual({ num_gpu: 0 });
  });

  it('sets body.options to the provided main_gpu fragment', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE, gpuOptions: { main_gpu: 1 } });

    expect(bodies[0].options).toEqual({ main_gpu: 1 });
  });

  it('omits the options field when gpuOptions is null', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE, gpuOptions: null });

    expect('options' in bodies[0]).toBe(false);
  });

  it('omits the options field when gpuOptions is absent', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE });

    expect('options' in bodies[0]).toBe(false);
  });

  it('produces a byte-identical GPU-less / tool-less body', async () => {
    const { fetchImpl, rawBodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE });

    expect(rawBodies[0]).toBe(baselineBody(false));
  });

  it('keeps the body byte-identical when gpuOptions is explicitly null', async () => {
    const { fetchImpl, rawBodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE, gpuOptions: null });

    expect(rawBodies[0]).toBe(baselineBody(false));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// requestOllamaChatStream (streaming)
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestOllamaChatStream: gpuOptions → body.options merge (Req 4.1, 4.6)', () => {
  it('sets body.options to the provided fragment', async () => {
    const { fetchImpl, bodies } = streamFetch([{ message: { content: 'ok' }, done: true }]);

    await requestOllamaChatStream(fetchImpl, { ...BASE, gpuOptions: { num_gpu: 0 } });

    expect(bodies[0].options).toEqual({ num_gpu: 0 });
    expect(bodies[0].stream).toBe(true);
  });

  it('omits the options field when gpuOptions is null/absent', async () => {
    const { fetchImpl, bodies } = streamFetch([{ message: { content: 'ok' }, done: true }]);

    await requestOllamaChatStream(fetchImpl, { ...BASE });

    expect('options' in bodies[0]).toBe(false);
  });

  it('produces a byte-identical GPU-less / tool-less streaming body', async () => {
    const { fetchImpl, rawBodies } = streamFetch([{ message: { content: 'ok' }, done: true }]);

    await requestOllamaChatStream(fetchImpl, { ...BASE });

    expect(rawBodies[0]).toBe(baselineBody(true));
  });
});
