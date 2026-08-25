/**
 * Unit Tests: AgentComposer Component (Task 8.2)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tests for the chat-style input bar covering:
 * - Enter submits, Shift+Enter inserts newline
 * - Disabled state when no model configured
 * - File drop and attachment limits
 *
 * Validates: Requirements 7.2, 7.5, 7.7
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AgentComposer } from '../../../src/components/Agent/AgentComposer';

afterEach(() => {
  cleanup();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultProps(overrides: Partial<Parameters<typeof AgentComposer>[0]> = {}) {
  return {
    modelId: 'llama3:latest',
    endpoint: 'http://localhost:11434',
    isConnected: true,
    isStreaming: false,
    isPendingApproval: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

function createFile(name: string, size: number, type = 'text/plain'): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

function createDropEvent(files: File[]) {
  return {
    dataTransfer: {
      files,
      items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
      types: ['Files'],
    },
  };
}

function createDragEvent() {
  return {
    dataTransfer: {
      files: [],
      items: [],
      types: ['Files'],
    },
  };
}

// ─── Test Suite: Enter submits, Shift+Enter newlines ─────────────────────────

describe('AgentComposer: Enter submits, Shift+Enter inserts newline', () => {
  /**
   * Validates: Requirement 7.2
   * WHEN the user presses Enter (without Shift), THE Agent_Composer SHALL submit
   * the message. WHEN the user presses Shift+Enter, THE Agent_Composer SHALL
   * insert a newline.
   */

  it('calls onSend when Enter is pressed with non-empty content', async () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps({ onSend })} />);

    const textarea = screen.getByLabelText('Chat message input');
    fireEvent.change(textarea, { target: { value: 'Hello agent' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith('Hello agent', []);
  });

  it('does NOT call onSend when Shift+Enter is pressed', () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps({ onSend })} />);

    const textarea = screen.getByLabelText('Chat message input');
    fireEvent.change(textarea, { target: { value: 'Line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does NOT call onSend when content is whitespace-only', () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps({ onSend })} />);

    const textarea = screen.getByLabelText('Chat message input');
    fireEvent.change(textarea, { target: { value: '   \t\n  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does NOT call onSend when content is empty', () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps({ onSend })} />);

    const textarea = screen.getByLabelText('Chat message input');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears textarea after successful send', async () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps({ onSend })} />);

    const textarea = screen.getByLabelText('Chat message input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Send me' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('does NOT submit when streaming is active', () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps({ onSend, isStreaming: true })} />);

    const textarea = screen.getByLabelText('Chat message input');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });
});

// ─── Test Suite: Disabled when no model ──────────────────────────────────────

