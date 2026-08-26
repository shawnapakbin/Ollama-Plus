import { describe, expect, it } from 'vitest';
import { requestOllamaChat, requestOllamaChatStream } from '../electron/runtime/ollamaClient.js';

/**
 * Supporting unit tests — Agent MCP Tools Not Accessible (Task 4)
 *
 * Focused on the `ollamaClient.js` fix surface:
 *  - include a `tools` array in the /api/chat body only when `input.tools` is
 *    non-empty; omit it entirely otherwise (byte-for-byte identical body).
 *  - capture `message.tool_calls` from BOTH streamed chunks and the
 *    non-streaming response.
 *  - do not error on empty `content` when a tool call is present.
 *
 * Validates: Requirements 2.1, 2.3, 3.1, 3.2, 3.5
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Non-streaming fetch that records the outgoing body and returns `payload`. */
function jsonFetch(payload: any) {
  const bodies: any[] = [];
  const fetchImpl = async (_url: string, options: any) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => payload };
  };
  return { fetchImpl, bodies };
}

/** Streaming fetch that records the outgoing body and streams NDJSON `chunks`. */
function streamFetch(chunks: any[]) {
  const bodies: any[] = [];
  const encoder = new TextEncoder();
  const fetchImpl = async (_url: string, options: any) => {
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
  return { fetchImpl, bodies };
}

const BASE = {
  endpoint: 'http://localhost:11434',
  model: 'qwen3.5:9b',
  messages: [{ role: 'user', content: 'hi' }]
};

const SAMPLE_CATALOG = [
  {
    type: 'function',
    function: {
      name: 'folder_read_file',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } }
    }
  }
];

// ═══════════════════════════════════════════════════════════════════════════════
// requestOllamaChat (non-streaming)
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestOllamaChat: tool catalog forwarding (Req 2.1, 3.2)', () => {
  it('includes a tools array in the body when input.tools is non-empty', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE, tools: SAMPLE_CATALOG });

    expect(bodies[0].tools).toEqual(SAMPLE_CATALOG);
  });

  it('omits the tools field when input.tools is absent', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE });

    expect('tools' in bodies[0]).toBe(false);
    expect(Object.keys(bodies[0]).sort()).toEqual(['messages', 'model', 'stream'].sort());
  });

  it('omits the tools field when input.tools is an empty array', async () => {
    const { fetchImpl, bodies } = jsonFetch({ message: { content: 'ok' }, done: true });

    await requestOllamaChat(fetchImpl, { ...BASE, tools: [] });

    expect('tools' in bodies[0]).toBe(false);
  });
});

