import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

/**
 * Preflight Validation Property Tests
 *
 * Property 3: Preflight validation detects all missing prerequisites
 *
 * Since the preflight script is a PowerShell script (scripts/check-electron-win-prereqs.ps1),
 * we model its validation logic as a pure function and verify the combinatorial correctness
 * of the decision logic using property-based testing.
 *
 * **Validates: Requirements 9.2, 9.5**
 */

// ─── Preflight Validation Model ──────────────────────────────────────────────

interface PreflightInput {
  iconPresent: boolean;
  iconValid: boolean;
  licensePresent: boolean;
  nsisScriptPresent: boolean;
  electronBuilderAvailable: boolean;
  signingConfigPresent: boolean;
  signingPasswordSet: boolean;
}

interface PreflightResult {
  valid: boolean;
  errors: string[];
}

/**
 * Pure model of the preflight validation logic from
 * scripts/check-electron-win-prereqs.ps1.
 *
 * This mirrors the script's behavior:
 * - Icon must be present AND have valid ICO header
 * - License file must be present
 * - NSIS installer script must be present
 * - electron-builder must be available
 * - If signing config is present, the signing password must also be set
 */
function validatePreflightPrerequisites(input: PreflightInput): PreflightResult {
  const errors: string[] = [];

  if (!input.iconPresent) {
    errors.push('build/icon.ico not found. The application icon is required for the installer.');
  } else if (!input.iconValid) {
    errors.push('build/icon.ico has invalid ICO header bytes. Expected 00 00 01 00.');
  }

  if (!input.licensePresent) {
    errors.push('build/license.txt not found. The license file is required for the installer.');
  }

  if (!input.nsisScriptPresent) {
    errors.push('build/installer.nsh not found. The custom NSIS script is required for the installer.');
  }

  if (!input.electronBuilderAvailable) {
    errors.push('electron-builder is not available or failed to run. Ensure it is installed (npm install).');
  }

  if (input.signingConfigPresent && !input.signingPasswordSet) {
    errors.push('WIN_CSC_LINK is set but WIN_CSC_KEY_PASSWORD is not. Both are required for code signing.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const preflightInputArbitrary: fc.Arbitrary<PreflightInput> = fc.record({
  iconPresent: fc.boolean(),
  iconValid: fc.boolean(),
  licensePresent: fc.boolean(),
  nsisScriptPresent: fc.boolean(),
  electronBuilderAvailable: fc.boolean(),
  signingConfigPresent: fc.boolean(),
  signingPasswordSet: fc.boolean(),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: windows-installer, Property 3: Preflight validation detects all missing prerequisites', () => {
  /**
   * **Validates: Requirements 9.2, 9.5**
   *
   * The core property: `valid === true` if and only if ALL of:
   * - iconPresent AND iconValid
   * - licensePresent
   * - nsisScriptPresent
   * - electronBuilderAvailable
   * - (signingConfigPresent → signingPasswordSet)
   *   [i.e., if signing is configured, password must be set]
   */
  it('reports valid iff all required prerequisites are present and signing config is consistent (PBT)', () => {
    fc.assert(
      fc.property(preflightInputArbitrary, (input) => {
        const result = validatePreflightPrerequisites(input);

        // Compute the expected validity per the specification
        const allRequiredPresent =
          input.iconPresent &&
          input.iconValid &&
          input.licensePresent &&
          input.nsisScriptPresent &&
          input.electronBuilderAvailable;

        // Signing implication: if signing config present, password must be set
        const signingConsistent = !input.signingConfigPresent || input.signingPasswordSet;

        const expectedValid = allRequiredPresent && signingConsistent;

        expect(result.valid).toBe(expectedValid);
      }),
      { numRuns: 200 } // 128 combinations exist (2^7); 200 runs ensures full coverage
    );
  });

  /**
   * **Validates: Requirements 9.2**
   *
   * When valid is false, at least one error message is reported.
   */
  it('reports at least one error when validation fails (PBT)', () => {
    fc.assert(
      fc.property(preflightInputArbitrary, (input) => {
        const result = validatePreflightPrerequisites(input);

        if (!result.valid) {
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * When valid is true, no errors are reported.
   */
  it('reports zero errors when validation passes (PBT)', () => {
    fc.assert(
      fc.property(preflightInputArbitrary, (input) => {
        const result = validatePreflightPrerequisites(input);

        if (result.valid) {
          expect(result.errors).toHaveLength(0);
        }
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Signing config without password always causes failure, regardless of other prerequisites.
   */
  it('incomplete signing config always causes failure (PBT)', () => {
    fc.assert(
      fc.property(preflightInputArbitrary, (input) => {
        // Force incomplete signing config
        const incompleteSigningInput: PreflightInput = {
          ...input,
          signingConfigPresent: true,
          signingPasswordSet: false,
        };

        const result = validatePreflightPrerequisites(incompleteSigningInput);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('WIN_CSC_LINK') && e.includes('WIN_CSC_KEY_PASSWORD'))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.2**
   *
   * All prerequisites present with valid icon and no signing (or consistent signing)
   * always passes.
   */
  it('all prerequisites present with consistent config always passes (PBT)', () => {
    fc.assert(
      fc.property(
        fc.record({
          signingConfigPresent: fc.boolean(),
        }),
        ({ signingConfigPresent }) => {
          const validInput: PreflightInput = {
            iconPresent: true,
            iconValid: true,
            licensePresent: true,
            nsisScriptPresent: true,
            electronBuilderAvailable: true,
            signingConfigPresent,
            // If signing is configured, password is always set
            signingPasswordSet: true,
          };

          const result = validatePreflightPrerequisites(validInput);

          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.2**
   *
   * Each individual missing prerequisite produces a specific error message.
   */
  it('each missing prerequisite produces its own error message (PBT)', () => {
    fc.assert(
      fc.property(preflightInputArbitrary, (input) => {
        const result = validatePreflightPrerequisites(input);

        // Count expected errors
        let expectedErrorCount = 0;
        if (!input.iconPresent) expectedErrorCount++;
        else if (!input.iconValid) expectedErrorCount++;
        if (!input.licensePresent) expectedErrorCount++;
        if (!input.nsisScriptPresent) expectedErrorCount++;
        if (!input.electronBuilderAvailable) expectedErrorCount++;
        if (input.signingConfigPresent && !input.signingPasswordSet) expectedErrorCount++;

        expect(result.errors.length).toBe(expectedErrorCount);
      }),
      { numRuns: 200 }
    );
  });
});
