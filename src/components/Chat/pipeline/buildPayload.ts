import type { ChatMessage } from '../types';

export const TOOL_SYSTEM_PROMPT = `You have access to tools. To use them, you MUST output a JSON block like: {"tool": "tool_name", "parameters": {"arg": "val"}}. 
Available tools:
- run_shell_command: {command: string}
- browser_action: {action: string, url?: string, selector?: string, text?: string, key?: string, wait_for?: string, script?: string}
- read_wiki: {filepath: string}
- web_search: {query: string}
- update_user_memory: {content: string} (Store facts here)
- get_current_time: {timezone?: string, locale?: string}
- engineering_calculator: {expression: string, scope?: object}
- scene_3d: {action: "list"|"add"|"transform"|"remove"|"clear", kind?: "box"|"sphere"|"cylinder"|"cone"|"plane"|"torus", id?: string, color?: string, size?: number, position?: {x,y,z}, rotation?: {x,y,z}, scale?: {x,y,z}} — drives the live 3D Workspace viewport. WHENEVER the user asks to add, generate, move, scale, rotate, color, list, or remove shapes in the 3D workspace, you MUST call this tool instead of writing three.js code or instructions. Do not paste three.js snippets. Example to add a red cube: {"tool":"scene_3d","parameters":{"action":"add","kind":"box","color":"#ff0000"}}`;

export const PLAIN_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

export const ROUTER_SYSTEM_PROMPT =
  'You are a routing agent. Your job is to decide if the user needs external tools. Tools available: run_shell_command (PowerShell), browser_action (Playwright), read_wiki (Markdown), web_search, get_current_time (clock), engineering_calculator (mathjs), scene_3d (manipulate the live 3D Workspace viewport: add/transform/remove primitives). Answer with exactly YES or NO.';

/**
 * Prepends the appropriate system prompt (tools or plain) plus any memory
 * context to the conversation history.
 */
export function buildSystemMessages(
  currentMessages: ChatMessage[],
  options: { useTools: boolean; memoryContext: string }
): ChatMessage[] {
  const base = options.useTools ? TOOL_SYSTEM_PROMPT : PLAIN_SYSTEM_PROMPT;
  const content = options.memoryContext ? `${base}${options.memoryContext}` : base;
  return [{ role: 'system', content }, ...currentMessages];
}

export function formatMemoryContext(memory: string): string {
  if (!memory) return '';
  return `\n\n[PERSISTENT MEMORY]\n${memory}`;
}
