import type { ChatMessage } from '../types';

export const TOOL_SYSTEM_PROMPT = `You have access to tools. To use them, you MUST output a JSON block like: {"tool": "tool_name", "parameters": {"arg": "val"}}. 
Available tools:
- browser_action: {action: string, url?: string, selector?: string, text?: string, key?: string, wait_for?: string, script?: string}
- web_search: {query: string} — Use this for current events, news, weather, prices, market data, recent conflicts, elections, breaking news, or any information that changes with time.
- read_wiki: {filepath: string}
- wiki_maintain: {action: "root"|"list"|"read"|"upsert_note"|"append_entry"|"search"|"set_root"|"set_autonomy"|"set_policy"|"reindex", path?: string, content?: string, entry?: string, heading?: string, query?: string, maxResults?: number, mode?: "auto"|"review"|"hybrid", level?: "strict"|"balanced"|"aggressive"}
- update_user_memory: {content: string}
- get_current_time: {timezone?: string, locale?: string}
- engineering_calculator: {expression: string, scope?: object}
- scene_3d: {action: "list"|"add"|"transform"|"remove"|"clear"|"import_model"|"list_models", kind?: "box"|"sphere"|"cylinder"|"cone"|"plane"|"torus", id?: string, color?: string, size?: number, position?: {x,y,z}, rotation?: {x,y,z}, scale?: {x,y,z}} — drives the live 3D Workspace viewport. WHENEVER the user asks to add, generate, move, scale, rotate, color, list, or remove shapes in the 3D workspace, you MUST call this tool.
- scene_annotations: {action: "list"|"remove"|"clear", id?: string}

MCP Servers (integrated tool backends):
- terminal_session: Create and manage terminal sessions (shell, PowerShell, bash). {action: "create"|"list"|"read"|"write"|"execute"|"close"}
- python_terminal: Execute Python code and manage Python sessions. {action: "health"|"create"|"list"|"read"|"execute"|"run"|"close"}
- folder_mcp: Read, write, list files in the configured folder root. {action: "root"|"select_root"|"clear_root"|"list"|"read"|"write"|"delete"|"rename"|"mkdir"}
- openscad_generate: Compile OpenSCAD scripts to 3D models. {action: "health"|"compile"}

Important guidelines:
- For current/live information (news, prices, weather, conflicts, elections), ALWAYS use web_search first before using knowledge from training.
- When the user asks about current events, breaking news, or "latest", web_search is your primary tool.
- Knowledge cutoff: July 2024. For anything after that date, use web_search.

Wiki rules:
- For user-requested "save this", "add to wiki", "remember this", or persistent profile/preferences updates, prefer wiki_maintain over folder_mcp.
- Use append_entry when adding timestamped journal-style notes and upsert_note for stable topic/profile pages.
- Respect configured policy mode returned by wiki_maintain root action; if denied, report denial clearly and continue safely.
- In strict mode, only write when user intent is explicit and set explicit: true.
- Prefer paths: profile/preferences.md for user prefs, knowledge/topics/*.md for stable facts, journal/YYYY-MM.md for timestamped logs.

Tool-call rules:
- Output exactly one JSON block per tool call.
- If the user wants multiple objects or repeated operations, output multiple JSON blocks, one per object or operation.
- Do not combine multiple scene objects into arrays.
- After tool results are returned, either output the next required JSON block(s) or provide the final answer.
- Do not narrate intended tool actions like "I'll add the third sphere" without emitting the JSON tool call.

Example to add a red cube: {"tool":"scene_3d","parameters":{"action":"add","kind":"box","color":"#ff0000"}}
Example to add three spheres in a triangle:
{"tool":"scene_3d","parameters":{"action":"add","kind":"sphere","size":1,"position":{"x":0,"y":0,"z":2.5},"color":"#2563eb"}}
{"tool":"scene_3d","parameters":{"action":"add","kind":"sphere","size":1,"position":{"x":-2.165,"y":0,"z":-1.25},"color":"#16a34a"}}
{"tool":"scene_3d","parameters":{"action":"add","kind":"sphere","size":1,"position":{"x":2.165,"y":0,"z":-1.25},"color":"#dc2626"}}`;

export const PLAIN_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

export const ROUTER_SYSTEM_PROMPT =
  'You are a routing agent. Your job is to decide if the user needs external tools. Tools available: run_shell_command (PowerShell), browser_action (Playwright), read_wiki (Markdown), wiki_maintain (persistent wiki updates/search), web_search, get_current_time (clock), engineering_calculator (mathjs), scene_3d (manipulate the live 3D Workspace viewport: add/transform/remove primitives). Answer with exactly YES or NO.';

function buildDateTimeContext(): string {
  const now = new Date();
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const timezone = resolved.timeZone || 'UTC';
  const locale = resolved.locale || 'en-US';
  const localFormatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone: timezone
  }).format(now);
  return `\n\n[CURRENT_DATE_TIME]\nLocal: ${localFormatted}\nTime zone: ${timezone}\nISO: ${now.toISOString()}`;
}

function buildCustomSystemMessageContext(customSystemMessage: string): string {
  const trimmed = customSystemMessage.trim();
  if (!trimmed) return '';
  return `[CUSTOM_SYSTEM_MESSAGE]\nTreat the following as highest-priority behavior guidance unless it conflicts with safety requirements.\n${trimmed}`;
}

export function hasToolResults(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === 'tool');
}

export function buildToolContinuationContext(currentMessages: ChatMessage[], repairContext = ''): string {
  const sections: string[] = [];
  if (hasToolResults(currentMessages)) {
    sections.push(
      '[AFTER TOOL RESULTS]\nYou have already received tool output in this conversation. If the task is not complete, emit the next JSON tool call now. Only provide a final natural-language answer when no more tool calls are needed.'
    );
  }
  if (repairContext) sections.push(`[REPAIR]\n${repairContext}`);
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

/**
 * Prepends the appropriate system prompt (tools or plain) plus any memory
 * context to the conversation history.
 */
export function buildSystemMessages(
  currentMessages: ChatMessage[],
  options: {
    useTools: boolean;
    memoryContext: string;
    repairContext?: string;
    customSystemMessage?: string;
    injectDateTime?: boolean;
  }
): ChatMessage[] {
  const base = options.useTools ? TOOL_SYSTEM_PROMPT : PLAIN_SYSTEM_PROMPT;
  const continuation = options.useTools
    ? buildToolContinuationContext(currentMessages, options.repairContext || '')
    : '';
  const dateTimeContext = options.injectDateTime ? buildDateTimeContext() : '';
  const customContext = buildCustomSystemMessageContext(options.customSystemMessage || '');
  const customPrefix = customContext ? `${customContext}\n\n` : '';
  const content = `${customPrefix}${base}${continuation}${dateTimeContext}${options.memoryContext}`;
  return [{ role: 'system', content }, ...currentMessages];
}

export function formatMemoryContext(memory: string): string {
  if (!memory) return '';
  return `\n\n[PERSISTENT MEMORY]\n${memory}`;
}
