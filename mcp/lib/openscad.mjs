import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { clampNumber, sanitizeEnv } from './security.mjs';

const OPENSCAD_CANDIDATES = process.platform === 'win32'
  ? ['openscad.com', 'openscad.exe', 'openscad']
  : ['openscad'];

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_PARAMETERS = 32;
const DEFAULT_TIMEOUT_MS = 45_000;

function trimText(text, maxLen = 24_000) {
  if (typeof text !== 'string') return '';
  return text.length > maxLen ? text.slice(-maxLen) : text;
}

function categorize(errorCategory, message) {
  return {
    ok: false,
    errorCategory,
    error: message
  };
}

function asFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeOpenScadParameterMap(parameters) {
  if (parameters === undefined || parameters === null) return [];
  if (typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('parameters must be an object map of variable names to values.');
  }

  const entries = Object.entries(parameters);
  if (entries.length > MAX_PARAMETERS) {
    throw new Error(`Too many parameters. Maximum is ${MAX_PARAMETERS}.`);
  }

  return entries.map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid parameter name: ${key}`);
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Invalid numeric parameter value for ${key}.`);
      return `-D${key}=${String(value)}`;
    }

    if (typeof value === 'boolean') {
      return `-D${key}=${value ? 'true' : 'false'}`;
    }

    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > 8 * 1024) {
        throw new Error(`Parameter ${key} is too large.`);
      }
      return `-D${key}=${JSON.stringify(value)}`;
    }

    throw new Error(`Unsupported parameter type for ${key}. Use number, boolean, or string.`);
  });
}

function selectOpenScadExecutable() {
  const envOverride = String(process.env.MCP_OPENSCAD_BIN || '').trim();
  const candidates = envOverride ? [envOverride] : OPENSCAD_CANDIDATES;

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      env: sanitizeEnv(process.env)
    });
    if (probe.error || probe.status !== 0) continue;

    const version = trimText(String(probe.stdout || probe.stderr || '').trim(), 500);
    return {
      ok: true,
      executable: candidate,
      version: version || 'OpenSCAD available',
      checkedAt: new Date().toISOString()
    };
  }

  return {
    ok: false,
    executable: envOverride || OPENSCAD_CANDIDATES[0],
    version: '',
    checkedAt: new Date().toISOString(),
    note: 'OpenSCAD CLI not found. Install OpenSCAD and ensure it is available on PATH.'
  };
}

