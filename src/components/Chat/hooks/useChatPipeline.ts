import { useCallback, useRef } from 'react';
import { ipcService } from '../../../services/ipcService';
import { taskRuntime } from '../../../services/taskRuntime';
import { buildSystemMessages, formatMemoryContext, ROUTER_SYSTEM_PROMPT } from '../pipeline/buildPayload';
import { extractToolCallsFromContent } from '../pipeline/extractToolCalls';
import { formatMetrics } from '../pipeline/formatMetrics';
import { TOOL_SCHEMAS, runTool } from '../tools/registry';
import type { ChatMessage, ToolCall, OllamaFinalResponse } from '../types';
import type { SteerPayload } from './useSteerQueue';

type ChatMode = 'auto' | 'tools' | 'standard';
type StreamRunner = (args: {
  hostUrl: string;
  endpoint: string;
  payload: unknown;
  onChunk?: (content: string) => void;
}) => Promise<{
  content: string;
  toolCalls: ToolCall[] | null;
  finalRes: OllamaFinalResponse | null;
}>;

interface UseChatPipelineOptions {
  hostUrl: string;
  selectedModel: string;
  keepAlive: boolean;
  chatMode: ChatMode;
  sessionTitle: string;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  saveSession: (msgs: ChatMessage[]) => Promise<void>;
  renameSession: (newTitle: string) => Promise<void>;
  runStream: StreamRunner;
  refreshProcessor: () => Promise<void> | void;
  enterGeneration: () => boolean;
  exitGeneration: () => { flush: SteerPayload | null; intent: 'stop-only' | 'interrupt-send' | null };
}

/**
 * Encapsulates the recursive Ollama turn pipeline: optional router decision,
 * streamed generation, tool-call dispatch (with one re-entry per tool round),
 * persistence, and post-turn bookkeeping (processor refresh, auto-rename,
 * queued steer flush).
 *
 * Exposes only two stable entrypoints — `runUserTurn` for fresh user input,
 * and `regenerate` for replacing an assistant message in place. Internally the
 * recursion drives itself through a ref to avoid stale closures.
 */
