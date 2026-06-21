import { describe, expect, it } from 'vitest';
import {
  shouldSkipRouterForModel,
  shouldForceTools
} from '../src/components/Chat/pipeline/routerDecision';

describe('Router Decision Logic - 3D File Format Detection', () => {
  /**
   * Test to verify how router decision logic handles specific 3D file formats like .stp files
   * The implementation requires BOTH keywords AND verbs to match for 3D-related prompts
   */

  it('should properly detect "open the stp file" as NOT requiring tools', () => {
    // This specific test case from the prompt: "open the stp file"
    // Should NOT trigger force tools because "open" is not in SCENE_VERBS
    // and "stp" is not in SCENE_KEYWORDS
    expect(shouldForceTools('open the stp file')).toBe(false);
  });

  it('should detect valid 3D prompts with proper verbs and keywords', () => {
    // Test that valid combinations work
    expect(shouldForceTools('Add an stl file')).toBe(true);  // "add" in SCENE_VERBS, "stl" in SCENE_KEYWORDS
    expect(shouldForceTools('Create a step model')).toBe(true);  // "create" in SCENE_VERBS, "step" in SCENE_KEYWORDS
    expect(shouldForceTools('Show me the stl file in the scene')).toBe(true);  // "show" in SCENE_VERBS, "stl" in SCENE_KEYWORDS
  });

  it('should correctly handle case sensitivity', () => {
    // Test mixed case handling
    expect(shouldForceTools('Add a STEP model')).toBe(true);  // "create" in SCENE_VERBS, "step" in SCENE_KEYWORDS
    expect(shouldForceTools('Open the STEP file')).toBe(false);  // No scene verb
  });

  it('should skip router for Qwen models', () => {
    // Qwen models should skip router calls but still use force tools when needed
    expect(shouldSkipRouterForModel('qwen3:8b')).toBe(true);
    expect(shouldForceTools('Add an stl file')).toBe(true);
  });
});