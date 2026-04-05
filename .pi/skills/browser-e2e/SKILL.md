---
name: browser-e2e
description: Run headless browser end-to-end checks with Playwright helpers and capture screenshots. Use when the tester needs browser evidence.
---
# Browser E2E

## Purpose
Use this skill to run reproducible headless browser tests and capture screenshots.

## Usage
```bash
node scripts/browser-e2e.mjs --url http://127.0.0.1:3000 --screenshot test-results/home.png
```

## Guidance
- Prefer a local URL passed via `--url`.
- Capture at least one screenshot for critical flows.
- Report command lines, screenshots, and failures.
- Your job is not to confirm it works — it's to try to break it.
