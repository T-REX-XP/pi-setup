#!/usr/bin/env node
/**
 * Deprecated — forwards to pi-enroll.mjs. Use: npm run enroll
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enroll = path.join(__dirname, 'pi-enroll.mjs');

console.error('device-onboard.mjs is deprecated — use: npm run enroll\n');

const forwarded = process.argv.slice(2).filter((a) => a !== '--issue');

const r = spawnSync(process.execPath, [enroll, ...forwarded], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});
process.exit(r.status ?? 1);
