#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  closeAllSessions,
  closeTerminalSession,
  createTerminalSession,
  executeTerminalCommand,
  listTerminalSessions,
  readTerminalOutput,
  sweepIdleTerminalSessions,
  writeTerminalInput
} from './lib/terminalSessions.mjs';

const server = new Server(
  {
    name: 'ollama-plus-terminal',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

setInterval(() => {
  sweepIdleTerminalSessions();
}, 60_000).unref();

function asTextResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'terminal_create_session',
      description: 'Create a persistent interactive terminal session (punchout style).',
      inputSchema: {
        type: 'object',
        properties: {
          shell: { type: 'string', description: 'Optional shell executable override.' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional shell args override.'
          },
          cwd: { type: 'string', description: 'Working directory relative to MCP_TERMINAL_ROOT.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'terminal_list_sessions',
      description: 'List active terminal sessions and status.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'terminal_write_input',
      description: 'Write raw input into a terminal session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          input: { type: 'string' }
        },
        required: ['sessionId', 'input'],
        additionalProperties: false
      }
    },
    {
      name: 'terminal_read_output',
      description: 'Read buffered terminal output.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          maxChars: { type: 'number' },
          clear: { type: 'boolean', description: 'Clear unread buffer after read (default true).' }
        },
        required: ['sessionId'],
        additionalProperties: false
      }
    },
    {
      name: 'terminal_execute',
      description: 'Execute one command in a persistent session and return output. Risky commands are blocked unless approved.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          command: { type: 'string' },
          timeoutMs: { type: 'number' },
          settleMs: { type: 'number' },
          approveRisky: { type: 'boolean' }
        },
        required: ['sessionId', 'command'],
        additionalProperties: false
      }
    },
    {
      name: 'terminal_close_session',
      description: 'Close a terminal session and release resources.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' }
        },
        required: ['sessionId'],
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'terminal_create_session':
        return asTextResult(createTerminalSession(args));
      case 'terminal_list_sessions':
        return asTextResult(listTerminalSessions());
      case 'terminal_write_input':
        return asTextResult(writeTerminalInput(args.sessionId, args.input));
      case 'terminal_read_output':
        return asTextResult(readTerminalOutput(args.sessionId, args.maxChars, args.clear !== false));
      case 'terminal_execute':
        return asTextResult(await executeTerminalCommand(args.sessionId, args.command, args));
      case 'terminal_close_session':
        return asTextResult(closeTerminalSession(args.sessionId));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return asTextResult({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Terminal MCP server failed:', err);
  process.exitCode = 1;
}).finally(() => {
  closeAllSessions();
});
