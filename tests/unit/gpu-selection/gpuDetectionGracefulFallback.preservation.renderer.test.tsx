/**
 * Preservation Test (Property 2) — Renderer boundary (Task 2).
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: gpu-detection-graceful-fallback
 * Property 2: Preservation — non-strategy-selection outcomes render unchanged.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OBSERVATION-FIRST PRESERVATION TESTS at the component boundary. These capture
 * the renderer's CURRENT (unfixed) observable behavior for the non-bug-condition
 * detection outcomes and are EXPECTED TO PASS on the unfixed code. They lock in
 * the display contract the fix must not regress:
 *
 *   • A hard detection failure (`timeout`, and post-fix `failed`) renders the
 *     hard "GPU detection failed" `role="alert"` block. (3.3, 3.4)
 *   • Empty success (`{ ok: true, gpus: [] }`) renders the CPU note. (3.2)
 *   • A non-empty device list renders the device rows. (3.1)
 *
 * NOTE on the malfunctioning-tool case (3.4): the post-fix result shape is
 * `{ ok: false, kind: 'failed' }`. Tasks 3.2/3.3 have landed, so `kind: 'failed'`
 * is now part of the shared `EnumerationResult` union and the renderer narrows
 * `detectionFailed` to `ok === false && kind !== 'unavailable'` — `timeout` and
 * `failed` are hard failures, while `unavailable` is the neutral, non-failure
 * state. The malfunctioning-tool assertion therefore drives the strict
 * `kind: 'failed'` result directly and expects the hard `role="alert"` block.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { EnumerationResult, GpuSelectionState } from '../../../src/services/runtimeClient';

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

/** Build a selection state around a given detection result. */
function stateFor(detection: EnumerationResult): GpuSelectionState {
  const detected = detection.ok ? detection.gpus.map((g) => g.index) : [];
  return {
    detection,
    config: { allowedIndices: detected, cpuOnly: false },
    effective: { mode: 'all', availableIndices: detected, unavailableIndices: [] },
    appliedStateAvailable: true,
  };
}

beforeEach(() => {
  getGpuSelectionState.mockReset();
  saveGpuSelection.mockReset();
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

describe('Feature: gpu-detection-graceful-fallback, Property 2 (renderer): non-bug-condition outcomes render unchanged', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * Timeout preserved: a `{ ok: false, kind: 'timeout' }` detection renders the
   * hard "GPU detection failed" `role="alert"` block.
   */
  it('renders the hard "GPU detection failed" alert for kind "timeout"', async () => {
    getGpuSelectionState.mockResolvedValue(
      stateFor({ ok: false, error: 'GPU enumeration did not complete within 5000 ms.', kind: 'timeout' })
    );
    await renderLoaded();

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(screen.getByText(/gpu detection failed/i)).toBeTruthy();
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Malfunctioning-tool preserved at the renderer boundary: a strict
   * `{ ok: false, kind: 'failed' }` detection (the shape a malfunctioning tool
   * produces — a strategy ran but did not report a valid device list) renders
   * the hard "GPU detection failed" `role="alert"` block. Tasks 3.2/3.3 have
   * landed, so `kind: 'failed'` now exists in the shared `EnumerationResult`
   * union and the renderer treats it as a hard failure distinct from the
   * neutral, non-failure `unavailable` state. This asserts the strict `failed`
   * classification directly (no longer deferred, no `timeout`/`unavailable`
   * stand-in).
   */
  it('surfaces a hard failure alert for a malfunctioning-tool result (strict kind "failed")', async () => {
    // A malfunctioning-tool detection: kind 'failed'. The renderer treats
    // 'failed' (like 'timeout') as a hard failure, distinct from 'unavailable'.
    getGpuSelectionState.mockResolvedValue(
      stateFor({
        ok: false,
        error: 'GPU enumeration failed: a detection tool ran but did not report a valid device list.',
        kind: 'failed',
      })
    );
    await renderLoaded();

    // A malfunctioning tool (kind 'failed') surfaces the hard alert.
    expect(screen.queryByRole('alert')).not.toBeNull();
    expect(screen.getByText(/gpu detection failed/i)).toBeTruthy();
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Empty success preserved: `{ ok: true, gpus: [] }` renders the CPU note
   * ("No GPU detected … Inference will run on CPU"), not a hard-failure alert.
   */
  it('renders the CPU note for empty success and shows no hard-failure alert', async () => {
    getGpuSelectionState.mockResolvedValue(stateFor({ ok: true, gpus: [] }));
    await renderLoaded();

    expect(screen.getByText(/no gpu detected/i)).toBeTruthy();
    expect(screen.getByText(/inference will run on cpu/i)).toBeTruthy();
    // Empty success is not a hard failure.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Successful detection preserved: a non-empty device list renders one row per
   * detected device, each showing its index and name.
   */
  it('renders the device list when devices exist, with index and name', async () => {
    getGpuSelectionState.mockResolvedValue(
      stateFor({
        ok: true,
        gpus: [
          { index: 0, name: 'AMD Radeon VII' },
          { index: 1, name: 'AMD Radeon Pro W7600' },
        ],
      })
    );
    await renderLoaded();

    expect(screen.getByText(/detected gpus/i)).toBeTruthy();
    expect(screen.getByText('AMD Radeon VII')).toBeTruthy();
    expect(screen.getByText('AMD Radeon Pro W7600')).toBeTruthy();
    // No hard-failure alert for a successful detection.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
