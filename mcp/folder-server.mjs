#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  listDirectory,
  readTextFile,
  writeTextFile,
  createTextFile,
  deletePath,
  renamePath
} from './lib/folderOps.mjs';

const server = new Server(
  {
    name: 'ollama-plus-folders',
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
      name: 'file_list',
      description: 'List a directory under the configured file root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to MCP_FILE_ROOT.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'file_read',
      description: 'Read a text file under the configured file root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to MCP_FILE_ROOT.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      name: 'file_write',
      description: 'Write a text file under the configured file root, creating parent directories if needed.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to MCP_FILE_ROOT.' },
          content: { type: 'string', description: 'Text to write.' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    },
    {
      name: 'file_create',
      description: 'Create a text file under the configured file root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Initial text content.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      name: 'file_delete',
      description: 'Delete a file or directory under the configured file root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      name: 'file_rename',
      description: 'Rename or move a file or directory inside the configured file root.',
      inputSchema: {
        type: 'object',
        properties: {
          fromPath: { type: 'string' },
          toPath: { type: 'string' }
        },
        required: ['fromPath', 'toPath'],
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'file_list':
        return asTextResult(listDirectory(String(args.path || '.')));
      case 'file_read':
        return asTextResult(readTextFile(String(args.path || '')));
      case 'file_write':
        return asTextResult(writeTextFile(String(args.path || ''), String(args.content ?? '')));
      case 'file_create':
        return asTextResult(createTextFile(String(args.path || ''), String(args.content ?? '')));
      case 'file_delete':
        return asTextResult(deletePath(String(args.path || '')));
      case 'file_rename':
        return asTextResult(renamePath(String(args.fromPath || ''), String(args.toPath || '')));
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
  console.error('Folder MCP server failed:', err);
  process.exitCode = 1;
});