describe('requestOllamaChat: tool_calls capture (Req 2.3)', () => {
  it('captures message.tool_calls from the non-streaming response', async () => {
    const toolCalls = [
      { function: { name: 'folder_read_file', arguments: { path: 'package.json' } } }
    ];
    const { fetchImpl } = jsonFetch({
      message: { content: '', tool_calls: toolCalls },
      done: true
    });

    const result = await requestOllamaChat(fetchImpl, { ...BASE, tools: SAMPLE_CATALOG });

    expect(result.toolCalls).toEqual(toolCalls);
  });

  it('returns an empty toolCalls array when the response has none', async () => {
    const { fetchImpl } = jsonFetch({ message: { content: 'plain answer' }, done: true });

    const result = await requestOllamaChat(fetchImpl, { ...BASE });

    expect(result.toolCalls).toEqual([]);
    expect(result.content).toBe('plain answer');
  });

  it('does not error on empty content when a tool call is present', async () => {
    const { fetchImpl } = jsonFetch({
      message: {
        content: '',
        tool_calls: [{ function: { name: 'terminal_run', arguments: {} } }]
      },
      done: true
    });

    const result = await requestOllamaChat(fetchImpl, { ...BASE });

    expect(result.content).toBe('');
    expect(result.toolCalls.length).toBe(1);
  });

  it('still errors on empty content AND no tool calls', async () => {
    const { fetchImpl } = jsonFetch({ message: { content: '   ' }, done: true });

    await expect(
      requestOllamaChat(fetchImpl, { ...BASE })
    ).rejects.toThrow(/empty assistant message/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// requestOllamaChatStream (streaming)
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestOllamaChatStream: tool catalog forwarding (Req 2.1, 3.1, 3.2)', () => {
  it('includes a tools array in the body when input.tools is non-empty', async () => {
    const { fetchImpl, bodies } = streamFetch([
      { message: { content: 'ok' }, done: false },
      { message: { content: '' }, done: true }
    ]);

    await requestOllamaChatStream(fetchImpl, { ...BASE, tools: SAMPLE_CATALOG });

    expect(bodies[0].tools).toEqual(SAMPLE_CATALOG);
    expect(bodies[0].stream).toBe(true);
  });

  it('omits the tools field when input.tools is empty/absent', async () => {
    const { fetchImpl, bodies } = streamFetch([
      { message: { content: 'ok' }, done: true }
    ]);

    await requestOllamaChatStream(fetchImpl, { ...BASE });

    expect('tools' in bodies[0]).toBe(false);
    expect(Object.keys(bodies[0]).sort()).toEqual(['messages', 'model', 'stream'].sort());
  });
});

describe('requestOllamaChatStream: tool_calls capture (Req 2.3)', () => {
  it('accumulates message.tool_calls across streamed chunks', async () => {
    const callA = { function: { name: 'folder_read_file', arguments: { path: 'a.txt' } } };
    const callB = { function: { name: 'terminal_run', arguments: { cmd: 'ls' } } };
    const { fetchImpl } = streamFetch([
      { message: { content: '', tool_calls: [callA] }, done: false },
      { message: { content: '', tool_calls: [callB] }, done: false },
      { message: { content: '' }, done: true }
    ]);

    const result = await requestOllamaChatStream(fetchImpl, { ...BASE, tools: SAMPLE_CATALOG });

    expect(result.toolCalls).toEqual([callA, callB]);
  });

  it('reads tool_calls from the final done chunk', async () => {
    const call = { function: { name: 'folder_read_file', arguments: { path: 'x' } } };
    const { fetchImpl } = streamFetch([
      { message: { content: '', tool_calls: [call] }, done: true }
    ]);

    const result = await requestOllamaChatStream(fetchImpl, { ...BASE });

    expect(result.toolCalls).toEqual([call]);
  });

  it('does not error on empty content when a tool call is present', async () => {
    const call = { function: { name: 'folder_read_file', arguments: {} } };
    const deltas: string[] = [];
    const { fetchImpl } = streamFetch([
      { message: { content: '', tool_calls: [call] }, done: false },
      { message: { content: '' }, done: true }
    ]);

    const result = await requestOllamaChatStream(
      fetchImpl,
      { ...BASE },
      { onToken: (d: string) => deltas.push(d) }
    );

    expect(result.content).toBe('');
    expect(result.toolCalls.length).toBe(1);
    // No content delta emitted for a text-less tool-call turn.
    expect(deltas).toEqual([]);
  });

  it('still errors on empty stream AND no tool calls', async () => {
    const { fetchImpl } = streamFetch([
      { message: { content: '' }, done: true }
    ]);

    await expect(
      requestOllamaChatStream(fetchImpl, { ...BASE })
    ).rejects.toThrow(/empty assistant stream/i);
  });

  it('streams text tokens and returns them alongside an empty toolCalls array', async () => {
    const deltas: string[] = [];
    const { fetchImpl } = streamFetch([
      { message: { content: 'Hello' }, done: false },
      { message: { content: ' world' }, done: false },
      { message: { content: '' }, done: true, eval_count: 3 }
    ]);

    const result = await requestOllamaChatStream(
      fetchImpl,
      { ...BASE },
      { onToken: (d: string) => deltas.push(d) }
    );

    expect(deltas).toEqual(['Hello', ' world']);
    expect(result.content).toBe('Hello world');
    expect(result.toolCalls).toEqual([]);
  });
});
