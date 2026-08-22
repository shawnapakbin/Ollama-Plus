// Feature: auto-session-naming, Property 3: Rename Guard Correctness
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluateRenameGuard, DEFAULT_SESSION_TITLE } from '../src/services/renameGuard';
import type { RuntimeChatConfig, RuntimeChatMessage, RuntimeSessionSummary } from '../src/services/runtimeClient';

/**
 * Arbitraries for generating random test inputs
 */

const arbSessionId = fc.uuid();

const arbIsoDate = fc
  .integer({ min: new Date('2000-01-01').getTime(), max: new Date('2030-12-31').getTime() })
  .map((ts) => new Date(ts).toISOString());

const arbSession = (opts?: { forceDefaultTitle?: boolean }): fc.Arbitrary<RuntimeSessionSummary> =>
  fc.record({
    id: arbSessionId,
    title: opts?.forceDefaultTitle
      ? fc.constant(DEFAULT_SESSION_TITLE)
      : fc.oneof(fc.constant(DEFAULT_SESSION_TITLE), fc.string({ minLength: 1 })),
    status: fc.constantFrom('active', 'archived', 'completed'),
    createdAt: arbIsoDate,
    updatedAt: arbIsoDate,
    lastRunSummary: fc.string()
  });

const arbConfig = (opts?: { forceEnabled?: boolean }): fc.Arbitrary<RuntimeChatConfig> =>
  fc.record({
    endpoint: fc.webUrl(),
    model: fc.string({ minLength: 1 }),
    autoRenameEnabled: opts?.forceEnabled !== undefined ? fc.constant(opts.forceEnabled) : fc.boolean()
  });

const arbMessage = (role?: 'user' | 'assistant' | 'system'): fc.Arbitrary<RuntimeChatMessage> =>
  fc.record({
    id: fc.uuid(),
    sessionId: fc.uuid(),
    role: role ? fc.constant(role) : fc.constantFrom('system' as const, 'user' as const, 'assistant' as const),
    content: fc.string(),
    model: fc.option(fc.string(), { nil: null }),
    endpoint: fc.option(fc.string(), { nil: null }),
    createdAt: arbIsoDate,
    metrics: fc.constant(null)
  });

const arbMessagesWithUserAndAssistant: fc.Arbitrary<RuntimeChatMessage[]> = fc
  .tuple(
    arbMessage('user'),
    arbMessage('assistant'),
    fc.array(arbMessage(), { maxLength: 5 })
  )
  .map(([user, assistant, rest]) => fc.shuffledSubarray([user, assistant, ...rest], { minLength: 2 + rest.length, maxLength: 2 + rest.length }))
  .chain((arb) => arb);

const arbMessagesWithoutUser: fc.Arbitrary<RuntimeChatMessage[]> = fc.array(
  arbMessage('assistant'),
  { minLength: 0, maxLength: 5 }
);

const arbMessagesWithoutAssistant: fc.Arbitrary<RuntimeChatMessage[]> = fc.array(
  arbMessage('user'),
  { minLength: 0, maxLength: 5 }
);

describe('evaluateRenameGuard – Property 3: Rename Guard Correctness', () => {
  it('returns true when ALL four conditions hold simultaneously', () => {
    fc.assert(
      fc.property(
        arbSession({ forceDefaultTitle: true }),
        arbConfig({ forceEnabled: true }),
        arbMessagesWithUserAndAssistant,
        (session, config, messages) => {
          const inProgress = new Set<string>();
          // All conditions satisfied: enabled, default title, has user+assistant, not in progress
          expect(evaluateRenameGuard(session, config, messages, inProgress)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false when autoRenameEnabled is false (Req 4.1)', () => {
    fc.assert(
      fc.property(
        arbSession({ forceDefaultTitle: true }),
        arbConfig({ forceEnabled: false }),
        arbMessagesWithUserAndAssistant,
        (session, config, messages) => {
          const inProgress = new Set<string>();
          expect(evaluateRenameGuard(session, config, messages, inProgress)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false when session title does not match DEFAULT_SESSION_TITLE (Req 4.2)', () => {
    fc.assert(
      fc.property(
        arbSession().filter((s) => s.title !== DEFAULT_SESSION_TITLE),
        arbConfig({ forceEnabled: true }),
        arbMessagesWithUserAndAssistant,
        (session, config, messages) => {
          const inProgress = new Set<string>();
          expect(evaluateRenameGuard(session, config, messages, inProgress)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false when messages lack a user message (Req 4.3)', () => {
    fc.assert(
      fc.property(
        arbSession({ forceDefaultTitle: true }),
        arbConfig({ forceEnabled: true }),
        arbMessagesWithoutUser,
        (session, config, messages) => {
          const inProgress = new Set<string>();
          expect(evaluateRenameGuard(session, config, messages, inProgress)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false when messages lack an assistant message (Req 4.3)', () => {
    fc.assert(
      fc.property(
        arbSession({ forceDefaultTitle: true }),
        arbConfig({ forceEnabled: true }),
        arbMessagesWithoutAssistant,
        (session, config, messages) => {
          const inProgress = new Set<string>();
          expect(evaluateRenameGuard(session, config, messages, inProgress)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false when session ID is in the in-progress set (Req 4.4)', () => {
    fc.assert(
      fc.property(
        arbSession({ forceDefaultTitle: true }),
        arbConfig({ forceEnabled: true }),
        arbMessagesWithUserAndAssistant,
        (session, config, messages) => {
          const inProgress = new Set<string>([session.id]);
          expect(evaluateRenameGuard(session, config, messages, inProgress)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns true iff all four conditions hold (universal property)', () => {
    fc.assert(
      fc.property(
        arbSession(),
        arbConfig(),
        fc.oneof(arbMessagesWithUserAndAssistant, arbMessagesWithoutUser, arbMessagesWithoutAssistant, fc.constant([])),
        fc.boolean(),
        (session, config, messages, sessionInProgress) => {
          const inProgress = sessionInProgress ? new Set<string>([session.id]) : new Set<string>();

          const conditionEnabled = config.autoRenameEnabled === true;
          const conditionTitle = session.title === DEFAULT_SESSION_TITLE;
          const conditionHasUser = messages.some((m) => m.role === 'user');
          const conditionHasAssistant = messages.some((m) => m.role === 'assistant');
          const conditionNotInProgress = !inProgress.has(session.id);

          const expected = conditionEnabled && conditionTitle && conditionHasUser && conditionHasAssistant && conditionNotInProgress;
          const actual = evaluateRenameGuard(session, config, messages, inProgress);

          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });
});
