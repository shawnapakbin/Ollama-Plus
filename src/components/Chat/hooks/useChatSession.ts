import { useCallback, useEffect, useState } from 'react';
import { ipcService } from '../../../services/ipcService';
import type { ChatMessage } from '../types';

interface UseChatSessionOptions {
  sessionId: string | undefined;
  onSessionUpdate: () => void;
}

/**
 * Owns load/save/rename for a single chat session. Returns the loaded messages
 * (initialized to []) plus stable callbacks the consumer can call after each
 * turn.
 */
export function useChatSession({ sessionId, onSessionUpdate }: UseChatSessionOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const saved = await ipcService.loadChat(sessionId);
      if (cancelled) return;
      if (saved && saved.messages) setMessages(saved.messages as ChatMessage[]);
      else setMessages([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const save = useCallback(
    async (currentMsgs: ChatMessage[]) => {
      if (!sessionId) return;
      await ipcService.saveChat(sessionId, currentMsgs as unknown as Array<Record<string, unknown>>);
      onSessionUpdate();
    },
    [sessionId, onSessionUpdate]
  );

  const rename = useCallback(
    async (newTitle: string) => {
      if (!sessionId) return;
      const trimmed = newTitle.trim().replace(/["']/g, '');
      const finalTitle = trimmed.length > 50 ? trimmed.substring(0, 47) + '...' : trimmed;
      await ipcService.renameChat(sessionId, finalTitle);
      onSessionUpdate();
    },
    [sessionId, onSessionUpdate]
  );

  return { messages, setMessages, save, rename };
}
