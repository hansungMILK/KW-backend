#!/usr/bin/env node
// Cross-platform equivalent of with-local-env.sh
// Loads .env if present, then spawns the given command with those env vars.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed
            .slice(idx + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
        if (key) process.env[key] = val;
    }
}

const [, , ...args] = process.argv;
if (args.length === 0) {
    console.error('Usage: node with-local-env.js <command> [args...]');
    process.exit(1);
}

const result = spawnSync(args[0], args.slice(1), {
    stdio: 'inherit',
    shell: true,
    env: process.env,
});

process.exit(result.status ?? 1);
