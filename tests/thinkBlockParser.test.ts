import { describe, it, expect } from 'vitest';
import { parseThinkBlocks } from '../src/components/Chat/pipeline/thinkBlockParser';

describe('parseThinkBlocks', () => {
  it('returns empty for empty input', () => {
    expect(parseThinkBlocks('')).toEqual([]);
  });

  it('returns a single text segment when no think tag is present', () => {
    expect(parseThinkBlocks('hello world')).toEqual([{ kind: 'text', value: 'hello world' }]);
  });

  it('extracts a complete think block', () => {
    const segs = parseThinkBlocks('before<think>reasoning</think>after');
    expect(segs).toEqual([
      { kind: 'text', value: 'before' },
      { kind: 'think', value: 'reasoning' },
      { kind: 'text', value: 'after' }
    ]);
  });

  it('handles multiple think blocks in order', () => {
    const segs = parseThinkBlocks('a<think>1</think>b<think>2</think>c');
    expect(segs.map(s => `${s.kind}:${s.value}`)).toEqual([
      'text:a', 'think:1', 'text:b', 'think:2', 'text:c'
    ]);
  });

  it('marks an unclosed trailing think block as streaming', () => {
    const segs = parseThinkBlocks('intro<think>still thinking');
    expect(segs).toEqual([
      { kind: 'text', value: 'intro' },
      { kind: 'think', value: 'still thinking', streaming: true }
    ]);
  });

  it('marks streaming think alone', () => {
    const segs = parseThinkBlocks('<think>partial');
    expect(segs).toEqual([{ kind: 'think', value: 'partial', streaming: true }]);
  });
});
