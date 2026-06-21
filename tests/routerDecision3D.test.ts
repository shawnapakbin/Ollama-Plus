import { describe, expect, it } from 'vitest';
import {
  shouldSkipRouterForModel,
  shouldForceTools
} from '../src/components/Chat/pipeline/routerDecision';

describe('Router Decision Logic - 3D-related Tests', () => {
  /**
   * Test plan for router decision logic to ensure proper tool detection for 3D-related requests:
   * 
   * 1. Basic automatic tool detection (scene keywords) - This works with existing tests
   * 2. Qwen model behavior - Should skip router but still use tools when needed
   * 3. File extension matching for 3D formats - Implementation relies on keyword + verb combinations
   * 4. Force tool usage cases - Based on the actual implementation patterns
   */

  describe('Basic automatic tool detection (scene keywords)', () => {
    it('detects existing scene editing prompts with verbs', () => {
      // These are confirmed working tests from the original test suite
      expect(shouldForceTools('Add a sphere to the 3d workspace')).toBe(true);
      expect(shouldForceTools('Show me a cube in the viewport')).toBe(true);
      expect(shouldForceTools('Create a cylinder in the scene')).toBe(true);
      expect(shouldForceTools('Render a plane in the viewer')).toBe(true);
    });

    it('detects 3D-related verbs', () => {
      // Test 3D-related verbs that indicate tool usage is needed
      expect(shouldForceTools('Add a cube to the scene')).toBe(true);
      expect(shouldForceTools('Create a sphere in the viewport')).toBe(true);
      expect(shouldForceTools('Generate a model in the workspace')).toBe(true);
      expect(shouldForceTools('Place an object in the viewer')).toBe(true);
      expect(shouldForceTools('Spawn a mesh into the 3d panel')).toBe(true);
    });

    it('detects scene manipulation verbs', () => {
      // Test workspace manipulation verbs
      expect(shouldForceTools('Move this object in the workspace')).toBe(true);
      expect(shouldForceTools('Translate the cube in the viewport')).toBe(true);
      expect(shouldForceTools('Rotate this model in the scene')).toBe(true);
      expect(shouldForceTools('Scale the sphere in the viewer')).toBe(true);
    });
  });

  describe('Qwen model behavior', () => {
    it('skips router for Qwen models but enables tools when needed', () => {
      // Qwen models should skip router calls
      expect(shouldSkipRouterForModel('qwen3:8b')).toBe(true);
      expect(shouldSkipRouterForModel('QWEN3-VL:30B')).toBe(true);
      expect(shouldSkipRouterForModel('qwen2:7b')).toBe(true);
      
      // Should still force tools for scene-related requests even with router skipped
      expect(shouldForceTools('Add three spheres to the 3d workspace')).toBe(true);
    });
  });

  describe('File extension matching for 3D formats', () => {
    it('understands how 3D format detection works in current implementation', () => {
      // The current implementation requires BOTH keywords AND verbs to match
      // This means that just "open .stl file" won't trigger tools because 
      // "open" is not in SCENE_VERBS (it's in DEV_TOOL_VERBS)
      // But if we add a scene verb, it should work
      
      // These are working examples showing the pattern:
      expect(shouldForceTools('Add an stl file')).toBe(true);  // "add" is in SCENE_VERBS
      expect(shouldForceTools('Create a step model')).toBe(true);  // "create" is in SCENE_VERBS
    });
  });

  describe('Force tool usage cases', () => {
    it('forces tools for clear scene-edit prompts', () => {
      const prompts = [
        'Add three spheres to the 3d workspace',
        'Rotate this cube in the scene',
        'show a 3d object on screen',
        'display a blender model in the viewer'
      ];
      
      // All these should match because they contain both keywords and verbs
      prompts.forEach(prompt => {
        expect(shouldForceTools(prompt)).toBe(true);
      });
    });

    it('handles non-tool prompts correctly', () => {
      // These should NOT trigger force tools (they don't have the right combination of keywords + verbs)
      expect(shouldForceTools('What is your favorite color?')).toBe(false);
      expect(shouldForceTools('Tell me a joke')).toBe(false);
      expect(shouldForceTools('')).toBe(false);
    });
  });
});