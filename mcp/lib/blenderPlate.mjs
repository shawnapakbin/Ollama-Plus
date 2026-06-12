import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { clampNumber, sanitizeEnv } from './security.mjs';

const BLENDER_CANDIDATES = process.platform === 'win32'
  ? ['blender.exe', 'blender.com', 'blender']
  : ['blender'];

const SUPPORTED_EXPORT_FORMATS = new Set(['stl', 'obj', 'gltf', 'glb']);
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

function collectWindowsBlenderCandidates() {
  if (process.platform !== 'win32') return [];

  const programRoots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : ''
  ].filter((entry) => typeof entry === 'string' && entry.trim().length > 0);

  const discovered = [];
  for (const root of programRoots) {
    const blenderFoundation = path.join(root, 'Blender Foundation');
    if (!fs.existsSync(blenderFoundation)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(blenderFoundation, { withFileTypes: true });
    } catch {
      continue;
    }

    const installs = entries
      .filter((entry) => entry.isDirectory() && /^Blender\s+/i.test(entry.name))
      .map((entry) => path.join(blenderFoundation, entry.name, 'blender.exe'))
      .filter((candidate) => fs.existsSync(candidate));

    installs.sort((a, b) => b.localeCompare(a));
    discovered.push(...installs);
  }

  return [...new Set(discovered)];
}

