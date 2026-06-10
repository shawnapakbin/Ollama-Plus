#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ensureDir, getFileRoot, resolveInsideRoot, trimOutput } from './lib/security.mjs';

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

function safePath(relPath) {
  return resolveInsideRoot(getFileRoot(), relPath || '.');
}

function listDirectory(relPath = '.') {
  const rootPath = safePath(relPath);
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) {
    throw new Error('Target is not a directory.');
  }

  return fs.readdirSync(rootPath, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(rootPath, entry.name);
    const entryStat = fs.statSync(entryPath);
    return {
      name: entry.name,
      path: path.relative(getFileRoot(), entryPath).replace(/\\/g, '/'),
      type: entry.isDirectory() ? 'directory' : 'file',
      bytes: entry.isDirectory() ? 0 : entryStat.size,
      modifiedAt: entryStat.mtime.toISOString()
    };
  });
}

function readTextFile(relPath) {
  const filePath = safePath(relPath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('Target is not a file.');
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return {
    path: path.relative(getFileRoot(), filePath).replace(/\\/g, '/'),
    bytes: Buffer.byteLength(content, 'utf8'),
    content: trimOutput(content, 64_000)
  };
}

function writeTextFile(relPath, content, createParents = true) {
  const filePath = safePath(relPath);
  if (createParents) {
    ensureDir(path.dirname(filePath));
  }
  fs.writeFileSync(filePath, String(content ?? ''), 'utf8');
  return readTextFile(relPath);
}

function deletePath(relPath) {
  const target = safePath(relPath);
  if (!fs.existsSync(target)) {
    return { deleted: false, missing: true };
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { deleted: true };
}

function renamePath(fromPath, toPath) {
  const source = safePath(fromPath);
  const destination = safePath(toPath);
  ensureDir(path.dirname(destination));
  fs.renameSync(source, destination);
  return {
    from: path.relative(getFileRoot(), source).replace(/\\/g, '/'),
    to: path.relative(getFileRoot(), destination).replace(/\\/g, '/')
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
        return asTextResult(writeTextFile(String(args.path || ''), String(args.content ?? ''), true));
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
