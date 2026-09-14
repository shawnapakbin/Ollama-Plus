/**
 * Bug Condition Exploration Test (Property 1) — Renderer boundary.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: gpu-detection-graceful-fallback
 * Property 1: Bug Condition — a graceful `unavailable` detection must NOT be
 * rendered as a hard "GPU detection failed" error, and the GPU Selection screen
 * must stay usable (a CPU-only / manual selection path is present).
 *
 * Validates: Requirements 2.5
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A BUGFIX-WORKFLOW EXPLORATION TEST. It is EXPECTED TO FAIL on the
 * current (unfixed) code — its failure confirms the bug exists.
 *
 * The bug: `GpuSelection` derives `detectionFailed = detection.ok === false`,
 * so the graceful no-strategy `{ ok: false, kind: 'unavailable' }` state renders
 * the same hard `role="alert"` "GPU detection failed" block as a genuine
 * timeout/failure, and every usable control is gated behind `gpus.length > 0`,
 * leaving the user at a dead end.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { GpuSelectionState } from '../../../src/services/runtimeClient';

// ─── Module mock ─────────────────────────────────────────────────────────────
const { getGpuSelectionState, saveGpuSelection } = vi.hoisted(() => ({
  getGpuSelectionState: vi.fn(),
  saveGpuSelection: vi.fn(),
}));

vi.mock('../../../src/services/runtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/runtimeClient')>(
    '../../../src/services/runtimeClient'
  );
  return {
    ...actual,
    runtimeClient: {
      ...actual.runtimeClient,
      getGpuSelectionState,
      saveGpuSelection,
    },
  };
});

vi.mock('../../../src/components/Settings/GpuSelection.css', () => ({}));

import { GpuSelection } from '../../../src/components/Settings/GpuSelection';

/**
 * Detection could not run any strategy at all → the graceful, NON-failure
 * `unavailable` state. This is advisory: GPU selection only affects request
 * options, so the screen must remain usable.
 */
function stateDetectionUnavailable(): GpuSelectionState {
  return {
    detection: { ok: false, error: 'no detection tool was available', kind: 'unavailable' },
    config: { allowedIndices: [], cpuOnly: false },
    effective: { mode: 'all', availableIndices: [], unavailableIndices: [] },
    appliedStateAvailable: true,
  };
}

beforeEach(() => {
  getGpuSelectionState.mockReset();
  saveGpuSelection.mockReset();
  getGpuSelectionState.mockResolvedValue(stateDetectionUnavailable());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function renderLoaded() {
  render(<GpuSelection />);
  await waitFor(() => expect(getGpuSelectionState).toHaveBeenCalled());
  await screen.findByRole('form', { name: /gpu selection settings/i });
}

describe('Feature: gpu-detection-graceful-fallback, Property 1: renderer treats `unavailable` as a neutral, usable state', () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * DESIRED: a `kind: 'unavailable'` detection renders NO hard "GPU detection
   * failed" `role="alert"` block.
   *
   * FAILS ON UNFIXED CODE: `detectionFailed = ok === false` is true for
   * `unavailable`, so the hard-failure alert is shown.
   */
  it('does not show a hard "GPU detection failed" alert for kind "unavailable"', async () => {
    await renderLoaded();

    // No hard-failure alert block should be present.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/gpu detection failed/i)).toBeNull();
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * DESIRED: the screen keeps a usable path in the `unavailable` state — a
   * CPU-only affordance / manual selection control (not gated behind detected
   * devices).
   *
   * FAILS ON UNFIXED CODE: the CPU-only affordance and Save controls only
   * render when `gpus.length > 0`, so an `unavailable` result leaves the user
   * with no usable control.
   */
  it('keeps a usable path (CPU-only / manual selection control) available for kind "unavailable"', async () => {
    await renderLoaded();

    // A usable affordance must exist: a CPU-only control or a Save/selection
    // control that lets the user proceed.
    const cpuOnly = screen.queryByRole('button', { name: /cpu only/i });
    const save = screen.queryByRole('button', { name: /save/i });
    expect(Boolean(cpuOnly) || Boolean(save)).toBe(true);
  });
});
