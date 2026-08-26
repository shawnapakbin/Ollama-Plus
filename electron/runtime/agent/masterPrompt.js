/**
 * Master Prompt Resolver
 *
 * Main-process-only module that owns the hidden developer-defined Master_Prompt.
 * The Master_Prompt is always applied ahead of the user's System_Prompt, is never
 * placed in Chat_Config, never crosses the preload bridge, and never lands in the
 * persisted state JSON. It is imported only by agentChatHandlers.js.
 *
 * Requirements:
 * - 1.1: The Master_Prompt is defined in an Electron main-process module.
 * - 1.2: When the override environment variable is set (even to an empty string),
 *        its value is used, overriding the built-in default.
 * - 1.7: If no Master_Prompt is defined, an empty Master_Prompt is applied; the
 *        resolver always returns a string, never null/undefined.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Environment variable that overrides the built-in default Master_Prompt. */
export const MASTER_PROMPT_ENV_VAR = 'OLLAMA_PLUS_MASTER_PROMPT';

/**
 * Built-in developer default. May be a non-empty baseline instruction or ''.
 * When empty and no override is set, the resolver yields '' (Req 1.7).
 */
const DEFAULT_MASTER_PROMPT = '';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves the effective Master_Prompt.
 * - When the override env var is present (even set to an empty string), its value
 *   wins over the built-in default (Req 1.2).
 * - Otherwise the built-in default is used.
 * - Always returns a trimmed string; never null/undefined (Req 1.7).
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] - Environment map to read from.
 * @returns {string}
 */
export function resolveMasterPrompt(env = process.env) {
  const source = env || {};
  const override = source[MASTER_PROMPT_ENV_VAR];
  const raw = typeof override === 'string' ? override : DEFAULT_MASTER_PROMPT;
  return typeof raw === 'string' ? raw.trim() : '';
}
