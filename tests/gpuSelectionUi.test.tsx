/**
 * Component Tests: GPU Selection UI (Task 9.3)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Exercises `src/components/Settings/GpuSelection.tsx` through React Testing
 * Library. The component loads its picture from
 * `runtimeClient.getGpuSelectionState()` on open, polls it every 2s, and
 * persists via `runtimeClient.saveGpuSelection()`. Both methods are mocked so
 * each rendered state can be driven directly.
 *
 * Coverage:
 * - Device rows with index + name (R1.5)
 * - Empty-success CPU message (R1.6)
 * - Detection-error indication (R1.7)
 * - Toggle single and multiple devices; CPU-only deselect-all (R2.1–2.4)
 * - Save success / CPU-only / unavailable-rejection / save-failure feedback (R2.5–2.8)
 * - Per-device applied allowed/disallowed state (R6.1)
 * - Reactive update on config change within the 2s window (R6.2)
 * - CPU-only applied indication (R6.3)
 * - Unmanaged-server note (R6.4)
 * - Retrieval-problem + last-state retention, then clear on next success (R6.5, R6.6)
 * - Unavailable-device list (R5.4)
 *
 * Validates: Requirements 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7,
 * 2.8, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import type { GpuSelectionState, GpuSaveResult } from '../src/services/runtimeClient';

// ─── Module mock ─────────────────────────────────────────────────────────────
// The component only touches runtimeClient.getGpuSelectionState and
// runtimeClient.saveGpuSelection; stub both with controllable spies while
// preserving the module's exported types.

const { getGpuSelectionState, saveGpuSelection } = vi.hoisted(() => ({
  getGpuSelectionState: vi.fn(),
  saveGpuSelection: vi.fn()
}));

vi.mock('../src/services/runtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../src/services/runtimeClient')>(
    '../src/services/runtimeClient'
  );
  return {
    ...actual,
    runtimeClient: {
      ...actual.runtimeClient,
      getGpuSelectionState,
      saveGpuSelection
    }
  };
});

// GpuSelection imports a CSS file; stub it so jsdom doesn't choke.
vi.mock('../src/components/Settings/GpuSelection.css', () => ({}));

import { GpuSelection } from '../src/components/Settings/GpuSelection';

// ─── State fixtures ──────────────────────────────────────────────────────────

/** Two detected GPUs, allow-all effective state. */
function stateAllowAll(): GpuSelectionState {
  return {
    detection: {
      ok: true,
      gpus: [
        { index: 0, name: 'NVIDIA RTX 4090' },
        { index: 1, name: 'NVIDIA RTX 3080' }
      ]
    },
    config: { allowedIndices: [], cpuOnly: false },
    effective: { mode: 'all', availableIndices: [0, 1], unavailableIndices: [] },
    appliedStateAvailable: true
  };
}

/** Two detected GPUs, only index 1 applied (subset). */
function stateSubsetOne(): GpuSelectionState {
  return {
    detection: {
      ok: true,
      gpus: [
        { index: 0, name: 'NVIDIA RTX 4090' },
        { index: 1, name: 'NVIDIA RTX 3080' }
      ]
    },
    config: { allowedIndices: [1], cpuOnly: false },
    effective: { mode: 'subset', availableIndices: [1], unavailableIndices: [] },
    appliedStateAvailable: true
  };
}

/** Detection succeeded but reported no GPUs (empty-success). */
function stateEmptySuccess(): GpuSelectionState {
  return {
    detection: { ok: true, gpus: [] },
    config: { allowedIndices: [], cpuOnly: false },
    effective: { mode: 'all', availableIndices: [], unavailableIndices: [] },
    appliedStateAvailable: true
  };
}

/** Detection failed. */
function stateDetectionError(): GpuSelectionState {
  return {
    detection: { ok: false, error: 'nvidia-smi not found', kind: 'unavailable' },
    config: { allowedIndices: [], cpuOnly: false },
    effective: { mode: 'all', availableIndices: [], unavailableIndices: [] },
    appliedStateAvailable: true
  };
}