describe('AgentComposer: Disabled when no model configured', () => {
  /**
   * Validates: Requirement 7.7
   * WHEN no model is configured, THE Agent_Composer SHALL display the textarea
   * in a disabled state with placeholder text directing the user to configure
   * a model in Settings.
   */

  it('disables the textarea when modelId is undefined', () => {
    render(<AgentComposer {...defaultProps({ modelId: undefined })} />);

    const textarea = screen.getByLabelText('Chat message input') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('shows "Configure a model in Settings" placeholder when no model', () => {
    render(<AgentComposer {...defaultProps({ modelId: undefined })} />);

    const textarea = screen.getByLabelText('Chat message input') as HTMLTextAreaElement;
    expect(textarea.placeholder).toContain('Settings');
  });

  it('displays "No model configured" in the status bar when no model', () => {
    render(<AgentComposer {...defaultProps({ modelId: undefined })} />);

    expect(screen.getByText('No model configured')).toBeTruthy();
  });

  it('enables the textarea when a model is configured', () => {
    render(<AgentComposer {...defaultProps({ modelId: 'llama3:latest' })} />);

    const textarea = screen.getByLabelText('Chat message input') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it('shows model name in the status bar when model is configured', () => {
    render(<AgentComposer {...defaultProps({ modelId: 'llama3:latest' })} />);

    expect(screen.getByText('llama3:latest')).toBeTruthy();
  });

  it('disables the attach button when no model is configured', () => {
    render(<AgentComposer {...defaultProps({ modelId: undefined })} />);

    const attachBtn = screen.getByLabelText('Attach files');
    expect((attachBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── Test Suite: File drop and attachment limits ─────────────────────────────

describe('AgentComposer: File drop and attachment limits', () => {
  /**
   * Validates: Requirement 7.5
   * THE Agent_Composer SHALL support file attachments via a paperclip button
   * and drag-and-drop, displaying attached files as compact pill chips below
   * the textarea, with a maximum of 10 files and 50 MB total.
   */

  it('shows attachment chips when files are dropped', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    const file = createFile('readme.txt', 1024);

    fireEvent.dragOver(composer, createDragEvent());
    fireEvent.drop(composer, createDropEvent([file]));

    expect(screen.getByText('readme.txt')).toBeTruthy();
  });

  it('shows multiple file chips when multiple files are dropped', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    const files = [
      createFile('file1.txt', 500),
      createFile('file2.txt', 700),
    ];

    fireEvent.drop(composer, createDropEvent(files));

    expect(screen.getByText('file1.txt')).toBeTruthy();
    expect(screen.getByText('file2.txt')).toBeTruthy();
  });

  it('shows an error when more than 10 files are added', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    const files = Array.from({ length: 11 }, (_, i) =>
      createFile(`file${i}.txt`, 100)
    );

    fireEvent.drop(composer, createDropEvent(files));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('10');
  });

  it('shows an error when total file size exceeds 50 MB', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    // 6 files of 10 MB each = 60 MB total, exceeding 50 MB limit
    const files = Array.from({ length: 6 }, (_, i) =>
      createFile(`big${i}.bin`, 10 * 1024 * 1024)
    );

    fireEvent.drop(composer, createDropEvent(files));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('50 MB');
  });

  it('allows removing an attachment via the remove button', async () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    const file = createFile('removable.txt', 512);

    fireEvent.drop(composer, createDropEvent([file]));
    expect(screen.getByText('removable.txt')).toBeTruthy();

    const removeBtn = screen.getByLabelText('Remove removable.txt');
    fireEvent.click(removeBtn);

    expect(screen.queryByText('removable.txt')).toBeNull();
  });

  it('displays file size info in the status bar when files are attached', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    const files = [
      createFile('a.txt', 1024),
      createFile('b.txt', 2048),
    ];

    fireEvent.drop(composer, createDropEvent(files));

    // Should show "2 files" in the attachment info
    const attachInfo = document.querySelector('.agent-composer-attachment-info');
    expect(attachInfo).toBeTruthy();
    expect(attachInfo!.textContent).toContain('2 files');
  });

  it('shows drag-over visual state during drag', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    fireEvent.dragOver(composer, createDragEvent());

    expect(composer.classList.contains('drag-over')).toBe(true);
  });

  it('removes drag-over state on drag leave', () => {
    render(<AgentComposer {...defaultProps()} />);

    const composer = document.querySelector('.agent-composer')!;
    fireEvent.dragOver(composer, createDragEvent());
    fireEvent.dragLeave(composer, createDragEvent());

    expect(composer.classList.contains('drag-over')).toBe(false);
  });
});

// ─── Test Suite: Stop button and streaming state ─────────────────────────────

describe('AgentComposer: Streaming and stop behavior', () => {
  /**
   * Validates: Requirement 11.7
   * THE Agent_Page SHALL support stopping an in-progress generation via a stop
   * button that appears during streaming.
   */

  it('shows stop button when streaming', () => {
    render(<AgentComposer {...defaultProps({ isStreaming: true })} />);

    expect(screen.getByLabelText('Stop generation')).toBeTruthy();
  });

  it('shows send button when not streaming', () => {
    render(<AgentComposer {...defaultProps({ isStreaming: false })} />);

    expect(screen.getByLabelText('Send message')).toBeTruthy();
  });

  it('calls onStop when stop button is clicked', () => {
    const onStop = vi.fn();
    render(<AgentComposer {...defaultProps({ onStop, isStreaming: true })} />);

    fireEvent.click(screen.getByLabelText('Stop generation'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

// ─── Test Suite: Approval pending status ─────────────────────────────────────

describe('AgentComposer: Approval pending status', () => {
  /**
   * Validates: Requirement 4.6
   * WHILE an Approval_Gate_Block is pending, THE Agent_Chat_Stream SHALL display
   * a persistent status indicator in the composer area showing "Waiting for approval..."
   */

  it('displays approval pending status text when isPendingApproval is true', () => {
    render(<AgentComposer {...defaultProps({ isPendingApproval: true })} />);

    expect(screen.getByText('Waiting for approval...')).toBeTruthy();
  });

  it('does NOT display approval status when isPendingApproval is false', () => {
    render(<AgentComposer {...defaultProps({ isPendingApproval: false })} />);

    expect(screen.queryByText('Waiting for approval...')).toBeNull();
  });
});
