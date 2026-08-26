import { describe, expect, it } from 'vitest';
import { createGateway } from '../mcp/lib/gateway.mjs';

// Task 5.5 — Integration test: real-registration metadata sanity.
// Validates: Requirements 3.1, 3.2, 3.4
//
// The real browser Registration_Sites live inline in `electron/main.js`, which
// imports `electron` and calls `app.getPath(...)` at module load, so it cannot
// be imported in a vitest node environment. There is no separately-importable
// registration helper module, so this test faithfully replicates the SAME 8
// `mcpGateway.register('browser', <action>, handler, metadata)` calls found in
// electron/main.js (the metadata objects below are copied verbatim from the
// backfill in task 4.1) onto a gateway built via `createGateway()`, then
// enumerates `listTools()` and asserts the descriptor metadata is well formed.
//
// If the inline registrations in electron/main.js change, update the copies
// below to keep this test faithful to the real authored metadata.

/**
 * Builds a gateway registered with the same 8 browser routes + metadata as the
 * in-process gateway in electron/main.js. Handlers are inert stand-ins because
 * this test only inspects the enumerated tool metadata, not handler behavior.
 */
function buildRealBrowserGateway() {
  const gateway = createGateway();
  const noop = async () => ({ ok: true });

  gateway.register('browser', 'create_session', noop, {
    description:
      'Launch a new headless browser session and open its first page. Returns the session summary and the initial page.',
    parameters: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: 'Run the browser without a visible window. Defaults to true.' },
        executablePath: { type: 'string', description: 'Absolute path to the browser executable to launch. Optional; a platform default is used when omitted.' },
        userAgent: { type: 'string', description: 'Override the browser context User-Agent string.' },
        viewport: {
          type: 'object',
          description: 'Initial viewport dimensions for the browser context.',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' }
          }
        },
        firstPage: {
          type: 'object',
          description: 'Options for the first page opened in the session (e.g. an initial url to navigate to and a navigation timeoutMs).',
          properties: {
            url: { type: 'string' },
            timeoutMs: { type: 'number' }
          }
        }
      }
    }
  });

  gateway.register('browser', 'list_sessions', noop, {
    description: 'List all active browser sessions with their summaries. Takes no parameters.',
    parameters: { type: 'object', properties: {} }
  });

  gateway.register('browser', 'close_session', noop, {
    description: 'Close a browser session by id, releasing its browser, context, and pages.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session to close.' }
      },
      required: ['sessionId']
    }
  });

  gateway.register('browser', 'create_page', noop, {
    description: 'Open a new page in an existing browser session and make it the active page.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session to open the page in.' },
        url: { type: 'string', description: 'Optional URL to navigate the new page to immediately.' },
        timeoutMs: { type: 'number', description: 'Navigation timeout in milliseconds when a url is provided.' }
      },
      required: ['sessionId']
    }
  });

  gateway.register('browser', 'list_pages', noop, {
    description: 'List all pages in a browser session along with the session summary.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session whose pages to list.' }
      },
      required: ['sessionId']
    }
  });

  gateway.register('browser', 'activate_page', noop, {
    description: 'Make a specific page the active page within its browser session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session that owns the page.' },
        pageId: { type: 'string', description: 'Identifier of the page to activate.' }
      },
      required: ['sessionId', 'pageId']
    }
  });

  gateway.register('browser', 'close_page', noop, {
    description: 'Close a specific page within a browser session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Identifier of the session that owns the page.' },
        pageId: { type: 'string', description: 'Identifier of the page to close.' }
      },
      required: ['sessionId', 'pageId']
    }
  });

  gateway.register('browser', 'action', noop, {
    description:
      'Perform a browser action (navigation, interaction, capture, or cookie/header management) on the active or specified page of a session.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The browser action to perform.',
          enum: [
            'goto', 'click', 'type', 'press', 'scroll', 'wait', 'back', 'forward',
            'reload', 'evaluate', 'screenshot', 'content', 'extract-text',
            'set-headers', 'get-cookies', 'set-cookies'
          ]
        },
        sessionId: { type: 'string', description: 'Identifier of the target session.' },
        pageId: { type: 'string', description: 'Identifier of the target page. Defaults to the session active page when omitted.' },
        url: { type: 'string', description: 'Target URL for the "goto" action.' },
        selector: { type: 'string', description: 'CSS selector for "click", "type", "press", or "scroll" actions.' },
        text: { type: 'string', description: 'Text to type for "type", or scroll direction ("down"/"up") for "scroll".' },
        key: { type: 'string', description: 'Key to press for the "press" action (e.g. "Enter").' },
        timeoutMs: { type: 'number', description: 'Action timeout in milliseconds.' },
        wait_for: { type: 'string', description: 'For the "wait" action: a URL (http...) to wait for, or a selector to wait to appear.' },
        ms: { type: 'number', description: 'For the "wait" action: milliseconds to wait when no wait_for is provided.' },
        script: { type: 'string', description: 'JavaScript to run in the page for the "evaluate" action.' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page for the "screenshot" action.' },
        headers: { type: 'object', description: 'Extra HTTP headers to set for the "set-headers" action.' },
        cookies: { type: 'array', description: 'Cookies to add for the "set-cookies" action.', items: { type: 'object' } }
      },
      required: ['action']
    }
  });

  return gateway;
}

describe('gateway listTools — real registration metadata sanity', () => {
  it('enumerates every browser route with a non-empty description and a well-formed parameters object', () => {
    const gateway = buildRealBrowserGateway();
    const tools = gateway.listTools();

    // There should be one descriptor per registered route (all 8 browser routes).
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(8);

    for (const tool of tools) {
      // Req 3.1: every Registration_Site supplies a non-empty description.
      expect(typeof tool.description).toBe('string');
      expect(tool.description.trim().length).toBeGreaterThan(0);

      // Req 3.2: parameters is a JSON-schema object with type/properties keys.
      expect(tool.parameters).toBeTypeOf('object');
      expect(tool.parameters).not.toBeNull();
      expect(Array.isArray(tool.parameters)).toBe(false);
      expect(tool.parameters).toHaveProperty('type');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters).toHaveProperty('properties');
      expect(tool.parameters.properties).toBeTypeOf('object');
      expect(tool.parameters.properties).not.toBeNull();

      // The tool name follows the <server>_<action> convention (Req 3.4).
      expect(typeof tool.name).toBe('string');
      expect(tool.name.startsWith('browser_')).toBe(true);
    }
  });

  it('includes the fixed tool names browser_list_sessions and browser_action', () => {
    const gateway = buildRealBrowserGateway();
    const names = gateway.listTools().map((tool) => tool.name);

    // Req 3.4: names remain stable fixed literals.
    expect(names).toContain('browser_list_sessions');
    expect(names).toContain('browser_action');
  });
});
