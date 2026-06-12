import { describe, expect, it } from 'vitest';
import {
  buildMissingToolCallRepairContext,
  buildToolRepairContext,
  looksLikeToolIntentNarration,
  shouldRepairMissingToolCall,
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

  it('repairs raw Blender script output when the user asked for 3D output', () => {
    const script = '```python\nimport bpy\nbpy.ops.mesh.primitive_cube_add()\n```';
    expect(shouldRepairMissingToolCall({
      currentMessages: [
        { role: 'user', content: 'show this 3d object on screen in the viewer' }
      ],
      currentContent: script,
      useTools: true,
      repairAttempt: 0
    })).toBe(true);
  });

  it('builds strict tool-json guidance for script-like output', () => {
    const out = buildMissingToolCallRepairContext(
      [{ role: 'user', content: 'render a blender model in 3d workspace' }],
      'import bpy\nbpy.ops.mesh.primitive_cube_add()'
    );
    expect(out).toContain('Do not output raw Blender Python script');
    expect(out).toContain('blender_plate_scene');
  });
});