import { describe, expect, it } from 'vitest';
import {
  buildToolRepairContext,
  looksLikeToolIntentNarration,
  shouldRepairToolTurn
} from '../src/components/Chat/pipeline/toolRepair';

describe('looksLikeToolIntentNarration', () => {
  it('detects narrated future tool intent', () => {
    expect(looksLikeToolIntentNarration("I'll add the third sphere to complete the arrangement.")).toBe(true);
  });

  it('does not flag completed summaries', () => {
    expect(looksLikeToolIntentNarration('I added three spheres in a triangular arrangement.')).toBe(false);
  });
});

describe('tool repair helpers', () => {
  const toolHistory = [
    { role: 'user' as const, content: 'create 3 spheres' },
    { role: 'assistant' as const, content: '{"tool":"scene_3d","parameters":{"action":"add","kind":"sphere"}}' },
    { role: 'tool' as const, content: 'Added sphere as id "sphere-1".', name: 'scene_3d' }
  ];

  it('retries narrated turns after tool results', () => {
    expect(shouldRepairToolTurn({
      currentMessages: toolHistory,
      currentContent: "I'll add the third sphere to complete the triangular arrangement.",
      useTools: true,
      repairAttempt: 0
    })).toBe(true);
  });

  it('stops retrying after the repair budget is used', () => {
    expect(shouldRepairToolTurn({
      currentMessages: toolHistory,
      currentContent: "I'll add the third sphere to complete the triangular arrangement.",
      useTools: true,
      repairAttempt: 1
    })).toBe(false);
  });

  it('adds scene-specific guidance to the repair context', () => {
    const out = buildToolRepairContext(toolHistory, "I'll add the third sphere to complete the triangular arrangement.");
    expect(out).toContain('scene_3d');
    expect(out).toContain('one JSON call per object');
  });
});