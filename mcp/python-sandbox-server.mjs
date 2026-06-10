#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkDockerAvailable, listSandboxRuns, readRunArtifact, runSandboxedPython } from './lib/pythonSandbox.mjs';

const server = new Server(
  {
    name: 'ollama-plus-python-sandbox',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

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
      name: 'python_sandbox_health',
      description: 'Check Docker availability and sandbox readiness.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'python_sandbox_run',
      description: 'Run Python code in an isolated Docker sandbox suitable for 3D scripting workflows.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python script body.' },
          timeoutSec: { type: 'number', description: 'Execution timeout (1-120 sec).' },
          image: { type: 'string', description: 'Optional Docker image override.' },
          approveUnsafe: { type: 'boolean', description: 'Allow scripts matching blocked patterns.' }
        },
        required: ['code'],
        additionalProperties: false
      }
    },
    {
      name: 'python_sandbox_list_runs',
      description: 'List recent sandbox execution runs.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'python_sandbox_read_artifact',
      description: 'Read artifact output from a previous sandbox run.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          fileName: { type: 'string' }
        },
        required: ['runId', 'fileName'],
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'python_sandbox_health': {
        const dockerVersion = await checkDockerAvailable();
        return asTextResult({ ok: true, dockerVersion });
      }
      case 'python_sandbox_run':
        return asTextResult(await runSandboxedPython(args));
      case 'python_sandbox_list_runs':
        return asTextResult(listSandboxRuns(args.limit));
      case 'python_sandbox_read_artifact':
        return asTextResult(readRunArtifact(args.runId, args.fileName));
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
  console.error('Python sandbox MCP server failed:', err);
  process.exitCode = 1;
});
