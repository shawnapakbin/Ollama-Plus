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
});