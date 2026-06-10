import { describe, expect, it } from 'vitest';
import {
  isValidWikiAutonomyMode,
  isValidWikiKnowledgePolicy,
  normalizeWikiConfig,
  shouldRequireWikiApproval,
  evaluateWikiKnowledgePolicy
} from '../electron/lib/wikiPolicy.js';

describe('wikiPolicy validation helpers', () => {
  it('validates known autonomy modes', () => {
    expect(isValidWikiAutonomyMode('auto')).toBe(true);
    expect(isValidWikiAutonomyMode('review')).toBe(true);
    expect(isValidWikiAutonomyMode('hybrid')).toBe(true);
    expect(isValidWikiAutonomyMode('unknown')).toBe(false);
  });

  it('validates known knowledge policy levels', () => {
    expect(isValidWikiKnowledgePolicy('strict')).toBe(true);
    expect(isValidWikiKnowledgePolicy('balanced')).toBe(true);
    expect(isValidWikiKnowledgePolicy('aggressive')).toBe(true);
    expect(isValidWikiKnowledgePolicy('nope')).toBe(false);
  });

  it('normalizes partial config with defaults', () => {
    expect(normalizeWikiConfig({})).toEqual({
      root: '',
      autonomyMode: 'hybrid',
      knowledgePolicy: 'strict'
    });
  });
});

describe('wikiPolicy approval behavior', () => {
  it('requires approval in review mode for writes', () => {
    expect(shouldRequireWikiApproval('upsert_note', {}, 'review')).toBe(true);
    expect(shouldRequireWikiApproval('append_entry', {}, 'review')).toBe(true);
  });

  it('requires approval in hybrid mode for delete and broad overwrite', () => {
    expect(shouldRequireWikiApproval('delete', {}, 'hybrid')).toBe(true);
    expect(shouldRequireWikiApproval('rename', {}, 'hybrid')).toBe(true);
    expect(shouldRequireWikiApproval('upsert_note', { overwrite: true }, 'hybrid')).toBe(true);
    expect(shouldRequireWikiApproval('append_entry', {}, 'hybrid')).toBe(false);
  });

  it('never requires approval in auto mode', () => {
    expect(shouldRequireWikiApproval('delete', {}, 'auto')).toBe(false);
    expect(shouldRequireWikiApproval('upsert_note', { overwrite: true }, 'auto')).toBe(false);
  });
});

describe('wikiPolicy knowledge level behavior', () => {
  it('blocks non-explicit writes in strict mode', () => {
    const res = evaluateWikiKnowledgePolicy({ explicit: false, category: 'knowledge' }, 'strict');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('strict');
  });

  it('allows explicit writes in strict mode', () => {
    const res = evaluateWikiKnowledgePolicy({ explicit: true, category: 'knowledge' }, 'strict');
    expect(res.allowed).toBe(true);
  });

  it('allows profile updates in balanced mode without explicit flag', () => {
    const res = evaluateWikiKnowledgePolicy({ explicit: false, category: 'profile' }, 'balanced');
    expect(res.allowed).toBe(true);
  });

  it('blocks broad non-explicit writes in balanced mode', () => {
    const res = evaluateWikiKnowledgePolicy({ explicit: false, category: 'knowledge' }, 'balanced');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('balanced');
  });

  it('allows writes in aggressive mode', () => {
    const res = evaluateWikiKnowledgePolicy({ explicit: false, category: 'knowledge' }, 'aggressive');
    expect(res.allowed).toBe(true);
  });
});
