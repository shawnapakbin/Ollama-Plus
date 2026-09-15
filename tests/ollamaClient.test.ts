import { describe, expect, it } from 'vitest';
import { listOllamaModels, normalizeOllamaBaseUrl, requestOllamaChat, requestOllamaChatStream } from '../electron/runtime/ollamaClient.js';

describe('ollamaClient', () => {
  it('normalizes localhost and LAN endpoints', () => {
    expect(normalizeOllamaBaseUrl('127.0.0.1')).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaBaseUrl('http://192.168.1.22:11434/')).toBe('http://192.168.1.22:11434');
  });

  it('lists models from Ollama tags endpoint', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3.1:8b', size: 123, modified_at: '2026-08-06T00:00:00.000Z' }
        ]
      })
    });

    const result = await listOllamaModels(fetchImpl, '192.168.1.50');

    expect(result.endpoint).toBe('http://192.168.1.50:11434');
    expect(result.models[0]).toMatchObject({ name: 'llama3.1:8b', size: 123 });
  });

  it('requests a non-streaming chat completion', async () => {
    const fetchImpl = async (_url, options) => ({
      ok: true,
      json: async () => ({
        message: { content: 'Hello from Ollama.' },
        done: true,
        total_duration: 50,
        eval_count: 12,
        requestBody: options?.body
      })
    });

    const result = await requestOllamaChat(fetchImpl, {
      endpoint: 'http://localhost:11434',
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'Hi' }]
    });

    expect(result).toMatchObject({
      endpoint: 'http://localhost:11434',
      model: 'llama3.1:8b',
      content: 'Hello from Ollama.'
    });
  });

  it('assembles a streaming chat completion', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"message":{"content":"Hello"},"done":false}\n',
      '{"message":{"content":" world"},"done":false}\n',
      '{"message":{"content":"!"},"done":true,"total_duration":42,"eval_count":9}\n'
    ];

    const fetchImpl = async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        }
      })
    });

    const deltas = [];
    const result = await requestOllamaChatStream(fetchImpl, {
      endpoint: 'localhost',
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'Hi' }]
    }, {
      onToken(delta) {
        deltas.push(delta);
      }
    });

    expect(deltas).toEqual(['Hello', ' world', '!']);
    expect(result).toMatchObject({
      endpoint: 'http://localhost:11434',
      model: 'llama3.1:8b',
      content: 'Hello world!',
      evalCount: 9
    });
  });

  describe('actionable request errors (Requirements 7.1, 7.2, 7.3)', () => {
    // A rejected fetch that mirrors Node's transport-level failure: a
    // `TypeError: fetch failed` whose `cause.code` carries the connection code.
    const connRefusedFetch = () => async () => {
      const error = new TypeError('fetch failed');
      (error as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
      throw error;
    };

    // A resolved HTTP 500 response — a reachable server that returned an error
    // status. It must flow through the existing readJson path, not the
    // unreachable-attribution path.
    const http500Fetch = () => async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'internal boom' })
    });

    const chatInput = (endpoint: string) => ({
      endpoint,
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'Hi' }]
    });

    it('listOllamaModels: ECONNREFUSED on a local endpoint throws a "not running" error referencing start', async () => {
      await expect(listOllamaModels(connRefusedFetch(), '127.0.0.1')).rejects.toThrow(
        'Ollama server is not running at http://127.0.0.1:11434. Start the local Ollama server and try again.'
      );
    });

    it('listOllamaModels: ECONNREFUSED on a remote endpoint throws a "not reachable" error without a local-start reference', async () => {
      let caught: Error | undefined;
      try {
        await listOllamaModels(connRefusedFetch(), 'http://192.168.1.50:11434');
      } catch (error) {
        caught = error as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).toBe('Ollama server is not reachable at http://192.168.1.50:11434.');
      expect(caught?.message).not.toContain('Start the local');
      expect(caught?.message).not.toContain('not running');
    });

    it('listOllamaModels: reachable server returning HTTP 500 keeps the existing readJson error, not an unreachable attribution', async () => {
      let caught: Error | undefined;
      try {
        await listOllamaModels(http500Fetch(), '127.0.0.1');
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toBe('Ollama request failed: internal boom');
      expect(caught?.message).not.toContain('not running');
      expect(caught?.message).not.toContain('not reachable');
    });

    it('requestOllamaChat: ECONNREFUSED on a local endpoint throws a "not running" error referencing start', async () => {
      await expect(requestOllamaChat(connRefusedFetch(), chatInput('localhost'))).rejects.toThrow(
        'Ollama server is not running at http://localhost:11434. Start the local Ollama server and try again.'
      );
    });

    it('requestOllamaChat: ECONNREFUSED on a remote endpoint throws a "not reachable" error without a local-start reference', async () => {
      let caught: Error | undefined;
      try {
        await requestOllamaChat(connRefusedFetch(), chatInput('http://192.168.1.50:11434'));
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toBe('Ollama server is not reachable at http://192.168.1.50:11434.');
      expect(caught?.message).not.toContain('Start the local');
    });

    it('requestOllamaChat: reachable server returning HTTP 500 keeps the existing readJson error', async () => {
      let caught: Error | undefined;
      try {
        await requestOllamaChat(http500Fetch(), chatInput('127.0.0.1'));
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toBe('Ollama request failed: internal boom');
      expect(caught?.message).not.toContain('not running');
      expect(caught?.message).not.toContain('not reachable');
    });

    it('requestOllamaChatStream: ECONNREFUSED on a local endpoint throws a "not running" error referencing start', async () => {
      await expect(requestOllamaChatStream(connRefusedFetch(), chatInput('127.0.0.1'))).rejects.toThrow(
        'Ollama server is not running at http://127.0.0.1:11434. Start the local Ollama server and try again.'
      );
    });

    it('requestOllamaChatStream: ECONNREFUSED on a remote endpoint throws a "not reachable" error without a local-start reference', async () => {
      let caught: Error | undefined;
      try {
        await requestOllamaChatStream(connRefusedFetch(), chatInput('http://192.168.1.50:11434'));
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toBe('Ollama server is not reachable at http://192.168.1.50:11434.');
      expect(caught?.message).not.toContain('Start the local');
    });

    it('requestOllamaChatStream: reachable server returning HTTP 500 keeps the existing readJson error', async () => {
      let caught: Error | undefined;
      try {
        await requestOllamaChatStream(http500Fetch(), chatInput('127.0.0.1'));
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toBe('Ollama request failed: internal boom');
      expect(caught?.message).not.toContain('not running');
      expect(caught?.message).not.toContain('not reachable');
    });
  });
});