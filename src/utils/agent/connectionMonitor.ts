/**
 * Connection Monitor
 *
 * Detects connection loss during active streaming sessions by comparing
 * the time elapsed since the last received event against a configurable timeout.
 * Used to trigger connection warning indicators and reconnection attempts.
 */

/** Default timeout threshold in milliseconds (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Determines whether the connection should be considered lost based on
 * the elapsed time since the last received event.
 *
 * @param lastEventAt - ISO 8601 timestamp of the last received event, or null if no active session
 * @param now - Current time in milliseconds (e.g., Date.now())
 * @param timeoutMs - Timeout threshold in milliseconds (default: 30000ms)
 * @returns true if the connection is considered lost, false otherwise
 */
export function isConnectionLost(
  lastEventAt: string | null,
  now: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): boolean {
  // No active session to timeout — not considered lost
  if (lastEventAt === null) {
    return false;
  }

  const lastEventTime = new Date(lastEventAt).getTime();
  return (now - lastEventTime) > timeoutMs;
}