function trimText(text, maxLen = 30_000) {
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

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isSafeBlenderScript(text) {
  if (typeof text !== 'string') return false;
  const blocked = [
    /\bsubprocess\b/,
    /\bsocket\b/,
    /\bctypes\b/,
    /\bos\.system\b/,
    /\beval\s*\(/,
    /\bexec\s*\(/,
    /__import__\s*\(/,
    /\brequests\b/,
    /\burllib\b/
  ];
  return !blocked.some((pattern) => pattern.test(text));
}

function selectBlenderExecutable() {
  const envOverride = String(process.env.MCP_BLENDER_BIN || '').trim();
  const candidates = envOverride
    ? [envOverride]
    : [...BLENDER_CANDIDATES, ...collectWindowsBlenderCandidates()];

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
      version: version || 'Blender available',
      checkedAt: new Date().toISOString()
    };
  }

  return {
    ok: false,
    executable: envOverride || BLENDER_CANDIDATES[0],
    version: '',
    checkedAt: new Date().toISOString(),
    note: 'Blender CLI not found. Install Blender and ensure it is available on PATH.'
  };
}

async function executeBlender(executable, args, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const proc = spawn(executable, args, {
      windowsHide: true,
      env: sanitizeEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const outCollector = { value: '' };
    const errCollector = { value: '' };
    let timedOut = false;

    proc.stdout.on('data', (chunk) => {
      outCollector.value += String(chunk || '');
      outCollector.value = trimText(outCollector.value);
    });

    proc.stderr.on('data', (chunk) => {
      errCollector.value += String(chunk || '');
      errCollector.value = trimText(errCollector.value);
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.on('close', (code, signal) => {
      clearTimeout(killTimer);
      resolve({
        code: Number.isFinite(code) ? code : null,
        signal: signal || null,
        timedOut,
        stdout: trimText(outCollector.value),
        stderr: trimText(errCollector.value),
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

function getWrapperScript(outputPath, exportFormat, userScriptPath) {
  return [
    'import bpy',
    'import sys',
    'import traceback',
    '',
    'def export_scene(path, fmt):',
    '    if fmt == "stl":',
    '        bpy.ops.export_mesh.stl(filepath=path, use_selection=False)',
    '    elif fmt == "obj":',
    '        bpy.ops.wm.obj_export(filepath=path, export_selected_objects=False)',
    '    elif fmt == "gltf":',
    '        bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE")',
    '    elif fmt == "glb":',
    '        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")',
    '    else:',
    '        raise RuntimeError(f"Unsupported export format: {fmt}")',
    '',
    'def run():',
    '    bpy.ops.wm.read_factory_settings(use_empty=True)',
    `    user_script_path = r'''${userScriptPath}'''`,
    `    output_path = r'''${outputPath}'''`,
    `    export_format = r'''${exportFormat}'''`,
    '    globals_dict = {"__builtins__": __builtins__, "bpy": bpy}',
    '    locals_dict = {}',
    '    with open(user_script_path, "r", encoding="utf-8") as f:',
    '        code = f.read()',
    '    exec(compile(code, user_script_path, "exec"), globals_dict, locals_dict)',
    '    export_scene(output_path, export_format)',
    '',
    'if __name__ == "__main__":',
    '    try:',
    '        run()',
    '        print("BLENDER_PLATE_EXPORT_OK")',
    '    except Exception as exc:',
    '        print("BLENDER_PLATE_EXPORT_ERROR", exc)',
    '        traceback.print_exc()',
    '        raise',
    ''
  ].join('\n');
}

export function checkBlenderPlateHealth() {
  return selectBlenderExecutable();
}

export async function buildBlenderPlate(payload = {}, options = {}) {
  const source = typeof payload.source === 'string' ? payload.source : '';
  const sourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath : '';
  const hasSource = source.trim().length > 0;
  const hasPath = sourcePath.trim().length > 0;
  if (hasSource === hasPath) {
    return categorize('VALIDATION_ERROR', 'Provide exactly one of source or sourcePath.');
  }

  const format = String(payload.format || 'glb').toLowerCase();
  if (!SUPPORTED_EXPORT_FORMATS.has(format)) {
    return categorize('VALIDATION_ERROR', 'Unsupported export format. Use stl, obj, gltf, or glb.');
  }

  const timeoutMs = clampNumber(payload.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
  const maxArtifactBytes = clampNumber(payload.maxArtifactBytes, 1_024, 512 * 1024 * 1024, MAX_ARTIFACT_BYTES);
  const returnPayloadBase64 = payload.returnPayloadBase64 !== false;

  let scriptText = source;
  let sourceIdentity = '';
  let sourceMode = hasSource ? 'inline' : 'path';

  if (hasPath) {
    if (typeof options.resolveSourcePath !== 'function') {
      return categorize('VALIDATION_ERROR', 'buildBlenderPlate requires resolveSourcePath for sourcePath mode.');
    }
    const resolved = options.resolveSourcePath(sourcePath);
    if (!resolved?.target || !resolved?.relPath) {
      return categorize('VALIDATION_ERROR', 'Unable to resolve sourcePath.');
    }
    const ext = path.extname(resolved.target).toLowerCase();
    if (ext !== '.py') {
      return categorize('VALIDATION_ERROR', 'sourcePath must point to a .py script file.');
    }
    const stat = fs.statSync(resolved.target);
    if (!stat.isFile()) return categorize('VALIDATION_ERROR', 'sourcePath is not a file.');
    if (stat.size > MAX_SOURCE_BYTES) {
      return categorize('VALIDATION_ERROR', `Blender script exceeds ${MAX_SOURCE_BYTES} bytes.`);
    }
    scriptText = fs.readFileSync(resolved.target, 'utf8');
    sourceIdentity = resolved.relPath;
  }

  const scriptBytes = Buffer.byteLength(scriptText || '', 'utf8');
  if (scriptBytes <= 0) {
    return categorize('VALIDATION_ERROR', 'Blender script source is empty.');
  }
  if (scriptBytes > MAX_SOURCE_BYTES) {
    return categorize('VALIDATION_ERROR', `Blender script exceeds ${MAX_SOURCE_BYTES} bytes.`);
  }
  if (!isSafeBlenderScript(scriptText)) {
    return categorize('VALIDATION_ERROR', 'Blender script contains blocked Python patterns.');
  }

  const health = selectBlenderExecutable();
  if (!health.ok) {
    return categorize('EXEC_NOT_FOUND', health.note || 'Blender CLI not found.');
  }

  const sourceHash = sha256Hex(scriptText).slice(0, 16);
  const formatHash = sha256Hex(format).slice(0, 8);
  const requestId = `${sourceHash}-${formatHash}`;
  const workRoot = path.resolve(
    options.tempRoot || process.env.MCP_BLENDER_TMP_ROOT || path.join(os.tmpdir(), 'ollama-plus-blender-plate')
  );
  const requestDir = path.join(workRoot, requestId);
  fs.mkdirSync(requestDir, { recursive: true });

  const userScriptPath = path.join(requestDir, 'input-script.py');
  const wrapperPath = path.join(requestDir, 'run-blender-plate.py');
  const artifactExt = format === 'gltf' ? 'gltf' : format;
  const outputPath = path.join(requestDir, `model-${requestId}.${artifactExt}`);

  fs.writeFileSync(userScriptPath, scriptText, 'utf8');
  fs.writeFileSync(wrapperPath, getWrapperScript(outputPath, format, userScriptPath), 'utf8');

  const run = await executeBlender(health.executable, [
    '--background',
    '--factory-startup',
    '--python',
    wrapperPath
  ], timeoutMs);

  if (run.failedToStart) {
    return {
      ...categorize('EXEC_NOT_FOUND', run.stderr || 'Failed to start Blender process.'),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs
    };
  }

  if (run.timedOut) {
    return {
      ...categorize('EXEC_TIMEOUT', `Blender build timed out after ${timeoutMs} ms.`),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs,
      timeoutMs
    };
  }

  if (run.code !== 0) {
    return {
      ...categorize('COMPILE_ERROR', 'Blender reported a build/export error.'),
      stderr: run.stderr,
      stdout: run.stdout,
      exitCode: run.code,
      durationMs: run.durationMs
    };
  }

  if (!fs.existsSync(outputPath)) {
    return {
      ...categorize('ARTIFACT_EMPTY', 'Blender did not produce an output artifact.'),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs
    };
  }

  const artifactStat = fs.statSync(outputPath);
  if (!artifactStat.isFile() || artifactStat.size <= 0) {
    return {
      ...categorize('ARTIFACT_EMPTY', 'Blender generated an empty artifact.'),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs
    };
  }
  if (artifactStat.size > maxArtifactBytes) {
    return {
      ...categorize('ARTIFACT_TOO_LARGE', `Artifact exceeds ${maxArtifactBytes} bytes.`),
      stderr: run.stderr,
      stdout: run.stdout,
      durationMs: run.durationMs,
      bytes: artifactStat.size
    };
  }

  const artifactRaw = fs.readFileSync(outputPath);
  const modelSourcePath = sourceIdentity || `generated/blender_plate/${requestId}.${artifactExt}`;

  return {
    ok: true,
    format,
    source: {
      mode: sourceMode,
      path: sourceIdentity || undefined,
      sourceHash,
      sourceBytes: scriptBytes
    },
    artifact: {
      path: outputPath,
      name: path.basename(outputPath),
      bytes: artifactStat.size,
      mimeType: format === 'glb' ? 'model/gltf-binary' : format === 'gltf' ? 'model/gltf+json' : `model/${format}`
    },
    payloadBase64: returnPayloadBase64 ? artifactRaw.toString('base64') : undefined,
    modelSourcePath,
    stdout: run.stdout,
    stderr: run.stderr,
    durationMs: run.durationMs,
    checkedAt: new Date().toISOString()
  };
}