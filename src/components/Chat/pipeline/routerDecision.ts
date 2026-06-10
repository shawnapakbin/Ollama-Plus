import { ROUTER_SYSTEM_PROMPT } from './buildPayload';

const SCENE_KEYWORDS = /\b(3d|three\.?js|scene|viewport|workspace|cube|cuboid|box|sphere|cylinder|cone|torus|plane|mesh|primitive)\b/i;
const SCENE_VERBS = /\b(add|create|spawn|generate|make|draw|render|place|move|translate|rotate|scale|resize|recolor|color|delete|remove|clear|list)\b/i;

export interface RouterResponseShape {
  message?: {
    content?: string;
  };
}

/**
 * Skips a router LLM call for prompts that clearly require scene updates.
 */
export function shouldForceTools(prompt: string): boolean {
  if (!prompt) return false;
  return SCENE_KEYWORDS.test(prompt) && SCENE_VERBS.test(prompt);
}

export function buildRouterPayload(selectedModel: string, userPrompt: string, keepAlive: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: selectedModel,
    messages: [
      { role: 'system', content: ROUTER_SYSTEM_PROMPT },
      { role: 'user', content: `User request: "${userPrompt}"\nDo you need tools for this?` }
    ],
    stream: false
  };

  if (keepAlive) payload.keep_alive = -1;
  return payload;
}

export function shouldEnableToolsFromRouterResponse(routerRes: RouterResponseShape | null | undefined): boolean {
  const content = routerRes?.message?.content;
  if (!content) return false;
  return content.toUpperCase().includes('YES');
}
