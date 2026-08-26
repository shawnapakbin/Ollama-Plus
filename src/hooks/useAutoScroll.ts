/**
 * Auto-Scroll Hook for Agent Chat Stream
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tracks scroll position within a container and provides auto-scroll
 * behavior for the agent chat stream. Auto-scrolls to reveal new content
 * when the user is near the bottom (within 80px), stops when the user
 * scrolls up, and provides manual scroll-to-bottom controls.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Distance in pixels from the bottom that still counts as "at bottom" */
const BOTTOM_THRESHOLD = 80;

export interface UseAutoScrollReturn {
  /** Ref to attach to the scrollable container element */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Whether the user is currently within the bottom threshold */
  isAtBottom: boolean;
  /** Smooth-scroll to the bottom and re-enable auto-scroll */
  scrollToBottom: () => void;
  /** Force scroll to bottom regardless of position (e.g., when user sends a message) */
  forceScrollToBottom: () => void;
}

/**
 * Hook that manages auto-scroll behavior for a chat stream container.
 *
 * - Auto-scrolls when new content arrives and user is near the bottom (Req 6.1)
 * - Stops auto-scrolling when user scrolls up beyond threshold (Req 6.2)
 * - Provides scrollToBottom for the floating button (Req 6.3)
 * - Provides forceScrollToBottom for user message sends (Req 6.4)
 */
export function useAutoScroll(): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Use a ref to track the latest isAtBottom value for MutationObserver callbacks
  const isAtBottomRef = useRef(true);

  /**
   * Calculate whether the container is scrolled within the bottom threshold.
   */
  const checkIsAtBottom = useCallback((element: HTMLElement): boolean => {
    const { scrollTop, scrollHeight, clientHeight } = element;
    return scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD;
  }, []);

  /**
   * Handle scroll events on the container to update isAtBottom state.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const atBottom = checkIsAtBottom(container);
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [checkIsAtBottom]);

  /**
   * Observe content changes (new messages, tool blocks, tokens) and
   * auto-scroll when the user is near the bottom.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new MutationObserver(() => {
      if (isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Also observe size changes (e.g., images loading, expanding blocks)
    const resizeObserver = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    resizeObserver.observe(container);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  /**
   * Smooth-scroll to the bottom. Used by the "scroll to bottom" button.
   * Re-engages auto-scrolling by updating isAtBottom state.
   */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  /**
   * Force scroll to bottom regardless of current position.
   * Used when the user sends a new message (Req 6.4).
   */
  const forceScrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  return {
    containerRef,
    isAtBottom,
    scrollToBottom,
    forceScrollToBottom,
  };
}
