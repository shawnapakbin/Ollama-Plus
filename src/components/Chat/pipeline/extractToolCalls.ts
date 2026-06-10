import type { ToolCall } from '../types';

const SCENE_ACTIONS = new Set(['list', 'add', 'transform', 'remove', 'clear']);
const SCENE_KINDS = new Set(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus']);

/**
 * Fallback extractor for models that emit tool calls as inline JSON instead of
 * using the native `tool_calls` field. Scans the streamed content for any
 * brace-balanced JSON object (arbitrary nesting), then maps recognized shapes
 * onto our tool registry names.
 */
export function extractToolCallsFromContent(content: string): ToolCall[] | null {
  if (!content || !content.includes('{')) return null;

  const candidates = findJsonObjects(content);
  if (candidates.length === 0) return null;

  const calls: ToolCall[] = [];
  for (const str of candidates) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(str) as Record<string, unknown>;
    } catch {
      continue;
    }
    const toolName = inferToolName(parsed);
    if (!toolName) continue;
    const args = pickArgs(parsed, toolName);
    calls.push({
      function: {
        name: toolName === 'search' ? 'web_search' : toolName,
        arguments: args
      }
    });
  }
  return calls.length > 0 ? calls : null;
}

function pickArgs(parsed: Record<string, unknown>, toolName: string): Record<string, unknown> {
  const explicit =
    (parsed.parameters as Record<string, unknown> | undefined) ||
    (parsed.params as Record<string, unknown> | undefined) ||
    (parsed.arguments as Record<string, unknown> | undefined);
  if (explicit) return explicit;
  if (typeof parsed.tool === 'string') {
    const rest = { ...parsed };
    delete rest.tool;
    return rest;
  }
  // For shape-inferred calls (scene_3d, run_shell_command, ...) the whole
  // object IS the argument bag.
  void toolName;
  return parsed;
}

function inferToolName(parsed: Record<string, unknown>): string | null {
  if (typeof parsed.tool === 'string') return parsed.tool;
  if (typeof parsed.name === 'string' && (parsed.parameters || parsed.arguments)) return parsed.name;

  // scene_3d shape detection: an `action` from the scene action set, possibly
  // with kind/id/position/etc. Distinguish from browser_action which uses
  // very different action verbs (goto, click, type, ...).
  if (typeof parsed.action === 'string') {
    const action = parsed.action.toLowerCase();
    if (SCENE_ACTIONS.has(action)) {
      const kind = typeof parsed.kind === 'string' ? parsed.kind.toLowerCase() : null;
      const hasSceneHint =
        (kind && SCENE_KINDS.has(kind)) ||
        typeof parsed.id === 'string' ||
        parsed.position !== undefined ||
        parsed.rotation !== undefined ||
        parsed.scale !== undefined ||
        parsed.color !== undefined ||
        parsed.size !== undefined ||
        action === 'list' ||
        action === 'clear';
      if (hasSceneHint) return 'scene_3d';
    }
  }

  if (typeof parsed.kind === 'string' && SCENE_KINDS.has(parsed.kind.toLowerCase())) return 'scene_3d';

  if (typeof parsed.command === 'string') return 'run_shell_command';
  if (typeof parsed.query === 'string' || typeof parsed.q === 'string') return 'web_search';
  if (hasNonEmpty(parsed, 'expression') || hasNonEmpty(parsed, 'expr')) return 'engineering_calculator';
  return null;
}

function hasNonEmpty(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  return v !== undefined && v !== '';
}

/**
 * Scans for top-level brace-balanced JSON objects in arbitrary text. Respects
 * string literals (so braces inside strings don't break matching) and supports
 * any nesting depth.
 */
function findJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}
