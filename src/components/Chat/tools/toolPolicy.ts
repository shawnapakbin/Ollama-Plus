function parseBoolean(value: string | undefined): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return null;
}

/**
 * Release profile defaults to core-chat-only in production builds.
 * Override with VITE_RELEASE_CORE_CHAT=true|false when needed.
 */
export function isCoreChatReleaseProfile(): boolean {
  const override = parseBoolean(import.meta.env.VITE_RELEASE_CORE_CHAT as string | undefined);
  if (override !== null) return override;
  return Boolean(import.meta.env.PROD);
}

export function isToolingEnabledInProfile(): boolean {
  return !isCoreChatReleaseProfile();
}

export function filterToolSchemasByProfile<T extends { function: { name: string } }>(schemas: T[]): T[] {
  if (!isToolingEnabledInProfile()) return [];
  return schemas;
}

export const TOOLING_DISABLED_MESSAGE = 'Tool execution is disabled in this build profile.';
