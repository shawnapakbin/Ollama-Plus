#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const shouldRun = args.has('--run');

const requiredFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'src/App.tsx',
  'src/components/Chat/MessageContent.tsx',
  'src/components/Chat/hooks/useOllamaStream.ts',
  'src/services/runtimeClient.ts',
  'electron/main.js',
  'electron/runtime/runtimeService.js',
  'electron/runtime/runtimeStore.js',
  'tests/runtimeClient.test.ts',
  'tests/runtimeService.test.ts'
];

const requiredChecks = [
  { name: 'Lint', command: 'npm run lint' },
  { name: 'Unit tests', command: 'npm run test' },
  { name: 'Build', command: 'npm run build' }
];

function run(command) {
  return spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: process.env
  }).status ?? 1;
}

function verifyRequiredFiles() {
  const missing = requiredFiles.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error('Release readiness failed: missing required files.');
    for (const file of missing) {
      console.error(`- ${file}`);
    }
    return 1;
  }
  console.log(`Required files check passed (${requiredFiles.length} files).`);
  return 0;
}

console.log('Ollama+ release readiness check');
console.log(`Mode: ${shouldRun ? 'run' : 'dry-run'}`);

const fileStatus = verifyRequiredFiles();
if (fileStatus !== 0) {
  process.exit(fileStatus);
}

if (!shouldRun) {
  console.log('Planned checks:');
  for (const check of requiredChecks) {
    console.log(`- ${check.name}: ${check.command}`);
  }
  console.log('Tip: run with --run to execute all checks.');
  process.exit(0);
}

for (const check of requiredChecks) {
  console.log(`\nRunning ${check.name}...`);
  const status = run(check.command);
  if (status !== 0) {
    console.error(`Release readiness failed during ${check.name}.`);
    process.exit(status);
  }
}

console.log('\nRelease readiness passed.');
