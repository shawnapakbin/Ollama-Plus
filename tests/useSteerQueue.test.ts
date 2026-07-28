import { describe, expect, it } from 'vitest';
import {
  enterGenerationTransition,
  exitGenerationTransition,
  sanitizeSteerPayload,
  type SteerPayload
} from '../src/components/Chat/hooks/useSteerQueue';

const payload: SteerPayload = {
  displayContent: 'user visible',
  ollamaContent: 'llm content',
  attachmentNames: [],
  imagePayloads: [],
  imageReferences: [],
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

describe('sanitizeSteerPayload', () => {
  it('accepts valid payload shape', () => {
    const out = sanitizeSteerPayload({
      displayContent: 'd',
      ollamaContent: 'o',
      attachmentNames: ['a.txt'],
      imagePayloads: ['b64'],
      imageReferences: ['C:/x.png'],
      preview: 'p'
    });
    expect(out).toEqual({
      displayContent: 'd',
      ollamaContent: 'o',
      attachmentNames: ['a.txt'],
      imagePayloads: ['b64'],
      imageReferences: ['C:/x.png'],
      preview: 'p'
    });
  });

  it('returns null for invalid objects', () => {
    expect(sanitizeSteerPayload(null)).toBeNull();
    expect(sanitizeSteerPayload({})).toBeNull();
    expect(sanitizeSteerPayload({ displayContent: 'x' })).toBeNull();
  });
});
