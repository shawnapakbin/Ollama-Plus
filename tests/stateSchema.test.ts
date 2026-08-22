import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeChatConfig } from '../electron/runtime/stateSchema.js';

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
