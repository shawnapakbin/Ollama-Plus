import { useCallback, useEffect, useRef } from 'react';
import { ipcService } from '../../../services/ipcService';
import { taskRuntime } from '../../../services/taskRuntime';
import { buildSystemMessages, formatMemoryContext } from '../pipeline/buildPayload';
import { extractToolCallsFromContent } from '../pipeline/extractToolCalls';
import { formatMetrics } from '../pipeline/formatMetrics';
import {
  buildRouterPayload,
  shouldEnableToolsFromRouterResponse,
  shouldForceTools
} from '../pipeline/routerDecision';
import { buildToolRepairContext, shouldRepairToolTurn } from '../pipeline/toolRepair';
import { TOOL_SCHEMAS } from '../tools/registry';
import type { ChatMessage, ToolCall, OllamaFinalResponse } from '../types';
import type { SteerPayload } from './useSteerQueue';
import { useToolRunner } from './useToolRunner';

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
  completed: boolean;
}>;

interface UseChatPipelineOptions {
  hostUrl: string;
  selectedModel: string;
  keepAlive: boolean;
  chatMode: ChatMode;
  customSystemMessage: string;
  injectDateTime: boolean;
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
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const commitUserTurnRef = useRef<((payload: SteerPayload, taskId: string | null) => Promise<void>) | null>(null);
  const { run: runToolCall } = useToolRunner();

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

  const processOllamaRequest = useCallback(
    async function processOllamaRequestInner(
    currentMessages: ChatMessage[],
    taskId: string | null = null,
    repairAttempt = 0,
    repairContext = ''
  ): Promise<void> {
    const {
      selectedModel,
      hostUrl,
      keepAlive,
      chatMode,
      customSystemMessage,
      injectDateTime,
      sessionTitle,
      setMessages,
      saveSession,
      runStream,
      refreshProcessor,
      enterGeneration
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
      } catch {
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
            const routerPayload = buildRouterPayload(selectedModel, userPrompt, keepAlive);
            const routerRes = await ipcService.invokeOllama(hostUrl, '/api/chat', routerPayload);
            if (shouldEnableToolsFromRouterResponse(routerRes)) {
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
      payload.messages = buildSystemMessages(currentMessages, {
        useTools,
        memoryContext,
        repairContext,
        customSystemMessage,
        injectDateTime
      });

      const { content: currentContent, toolCalls: streamedToolCalls, finalRes, completed } = await runStream({
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

      if (!completed) {
        const trimmed = currentContent.trim();
        const interruptedContent = trimmed
          ? `${trimmed}\n\n_Generation interrupted before completion._`
          : '_Generation interrupted before completion._';
        const interruptedMsgs: ChatMessage[] = [
          ...currentMessages,
          { role: 'assistant', model: selectedModel, content: interruptedContent, metrics: null }
        ];
        setMessages(interruptedMsgs);
        await saveSession(interruptedMsgs);
        if (taskId) taskRuntime.setState(taskId, 'failed', 'Generation interrupted before completion.');
        return;
      }

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
          const toolMsg = await runToolCall(call);
          if (taskId) {
            const summary = toolMsg.content ? String(toolMsg.content).slice(0, 120) : 'No output';
            taskRuntime.addLog(taskId, `Tool ${toolMsg.name}: ${summary}`);
          }
          toolResults.push(toolMsg);
        }

        setMessages([...toolResults, { role: 'assistant', content: '', model: selectedModel }]);
        await saveSession(toolResults);
        await processOllamaRequestInner(toolResults, taskId, 0, '');
        return;
      }

      if (shouldRepairToolTurn({ currentMessages, currentContent, useTools, repairAttempt })) {
        const nextRepairContext = buildToolRepairContext(currentMessages, currentContent);
        if (nextRepairContext) {
          if (taskId) taskRuntime.addLog(taskId, 'Retrying with stricter tool-call guidance after narrated tool intent.');
          setMessages([...currentMessages, { role: 'assistant', content: '', model: selectedModel }]);
          await processOllamaRequestInner(currentMessages, taskId, repairAttempt + 1, nextRepairContext);
          return;
        }
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
        if (commitUserTurnRef.current) {
          await commitUserTurnRef.current(flush, queuedTaskId);
        }
      }
    }
  }, [runAutoRename, runToolCall]);

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
    await processOllamaRequest(ollamaMsgs, taskId, 0, '');
  }, [processOllamaRequest]);

  useEffect(() => {
    commitUserTurnRef.current = commitUserTurn;
  }, [commitUserTurn]);

  const regenerate = useCallback(async (index: number): Promise<void> => {
    const { messagesRef, setMessages, selectedModel } = optsRef.current;
    const historyBefore = messagesRef.current.slice(0, index);
    setMessages([...historyBefore, { role: 'assistant', content: '', model: selectedModel }]);
    await processOllamaRequest(historyBefore, null, 0, '');
  }, [processOllamaRequest]);

  return { commitUserTurn, regenerate };
}
