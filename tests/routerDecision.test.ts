import { describe, expect, it } from 'vitest';
import {
  buildRouterPayload,
  shouldSkipRouterForModel,
  shouldEnableToolsFromRouterResponse,
  shouldForceTools
} from '../src/components/Chat/pipeline/routerDecision';
import { ROUTER_SYSTEM_PROMPT } from '../src/components/Chat/pipeline/buildPayload';

describe('shouldForceTools', () => {
  it('returns true for clear scene-edit prompts', () => {
    expect(shouldForceTools('Add three spheres to the 3d workspace')).toBe(true);
    expect(shouldForceTools('Rotate this cube in the scene')).toBe(true);
  });

  it('returns true for explicit wiki-maintenance prompts', () => {
    expect(shouldForceTools('Add this to the wiki with a timestamp')).toBe(true);
    expect(shouldForceTools('Remember this preference in my profile notes')).toBe(true);
  });

  it('returns true for current-events and live-info prompts', () => {
    expect(shouldForceTools('can you give the current state of war in the Persian Gulf?')).toBe(true);
    expect(shouldForceTools('what is the latest news on oil prices today')).toBe(true);
  });

  it('returns false for non-tool prompts', () => {
    expect(shouldForceTools('Summarize this markdown file')).toBe(false);
    expect(shouldForceTools('')).toBe(false);
  });
});

describe('buildRouterPayload', () => {
  it('builds a non-streaming router payload', () => {
    const payload = buildRouterPayload('llama3.2', 'find the weather', false);
    expect(payload).toEqual({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: 'User request: "find the weather"\nDo you need tools for this?' }
      ],
      stream: false,
      options: {
        temperature: 0,
        num_predict: 8
      }
    });
  });

  it('includes keep_alive when keepAlive is enabled', () => {
    const payload = buildRouterPayload('llama3.2', 'find the weather', true);
    expect(payload.keep_alive).toBe(-1);
  });

  it('skips router calls for qwen-family models', () => {
    expect(shouldSkipRouterForModel('qwen3:8b')).toBe(true);
    expect(shouldSkipRouterForModel('QWEN3-VL:30B')).toBe(true);
    expect(shouldSkipRouterForModel('llama3.2')).toBe(false);
  });
});

describe('shouldEnableToolsFromRouterResponse', () => {
  it('returns true when router response contains YES', () => {
    expect(shouldEnableToolsFromRouterResponse({ message: { content: 'YES' } })).toBe(true);
    expect(shouldEnableToolsFromRouterResponse({ message: { content: 'Yes, tools are needed.' } })).toBe(true);
  });

  it('returns false for empty or negative responses', () => {
    expect(shouldEnableToolsFromRouterResponse({ message: { content: 'NO' } })).toBe(false);
    expect(shouldEnableToolsFromRouterResponse({ message: {} })).toBe(false);
    expect(shouldEnableToolsFromRouterResponse(null)).toBe(false);
  });
});
