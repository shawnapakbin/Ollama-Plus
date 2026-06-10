import type { ChatMessage, ToolCall } from '../types';
import { runTool } from '../tools/registry';

/**
 * Executes a single tool call and returns a normalized tool-role chat message.
 */
export function useToolRunner() {
  const run = async (call: ToolCall): Promise<ChatMessage> => {
    const fn = call.function.name;
    const args = typeof call.function.arguments === 'string'
      ? JSON.parse(call.function.arguments)
      : call.function.arguments;

    const result = await runTool(fn, args);
    return {
      role: 'tool',
      content: result,
      name: fn
    };
  };

  return { run };
}