async function executeOpenScad(executable, args, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const proc = spawn(executable, args, {
      windowsHide: true,
      env: sanitizeEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const onData = (collector) => (chunk) => {
      collector.value += String(chunk || '');
      collector.value = trimText(collector.value, 30_000);
    };

    const outCollector = { value: '' };
    const errCollector = { value: '' };
    proc.stdout.on('data', onData(outCollector));
    proc.stderr.on('data', onData(errCollector));

    const killTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.on('close', (code, signal) => {
      clearTimeout(killTimer);
      stdout = outCollector.value;
      stderr = errCollector.value;
      resolve({
        code: asFiniteNumber(code, null),
        signal: signal || null,
        timedOut,
        stdout: trimText(stdout),
        stderr: trimText(stderr),
        durationMs: Date.now() - startedAt
      });
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({
        code: null,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: trimText(err instanceof Error ? err.message : String(err)),
        durationMs: Date.now() - startedAt,
        failedToStart: true
      });
    });
  });
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function checkOpenScadHealth() {
  return selectOpenScadExecutable();
}

export async function compileOpenScad(payload = {}, options = {}) {
  const source = typeof payload.source === 'string' ? payload.source : '';
  const sourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath : '';

  const hasSource = source.trim().length > 0;
  const hasPath = sourcePath.trim().length > 0;
  if (hasSource === hasPath) {
    return categorize('VALIDATION_ERROR', 'Provide exactly one of source or sourcePath.');
  }

  const timeoutMs = clampNumber(payload.timeoutMs, 1_000, 180_000, DEFAULT_TIMEOUT_MS);
  const maxArtifactBytes = clampNumber(payload.maxArtifactBytes, 1_024, 256 * 1024 * 1024, MAX_ARTIFACT_BYTES);
  const returnPayloadBase64 = payload.returnPayloadBase64 !== false;

  let sourceText = source;
  let sourceIdentity = '';
  let sourceMode = hasSource ? 'inline' : 'path';

  if (hasPath) {
    if (typeof options.resolveSourcePath !== 'function') {
      return categorize('VALIDATION_ERROR', 'compileOpenScad requires resolveSourcePath for sourcePath mode.');
    }
    const resolved = options.resolveSourcePath(sourcePath);
    if (!resolved?.target || !resolved?.relPath) {
      return categorize('VALIDATION_ERROR', 'Unable to resolve sourcePath.');
    }
    const ext = path.extname(resolved.target).toLowerCase();
    if (ext !== '.scad') {
      return categorize('VALIDATION_ERROR', 'sourcePath must point to a .scad file.');
    }
    const stat = fs.statSync(resolved.target);
    if (!stat.isFile()) return categorize('VALIDATION_ERROR', 'sourcePath is not a file.');
    if (stat.size > MAX_SOURCE_BYTES) {
      return categorize('VALIDATION_ERROR', `SCAD source exceeds ${MAX_SOURCE_BYTES} bytes.`);
    }
    sourceText = fs.readFileSync(resolved.target, 'utf8');
    sourceIdentity = resolved.relPath;
  }

  const sourceBytes = Buffer.byteLength(sourceText || '', 'utf8');
  if (sourceBytes <= 0) {
    return categorize('VALIDATION_ERROR', 'SCAD source is empty.');
  }
  if (sourceBytes > MAX_SOURCE_BYTES) {
    return categorize('VALIDATION_ERROR', `SCAD source exceeds ${MAX_SOURCE_BYTES} bytes.`);
  }

  let paramArgs;
  try {
    paramArgs = normalizeOpenScadParameterMap(payload.parameters);
  } catch (err) {
    return categorize('VALIDATION_ERROR', err instanceof Error ? err.message : String(err));
  }

  const health = selectOpenScadExecutable();
  if (!health.ok) {
    return categorize('EXEC_NOT_FOUND', health.note || 'OpenSCAD CLI not found.');
  }

  const sourceHash = sha256Hex(sourceText).slice(0, 16);
  const paramsHash = sha256Hex(JSON.stringify(payload.parameters || {})).slice(0, 12);
  const workRoot = path.resolve(
    options.tempRoot || process.env.MCP_OPENSCAD_TMP_ROOT || path.join(os.tmpdir(), 'ollama-plus-openscad')
  );
  const requestId = `${sourceHash}-${paramsHash}`;
  const requestDir = path.join(workRoot, requestId);
  fs.mkdirSync(requestDir, { recursive: true });

  const inputPath = path.join(requestDir, 'input.scad');
  const outputPath = path.join(requestDir, `model-${requestId}.stl`);
  fs.writeFileSync(inputPath, sourceText, 'utf8');

  const args = ['-o', outputPath, ...paramArgs, inputPath];
  const run = await executeOpenScad(health.executable, args, timeoutMs);

  if (run.failedToStart) {
    return {
      ...categorize('EXEC_NOT_FOUND', run.stderr || 'Failed to start OpenSCAD process.'),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs
    };
  }

  if (run.timedOut) {
    return {
      ...categorize('EXEC_TIMEOUT', `OpenSCAD compile timed out after ${timeoutMs} ms.`),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs,
      timeoutMs
    };
  }

  if (run.code !== 0) {
    return {
      ...categorize('COMPILE_ERROR', 'OpenSCAD reported a compile error.'),
      stderr: run.stderr,
      stdout: run.stdout,
      exitCode: run.code,
      durationMs: run.durationMs
    };
  }

  if (!fs.existsSync(outputPath)) {
    return {
      ...categorize('ARTIFACT_EMPTY', 'OpenSCAD did not produce an output STL artifact.'),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs
    };
  }

  const artifactStat = fs.statSync(outputPath);
  if (!artifactStat.isFile() || artifactStat.size <= 0) {
    return {
      ...categorize('ARTIFACT_EMPTY', 'OpenSCAD generated an empty STL artifact.'),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs
    };
  }

  if (artifactStat.size > maxArtifactBytes) {
    return {
      ...categorize('ARTIFACT_TOO_LARGE', `STL artifact exceeds ${maxArtifactBytes} bytes.`),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs,
      bytes: artifactStat.size
    };
  }

  const artifactRaw = fs.readFileSync(outputPath);
  const modelSourcePath = sourceIdentity || `generated/openscad/${requestId}.stl`;

  return {
    ok: true,
    format: 'stl',
    source: {
      mode: sourceMode,
      path: sourceIdentity || undefined,
      sourceHash,
      sourceBytes,
      paramsHash
    },
    artifact: {
      path: outputPath,
      name: path.basename(outputPath),
      bytes: artifactStat.size,
      mimeType: 'model/stl'
    },
    payloadBase64: returnPayloadBase64 ? artifactRaw.toString('base64') : undefined,
    modelSourcePath,
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: run.code,
    durationMs: run.durationMs,
    compiledAt: new Date().toISOString()
  };
}
