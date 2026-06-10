import { describe, expect, it } from 'vitest';
import {
  enterGenerationTransition,
  exitGenerationTransition,
  type SteerPayload
} from '../src/components/Chat/hooks/useSteerQueue';

const payload: SteerPayload = {
  displayContent: 'user visible',
  ollamaContent: 'llm content',
  attachmentNames: [],
  preview: 'preview'
};

describe('enterGenerationTransition', () => {
  it('marks first entry when depth goes from 0 to 1', () => {
    const out = enterGenerationTransition(0);
    expect(out).toEqual({
      nextGenerationDepth: 1,
      firstEntry: true
    });
  });

  it('does not mark first entry for nested generations', () => {
    const out = enterGenerationTransition(1);
    expect(out).toEqual({
      nextGenerationDepth: 2,
      firstEntry: false
    });
  });
});

describe('exitGenerationTransition', () => {
  it('does not complete while still inside nested generations', () => {
    const out = exitGenerationTransition(2, null, payload);
    expect(out).toEqual({
      nextGenerationDepth: 1,
      nextIntent: null,
      nextPending: payload,
      flush: null,
      intent: null,
      completed: false
    });
  });

  it('preserves pending queue when stop-only intent is set', () => {
    const out = exitGenerationTransition(1, 'stop-only', payload);
    expect(out).toEqual({
      nextGenerationDepth: 0,
      nextIntent: null,
      nextPending: payload,
      flush: null,
      intent: 'stop-only',
      completed: true
    });
  });

  it('flushes pending queue on outer completion when not stop-only', () => {
    const out = exitGenerationTransition(1, 'interrupt-send', payload);
    expect(out).toEqual({
      nextGenerationDepth: 0,
      nextIntent: null,
      nextPending: null,
      flush: payload,
      intent: 'interrupt-send',
      completed: true
    });
  });

  it('completes without flush when no pending queue exists', () => {
    const out = exitGenerationTransition(1, null, null);
    expect(out).toEqual({
      nextGenerationDepth: 0,
      nextIntent: null,
      nextPending: null,
      flush: null,
      intent: null,
      completed: true
    });
  });
});
