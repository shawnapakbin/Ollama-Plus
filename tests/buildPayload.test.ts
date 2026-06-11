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

  it('includes datetime context when injection is enabled', () => {
    const out = buildSystemMessages(history, { useTools: false, memoryContext: '', injectDateTime: true });
    expect(out[0].content).toContain('[CURRENT_DATE_TIME]');
    expect(out[0].content).toContain('ISO:');
  });

  it('does not include datetime context when injection is disabled', () => {
    const out = buildSystemMessages(history, { useTools: false, memoryContext: '', injectDateTime: false });
    expect(out[0].content).not.toContain('[CURRENT_DATE_TIME]');
  });

  it('includes custom system message when provided', () => {
    const out = buildSystemMessages(history, {
      useTools: false,
      memoryContext: '',
      customSystemMessage: 'Always ask clarifying questions before making assumptions.'
    });
    expect(out[0].content).toContain('[CUSTOM_SYSTEM_MESSAGE]');
    expect(out[0].content).toContain('Always ask clarifying questions before making assumptions.');
  });

  it('orders composed sections in the expected sequence', () => {
    const out = buildSystemMessages(history, {
      useTools: true,
      memoryContext: formatMemoryContext('remember this too'),
      repairContext: 'repair hint',
      customSystemMessage: 'custom guardrail',
      injectDateTime: true
    });
    const content = out[0].content;
    const customIdx = content.indexOf('[CUSTOM_SYSTEM_MESSAGE]');
    const baseIdx = content.indexOf(TOOL_SYSTEM_PROMPT);
    const repairIdx = content.indexOf('[REPAIR]');
    const timeIdx = content.indexOf('[CURRENT_DATE_TIME]');
    const memoryIdx = content.indexOf('[PERSISTENT MEMORY]');
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeLessThan(baseIdx);
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(repairIdx).toBeGreaterThan(baseIdx);
    expect(timeIdx).toBeGreaterThan(repairIdx);
    expect(memoryIdx).toBeGreaterThan(customIdx);
  });

  it('includes wiki strict-mode explicit intent guidance in tool prompt', () => {
    const out = buildSystemMessages(history, { useTools: true, memoryContext: '' });
    expect(out[0].content).toContain('In strict mode, only write when user intent is explicit');
    expect(out[0].content).toContain('profile/preferences.md');
    expect(out[0].content).toContain('journal/YYYY-MM.md');
  });

  it('lists MCP server inventory and modern MCP tool names', () => {
    const out = buildSystemMessages(history, { useTools: true, memoryContext: '' });
    expect(out[0].content).toContain('Available MCP servers:');
    expect(out[0].content).toContain('terminal_session');
    expect(out[0].content).toContain('python_terminal');
    expect(out[0].content).toContain('folder_mcp');
    expect(out[0].content).toContain('openscad_generate');
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
