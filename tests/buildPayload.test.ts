import { describe, it, expect } from 'vitest';
import {
  buildSystemMessages,
  buildToolContinuationContext,
  formatMemoryContext,
  hasToolResults,
  TOOL_SYSTEM_PROMPT,
  PLAIN_SYSTEM_PROMPT
} from '../src/components/Chat/pipeline/buildPayload';

describe('formatMemoryContext', () => {
  it('returns empty string for empty input', () => {
    expect(formatMemoryContext('')).toBe('');
  });
  it('prefixes the memory header for non-empty input', () => {
    expect(formatMemoryContext('user likes cats')).toBe('\n\n[PERSISTENT MEMORY]\nuser likes cats');
  });
});

describe('buildSystemMessages', () => {
  const history = [
    { role: 'user' as const, content: 'hi' },
    { role: 'assistant' as const, content: 'hello' }
  ];

  it('prepends the plain system prompt when tools are disabled', () => {
    const out = buildSystemMessages(history, { useTools: false, memoryContext: '' });
    expect(out[0]).toEqual({ role: 'system', content: PLAIN_SYSTEM_PROMPT });
    expect(out.slice(1)).toEqual(history);
  });

  it('prepends the tool system prompt when tools are enabled', () => {
    const out = buildSystemMessages(history, { useTools: true, memoryContext: '' });
    expect(out[0]).toEqual({ role: 'system', content: TOOL_SYSTEM_PROMPT });
  });

  it('includes continuation guidance after tool results', () => {
    const withTool = [
      ...history,
      { role: 'tool' as const, content: 'Added sphere as id "sphere-1".', name: 'scene_3d' }
    ];
    const out = buildSystemMessages(withTool, { useTools: true, memoryContext: '' });
    expect(out[0].content).toContain('[AFTER TOOL RESULTS]');
    expect(out[0].content).toContain('emit the next JSON tool call now');
  });

  it('appends repair guidance when provided', () => {
    const out = buildSystemMessages(history, {
      useTools: true,
      memoryContext: '',
      repairContext: 'Output tool JSON instead of narration.'
    });
    expect(out[0].content).toContain('[REPAIR]');
    expect(out[0].content).toContain('Output tool JSON instead of narration.');
  });

  it('appends memory context to the system prompt', () => {
    const mem = formatMemoryContext('remember this');
    const out = buildSystemMessages(history, { useTools: false, memoryContext: mem });
    expect(out[0].content.endsWith('remember this')).toBe(true);
    expect(out[0].content.startsWith(PLAIN_SYSTEM_PROMPT)).toBe(true);
  });

  it('does not mutate the input history', () => {
    const original = [...history];
    buildSystemMessages(history, { useTools: true, memoryContext: '' });
    expect(history).toEqual(original);
  });
});

describe('tool continuation helpers', () => {
  it('detects when tool results are present', () => {
    expect(hasToolResults([{ role: 'tool', content: 'ok', name: 'scene_3d' }])).toBe(true);
    expect(hasToolResults([{ role: 'assistant', content: 'ok' }])).toBe(false);
  });

  it('builds no continuation context when no tool results or repair are present', () => {
    expect(buildToolContinuationContext([{ role: 'assistant', content: 'ok' }])).toBe('');
  });
});
