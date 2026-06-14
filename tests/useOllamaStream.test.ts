import { describe, expect, it, vi } from 'vitest';
import {
  applyOllamaStreamChunk,
  computeStreamMaxDurationMs,
  flushOllamaStreamChunkBuffer
} from '../src/components/Chat/hooks/useOllamaStream';

describe('computeStreamMaxDurationMs', () => {
  it('uses the 3-minute base duration for default or small contexts', () => {
    expect(computeStreamMaxDurationMs({})).toBe(180_000);
    expect(computeStreamMaxDurationMs({ options: { num_ctx: 4096 } })).toBe(180_000);
    expect(computeStreamMaxDurationMs({ options: { num_ctx: 8192 } })).toBe(180_000);
  });

  it('scales linearly with larger context windows', () => {
    expect(computeStreamMaxDurationMs({ options: { num_ctx: 16384 } })).toBe(360_000);
    expect(computeStreamMaxDurationMs({ options: { num_ctx: 32768 } })).toBe(720_000);
  });

  it('caps the duration for very large contexts', () => {
    expect(computeStreamMaxDurationMs({ options: { num_ctx: 65536 } })).toBe(900_000);
    expect(computeStreamMaxDurationMs({ options: { num_ctx: 131072 } })).toBe(900_000);
  });
});

describe('useOllamaStream helpers', () => {
  it('buffers incomplete JSON lines across chunks until a newline arrives', () => {
    const state = {
      content: '',
      toolCalls: null,
      finalRes: null,
      lineBuffer: '',
      textContent: '',
      thinkingContent: '',
      thinkingOpen: false
    };
    const onChunk = vi.fn();

    applyOllamaStreamChunk(state, '{"message":{"content":"<think>Analy', onChunk);
    expect(state.content).toBe('');
    expect(state.lineBuffer).toContain('<think>Analy');
    expect(onChunk).not.toHaveBeenCalled();

    applyOllamaStreamChunk(state, 'zing</think>"}}\n', onChunk);
    expect(state.content).toBe('<think>Analyzing</think>');
    expect(state.lineBuffer).toBe('');
    expect(onChunk).toHaveBeenCalledWith('<think>Analyzing</think>');
  });

  it('flushes a final buffered line even without a trailing newline', () => {
    const state = {
      content: '',
      toolCalls: null,
      finalRes: null,
      lineBuffer: '',
      textContent: '',
      thinkingContent: '',
      thinkingOpen: false
    };
    const onChunk = vi.fn();

    applyOllamaStreamChunk(state, '{"message":{"content":"done"}}', onChunk);
    expect(state.content).toBe('');

    flushOllamaStreamChunkBuffer(state, onChunk);
    expect(state.content).toBe('done');
    expect(state.lineBuffer).toBe('');
    expect(onChunk).toHaveBeenCalledWith('done');
  });

  it('preserves tool calls and final response fields from buffered lines', () => {
    const state = {
      content: '',
      toolCalls: null,
      finalRes: null,
      lineBuffer: '',
      textContent: '',
      thinkingContent: '',
      thinkingOpen: false
    };

    applyOllamaStreamChunk(
      state,
      '{"message":{"tool_calls":[{"function":{"name":"scene_3d","arguments":{"action":"add"}}}]}}\n' +
        '{"done":true,"total_duration":1,"load_duration":2,"prompt_eval_count":3,"prompt_eval_duration":4,"eval_count":5,"eval_duration":6}\n'
    );

    expect(state.toolCalls).toEqual([
      { function: { name: 'scene_3d', arguments: { action: 'add' } } }
    ]);
    expect(state.finalRes).toEqual({
      done: true,
      total_duration: 1,
      load_duration: 2,
      prompt_eval_count: 3,
      prompt_eval_duration: 4,
      eval_count: 5,
      eval_duration: 6
    });
  });

  it('streams message.thinking as an open think block and closes it when content begins', () => {
    const state = {
      content: '',
      toolCalls: null,
      finalRes: null,
      lineBuffer: '',
      textContent: '',
      thinkingContent: '',
      thinkingOpen: false
    };
    const onChunk = vi.fn();

    applyOllamaStreamChunk(state, '{"message":{"thinking":"Plan"}}\n', onChunk);
    expect(state.content).toBe('<think>Plan');

    applyOllamaStreamChunk(state, '{"message":{"thinking":" more"}}\n', onChunk);
    expect(state.content).toBe('<think>Plan more');

    applyOllamaStreamChunk(state, '{"message":{"content":" answer"}}\n', onChunk);
    expect(state.content).toBe('<think>Plan more</think> answer');
    expect(onChunk).toHaveBeenLastCalledWith('<think>Plan more</think> answer');
  });

  it('closes an open thinking block at stream end even without content tokens', () => {
    const state = {
      content: '',
      toolCalls: null,
      finalRes: null,
      lineBuffer: '',
      textContent: '',
      thinkingContent: '',
      thinkingOpen: false
    };

    applyOllamaStreamChunk(state, '{"message":{"thinking":"Analyzing"}}\n');
    expect(state.content).toBe('<think>Analyzing');

    flushOllamaStreamChunkBuffer(state);
    expect(state.content).toBe('<think>Analyzing</think>');
  });
});