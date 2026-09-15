/**
 * Component Tests: launch Start_Prompt (Task 7.2)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Direct component tests of `src/components/ServerStatus/StartPrompt.tsx`:
 * open/closed rendering, affirmative/negative/close reporting, busy state, and
 * the Escape / backdrop dismissal (disabled while busy).
 *
 * App-level launch gating (rendering <App /> to drive whether the prompt
 * appears) is covered separately in tests/appLaunchStartPrompt.test.tsx.
 *
 * Validates: Requirements 2.1, 2.4, 2.5
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ─── Component: StartPrompt (direct) ─────────────────────────────────────────
// The component imports a CSS file; stub it so jsdom doesn't choke.
vi.mock('../src/components/ServerStatus/StartPrompt.css', () => ({}));

import { StartPrompt } from '../src/components/ServerStatus';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StartPrompt component', () => {
  it('renders nothing when open is false', () => {
    render(
      <StartPrompt open={false} onConfirm={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a modal dialog with the title when open (R2.1)', () => {
    render(<StartPrompt open onConfirm={vi.fn()} onDismiss={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText(/start the ollama server\?/i)).toBeTruthy();
  });

  it('shows the endpoint when provided', () => {
    render(
      <StartPrompt open endpoint="http://127.0.0.1:11434" onConfirm={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('http://127.0.0.1:11434')).toBeTruthy();
  });

  it('calls onConfirm when the affirmative action is clicked (R2.4)', () => {
    const onConfirm = vi.fn();
    render(<StartPrompt open onConfirm={onConfirm} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /start server/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when the negative action is clicked (R2.5)', () => {
    const onDismiss = vi.fn();
    render(<StartPrompt open onConfirm={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss via the header close button and Escape', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<StartPrompt open onConfirm={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<StartPrompt open onConfirm={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('dismisses on a backdrop mousedown', () => {
    const onDismiss = vi.fn();
    render(<StartPrompt open onConfirm={vi.fn()} onDismiss={onDismiss} />);

    // The overlay is the dialog's parent; a mousedown on it dismisses.
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows a busy label and disables the actions while busy (R4.3)', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<StartPrompt open busy onConfirm={onConfirm} onDismiss={onDismiss} />);

    const confirm = screen.getByRole('button', { name: /starting…/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect((screen.getByRole('button', { name: /not now/i }) as HTMLButtonElement).disabled).toBe(true);

    // Escape and backdrop dismissal are suppressed while busy.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
