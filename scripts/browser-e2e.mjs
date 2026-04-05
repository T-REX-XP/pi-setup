#!/usr/bin/env node
import { chromium } from 'playwright';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const url = arg('--url');
const screenshot = arg('--screenshot', 'test-results/browser-e2e.png');
const timeout = Number(arg('--timeout', '30000'));

if (!url) {
  console.error('Usage: node scripts/browser-e2e.mjs --url <url> [--screenshot <file>] [--timeout <ms>]');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  page.setDefaultTimeout(timeout);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ ok: true, url, screenshot }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
