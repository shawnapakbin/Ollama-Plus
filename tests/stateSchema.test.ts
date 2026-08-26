import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_SYSTEM_PROMPT_LENGTH, normalizeChatConfig } from '../electron/runtime/stateSchema.js';

// Feature: auto-session-naming, Property 1: Config Normalization Produces Valid Defaults
describe('normalizeChatConfig – Property 1: Config Normalization Produces Valid Defaults', () => {
  /**
   * Validates: Requirements 1.1, 8.2, 11.2
   *
   * For any input object passed to normalizeChatConfig (including undefined, null,
   * objects with missing autoRenameEnabled, objects with non-boolean autoRenameEnabled
   * values like strings, numbers, or arrays), the returned config SHALL have
   * autoRenameEnabled set to true (the default) when the input is not a boolean,
   * and preserve the exact boolean value when it is.
   */

  it('always returns autoRenameEnabled as a boolean', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (input) => {
          const result = normalizeChatConfig(input);
          expect(typeof result.autoRenameEnabled).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults autoRenameEnabled to true when input is not a boolean', () => {
    const nonBooleanArbitrary = fc.anything().filter(
      (value) => typeof value !== 'boolean'
    );

    fc.assert(
      fc.property(
        fc.record({
          endpoint: fc.option(fc.string(), { nil: undefined }),
          model: fc.option(fc.string(), { nil: undefined }),
          autoRenameEnabled: nonBooleanArbitrary
        }),
        (config) => {
          const result = normalizeChatConfig(config);
          expect(result.autoRenameEnabled).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves exact boolean value when autoRenameEnabled is a boolean', () => {
    fc.assert(
      fc.property(
        fc.record({
          endpoint: fc.option(fc.string(), { nil: undefined }),
          model: fc.option(fc.string(), { nil: undefined }),
          autoRenameEnabled: fc.boolean()
        }),
        (config) => {
          const result = normalizeChatConfig(config);
          expect(result.autoRenameEnabled).toBe(config.autoRenameEnabled);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults autoRenameEnabled to true when config is undefined or null', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(undefined, null),
        (config) => {
          const result = normalizeChatConfig(config);
          expect(result.autoRenameEnabled).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults autoRenameEnabled to true when autoRenameEnabled field is missing', () => {
    fc.assert(
      fc.property(
        fc.record({
          endpoint: fc.option(fc.string(), { nil: undefined }),
          model: fc.option(fc.string(), { nil: undefined })
        }),
        (config) => {
          const result = normalizeChatConfig(config);
          expect(result.autoRenameEnabled).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Task 3.2: Unit tests for normalizeChatConfig systemPrompt example cases
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 7.1
describe('normalizeChatConfig – systemPrompt example cases', () => {
  it('defaults systemPrompt to an empty string when the field is missing (Req 2.1, 2.2)', () => {
    const result = normalizeChatConfig({ endpoint: 'http://127.0.0.1:11434', model: 'llama3' });
    expect(result.systemPrompt).toBe('');
  });

  it('defaults systemPrompt to an empty string when config is undefined or null (Req 2.1, 2.2)', () => {
    expect(normalizeChatConfig(undefined).systemPrompt).toBe('');
    expect(normalizeChatConfig(null).systemPrompt).toBe('');
  });

  it('coerces non-string systemPrompt values to an empty string (Req 2.3)', () => {
    expect(normalizeChatConfig({ systemPrompt: 123 as unknown as string }).systemPrompt).toBe('');
    expect(normalizeChatConfig({ systemPrompt: true as unknown as string }).systemPrompt).toBe('');
    expect(normalizeChatConfig({ systemPrompt: { text: 'hi' } as unknown as string }).systemPrompt).toBe('');
    expect(normalizeChatConfig({ systemPrompt: ['a', 'b'] as unknown as string }).systemPrompt).toBe('');
    expect(normalizeChatConfig({ systemPrompt: null as unknown as string }).systemPrompt).toBe('');
  });

  it('trims leading and trailing whitespace from systemPrompt (Req 2.4)', () => {
    expect(normalizeChatConfig({ systemPrompt: '  You are a helpful agent.  ' }).systemPrompt)
      .toBe('You are a helpful agent.');
    expect(normalizeChatConfig({ systemPrompt: '\n\t  trimmed  \t\n' }).systemPrompt).toBe('trimmed');
  });

  it('preserves an already-normalized systemPrompt value (Req 2.4)', () => {
    expect(normalizeChatConfig({ systemPrompt: 'stay on task' }).systemPrompt).toBe('stay on task');
  });

  it('truncates an over-length systemPrompt to MAX_SYSTEM_PROMPT_LENGTH (Req 2.4)', () => {
    const overLength = 'a'.repeat(MAX_SYSTEM_PROMPT_LENGTH + 500);
    const result = normalizeChatConfig({ systemPrompt: overLength });
    expect(result.systemPrompt).toHaveLength(MAX_SYSTEM_PROMPT_LENGTH);
    expect(result.systemPrompt).toBe('a'.repeat(MAX_SYSTEM_PROMPT_LENGTH));
  });

  it('trims before truncating so the result is bounded by MAX_SYSTEM_PROMPT_LENGTH (Req 2.4)', () => {
    const padded = `   ${'b'.repeat(MAX_SYSTEM_PROMPT_LENGTH + 100)}   `;
    const result = normalizeChatConfig({ systemPrompt: padded });
    expect(result.systemPrompt).toHaveLength(MAX_SYSTEM_PROMPT_LENGTH);
    expect(result.systemPrompt.startsWith('b')).toBe(true);
  });

  it('keeps a value exactly at MAX_SYSTEM_PROMPT_LENGTH unchanged (Req 2.4)', () => {
    const exact = 'c'.repeat(MAX_SYSTEM_PROMPT_LENGTH);
    const result = normalizeChatConfig({ systemPrompt: exact });
    expect(result.systemPrompt).toHaveLength(MAX_SYSTEM_PROMPT_LENGTH);
    expect(result.systemPrompt).toBe(exact);
  });
});

// Feature: agent-system-prompts, Property 2: System prompt normalization is total and bounded
describe('normalizeChatConfig – Property 2: System prompt normalization is total and bounded', () => {
  /**
   * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 1.3
   *
   * For any input passed to normalizeChatConfig (including undefined, null, and
   * objects with missing, non-string, whitespace-padded, or over-length systemPrompt
   * values, and objects carrying master-prompt-like keys), the result's systemPrompt
   * is a string with no leading/trailing whitespace and length <= MAX_SYSTEM_PROMPT_LENGTH,
   * defaulting to '' for missing or non-string values, and the result object contains
   * no master-prompt key.
   */

  // Keys that look like a hidden master prompt and MUST never survive normalization.
  const MASTER_PROMPT_LIKE_KEYS = [
    'masterPrompt',
    'master_prompt',
    'MASTER_PROMPT',
    'masterSystemPrompt',
    'OLLAMA_PLUS_MASTER_PROMPT'
  ];

  // Only the four known keys are allowed in the normalized result (Req 1.3).
  const ALLOWED_KEYS = ['endpoint', 'model', 'autoRenameEnabled', 'systemPrompt'];

  it('always returns systemPrompt as a trimmed string bounded by MAX_SYSTEM_PROMPT_LENGTH (any input)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (input) => {
          const result = normalizeChatConfig(input);
          expect(typeof result.systemPrompt).toBe('string');
          expect(result.systemPrompt).toBe(result.systemPrompt.trim());
          expect(result.systemPrompt.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_LENGTH);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults systemPrompt to "" when the value is missing or non-string', () => {
    const nonStringArbitrary = fc.anything().filter((value) => typeof value !== 'string');

    fc.assert(
      fc.property(
        fc.record({
          endpoint: fc.option(fc.string(), { nil: undefined }),
          model: fc.option(fc.string(), { nil: undefined }),
          systemPrompt: fc.option(nonStringArbitrary, { nil: undefined })
        }),
        (config) => {
          const result = normalizeChatConfig(config);
          expect(result.systemPrompt).toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('trims and truncates arbitrary string systemPrompt values', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (systemPrompt) => {
          const result = normalizeChatConfig({ systemPrompt });
          const expected = systemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH);
          expect(result.systemPrompt).toBe(expected);
          expect(result.systemPrompt).toBe(result.systemPrompt.trim());
          expect(result.systemPrompt.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_LENGTH);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('bounds even whitespace-padded over-length strings to MAX_SYSTEM_PROMPT_LENGTH', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_SYSTEM_PROMPT_LENGTH, max: MAX_SYSTEM_PROMPT_LENGTH + 2000 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (length, pad) => {
          const overLength = `${pad}${'x'.repeat(length)}${pad}`;
          const result = normalizeChatConfig({ systemPrompt: overLength });
          expect(result.systemPrompt.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_LENGTH);
          expect(result.systemPrompt).toBe(result.systemPrompt.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('never carries a master-prompt-like key into the result, regardless of input (Req 1.3)', () => {
    // Build configs that always include at least one master-prompt-like key.
    const masterKeyRecord = fc.dictionary(
      fc.constantFrom(...MASTER_PROMPT_LIKE_KEYS),
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      { minKeys: 1 }
    );

    fc.assert(
      fc.property(
        fc.record({
          endpoint: fc.option(fc.string(), { nil: undefined }),
          model: fc.option(fc.string(), { nil: undefined }),
          autoRenameEnabled: fc.option(fc.boolean(), { nil: undefined }),
          systemPrompt: fc.option(fc.string(), { nil: undefined })
        }),
        masterKeyRecord,
        (baseConfig, masterKeys) => {
          const config = { ...baseConfig, ...masterKeys };
          const result = normalizeChatConfig(config);

          // No master-prompt-like key survives.
          for (const key of MASTER_PROMPT_LIKE_KEYS) {
            expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
          }

          // Result contains only the four known keys (Req 1.3).
          expect(Object.keys(result).sort()).toEqual([...ALLOWED_KEYS].sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('produces only the four known keys for any input (Req 1.3)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (input) => {
          const result = normalizeChatConfig(input);
          expect(Object.keys(result).sort()).toEqual([...ALLOWED_KEYS].sort());
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: agent-system-prompts, Property 10: Existing chat-config fields are preserved
describe('normalizeChatConfig – Property 10: Existing chat-config fields are preserved', () => {
  /**
   * Validates: Requirements 5.1
   *
   * For any input, normalizeChatConfig produces endpoint, model, and
   * autoRenameEnabled with their current defaults and coercion behavior,
   * unaffected by the addition of systemPrompt.
   *
   * Current defaults / coercion:
   *  - endpoint: 'http://127.0.0.1:11434' when missing/blank/non-string; trimmed otherwise
   *  - model: '' when missing/non-string; trimmed otherwise
   *  - autoRenameEnabled: true when not a boolean; the exact boolean otherwise
   */

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';

  // Pure reference implementations of the existing-field behavior, independent of systemPrompt.
  function expectedEndpoint(config: unknown): string {
    const endpoint = (config as { endpoint?: unknown })?.endpoint;
    return typeof endpoint === 'string' && endpoint.trim() ? endpoint.trim() : DEFAULT_ENDPOINT;
  }

  function expectedModel(config: unknown): string {
    const model = (config as { model?: unknown })?.model;
    return typeof model === 'string' ? model.trim() : '';
  }

  function expectedAutoRename(config: unknown): boolean {
    const autoRenameEnabled = (config as { autoRenameEnabled?: unknown })?.autoRenameEnabled;
    return typeof autoRenameEnabled === 'boolean' ? autoRenameEnabled : true;
  }

  it('preserves endpoint/model/autoRenameEnabled behavior for any input (any systemPrompt)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (input) => {
          const result = normalizeChatConfig(input);
          expect(result.endpoint).toBe(expectedEndpoint(input));
          expect(result.model).toBe(expectedModel(input));
          expect(result.autoRenameEnabled).toBe(expectedAutoRename(input));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('keeps endpoint/model/autoRenameEnabled unchanged regardless of the systemPrompt value', () => {
    fc.assert(
      fc.property(
        fc.record({
          endpoint: fc.option(fc.string(), { nil: undefined }),
          model: fc.option(fc.string(), { nil: undefined }),
          autoRenameEnabled: fc.option(fc.boolean(), { nil: undefined })
        }),
        // Arbitrary systemPrompt of any type — must not influence the other fields.
        fc.anything(),
        (baseConfig, systemPrompt) => {
          const withPrompt = normalizeChatConfig({ ...baseConfig, systemPrompt });
          const withoutPrompt = normalizeChatConfig(baseConfig);

          // The three existing fields are identical whether or not systemPrompt is present.
          expect(withPrompt.endpoint).toBe(withoutPrompt.endpoint);
          expect(withPrompt.model).toBe(withoutPrompt.model);
          expect(withPrompt.autoRenameEnabled).toBe(withoutPrompt.autoRenameEnabled);

          // And they still match the current defaults/coercion behavior.
          expect(withPrompt.endpoint).toBe(expectedEndpoint(baseConfig));
          expect(withPrompt.model).toBe(expectedModel(baseConfig));
          expect(withPrompt.autoRenameEnabled).toBe(expectedAutoRename(baseConfig));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults endpoint to http://127.0.0.1:11434 for missing/blank/non-string values', () => {
    const blankOrMissing = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('', '   ', '\n\t '),
      fc.anything().filter((value) => typeof value !== 'string')
    );

    fc.assert(
      fc.property(
        blankOrMissing,
        fc.anything(),
        (endpoint, systemPrompt) => {
          const result = normalizeChatConfig({ endpoint: endpoint as string, systemPrompt });
          expect(result.endpoint).toBe(DEFAULT_ENDPOINT);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('trims non-blank string endpoints, independent of systemPrompt', () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.trim().length > 0),
        fc.anything(),
        (endpoint, systemPrompt) => {
          const result = normalizeChatConfig({ endpoint, systemPrompt });
          expect(result.endpoint).toBe(endpoint.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('trims string models and defaults non-strings to "", independent of systemPrompt', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.anything().filter((value) => typeof value !== 'string')),
        fc.anything(),
        (model, systemPrompt) => {
          const result = normalizeChatConfig({ model: model as string, systemPrompt });
          expect(result.model).toBe(typeof model === 'string' ? model.trim() : '');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves exact boolean autoRenameEnabled and defaults non-booleans to true, independent of systemPrompt', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.boolean(), fc.anything().filter((value) => typeof value !== 'boolean')),
        fc.anything(),
        (autoRenameEnabled, systemPrompt) => {
          const result = normalizeChatConfig({ autoRenameEnabled: autoRenameEnabled as boolean, systemPrompt });
          expect(result.autoRenameEnabled).toBe(
            typeof autoRenameEnabled === 'boolean' ? autoRenameEnabled : true
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
