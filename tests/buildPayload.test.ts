import { describe, it, expect } from 'vitest';
import {
  buildSystemMessages,
  formatMemoryContext,
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