/** CPU-only applied mode with one detected GPU. */
function stateCpuOnly(): GpuSelectionState {
  return {
    detection: { ok: true, gpus: [{ index: 0, name: 'NVIDIA RTX 4090' }] },
    config: { allowedIndices: [], cpuOnly: true },
    effective: { mode: 'cpu-only', availableIndices: [], unavailableIndices: [] },
    appliedStateAvailable: true
  };
}

/** One selected device unavailable (index 2), one available (index 0). */
function stateWithUnavailable(): GpuSelectionState {
  return {
    detection: { ok: true, gpus: [{ index: 0, name: 'NVIDIA RTX 4090' }] },
    config: { allowedIndices: [0, 2], cpuOnly: false },
    effective: { mode: 'subset', availableIndices: [0], unavailableIndices: [2] },
    appliedStateAvailable: true
  };
}

// ─── jsdom / helpers ─────────────────────────────────────────────────────────

beforeEach(() => {
  getGpuSelectionState.mockReset();
  saveGpuSelection.mockReset();
  getGpuSelectionState.mockResolvedValue(stateAllowAll());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Render the component and wait for the initial async load to settle. */
async function renderLoaded() {
  render(<GpuSelection />);
  await waitFor(() => expect(getGpuSelectionState).toHaveBeenCalled());
  // Wait past the loading placeholder to the rendered form.
  await screen.findByRole('form', { name: /gpu selection settings/i });
}

/** Locate a device row by its GPU name. */
function deviceRow(name: string): HTMLElement {
  return screen.getByText(name).closest('.gpu-selection-device') as HTMLElement;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GpuSelection UI', () => {
  it('renders one row per detected GPU with its index and name (R1.5)', async () => {
    await renderLoaded();

    // Both device names are shown.
    expect(screen.getByText('NVIDIA RTX 4090')).toBeTruthy();
    expect(screen.getByText('NVIDIA RTX 3080')).toBeTruthy();

    // Each row surfaces its device index.
    const row0 = deviceRow('NVIDIA RTX 4090');
    const row1 = deviceRow('NVIDIA RTX 3080');
    expect(within(row0).getByText('Index 0')).toBeTruthy();
    expect(within(row1).getByText('Index 1')).toBeTruthy();

    // One toggle switch per detected device.
    const toggles = screen.getAllByRole('switch');
    expect(toggles).toHaveLength(2);
  });

  it('shows the empty-success CPU message and no device rows when detection reports no GPUs (R1.6)', async () => {
    getGpuSelectionState.mockResolvedValue(stateEmptySuccess());
    await renderLoaded();

    expect(screen.getByText(/no gpu was detected/i)).toBeTruthy();
    expect(screen.getByText(/inference will run on cpu/i)).toBeTruthy();
    // No device rows / toggles are displayed.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    // Save area is not rendered when there are no devices.
    expect(screen.queryByRole('button', { name: /save selection/i })).toBeNull();
  });

  it('shows a detection-error indication and no device rows on an enumeration error (R1.7)', async () => {
    getGpuSelectionState.mockResolvedValue(stateDetectionError());
    await renderLoaded();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/gpu detection failed/i)).toBeTruthy();
    // The specific error string is surfaced.
    expect(screen.getByText(/nvidia-smi not found/i)).toBeTruthy();
    // No device rows.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders the unmanaged-server note (R6.4)', async () => {
    await renderLoaded();

    const note = screen.getByRole('note');
    expect(within(note).getByText(/affect only the request options/i)).toBeTruthy();
    expect(within(note).getByText(/controlled by the ollama server/i)).toBeTruthy();
  });

  it('shows per-device applied allowed/disallowed state (R6.1)', async () => {
    // Only index 1 is applied-allowed; index 0 is applied-disallowed.
    getGpuSelectionState.mockResolvedValue(stateSubsetOne());
    await renderLoaded();

    const row0 = deviceRow('NVIDIA RTX 4090'); // index 0
    const row1 = deviceRow('NVIDIA RTX 3080'); // index 1

    expect(within(row0).getByText('Applied: disallowed')).toBeTruthy();
    expect(within(row1).getByText('Applied: allowed')).toBeTruthy();
  });

  it('toggles a single device on and off (R2.1, R2.3)', async () => {
    // Start from a subset where index 0 is deselected.
    getGpuSelectionState.mockResolvedValue(stateSubsetOne());
    await renderLoaded();

    const row0 = deviceRow('NVIDIA RTX 4090'); // index 0, initially unchecked
    const toggle0 = within(row0).getByRole('switch');
    expect(toggle0.getAttribute('aria-checked')).toBe('false');

    // Toggle on.
    fireEvent.click(toggle0);
    expect(toggle0.getAttribute('aria-checked')).toBe('true');

    // Toggle back off.
    fireEvent.click(toggle0);
    expect(toggle0.getAttribute('aria-checked')).toBe('false');
  });

  it('allows selecting multiple devices as allowed (R2.2)', async () => {
    // Start CPU-derived: subset of just index 1, so index 0 is off.
    getGpuSelectionState.mockResolvedValue(stateSubsetOne());
    await renderLoaded();

    const toggle0 = within(deviceRow('NVIDIA RTX 4090')).getByRole('switch');
    const toggle1 = within(deviceRow('NVIDIA RTX 3080')).getByRole('switch');

    // index 1 already on, add index 0 → both allowed.
    expect(toggle1.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle0);

    expect(toggle0.getAttribute('aria-checked')).toBe('true');
    expect(toggle1.getAttribute('aria-checked')).toBe('true');
  });

  it('deselects every device via the CPU-only affordance (R2.4)', async () => {
    // Allow-all: both devices start checked.
    await renderLoaded();

    const toggle0 = within(deviceRow('NVIDIA RTX 4090')).getByRole('switch');
    const toggle1 = within(deviceRow('NVIDIA RTX 3080')).getByRole('switch');
    expect(toggle0.getAttribute('aria-checked')).toBe('true');
    expect(toggle1.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /cpu only \(deselect all\)/i }));

    expect(toggle0.getAttribute('aria-checked')).toBe('false');
    expect(toggle1.getAttribute('aria-checked')).toBe('false');
    // A CPU-only-pending indication appears once all devices are deselected.
    expect(screen.getByText(/no gpu allowed/i)).toBeTruthy();
  });

  it('shows a successful-save confirmation (R2.6)', async () => {
    await renderLoaded();
    saveGpuSelection.mockResolvedValue({
      ok: true,
      config: { allowedIndices: [0, 1], cpuOnly: false },
      cpuOnly: false
    } satisfies GpuSaveResult);

    fireEvent.click(screen.getByRole('button', { name: /save selection/i }));

    // Save was called with the currently-selected indices (allow-all → [0,1]).
    await waitFor(() => expect(saveGpuSelection).toHaveBeenCalled());
    expect(saveGpuSelection.mock.calls[0][0]).toMatchObject({ allowedIndices: [0, 1], cpuOnly: false });
    expect(await screen.findByText(/gpu selection saved/i)).toBeTruthy();
  });

  it('confirms CPU-only mode when saving an empty selection (R2.5)', async () => {
    await renderLoaded();
    saveGpuSelection.mockResolvedValue({
      ok: true,
      config: { allowedIndices: [], cpuOnly: true },
      cpuOnly: true
    } satisfies GpuSaveResult);
    // After the save, the reload returns the CPU-only state.
    getGpuSelectionState.mockResolvedValue(stateCpuOnly());

    // Deselect all, then save.
    fireEvent.click(screen.getByRole('button', { name: /cpu only \(deselect all\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /save selection/i }));

    await waitFor(() => expect(saveGpuSelection).toHaveBeenCalled());
    expect(saveGpuSelection.mock.calls[0][0]).toMatchObject({ allowedIndices: [], cpuOnly: true });
    // The save feedback confirms CPU-only mode ("Saved. Inference will run…").
    expect(await screen.findByText(/saved\. inference will run in cpu-only mode/i)).toBeTruthy();
  });

  it('surfaces an unavailable-device rejection and keeps the selection unchanged (R2.7)', async () => {
    await renderLoaded();
    saveGpuSelection.mockResolvedValue({
      ok: false,
      reason: 'unavailable-device',
      unavailableIndices: [1]
    } satisfies GpuSaveResult);

    fireEvent.click(screen.getByRole('button', { name: /save selection/i }));

    const feedback = await screen.findByText(/no longer available/i);
    expect(feedback).toBeTruthy();
    // The rejected index is identified in the message.
    expect(feedback.textContent).toMatch(/index 1/i);
  });

  it('surfaces a save-failure indication when persistence fails (R2.8)', async () => {
    await renderLoaded();
    saveGpuSelection.mockResolvedValue({
      ok: false,
      reason: 'persist-failed'
    } satisfies GpuSaveResult);

    fireEvent.click(screen.getByRole('button', { name: /save selection/i }));

    expect(await screen.findByText(/could not be saved/i)).toBeTruthy();
    expect(await screen.findByText(/previous selection is unchanged/i)).toBeTruthy();
  });

  it('shows a CPU-only applied indication when the effective mode is cpu-only (R6.3)', async () => {
    getGpuSelectionState.mockResolvedValue(stateCpuOnly());
    await renderLoaded();

    expect(screen.getByText(/currently running in cpu-only mode/i)).toBeTruthy();
  });

  it('lists each unavailable selected device index (R5.4)', async () => {
    getGpuSelectionState.mockResolvedValue(stateWithUnavailable());
    await renderLoaded();

    const notice = screen.getByText(/previously selected gpus unavailable/i).closest('.gpu-selection-notice') as HTMLElement;
    expect(within(notice).getByText(/no longer detected: 2/i)).toBeTruthy();
  });

  it('reactively updates the applied allowed/disallowed state within the 2s poll window (R6.2)', async () => {
    vi.useFakeTimers();
    // Initial: allow-all so both devices are applied-allowed.
    getGpuSelectionState.mockResolvedValue(stateAllowAll());

    render(<GpuSelection />);
    // Flush the initial async load under fake timers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let row0 = deviceRow('NVIDIA RTX 4090');
    expect(within(row0).getByText('Applied: allowed')).toBeTruthy();

    // The applied config changes on the server: now only index 1 is allowed.
    getGpuSelectionState.mockResolvedValue(stateSubsetOne());

    // Advance past the 2s poll interval and flush the resulting async update.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    row0 = deviceRow('NVIDIA RTX 4090'); // index 0 is now applied-disallowed
    expect(within(row0).getByText('Applied: disallowed')).toBeTruthy();
    const row1 = deviceRow('NVIDIA RTX 3080');
    expect(within(row1).getByText('Applied: allowed')).toBeTruthy();
  });

  it('retains the last state and flags a retrieval problem, then clears it on the next success (R6.5, R6.6)', async () => {
    vi.useFakeTimers();
    // Initial successful load.
    getGpuSelectionState.mockResolvedValue(stateAllowAll());

    render(<GpuSelection />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No retrieval-problem messaging on a healthy load, and devices are shown.
    expect(screen.queryByText(/applied gpu state unavailable/i)).toBeNull();
    expect(screen.getByText('NVIDIA RTX 4090')).toBeTruthy();

    // Next poll: applied state cannot be determined.
    getGpuSelectionState.mockResolvedValue({
      ...stateAllowAll(),
      appliedStateAvailable: false
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Retrieval-problem indication appears; last known devices are retained.
    expect(screen.getByText(/applied gpu state unavailable/i)).toBeTruthy();
    expect(screen.getByText(/last known state/i)).toBeTruthy();
    expect(screen.getByText('NVIDIA RTX 4090')).toBeTruthy();

    // Next poll succeeds again: the retrieval-problem indication clears.
    getGpuSelectionState.mockResolvedValue(stateAllowAll());
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/applied gpu state unavailable/i)).toBeNull();
  });
});
