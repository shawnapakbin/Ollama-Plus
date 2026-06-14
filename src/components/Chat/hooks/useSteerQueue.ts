import { useCallback, useRef, useState } from 'react';

export type SteerAbortIntent = 'stop-only' | 'interrupt-send' | null;

export interface SteerPayload {
  displayContent: string;
  ollamaContent: string;
  attachmentNames: string[];
  preview: string;
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
  const [steerQueue, setSteerQueueState] = useState<SteerPayload | null>(null);
  const steerQueueRef = useRef<SteerPayload | null>(null);
  const generationDepthRef = useRef(0);
  const steerAbortIntentRef = useRef<SteerAbortIntent>(null);

  const setSteerQueue = useCallback((p: SteerPayload | null) => {
    steerQueueRef.current = p;
    setSteerQueueState(p);
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
    }

    if (!transition.completed) return { flush: null, intent: null };

    setIsGenerating(false);
    return { flush: transition.flush, intent: transition.intent };
  }, []);

  const clear = useCallback(() => {
    steerQueueRef.current = null;
    setSteerQueueState(null);
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
