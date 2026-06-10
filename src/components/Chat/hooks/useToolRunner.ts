import type { ChatMessage, ToolCall } from '../types';
import { runTool } from '../tools/registry';

/**
 * Executes a single tool call and returns a normalized tool-role chat message.
 */
export function useToolRunner() {
  const run = async (call: ToolCall): Promise<ChatMessage> => {
    const fn = call.function.name;
    let args: Record<string, unknown> = {};
    const rawArgs = call.function.arguments;
    if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          role: 'tool',
          content: `Error executing tool ${fn}: Invalid JSON arguments from model (${msg}).`,
          name: fn
        };
      }
    } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    }

    const result = await runTool(fn, args);
    return {
      role: 'tool',
      content: result,
      name: fn
    };
  };

  return { run };
}
