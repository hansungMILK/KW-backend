#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = join(scriptDir, '..');
const repoRoot = join(backendDir, '..', '..');
const outDir = join(backendDir, '.local-db', 'local-worker');
const outFile = join(outDir, 'local-worker-entry.cjs');
const entryPoint = join(backendDir, 'src', 'workers', 'local-worker-entry.ts');

mkdirSync(outDir, { recursive: true });

console.log(`[local-worker] building local worker bundle from ${entryPoint}`);
await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [entryPoint],
    format: 'cjs',
    outfile: outFile,
    platform: 'node',
    sourcemap: 'inline',
    target: 'node20',
    tsconfig: join(backendDir, 'tsconfig.json'),
});

console.log(`[local-worker] running ${outFile}`);
await import(outFile);
