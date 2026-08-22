import type { RuntimeChatConfig, RuntimeChatMessage, RuntimeSessionSummary } from './runtimeClient';

/**
 * The default title assigned to newly created sessions.
 * Sessions with this title have not been manually or AI-renamed.
 */
export const DEFAULT_SESSION_TITLE = 'Untitled runtime session';

/**
 * Evaluates whether all preconditions for automatic session renaming are met.
 *
 * Returns `true` only when ALL of the following hold:
 * 1. `config.autoRenameEnabled` is `true`
 * 2. The session title matches the default (has not been manually or AI-renamed)
 * 3. The message list contains at least one user message and one assistant message
 * 4. No rename operation is currently in progress for this session
 *
 * Returns `false` without throwing for any failing condition.
 */
export function evaluateRenameGuard(
  session: RuntimeSessionSummary,
  config: RuntimeChatConfig,
  messages: RuntimeChatMessage[],
  inProgressSessionIds: Set<string>
): boolean {
  if (config.autoRenameEnabled !== true) {
    return false;
  }

  if (session.title !== DEFAULT_SESSION_TITLE) {
    return false;
  }

  const hasUserMessage = messages.some((m) => m.role === 'user');
  const hasAssistantMessage = messages.some((m) => m.role === 'assistant');
  if (!hasUserMessage || !hasAssistantMessage) {
    return false;
  }

  if (inProgressSessionIds.has(session.id)) {
    return false;
  }

  return true;
}
