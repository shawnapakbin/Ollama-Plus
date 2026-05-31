import { useCallback, useRef, useState } from 'react';

export type SteerAbortIntent = 'stop-only' | 'interrupt-send' | null;

export interface SteerPayload {
  displayContent: string;
  ollamaContent: string;
  attachmentNames: string[];
  preview: string;
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
    generationDepthRef.current += 1;
    if (generationDepthRef.current === 1) {
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
    generationDepthRef.current -= 1;
    if (generationDepthRef.current > 0) return { flush: null, intent: null };
    const intent = steerAbortIntentRef.current;
    steerAbortIntentRef.current = null;
    if (intent === 'stop-only') {
      setIsGenerating(false);
      return { flush: null, intent };
    }
    const pending = steerQueueRef.current;
    if (pending) {
      steerQueueRef.current = null;
      setSteerQueueState(null);
      return { flush: pending, intent };
    }
    setIsGenerating(false);
    return { flush: null, intent };
  }, []);

  const clear = useCallback(() => {
    steerQueueRef.current = null;
    setSteerQueueState(null);
  }, []);

  const setAbortIntent = useCallback((intent: SteerAbortIntent) => {
    steerAbortIntentRef.current = intent;
  }, []);

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
    setAbortIntent
  };
}
