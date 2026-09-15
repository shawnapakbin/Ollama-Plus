/**
 * Component Tests: Server Status Pill + Popup (Task 6.3)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Exercises `src/components/ServerStatus/ServerStatusPill.tsx` through React
 * Testing Library. The component is presentational: it renders a
 * header pill for the given `status`, and activating it toggles a dismissible
 * popup (role="dialog"). The Start action ("Start local server") renders only
 * for an offline Local_Endpoint with an `onStartServer` handler; an offline
 * Remote_Endpoint shows an unreachable message and no start action.
 *
 * Coverage:
 * - Pill renders each ServerStatus with the correct label (R5.2, R5.3, R5.4)
 * - Activating the pill opens the popup; toggle / close / Escape dismiss it (R5.6)
 * - offline + local → popup shows Start; click calls onStartServer (R5.7)
 * - offline + remote → popup shows unreachable message, no Start (R5.8)
 * - Changing the `status` prop updates the pill label/state (R5.5)
 * - startError text is surfaced in the popup when provided
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// The component imports a CSS file; stub it so jsdom doesn't choke.
vi.mock('../src/components/ServerStatus/ServerStatusPill.css', () => ({}));

import { ServerStatusPill } from '../src/components/ServerStatus';
import type { ServerStatus } from '../src/components/ServerStatus';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Locate the pill button (its accessible name embeds the current label). */
function pill(): HTMLElement {
  return screen.getByRole('button', { name: /ollama server status/i });
}

// ─── jsdom / lifecycle ───────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ServerStatusPill', () => {
  it('renders each ServerStatus with its correct label (R5.2, R5.3, R5.4)', () => {
    const cases: Array<[ServerStatus, RegExp]> = [
      ['checking', /^Checking…$/],
      ['starting', /^Starting…$/],
      ['online', /^Online$/],
      ['offline', /^Offline$/],
    ];

    for (const [status, label] of cases) {
      render(<ServerStatusPill status={status} />);
      // The pill button surfaces the status label as its visible text.
      expect(pill().textContent).toMatch(label);
      cleanup();
    }
  });

  it('opens the popup on activation and toggles it closed on a second activation (R5.6)', () => {
    render(<ServerStatusPill status="online" />);

    // No dialog before activation.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pill().getAttribute('aria-expanded')).toBe('false');

    // Activating opens the popup.
    fireEvent.click(pill());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(pill().getAttribute('aria-expanded')).toBe('true');

    // Activating again dismisses it.
    fireEvent.click(pill());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('dismisses the popup via the close button (R5.6)', () => {
    render(<ServerStatusPill status="offline" endpointKind="remote" />);

    fireEvent.click(pill());
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses the popup on Escape (R5.6)', () => {
    render(<ServerStatusPill status="online" />);

    fireEvent.click(pill());
    expect(screen.getByRole('dialog')).toBeTruthy();

    // The component listens on document for the Escape key.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses the popup on an outside click (R5.6)', () => {
    render(
      <div>
        <button type="button">outside</button>
        <ServerStatusPill status="online" />
      </div>,
    );

    fireEvent.click(pill());
    expect(screen.getByRole('dialog')).toBeTruthy();

    // The outside-click handler listens for mousedown outside the container.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the Start action for an offline local endpoint and calls onStartServer when clicked (R5.7)', () => {
    const onStartServer = vi.fn();
    render(
      <ServerStatusPill status="offline" endpointKind="local" onStartServer={onStartServer} />,
    );

    fireEvent.click(pill());
    const startButton = screen.getByRole('button', { name: /start local server/i });
    expect(startButton).toBeTruthy();

    fireEvent.click(startButton);
    expect(onStartServer).toHaveBeenCalledTimes(1);
  });

  it('does not offer the Start action for an offline remote endpoint and describes unreachability (R5.8)', () => {
    const onStartServer = vi.fn();
    render(
      <ServerStatusPill status="offline" endpointKind="remote" onStartServer={onStartServer} />,
    );

    fireEvent.click(pill());
    const dialog = screen.getByRole('dialog');

    // No start action is offered for a remote endpoint.
    expect(screen.queryByRole('button', { name: /start local server/i })).toBeNull();
    // The popup explains the remote server is not reachable.
    expect(dialog.textContent).toMatch(/not reachable/i);
    expect(dialog.textContent).toMatch(/cannot start a server on another machine/i);
  });

  it('does not offer the Start action when offline but the endpoint kind is unknown', () => {
    render(<ServerStatusPill status="offline" endpointKind={null} onStartServer={vi.fn()} />);

    fireEvent.click(pill());
    expect(screen.queryByRole('button', { name: /start local server/i })).toBeNull();
  });

  it('updates the pill label/state when the status prop changes (R5.5)', () => {
    const { rerender } = render(<ServerStatusPill status="checking" />);
    expect(pill().textContent).toMatch(/^Checking…$/);
    expect(pill().className).toMatch(/\bchecking\b/);

    rerender(<ServerStatusPill status="starting" />);
    expect(pill().textContent).toMatch(/^Starting…$/);
    expect(pill().className).toMatch(/\bstarting\b/);

    rerender(<ServerStatusPill status="online" />);
    expect(pill().textContent).toMatch(/^Online$/);
    expect(pill().className).toMatch(/\bonline\b/);

    rerender(<ServerStatusPill status="offline" />);
    expect(pill().textContent).toMatch(/^Offline$/);
    expect(pill().className).toMatch(/\boffline\b/);
  });

  it('surfaces startError text in the popup when provided', () => {
    render(
      <ServerStatusPill
        status="offline"
        endpointKind="local"
        onStartServer={vi.fn()}
        startError="Ollama executable could not be found."
      />,
    );

    fireEvent.click(pill());
    expect(screen.getByRole('dialog').textContent).toMatch(/could not be found/i);
  });

  it('shows the endpoint URL in the popup when provided', () => {
    render(<ServerStatusPill status="online" endpoint="http://127.0.0.1:11434" />);

    fireEvent.click(pill());
    expect(screen.getByText('http://127.0.0.1:11434')).toBeTruthy();
  });
});
