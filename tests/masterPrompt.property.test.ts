import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MASTER_PROMPT_ENV_VAR,
  resolveMasterPrompt
} from '../electron/runtime/agent/masterPrompt.js';

/**
 * Property-Based Tests — Agent System Prompts: Master Prompt Resolution
 *
 * Feature: agent-system-prompts, Property 1: Environment override determines the
 * master prompt. For any string value assigned to the override environment
 * variable, resolveMasterPrompt returns that value (trimmed); and when the
 * variable is absent it returns the built-in default (trimmed), which is '' when
 * no default is defined.
 *
 * **Validates: Requirements 1.2, 1.7**
 */

// The built-in DEFAULT_MASTER_PROMPT is '' per the design (Req 1.7).
const EXPECTED_DEFAULT = '';

describe('resolveMasterPrompt - Property 1: Environment override determines the master prompt', () => {
  // Feature: agent-system-prompts, Property 1: Environment override determines the master prompt
  it('returns the override value (trimmed) when the env var is present, incl. empty strings', () => {
    fc.assert(
      fc.property(fc.string(), (overrideValue) => {
        // Env map WITHOUT the override key, then explicitly set it so an empty
        // string still counts as "present" (Req 1.2).
        const env: NodeJS.ProcessEnv = {
          [MASTER_PROMPT_ENV_VAR]: overrideValue
        };

        const result = resolveMasterPrompt(env);

        expect(result).toBe(overrideValue.trim());
      }),
      { numRuns: 200 }
    );
  });

  // Feature: agent-system-prompts, Property 1: Environment override determines the master prompt
  it('returns the built-in default when the override env var is absent', () => {
    fc.assert(
      fc.property(
        // Arbitrary env maps that never contain the override key.
        fc.dictionary(
          fc.string().filter((key) => key !== MASTER_PROMPT_ENV_VAR),
          fc.string()
        ),
        (env) => {
          const result = resolveMasterPrompt(env);
          expect(result).toBe(EXPECTED_DEFAULT);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: agent-system-prompts, Property 1: Environment override determines the master prompt
  it('always returns a string (never null/undefined) for arbitrary env maps', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.constant(undefined))),
        (env) => {
          const result = resolveMasterPrompt(env as NodeJS.ProcessEnv);
          expect(typeof result).toBe('string');
        }
      ),
      { numRuns: 200 }
    );
  });
});
