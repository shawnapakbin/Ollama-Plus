import { describe, it, expect } from 'vitest';
import { extractToolCallsFromContent } from '../src/components/Chat/pipeline/extractToolCalls';

describe('extractToolCallsFromContent', () => {
  it('returns null when no braces are present', () => {
    expect(extractToolCallsFromContent('plain text')).toBeNull();
    expect(extractToolCallsFromContent('')).toBeNull();
  });

  it('returns null when JSON does not match a known tool shape', () => {
    expect(extractToolCallsFromContent('{"foo":"bar"}')).toBeNull();
  });

  it('extracts a tool call from the {tool, parameters} shape', () => {
    const out = extractToolCallsFromContent('Sure: {"tool":"web_search","parameters":{"query":"cats"}}');
    expect(out).toEqual([
      { function: { name: 'web_search', arguments: { query: 'cats' } } }
    ]);
  });

  it('infers run_shell_command from {command}', () => {
    const out = extractToolCallsFromContent('{"command":"ls"}');
    expect(out?.[0].function.name).toBe('run_shell_command');
  });

  it('infers engineering_calculator from {expression}', () => {
    const out = extractToolCallsFromContent('{"expression":"sqrt(2)"}');
    expect(out?.[0].function.name).toBe('engineering_calculator');
  });

  it('infers web_search from {query}', () => {
    const out = extractToolCallsFromContent('{"query":"hello"}');
    expect(out?.[0].function.name).toBe('web_search');
  });

  it('rewrites legacy "search" to web_search', () => {
    const out = extractToolCallsFromContent('{"tool":"search","parameters":{"q":"x"}}');
    expect(out?.[0].function.name).toBe('web_search');
  });

  it('skips invalid JSON candidates and continues', () => {
    const out = extractToolCallsFromContent('garbage {not-json} then {"command":"echo hi"}');
    expect(out).toHaveLength(1);
    expect(out?.[0].function.name).toBe('run_shell_command');
  });

  it('returns null when no candidate matched', () => {
    expect(extractToolCallsFromContent('{"expression":""}')).toBeNull();
  });
});
