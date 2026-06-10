import type { ChatMessage } from '../types';

export const MAX_TOOL_REPAIR_ATTEMPTS = 1;

const NARRATED_TOOL_INTENT = /\b(i(?:'| wi)?ll|let me|going to|continue by|next\s*,?\s*i(?:'| wi)?ll|i can|i should|i need to|i want to)\b/i;
const TOOLISH_ACTION = /\b(add|create|place|move|translate|rotate|scale|resize|recolor|color|delete|remove|clear|list|check|inspect|search|open|click|type|run|execute|read|write|transform|recheck)\b/i;
const COMPLETION_LANGUAGE = /\b(done|completed|finished|here(?:'| i)?s|there (?:are|is)|i (?:added|created|checked|found|ran|updated|removed|listed|completed)|the scene now|result|summary)\b/i;

function getLastToolName(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'tool') return messages[i].name || null;
  }
  return null;
}

export function looksLikeToolIntentNarration(content: string): boolean {
  const text = content.trim();
  if (!text || text.includes('{')) return false;
  return NARRATED_TOOL_INTENT.test(text) && TOOLISH_ACTION.test(text) && !COMPLETION_LANGUAGE.test(text);
}

export function buildToolRepairContext(currentMessages: ChatMessage[], currentContent: string): string | null {
  const lastTool = getLastToolName(currentMessages);
  if (!lastTool) return null;

  const parts = [
    'Your previous draft narrated the next tool action instead of emitting JSON. If more work is needed, output the next JSON tool call now.',
    'Do not describe the action first.'
  ];

  if (lastTool === 'scene_3d') {
    parts.push('For scene_3d, emit one JSON call per object or transform. If you need to verify the current scene first, call {"tool":"scene_3d","parameters":{"action":"list"}}.');
  }

  const preview = currentContent.trim().replace(/\s+/g, ' ').slice(0, 180);
  if (preview) parts.push(`Replace this narration with tool JSON if the task is still in progress: "${preview}"`);
  return parts.join(' ');
}

export function shouldRepairToolTurn(args: {
  currentMessages: ChatMessage[];
  currentContent: string;
  useTools: boolean;
  repairAttempt: number;
}): boolean {
  if (!args.useTools || args.repairAttempt >= MAX_TOOL_REPAIR_ATTEMPTS) return false;
  if (!args.currentMessages.some((message) => message.role === 'tool')) return false;
  return looksLikeToolIntentNarration(args.currentContent);
}