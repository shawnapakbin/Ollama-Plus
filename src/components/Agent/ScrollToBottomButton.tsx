/**
 * ScrollToBottomButton Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Floating circular button that appears when the user scrolls up
 * beyond the auto-scroll threshold. Clicking it smooth-scrolls the
 * chat stream back to the latest content.
 *
 * Requirements: 6.2, 6.3
 */
import './ScrollToBottomButton.css';

interface ScrollToBottomButtonProps {
  isVisible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ isVisible, onClick }: ScrollToBottomButtonProps) {
  const className = [
    'scroll-to-bottom-button',
    !isVisible && 'scroll-to-bottom-button--hidden',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={className}
      onClick={onClick}
      aria-label="Scroll to bottom"
      tabIndex={isVisible ? 0 : -1}
    >
      <svg
        className="scroll-to-bottom-button__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
