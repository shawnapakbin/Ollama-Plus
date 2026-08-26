/**
 * Session Storage Hook for Agent Chat
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Provides CRUD operations for agent sessions via IPC.
 * Manages session list and active session state, with automatic
 * loading of sessions on mount.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AgentSession,
  AgentSessionSummary,
  ChatMessage,
  TimelineEvent,
} from '../types/agentChat';

export interface UseSessionStorageReturn {
  /** List of all agent session summaries */
  sessions: AgentSessionSummary[];
  /** The currently active/loaded session (null if none) */
  activeSession: AgentSession | null;
  /** Create a new session by sending the first message (Req 5.1) */
  createSession: (firstMessage: string) => Promise<AgentSession>;
  /** Load a specific session by ID and set it as active (Req 5.3) */
  loadSession: (sessionId: string) => Promise<AgentSession>;
  /** Persist a message to the active session's local state */
  persistMessage: (sessionId: string, message: ChatMessage) => Promise<void>;
  /** Persist a timeline event to the active session's local state */
  persistEvent: (sessionId: string, event: TimelineEvent) => Promise<void>;
  /** Refresh the sessions list from backend (Req 5.2) */
  listSessions: () => Promise<AgentSessionSummary[]>;
  /** Get the last active session for app restore (Req 5.6) */
  getLastActiveSession: () => Promise<AgentSession | null>;
  /** Delete a session by ID */
  deleteSession: (sessionId: string) => Promise<void>;
}

/**
 * Hook that manages agent session storage via the Electron IPC bridge.
 *
 * - Loads the session list on mount and restores the last active session
 * - Provides methods to create, load, persist, list, and restore sessions
 * - Keeps local state in sync with the backend for the active session
 *
 * The backend persists messages and events automatically during streaming,
 * so `persistMessage` and `persistEvent` are local state updates to keep
 * the UI in sync without additional IPC round-trips.
 */
export function useSessionStorage(): UseSessionStorageReturn {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);

  /**
   * Refresh the sessions list from the backend via IPC (Req 5.2).
   */
  const listSessions = useCallback(async (): Promise<AgentSessionSummary[]> => {
    const api = window.electronAPI;
    if (!api?.listAgentChatSessions) return [];

    const items = await api.listAgentChatSessions();
    setSessions(items);
    return items;
  }, []);

  /**
   * Load a specific session by ID and set it as the active session (Req 5.3).
   * Used when selecting a session from history.
   */
  const loadSession = useCallback(async (sessionId: string): Promise<AgentSession> => {
    const api = window.electronAPI;
    if (!api?.getAgentChatSession) {
      throw new Error('Electron API not available');
    }

    const session = await api.getAgentChatSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    setActiveSession(session);
    return session;
  }, []);

  /**
   * Create a new session by sending the first message (Req 5.1).
   * The backend creates the session automatically when sendAgentChatMessage
   * is called without a sessionId.
   */
  const createSession = useCallback(async (firstMessage: string): Promise<AgentSession> => {
    const api = window.electronAPI;
    if (!api?.sendAgentChatMessage || !api?.getAgentChatSession) {
      throw new Error('Electron API not available');
    }

    // Send the first message without a sessionId — backend creates the session
    const { sessionId } = await api.sendAgentChatMessage({
      content: firstMessage,
      model: '',
      endpoint: '',
    });

    // Load the newly created session
    const session = await api.getAgentChatSession(sessionId);
    if (!session) {
      throw new Error('Failed to load newly created session');
    }
    setActiveSession(session);

    // Refresh the sessions list to include the new session
    await listSessions();

    return session;
  }, [listSessions]);

  /**
   * Persist a message to the active session's local state.
   * The backend persists automatically during streaming, so this
   * is a local state update to keep the UI in sync.
   */
  const persistMessage = useCallback(async (sessionId: string, message: ChatMessage): Promise<void> => {
    setActiveSession((current) => {
      if (!current || current.id !== sessionId) return current;
      return {
        ...current,
        messages: [...current.messages, message],
        messageCount: current.messageCount + 1,
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  /**
   * Persist a timeline event to the active session's local state.
   * The backend persists events automatically, so this updates
   * the local state to keep the UI timeline in sync.
   */
  const persistEvent = useCallback(async (sessionId: string, event: TimelineEvent): Promise<void> => {
    setActiveSession((current) => {
      if (!current || current.id !== sessionId) return current;
      return {
        ...current,
        timelineEvents: [...current.timelineEvents, event],
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  /**
   * Get the last active session for app restore (Req 5.6).
   * Sets it as the active session if found.
   */
  const getLastActiveSession = useCallback(async (): Promise<AgentSession | null> => {
    const api = window.electronAPI;
    if (!api?.getLastActiveAgentSession) return null;

    const session = await api.getLastActiveAgentSession();
    if (session) {
      setActiveSession(session);
    }
    return session;
  }, []);

  /**
   * Delete a session by ID and refresh the sessions list (Req 5.5).
   */
  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    const api = window.electronAPI;
    if (!api?.deleteAgentSession) return;

    await api.deleteAgentSession(sessionId);

    // If the deleted session is the active one, clear it
    setActiveSession((current) => {
      if (current?.id === sessionId) return null;
      return current;
    });

    // Refresh the sessions list
    await listSessions();
  }, [listSessions]);

  /**
   * Load sessions on mount and attempt to restore the last active session (Req 5.6).
   */
  useEffect(() => {
    const initialize = async () => {
      await listSessions();
      await getLastActiveSession();
    };
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessions,
    activeSession,
    createSession,
    loadSession,
    persistMessage,
    persistEvent,
    listSessions,
    getLastActiveSession,
    deleteSession,
  };
}
