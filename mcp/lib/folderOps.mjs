import fs from 'fs';
import path from 'path';
import { ensureDir, getFileRoot, resolveInsideRoot, trimOutput } from './security.mjs';

// Confined folder operations extracted from folder-server.mjs.
// Every function resolves its target path via resolveInsideRoot(getFileRoot(), rel)
// before touching the filesystem, so confinement violations throw before any I/O.

function safePath(relPath) {
  return resolveInsideRoot(getFileRoot(), relPath || '.');
}

export function listDirectory(relPath = '.') {
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

export function readTextFile(relPath) {
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

export function writeTextFile(relPath, content, createParents = true) {
  const filePath = safePath(relPath);
  if (createParents) {
    ensureDir(path.dirname(filePath));
  }
  fs.writeFileSync(filePath, String(content ?? ''), 'utf8');
  return readTextFile(relPath);
}

// Alias for file_create: create a text file, always creating parent directories.
export function createTextFile(relPath, content) {
  return writeTextFile(relPath, content, true);
}

export function deletePath(relPath) {
  const target = safePath(relPath);
  if (!fs.existsSync(target)) {
    return { deleted: false, missing: true };
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { deleted: true };
}

export function renamePath(fromPath, toPath) {
  const source = safePath(fromPath);
  const destination = safePath(toPath);
  ensureDir(path.dirname(destination));
  fs.renameSync(source, destination);
  return {
    from: path.relative(getFileRoot(), source).replace(/\\/g, '/'),
    to: path.relative(getFileRoot(), destination).replace(/\\/g, '/')
  };
}
