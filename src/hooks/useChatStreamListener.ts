/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import { useEffect, useRef } from 'react';
import { runtimeClient, type RuntimeChatStreamEvent } from '../services/runtimeClient';

type StartedEvent = Extract<RuntimeChatStreamEvent, { type: 'started' }>;
type TokenEvent = Extract<RuntimeChatStreamEvent, { type: 'token' }>;
type CompletedEvent = Extract<RuntimeChatStreamEvent, { type: 'completed' }>;
type ErrorEvent = Extract<RuntimeChatStreamEvent, { type: 'error' }>;

type UseChatStreamListenerOptions = {
  onStarted: (event: StartedEvent) => void;
  onToken: (event: TokenEvent) => void;
  onCompleted: (event: CompletedEvent) => void;
  onError: (event: ErrorEvent) => void;
};

/**
 * Subscribes to runtimeClient.onChatStream on mount and routes
 * events to the appropriate handler callback. Uses refs for handlers
 * to avoid stale closures without needing to re-subscribe.
 */
export function useChatStreamListener(options: UseChatStreamListenerOptions): void {
  const onStartedRef = useRef(options.onStarted);
  const onTokenRef = useRef(options.onToken);
  const onCompletedRef = useRef(options.onCompleted);
  const onErrorRef = useRef(options.onError);

  // Keep refs fresh on every render
  useEffect(() => {
    onStartedRef.current = options.onStarted;
    onTokenRef.current = options.onToken;
    onCompletedRef.current = options.onCompleted;
    onErrorRef.current = options.onError;
  });

  useEffect(() => {
    const unsubscribe = runtimeClient.onChatStream((event: RuntimeChatStreamEvent) => {
      switch (event.type) {
        case 'started':
          onStartedRef.current(event);
          break;
        case 'token':
          onTokenRef.current(event);
          break;
        case 'completed':
          onCompletedRef.current(event);
          break;
        case 'error':
          onErrorRef.current(event);
          break;
      }
    });

    return unsubscribe;
  }, []);
}
