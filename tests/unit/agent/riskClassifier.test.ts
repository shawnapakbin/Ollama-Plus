import { describe, expect, it } from 'vitest';
import { classifyRisk, matchesCustomRule } from '../../../electron/runtime/agent/riskClassifier.js';

describe('riskClassifier', () => {
  describe('classifyRisk — default high-risk criteria', () => {
    describe('file deletion operations', () => {
      it('classifies delete action as high-risk', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'delete',
          params: { path: '/project/src/file.ts' },
          workingDirectory: '/project',
          affectedPaths: ['/project/src/file.ts']
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('deletion');
      });

      it('classifies remove action as high-risk', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'remove',
          params: { path: '/project/old.js' },
          workingDirectory: '/project',
          affectedPaths: ['/project/old.js']
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
      });

      it('classifies unlink action as high-risk', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'unlink',
          params: {},
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
      });

      it('classifies rm action as high-risk', () => {
        const result = classifyRisk({
          tool: 'terminal',
          action: 'rm',
          params: {},
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
      });

      it('classifies rmdir action as high-risk', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'rmdir',
          params: {},
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('commands outside working directory', () => {
      it('classifies terminal command targeting path outside working dir as high-risk', () => {
        const result = classifyRisk({
          tool: 'terminal',
          action: 'execute',
          params: { cwd: '/other/directory' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('outside');
      });

      it('classifies terminal command with path param outside working dir as high-risk', () => {
        const result = classifyRisk({
          tool: 'terminal',
          action: 'execute',
          params: { path: '/etc/passwd' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
      });

      it('allows terminal command within working directory', () => {
        const result = classifyRisk({
          tool: 'terminal',
          action: 'execute',
          params: { cwd: '/project/src' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });

      it('does not apply outside-dir check to non-terminal tools', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'read',
          params: { cwd: '/other/directory' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });
    });

    describe('network requests to non-allowlisted hosts', () => {
      it('classifies HTTP request to external host as high-risk', () => {
        const result = classifyRisk({
          tool: 'http',
          action: 'get',
          params: { url: 'https://external-api.com/data' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('allowlist');
      });

      it('classifies browser tool with external URL as high-risk', () => {
        const result = classifyRisk({
          tool: 'browser',
          action: 'navigate',
          params: { url: 'https://malicious-site.com' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
      });

      it('allows requests to localhost', () => {
        const result = classifyRisk({
          tool: 'http',
          action: 'get',
          params: { url: 'http://localhost:3000/api' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });

      it('allows requests to 127.0.0.1', () => {
        const result = classifyRisk({
          tool: 'http',
          action: 'post',
          params: { url: 'http://127.0.0.1:8080/submit' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });

      it('allows requests to user-configured allowlisted hosts', () => {
        const result = classifyRisk(
          {
            tool: 'http',
            action: 'get',
            params: { url: 'https://api.github.com/repos' },
            workingDirectory: '/project',
            affectedPaths: []
          },
          { allowedHosts: ['api.github.com'] }
        );
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });

      it('does not apply network check to non-network tools', () => {
        const result = classifyRisk({
          tool: 'terminal',
          action: 'execute',
          params: { url: 'https://evil.com' },
          workingDirectory: '/project',
          affectedPaths: []
        });
        // terminal with url param is not flagged as network issue
        // (it might still be flagged for other reasons)
        expect(result.reason).not.toContain('allowlist');
      });
    });

    describe('operations modifying more than 5 files', () => {
      it('classifies operation with >5 affected paths as high-risk', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'write',
          params: {},
          workingDirectory: '/project',
          affectedPaths: [
            '/project/a.ts',
            '/project/b.ts',
            '/project/c.ts',
            '/project/d.ts',
            '/project/e.ts',
            '/project/f.ts'
          ]
        });
        expect(result.level).toBe('high');
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('5');
      });

      it('allows operation with exactly 5 affected paths', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'write',
          params: {},
          workingDirectory: '/project',
          affectedPaths: [
            '/project/a.ts',
            '/project/b.ts',
            '/project/c.ts',
            '/project/d.ts',
            '/project/e.ts'
          ]
        });
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });

      it('allows operation with no affected paths', () => {
        const result = classifyRisk({
          tool: 'folder',
          action: 'write',
          params: {},
          workingDirectory: '/project',
          affectedPaths: []
        });
        expect(result.level).toBe('low');
        expect(result.requiresApproval).toBe(false);
      });
    });
  });

  describe('classifyRisk — custom rules take precedence', () => {
    it('matches a glob custom rule and classifies as high-risk', () => {
      const config = {
        customApprovalRules: [
          { id: 'r1', pattern: 'terminal:*', type: 'glob' as const, description: 'All terminal ops' }
        ]
      };
      const result = classifyRisk(
        {
          tool: 'terminal',
          action: 'execute',
          params: { cwd: '/project/src' },
          workingDirectory: '/project',
          affectedPaths: []
        },
        config
      );
      expect(result.level).toBe('high');
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('custom approval rule');
    });

    it('matches a regex custom rule and classifies as high-risk', () => {
      const config = {
        customApprovalRules: [
          { id: 'r2', pattern: 'npm\\s+publish', type: 'regex' as const, description: 'Prevent npm publish' }
        ]
      };
      const result = classifyRisk(
        {
          tool: 'terminal',
          action: 'execute',
          params: { command: 'npm publish' },
          workingDirectory: '/project',
          affectedPaths: []
        },
        config
      );
      expect(result.level).toBe('high');
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('custom approval rule');
    });

    it('custom rule takes precedence over low-risk default', () => {
      const config = {
        customApprovalRules: [
          { id: 'r3', pattern: 'folder:read', type: 'glob' as const, description: 'Block reads' }
        ]
      };
      const result = classifyRisk(
        {
          tool: 'folder',
          action: 'read',
          params: { path: '/project/file.ts' },
          workingDirectory: '/project',
          affectedPaths: ['/project/file.ts']
        },
        config
      );
      // Normally read would be low-risk, but custom rule overrides
      expect(result.level).toBe('high');
      expect(result.requiresApproval).toBe(true);
    });

    it('unmatched custom rule does not affect classification', () => {
      const config = {
        customApprovalRules: [
          { id: 'r4', pattern: 'python:*', type: 'glob' as const, description: 'Block python' }
        ]
      };
      const result = classifyRisk(
        {
          tool: 'folder',
          action: 'read',
          params: {},
          workingDirectory: '/project',
          affectedPaths: []
        },
        config
      );
      expect(result.level).toBe('low');
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('classifyRisk — edge cases', () => {
    it('returns low-risk for null operation', () => {
      const result = classifyRisk(null as unknown);
      expect(result.level).toBe('low');
      expect(result.requiresApproval).toBe(false);
    });

    it('returns low-risk for undefined operation', () => {
      const result = classifyRisk(undefined as unknown);
      expect(result.level).toBe('low');
      expect(result.requiresApproval).toBe(false);
    });

    it('works with empty config', () => {
      const result = classifyRisk(
        {
          tool: 'folder',
          action: 'read',
          params: {},
          workingDirectory: '/project',
          affectedPaths: []
        },
        {}
      );
      expect(result.level).toBe('low');
      expect(result.requiresApproval).toBe(false);
    });

    it('works with no config provided', () => {
      const result = classifyRisk({
        tool: 'folder',
        action: 'read',
        params: {},
        workingDirectory: '/project',
        affectedPaths: []
      });
      expect(result.level).toBe('low');
      expect(result.requiresApproval).toBe(false);
    });

    it('handles missing affectedPaths gracefully', () => {
      const result = classifyRisk({
        tool: 'folder',
        action: 'write',
        params: {},
        workingDirectory: '/project'
      } as unknown);
      expect(result.level).toBe('low');
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('matchesCustomRule', () => {
    it('returns matched:false for null operation', () => {
      const result = matchesCustomRule(null as unknown, []);
      expect(result.matched).toBe(false);
      expect(result.rule).toBeNull();
    });

    it('returns matched:false for null rules', () => {
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        null as unknown
      );
      expect(result.matched).toBe(false);
    });

    it('returns matched:false for empty rules array', () => {
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        []
      );
      expect(result.matched).toBe(false);
    });

    it('matches glob pattern against operation string', () => {
      const rules = [
        { id: 'r1', pattern: 'terminal:*', type: 'glob' as const, description: 'All terminal' }
      ];
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('r1');
    });

    it('matches regex pattern against operation string', () => {
      const rules = [
        { id: 'r2', pattern: 'folder:delete', type: 'regex' as const, description: 'Delete ops' }
      ];
      const result = matchesCustomRule(
        { tool: 'folder', action: 'delete', params: { path: '/tmp/x' }, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('r2');
    });

    it('does not match invalid regex and returns false', () => {
      const rules = [
        { id: 'r3', pattern: '[invalid(regex', type: 'regex' as const, description: 'Bad regex' }
      ];
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      expect(result.matched).toBe(false);
    });

    it('returns the first matching rule when multiple match', () => {
      const rules = [
        { id: 'r1', pattern: 'terminal:*', type: 'glob' as const, description: 'First' },
        { id: 'r2', pattern: 'terminal:execute', type: 'regex' as const, description: 'Second' }
      ];
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('r1');
    });

    it('matches case-insensitively', () => {
      const rules = [
        { id: 'r1', pattern: 'TERMINAL:EXECUTE', type: 'regex' as const, description: 'Upper' }
      ];
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      expect(result.matched).toBe(true);
    });

    it('includes params in matching string', () => {
      const rules = [
        { id: 'r1', pattern: '.*password.*', type: 'regex' as const, description: 'Password ops' }
      ];
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: { command: 'echo password123' }, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      expect(result.matched).toBe(true);
    });

    it('skips rules with missing pattern', () => {
      const rules = [
        { id: 'r1', pattern: '', type: 'glob' as const, description: 'Empty' },
        { id: 'r2', pattern: 'terminal:*', type: 'glob' as const, description: 'Second' }
      ];
      const result = matchesCustomRule(
        { tool: 'terminal', action: 'execute', params: {}, workingDirectory: '/p', affectedPaths: [] },
        rules
      );
      // First rule has empty pattern so it's skipped, second matches
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('r2');
    });
  });
});

// ─── Property-Based Tests: Property 12 ──────────────────────────────────────

import fc from 'fast-check';

describe('riskClassifier - Property 12: Risk classification correctness', () => {
  /**
   * **Validates: Requirements 6.1, 6.5, 6.6**
   * Feature: agent-client, Property 12
   *
   * For any operation, it SHALL be classified as high-risk if it matches any of:
   * file deletion, shell command execution targeting a path outside the working
   * directory, network request to a host not in the user-configured allowlist,
   * or an operation modifying more than 5 files simultaneously.
   * Custom approval rules SHALL take precedence and additionally classify
   * matching operations as requiring approval.
   */

  // ─── Arbitraries ─────────────────────────────────────────────────────────

  const deletionActionArb = fc.constantFrom('delete', 'remove', 'unlink', 'rm', 'rmdir');
  const toolNameArb = fc.constantFrom('terminal', 'folder', 'browser', 'python', 'http');
  const safeActionArb = fc.constantFrom('read', 'write', 'list', 'search', 'create', 'edit');
  const workingDirArb = fc.constantFrom('/project', '/home/user/work', '/workspace');

  const pathSegmentArb = fc.string({ minLength: 1, maxLength: 12 })
    .filter(s => /^[a-z0-9_-]+$/.test(s));

  const relativePathArb = fc.array(pathSegmentArb, { minLength: 1, maxLength: 4 })
    .map(segments => segments.join('/'));

  const externalHostArb = fc.tuple(
    fc.string({ minLength: 3, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
    fc.constantFrom('.com', '.org', '.io', '.net', '.dev')
  ).map(([name, tld]) => `${name}${tld}`);

  const externalUrlArb = fc.tuple(
    fc.constantFrom('https://', 'http://'),
    externalHostArb,
    relativePathArb
  ).map(([protocol, host, path]) => `${protocol}${host}/${path}`);

  // ─── Property: File deletion operations are always high-risk ─────────────

  it('operations with deletion actions are always classified as high-risk', () => {
    fc.assert(
      fc.property(
        toolNameArb,
        deletionActionArb,
        workingDirArb,
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 3 }),
        (tool, action, workingDirectory, paths) => {
          const result = classifyRisk({
            tool,
            action,
            params: {},
            workingDirectory,
            affectedPaths: paths.map(p => `${workingDirectory}/${p}`)
          });
          expect(result.level).toBe('high');
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('deletion');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property: Operations modifying >5 files are high-risk ───────────────

  it('operations modifying more than 5 files are classified as high-risk', () => {
    fc.assert(
      fc.property(
        toolNameArb,
        safeActionArb,
        workingDirArb,
        fc.integer({ min: 6, max: 50 }),
        (tool, action, workingDirectory, fileCount) => {
          const affectedPaths = Array.from({ length: fileCount }, (_, i) =>
            `${workingDirectory}/file${i}.ts`
          );
          const result = classifyRisk({
            tool,
            action,
            params: {},
            workingDirectory,
            affectedPaths
          });
          expect(result.level).toBe('high');
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('5');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property: Network requests to non-allowlisted hosts are high-risk ───

  it('HTTP/browser operations with non-localhost URLs are classified as high-risk', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'browser'),
        fc.constantFrom('get', 'post', 'navigate', 'fetch'),
        workingDirArb,
        externalUrlArb,
        (tool, action, workingDirectory, url) => {
          const result = classifyRisk({
            tool,
            action,
            params: { url },
            workingDirectory,
            affectedPaths: []
          });
          expect(result.level).toBe('high');
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('allowlist');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property: Terminal commands outside working directory are high-risk ──

  it('terminal operations with cwd outside working directory are classified as high-risk', () => {
    fc.assert(
      fc.property(
        workingDirArb,
        relativePathArb,
        (workingDirectory, subpath) => {
          // Generate a path guaranteed to be outside working directory
          const outsidePath = workingDirectory === '/project'
            ? `/other/${subpath}`
            : `/different/${subpath}`;

          const result = classifyRisk({
            tool: 'terminal',
            action: 'execute',
            params: { cwd: outsidePath },
            workingDirectory,
            affectedPaths: []
          });
          expect(result.level).toBe('high');
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('outside');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property: Custom approval rules take precedence ─────────────────────

  it('operations matching custom glob rules are classified as high-risk requiring approval', () => {
    fc.assert(
      fc.property(
        toolNameArb,
        safeActionArb,
        workingDirArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        (tool, action, workingDirectory, ruleId) => {
          const config = {
            customApprovalRules: [
              { id: ruleId, pattern: `${tool}:*`, type: 'glob' as const, description: 'Custom block rule' }
            ]
          };
          const result = classifyRisk(
            {
              tool,
              action,
              params: {},
              workingDirectory,
              affectedPaths: []
            },
            config
          );
          expect(result.level).toBe('high');
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('custom approval rule');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('operations matching custom regex rules are classified as high-risk requiring approval', () => {
    fc.assert(
      fc.property(
        toolNameArb,
        safeActionArb,
        workingDirArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        (tool, action, workingDirectory, ruleId) => {
          const config = {
            customApprovalRules: [
              { id: ruleId, pattern: `${tool}:${action}`, type: 'regex' as const, description: 'Regex block rule' }
            ]
          };
          const result = classifyRisk(
            {
              tool,
              action,
              params: {},
              workingDirectory,
              affectedPaths: []
            },
            config
          );
          expect(result.level).toBe('high');
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('custom approval rule');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property: Low-risk operations do NOT require approval ───────────────

  it('non-deletion, within-dir, <=5 files operations without custom rules are low-risk', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('folder', 'python'),
        safeActionArb,
        workingDirArb,
        fc.integer({ min: 0, max: 5 }),
        (tool, action, workingDirectory, fileCount) => {
          const affectedPaths = Array.from({ length: fileCount }, (_, i) =>
            `${workingDirectory}/src/file${i}.ts`
          );
          const result = classifyRisk({
            tool,
            action,
            params: {},
            workingDirectory,
            affectedPaths
          });
          expect(result.level).toBe('low');
          expect(result.requiresApproval).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('localhost/127.0.0.1 network requests are low-risk', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'browser'),
        fc.constantFrom('get', 'post', 'navigate'),
        workingDirArb,
        fc.constantFrom(
          'http://localhost:3000/api',
          'http://127.0.0.1:8080/data',
          'http://localhost/test',
          'http://127.0.0.1/health'
        ),
        (tool, action, workingDirectory, url) => {
          const result = classifyRisk({
            tool,
            action,
            params: { url },
            workingDirectory,
            affectedPaths: []
          });
          expect(result.level).toBe('low');
          expect(result.requiresApproval).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('user-allowlisted hosts are low-risk', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'browser'),
        fc.constantFrom('get', 'post', 'navigate'),
        workingDirArb,
        externalHostArb,
        (tool, action, workingDirectory, host) => {
          const url = `https://${host}/api/resource`;
          const config = { allowedHosts: [host] };
          const result = classifyRisk(
            {
              tool,
              action,
              params: { url },
              workingDirectory,
              affectedPaths: []
            },
            config
          );
          expect(result.level).toBe('low');
          expect(result.requiresApproval).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
