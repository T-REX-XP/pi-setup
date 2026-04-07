#!/usr/bin/env node
import { access } from 'node:fs/promises';

const required = [
  '.pi/extensions/pi-setup-orchestrator.ts',
  '.pi/agents/creator.md',
  '.pi/agents/cross-reviewer.md',
  '.pi/agents/tester.md',
  '.pi/agents/test-verifier.md',
  '.pi/agents/improver.md',
  'cloudflare/worker/src/index.ts',
  'scripts/pi-enroll.mjs',
  'scripts/lib/pi-env-file.mjs',
  'scripts/observability-report.mjs',
];

for (const file of required) {
  try {
    await access(file);
  } catch {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}
console.log('pi-setup validation ok');
