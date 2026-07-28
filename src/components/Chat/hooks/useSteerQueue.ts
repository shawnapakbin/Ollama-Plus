import { useCallback, useRef, useState } from 'react';

export type SteerAbortIntent = 'stop-only' | 'interrupt-send' | null;

export interface SteerPayload {
  displayContent: string;
  ollamaContent: string;
  attachmentNames: string[];
  imagePayloads: string[];
  imageReferences: string[];
  preview: string;
}

export const STEER_QUEUE_STORAGE_KEY = 'ollama-plus.steer-queue.v1';

export function sanitizeSteerPayload(value: unknown): SteerPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SteerPayload>;
  if (typeof raw.displayContent !== 'string' || typeof raw.ollamaContent !== 'string' || typeof raw.preview !== 'string') {
    return null;
  }
  const attachmentNames = Array.isArray(raw.attachmentNames)
    ? raw.attachmentNames.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const imagePayloads = Array.isArray(raw.imagePayloads)
    ? raw.imagePayloads.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const imageReferences = Array.isArray(raw.imageReferences)
    ? raw.imageReferences.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    displayContent: raw.displayContent,
    ollamaContent: raw.ollamaContent,
    attachmentNames,
    imagePayloads,
    imageReferences,
    preview: raw.preview
  };
}

export function loadPersistedSteerPayload(): SteerPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STEER_QUEUE_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSteerPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistSteerPayload(payload: SteerPayload | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!payload) {
      window.localStorage.removeItem(STEER_QUEUE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STEER_QUEUE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors in privacy-restricted environments.
  }
}

interface EnterGenerationTransition {
  nextGenerationDepth: number;
  firstEntry: boolean;
}

interface ExitGenerationTransition {
  nextGenerationDepth: number;
  nextIntent: SteerAbortIntent;
  nextPending: SteerPayload | null;
  flush: SteerPayload | null;
  intent: SteerAbortIntent;
  completed: boolean;
}

export function enterGenerationTransition(generationDepth: number): EnterGenerationTransition {
  const nextGenerationDepth = generationDepth + 1;
  return {
    nextGenerationDepth,
    firstEntry: nextGenerationDepth === 1
  };
}

export function exitGenerationTransition(
  generationDepth: number,
  intent: SteerAbortIntent,
  pending: SteerPayload | null
): ExitGenerationTransition {
  const nextGenerationDepth = generationDepth - 1;

  if (nextGenerationDepth > 0) {
    return {
      nextGenerationDepth,
      nextIntent: intent,
      nextPending: pending,
      flush: null,
      intent: null,
      completed: false
    };
  }

  if (intent === 'stop-only') {
    return {
      nextGenerationDepth,
      nextIntent: null,
      nextPending: pending,
      flush: null,
      intent,
      completed: true
    };
  }

  if (pending) {
    return {
      nextGenerationDepth,
      nextIntent: null,
      nextPending: null,
      flush: pending,
      intent,
      completed: true
    };
  }

  return {
    nextGenerationDepth,
    nextIntent: null,
    nextPending: pending,
    flush: null,
    intent,
    completed: true
  };
}

/**
 * Encapsulates the "steer queue" semantics: while a generation is in flight,
 * a new user send is buffered and either flushed when the generation completes
 * or dropped if the user explicitly stops. The hook tracks recursion depth so
 * that a tool-loop re-entry does not flip `isGenerating` back to false midway.
 */
export function useSteerQueue() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [steerQueue, setSteerQueueState] = useState<SteerPayload | null>(() => loadPersistedSteerPayload());
  const steerQueueRef = useRef<SteerPayload | null>(steerQueue);
  const generationDepthRef = useRef(0);
  const steerAbortIntentRef = useRef<SteerAbortIntent>(null);

  const setSteerQueue = useCallback((p: SteerPayload | null) => {
    steerQueueRef.current = p;
    setSteerQueueState(p);
    persistSteerPayload(p);
  }, []);

  const enterGeneration = useCallback(() => {
    const transition = enterGenerationTransition(generationDepthRef.current);
    generationDepthRef.current = transition.nextGenerationDepth;
    if (transition.firstEntry) {
      setIsGenerating(true);
      return true; // first entry
    }
    return false;
  }, []);

  /**
   * Decrement the depth counter at the end of a generation. When the
   * outermost frame exits, returns either a pending steer payload to flush or
   * null. Callers should respect the returned intent: `'stop-only'` means the
   * user pressed Stop and any queue should be honored on the next send only.
   */
  const exitGeneration = useCallback((): { flush: SteerPayload | null; intent: SteerAbortIntent } => {
    const transition = exitGenerationTransition(
      generationDepthRef.current,
      steerAbortIntentRef.current,
      steerQueueRef.current
    );

    generationDepthRef.current = transition.nextGenerationDepth;
    steerAbortIntentRef.current = transition.nextIntent;
    if (transition.nextPending !== steerQueueRef.current) {
      steerQueueRef.current = transition.nextPending;
      setSteerQueueState(transition.nextPending);
      persistSteerPayload(transition.nextPending);
    }

    if (!transition.completed) return { flush: null, intent: null };

    setIsGenerating(false);
    return { flush: transition.flush, intent: transition.intent };
  }, []);

  const clear = useCallback(() => {
    steerQueueRef.current = null;
    setSteerQueueState(null);
    persistSteerPayload(null);
  }, []);

  const setAbortIntent = useCallback((intent: SteerAbortIntent) => {
    steerAbortIntentRef.current = intent;
  }, []);

  const getAbortIntent = useCallback((): SteerAbortIntent => steerAbortIntentRef.current, []);

  return {
    isGenerating,
    setIsGenerating,
    steerQueue,
    setSteerQueue,
    steerQueueRef,
    generationDepthRef,
    enterGeneration,
    exitGeneration,
    clear,
    setAbortIntent,
    getAbortIntent
  };
}