export function useChatPipeline(opts: UseChatPipelineOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const runAutoRename = useCallback(async (currentMessages: ChatMessage[]) => {
    const { selectedModel, hostUrl, keepAlive, renameSession } = optsRef.current;
    try {
      const prompt = `You are a helpful assistant. Based on the following conversation, provide a VERY concise (3-5 words) title for this chat session. Do not use quotes or special characters.
Conversation:
${currentMessages.map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 100)}`).join('\n')}

Title:`;

      const payload: Record<string, unknown> = {
        model: selectedModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      };
      if (keepAlive) payload.keep_alive = -1;

      const res = await ipcService.invokeOllama(hostUrl, '/api/chat', payload);
      if (res && res.message && res.message.content) {
        await renameSession(res.message.content);
      }
    } catch (e) {
      console.error('Auto-rename failed', e);
    }
  }, []);

  const processOllamaRequest = useCallback(async (currentMessages: ChatMessage[], taskId: string | null = null): Promise<void> => {
    const {
      selectedModel,
      hostUrl,
      keepAlive,
      chatMode,
      sessionTitle,
      setMessages,
      saveSession,
      runStream,
      refreshProcessor,
      enterGeneration,
      exitGeneration
    } = optsRef.current;

    const firstEntry = enterGeneration();
    if (firstEntry && taskId) {
      taskRuntime.setState(taskId, 'running', 'Model generation started.');
    }
    try {
      let memoryContext = '';
      try {
        const mem = await ipcService.readWiki('memory/personal.md');
        memoryContext = formatMemoryContext(mem || '');
      } catch (e) {
        /* ignore: memory is optional */
      }

      const payload: Record<string, unknown> = {
        model: selectedModel,
        messages: currentMessages,
        stream: true
      };
      if (keepAlive) payload.keep_alive = -1;

      let useTools = false;
      if (chatMode === 'tools') {
        useTools = true;
      } else if (chatMode === 'auto') {
        const userPrompt = currentMessages[currentMessages.length - 1].content;
        if (shouldForceTools(userPrompt)) {
          useTools = true;
        } else {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: '🤔 *Evaluating tool usage...*' };
            return updated;
          });
          try {
            const routerPayload: Record<string, unknown> = {
              model: selectedModel,
              messages: [
                { role: 'system', content: ROUTER_SYSTEM_PROMPT },
                { role: 'user', content: `User request: "${userPrompt}"\nDo you need tools for this?` }
              ],
              stream: false
            };
            if (keepAlive) routerPayload.keep_alive = -1;
            const routerRes = await ipcService.invokeOllama(hostUrl, '/api/chat', routerPayload);
            if (routerRes && routerRes.message && routerRes.message.content.toUpperCase().includes('YES')) {
              useTools = true;
            }
          } catch (e) {
            console.error('Router failed', e);
          }
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: '' };
            return updated;
          });
        }
      }

      if (useTools) payload.tools = TOOL_SCHEMAS;
      payload.messages = buildSystemMessages(currentMessages, { useTools, memoryContext });

      const { content: currentContent, toolCalls: streamedToolCalls, finalRes } = await runStream({
        hostUrl,
        endpoint: '/api/chat',
        payload,
        onChunk: content => {
          setMessages(prev => {
            const updated = [...prev];
            if (updated[updated.length - 1]?.role === 'assistant') {
              updated[updated.length - 1] = { ...updated[updated.length - 1], content };
            }
            return updated;
          });
        }
      });

      let toolCalls = streamedToolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        const fallback = extractToolCallsFromContent(currentContent);
        if (fallback) toolCalls = fallback;
      }

      if (toolCalls && toolCalls.length > 0) {
        const toolResults: ChatMessage[] = [
          ...currentMessages,
          { role: 'assistant', content: currentContent, tool_calls: toolCalls }
        ];
        if (taskId) taskRuntime.addLog(taskId, `Tool calls requested: ${toolCalls.length}.`);

        for (const call of toolCalls) {
          const fn = call.function.name;
          const args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : call.function.arguments;
          const result = await runTool(fn, args);
          if (taskId) {
            const summary = result ? String(result).slice(0, 120) : 'No output';
            taskRuntime.addLog(taskId, `Tool ${fn}: ${summary}`);
          }
          toolResults.push({ role: 'tool', content: result, name: fn });
        }

        setMessages([...toolResults, { role: 'assistant', content: '', model: selectedModel }]);
        await saveSession(toolResults);
        await processOllamaRequest(toolResults, taskId);
        return;
      }

      const metrics = formatMetrics(finalRes);
      const finalMsgs: ChatMessage[] = [
        ...currentMessages,
        { role: 'assistant', model: selectedModel, content: currentContent, metrics }
      ];
      setMessages(finalMsgs);
      await saveSession(finalMsgs);
      if (taskId) taskRuntime.setState(taskId, 'done', 'Completed successfully.');

      setTimeout(refreshProcessor, 500);

      if (sessionTitle === 'New Chat' && finalMsgs.length >= 2) {
        runAutoRename(finalMsgs);
      }
    } catch (err) {
      console.error(err);
      const { setMessages: sm } = optsRef.current;
      sm([
        ...currentMessages,
        { role: 'assistant', content: '**Error**: Failed to communicate with Ollama.' }
      ]);
      if (taskId) {
        const msg = err instanceof Error ? err.message : 'Unknown generation error';
        taskRuntime.setState(taskId, 'failed', `Failed: ${msg}`);
      }
    } finally {
      const { flush } = optsRef.current.exitGeneration();
      if (flush) {
        const queuedTaskId = taskRuntime.createTask(flush.preview || 'Queued steer', 'chat');
        taskRuntime.setState(queuedTaskId, 'queued', 'Queued steer accepted after current generation.');
        await commitUserTurn(flush, queuedTaskId);
      }
    }
  }, [runAutoRename]);

  const commitUserTurn = useCallback(async (payload: SteerPayload, taskId: string | null = null): Promise<void> => {
    const { messagesRef, setMessages, selectedModel } = optsRef.current;
    const base = messagesRef.current;
    const { displayContent, ollamaContent, attachmentNames } = payload;
    const userMsg: ChatMessage = {
      role: 'user',
      content: displayContent,
      ...(attachmentNames.length ? { attachments: attachmentNames } : {})
    };
    const newMsgs = [...base, userMsg];
    const ollamaMsgs: ChatMessage[] = [...base, { role: 'user', content: ollamaContent }];
    setMessages([...newMsgs, { role: 'assistant', content: '', model: selectedModel }]);
    await processOllamaRequest(ollamaMsgs, taskId);
  }, [processOllamaRequest]);

  const regenerate = useCallback(async (index: number): Promise<void> => {
    const { messagesRef, setMessages, selectedModel } = optsRef.current;
    const historyBefore = messagesRef.current.slice(0, index);
    setMessages([...historyBefore, { role: 'assistant', content: '', model: selectedModel }]);
    await processOllamaRequest(historyBefore);
  }, [processOllamaRequest]);

  return { commitUserTurn, regenerate };
}

const SCENE_KEYWORDS = /\b(3d|three\.?js|scene|viewport|workspace|cube|cuboid|box|sphere|cylinder|cone|torus|plane|mesh|primitive)\b/i;
const SCENE_VERBS = /\b(add|create|spawn|generate|make|draw|render|place|move|translate|rotate|scale|resize|recolor|color|delete|remove|clear|list)\b/i;

/**
 * Skips the router LLM call for prompts that clearly need scene_3d. Cheap
 * heuristic: a scene-related noun plus an action verb implies the user wants
 * the viewport modified, so we enable tools immediately.
 */
function shouldForceTools(prompt: string): boolean {
  if (!prompt) return false;
  return SCENE_KEYWORDS.test(prompt) && SCENE_VERBS.test(prompt);
}
