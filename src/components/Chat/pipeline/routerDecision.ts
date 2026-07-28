import { ROUTER_SYSTEM_PROMPT } from './buildPayload';

const SCENE_KEYWORDS = /\b(3d|3-d|three\.?js|scene|viewport|viewer|workspace|object|model|mesh|primitive|blender|glb|gltf|stl|obj|stp|step|cube|cuboid|box|sphere|cylinder|cone|torus|plane)\b/i;
const SCENE_VERBS = /\b(add|create|spawn|generate|make|draw|render|place|move|translate|rotate|scale|resize|recolor|color|delete|remove|clear|list|show|display|put|load|import|view|inspect)\b/i;
const WIKI_KEYWORDS = /\b(wiki|knowledge\s*base|knowledge|note|notes|memory|remember|profile|preference|preferences|journal)\b/i;
const WIKI_VERBS = /\b(save|store|remember|add|append|update|write|record|log|capture|persist)\b/i;
const LIVE_INFO_KEYWORDS = /\b(current|latest|today|now|real[ -]?time|up[ -]?to[ -]?date|breaking|news|headline|headlines|status|state\s+of|weather|forecast|price|market|stock|rates|exchange\s+rate|war|conflict|ceasefire|election|scores?)\b/i;
const LIVE_INFO_VERBS = /\b(give|show|check|find|search|look\s*up|tell|update|summari[sz]e|what(?:'s| is)|how\s+is)\b/i;
const DEV_TOOL_KEYWORDS = /\b(debug|diagnose|investigate|reproduce|fix|run|execute|terminal|shell|command|script|tests?|log|stack\s*trace|traceback|error|failing|build|compile|lint)\b/i;
const DEV_TOOL_VERBS = /\b(run|execute|debug|diagnose|check|inspect|trace|fix|repair|investigate|reproduce|open|read|edit|patch|test|build|compile|lint)\b/i;

export interface RouterResponseShape {
  message?: {
    content?: string;
  };
}

export function shouldSkipRouterForModel(selectedModel: string): boolean {
  return /qwen/i.test(selectedModel || '');
}

/**
 * Skips a router LLM call for prompts that clearly require tool usage.
 */
export function shouldForceTools(prompt: string): boolean {
  if (!prompt) return false;
  const sceneIntent = SCENE_KEYWORDS.test(prompt) && SCENE_VERBS.test(prompt);
  const wikiIntent = WIKI_KEYWORDS.test(prompt) && WIKI_VERBS.test(prompt);
  const liveInfoIntent = LIVE_INFO_KEYWORDS.test(prompt) && LIVE_INFO_VERBS.test(prompt);
  const devIntent = DEV_TOOL_KEYWORDS.test(prompt) && DEV_TOOL_VERBS.test(prompt);
  return sceneIntent || wikiIntent || liveInfoIntent || devIntent;
}

export function hasPriorToolUsage(
  messages: Array<{ role?: string; tool_calls?: unknown[] | null }>
): boolean {
  return messages.some((message) => {
    if (message.role === 'tool') return true;
    if (message.role !== 'assistant') return false;
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  });
}

export function buildRouterPayload(
  selectedModel: string,
  userPrompt: string,
  _keepAlive: boolean,
  modelContextWindow: number | null = null
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    temperature: 0,
    num_predict: 8
  };
  if (modelContextWindow && modelContextWindow > 0) options.num_ctx = modelContextWindow;

  const payload: Record<string, unknown> = {
    model: selectedModel,
    messages: [
      { role: 'system', content: ROUTER_SYSTEM_PROMPT },
      { role: 'user', content: `User request: "${userPrompt}"\nDo you need tools for this?` }
    ],
    stream: false,
    think: false,
    keep_alive: 0,
    options
  };
  return payload;
}

export function shouldEnableToolsFromRouterResponse(routerRes: RouterResponseShape | null | undefined): boolean {
  const content = routerRes?.message?.content;
  if (!content) return false;
  return content.toUpperCase().includes('YES');
}
