/**
 * Unit Test: Sticky CPU-only across device reappearance
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection — Requirement 5.6
 *
 * An intentional CPU_Only_Mode selection is sticky: when a device index that
 * was previously absent reappears in the Detected_GPU list, reconciliation
 * MUST restore that index to the effective available set but MUST NOT
 * automatically switch inference from CPU_Only_Mode back to GPU mode.
 *
 * Validates: Requirements 5.6
 */

import { describe, it, expect } from 'vitest';
import { reconcileSelection } from '../../../electron/runtime/runtimeService.js';

describe('Feature: gpu-selection — sticky CPU-only across device reappearance (Requirement 5.6)', () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * A `cpuOnly: true` config that also names device 0 as allowed is reconciled
   * twice:
   *   1. against a detected list that is MISSING device 0 (device absent), and
   *   2. against a detected list where device 0 has REAPPEARED.
   *
   * In both cases the effective mode must remain 'cpu-only'. The reappearance
   * of the device must not auto-switch the mode back to GPU.
   */
  it('remains cpu-only after a previously-absent device reappears', () => {
    // A config that intentionally chose CPU-only, but still remembers that the
    // user had previously allowed device index 0.
    const config = { allowedIndices: [0], cpuOnly: true };

    // First reconciliation: device 0 is absent (only device 1 detected).
    const whileAbsent = reconcileSelection(config, [1]);
    expect(whileAbsent.mode).toBe('cpu-only');
    // Device 0 is not currently detected, so it is unavailable at this point.
    expect(whileAbsent.availableIndices).toEqual([]);
    expect(whileAbsent.unavailableIndices).toEqual([0]);

    // Second reconciliation: device 0 has reappeared in the detected list.
    const afterReappearance = reconcileSelection(config, [0, 1]);
    // Sticky: still cpu-only, NOT auto-switched back to GPU mode.
    expect(afterReappearance.mode).toBe('cpu-only');
    // The reappeared device index is restored to the effective available set.
    expect(afterReappearance.availableIndices).toEqual([0]);
    expect(afterReappearance.unavailableIndices).toEqual([]);
  });

  it('stays cpu-only regardless of which allowed devices are detected', () => {
    const config = { allowedIndices: [2, 3], cpuOnly: true };

    // None of the allowed devices detected.
    expect(reconcileSelection(config, []).mode).toBe('cpu-only');
    // All allowed devices reappear.
    expect(reconcileSelection(config, [2, 3]).mode).toBe('cpu-only');
    // Partial reappearance.
    expect(reconcileSelection(config, [3]).mode).toBe('cpu-only');
  });
});
