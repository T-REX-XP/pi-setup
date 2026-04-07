#!/usr/bin/env node
/**
 * browser-e2e.mjs — Playwright headless E2E runner for pi.dev tester agent.
 *
 * Usage:
 *   # Single screenshot
 *   node scripts/browser-e2e.mjs --url http://localhost:3000 --screenshot test-results/home.png
 *
 *   # Multi-step actions via JSON file
 *   node scripts/browser-e2e.mjs --url http://localhost:3000 --actions steps.json
 *
 *   # Inline actions via JSON string
 *   node scripts/browser-e2e.mjs --url http://localhost:3000 --actions '[{"type":"screenshot","path":"test-results/home.png"}]'
 *
 * Action types:
 *   { "type": "navigate",        "url": "https://..." }
 *   { "type": "click",           "selector": "button.submit" }
 *   { "type": "fill",            "selector": "input[name=q]", "value": "test" }
 *   { "type": "select",          "selector": "select#role",   "value": "admin" }
 *   { "type": "press",           "selector": "input",         "key": "Enter" }
 *   { "type": "wait",            "ms": 500 }
 *   { "type": "wait-for",        "selector": ".loaded",       "timeout": 5000 }
 *   { "type": "screenshot",      "path": "test-results/step.png", "fullPage": true }
 *   { "type": "assert-url",      "contains": "/dashboard" }
 *   { "type": "assert-title",    "contains": "My App" }
 *   { "type": "assert-text",     "selector": "h1",            "contains": "Welcome" }
 *   { "type": "assert-visible",  "selector": ".modal" }
 *   { "type": "assert-hidden",   "selector": ".spinner" }
 *   { "type": "assert-count",    "selector": "li.item",       "count": 3 }
 *   { "type": "assert-attr",     "selector": "a.link",        "attr": "href", "contains": "/about" }
 *   { "type": "assert-response", "url": "/api/health",        "status": 200 }
 *   { "type": "hover",           "selector": ".menu-item" }
 *   { "type": "scroll",          "selector": ".results",      "direction": "bottom" }
 *   { "type": "eval",            "expression": "document.querySelectorAll('li').length", "label": "item count" }
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// ── CLI argument helpers ─────────────────────────────────────────────────────

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

// ── Config ───────────────────────────────────────────────────────────────────

const url        = arg('--url');
const screenshot = arg('--screenshot');
const actionsArg = arg('--actions');
const timeout    = Number(arg('--timeout', '30000'));
const viewport   = { width: Number(arg('--width', '1280')), height: Number(arg('--height', '800')) };
const outputFile = arg('--output');
const headful    = flag('--headful');

if (!url && !actionsArg) {
  console.error([
    'Usage:',
    '  node scripts/browser-e2e.mjs --url <url> [--screenshot <file>] [--timeout <ms>]',
    '  node scripts/browser-e2e.mjs --url <url> --actions <file.json|json-string>',
    '',
    'Options:',
    '  --url         Starting URL',
    '  --screenshot  Quick single-screenshot mode (path)',
    '  --actions     JSON action array (file path or inline JSON string)',
    '  --timeout     Default action timeout in ms (default: 30000)',
    '  --width       Viewport width (default: 1280)',
    '  --height      Viewport height (default: 800)',
    '  --output      Write JSON results to this file',
    '  --headful     Run with visible browser (for debugging)',
  ].join('\n'));
  process.exit(1);
}

// ── Load actions ─────────────────────────────────────────────────────────────

async function loadActions() {
  // Quick mode: --screenshot with no --actions
  if (!actionsArg && screenshot) {
    return [{ type: 'screenshot', path: screenshot, fullPage: true }];
  }

  if (!actionsArg) {
    return [{ type: 'screenshot', path: 'test-results/browser-e2e.png', fullPage: true }];
  }

  const trimmed = actionsArg.trim();

  // Inline JSON string
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  // File path
  const raw = await fs.readFile(trimmed, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ── Result helpers ────────────────────────────────────────────────────────────

function ok(action, data = {}) {
  return { status: 'pass', action, ...data };
}

function fail(action, error, data = {}) {
  return { status: 'fail', action, error: String(error), ...data };
}

// ── Ensure directory exists ───────────────────────────────────────────────────

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.') await fs.mkdir(dir, { recursive: true });
}

// ── Action executor ───────────────────────────────────────────────────────────

async function runAction(page, action, index) {
  const label = `[${index + 1}] ${action.type}`;

  try {
    switch (action.type) {

      case 'navigate': {
        await page.goto(action.url, { waitUntil: action.waitUntil ?? 'networkidle', timeout: action.timeout ?? timeout });
        return ok(label, { url: action.url });
      }

      case 'click': {
        await page.locator(action.selector).first().click({ timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector });
      }

      case 'fill': {
        await page.locator(action.selector).first().fill(action.value ?? '', { timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector, value: action.value });
      }

      case 'select': {
        await page.locator(action.selector).first().selectOption(action.value, { timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector, value: action.value });
      }

      case 'press': {
        await page.locator(action.selector).first().press(action.key, { timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector, key: action.key });
      }

      case 'hover': {
        await page.locator(action.selector).first().hover({ timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector });
      }

      case 'scroll': {
        const loc = page.locator(action.selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout: action.timeout ?? timeout });
        if (action.direction === 'bottom') {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.scrollTop = el.scrollHeight;
          }, action.selector);
        }
        return ok(label, { selector: action.selector });
      }

      case 'wait': {
        await page.waitForTimeout(action.ms ?? 1000);
        return ok(label, { ms: action.ms });
      }

      case 'wait-for': {
        await page.locator(action.selector).first().waitFor({
          state: action.state ?? 'visible',
          timeout: action.timeout ?? timeout,
        });
        return ok(label, { selector: action.selector });
      }

      case 'screenshot': {
        const shotPath = action.path ?? `test-results/step-${index + 1}.png`;
        await ensureDir(shotPath);
        await page.screenshot({ path: shotPath, fullPage: action.fullPage ?? false });
        return ok(label, { path: shotPath });
      }

      case 'assert-url': {
        const current = page.url();
        if (action.contains && !current.includes(action.contains)) {
          return fail(label, `URL "${current}" does not contain "${action.contains}"`);
        }
        if (action.equals && current !== action.equals) {
          return fail(label, `URL "${current}" !== "${action.equals}"`);
        }
        return ok(label, { url: current });
      }

      case 'assert-title': {
        const title = await page.title();
        if (action.contains && !title.includes(action.contains)) {
          return fail(label, `Title "${title}" does not contain "${action.contains}"`);
        }
        if (action.equals && title !== action.equals) {
          return fail(label, `Title "${title}" !== "${action.equals}"`);
        }
        return ok(label, { title });
      }

      case 'assert-text': {
        const el = page.locator(action.selector).first();
        await el.waitFor({ state: 'visible', timeout: action.timeout ?? timeout });
        const text = await el.innerText();
        if (action.contains && !text.includes(action.contains)) {
          return fail(label, `Text "${text}" does not contain "${action.contains}"`, { selector: action.selector });
        }
        if (action.equals && text.trim() !== action.equals) {
          return fail(label, `Text "${text.trim()}" !== "${action.equals}"`, { selector: action.selector });
        }
        return ok(label, { selector: action.selector, text });
      }

      case 'assert-visible': {
        await page.locator(action.selector).first().waitFor({ state: 'visible', timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector });
      }

      case 'assert-hidden': {
        await page.locator(action.selector).first().waitFor({ state: 'hidden', timeout: action.timeout ?? timeout });
        return ok(label, { selector: action.selector });
      }

      case 'assert-count': {
        const count = await page.locator(action.selector).count();
        if (count !== action.count) {
          return fail(label, `Expected ${action.count} elements matching "${action.selector}", found ${count}`);
        }
        return ok(label, { selector: action.selector, count });
      }

      case 'assert-attr': {
        const val = await page.locator(action.selector).first().getAttribute(action.attr, { timeout: action.timeout ?? timeout });
        if (action.contains && !(val ?? '').includes(action.contains)) {
          return fail(label, `Attribute "${action.attr}" = "${val}" does not contain "${action.contains}"`, { selector: action.selector });
        }
        if (action.equals && val !== action.equals) {
          return fail(label, `Attribute "${action.attr}" = "${val}" !== "${action.equals}"`, { selector: action.selector });
        }
        return ok(label, { selector: action.selector, attr: action.attr, value: val });
      }

      case 'assert-response': {
        const resp = await page.request.fetch(action.url);
        if (action.status && resp.status() !== action.status) {
          return fail(label, `Expected HTTP ${action.status}, got ${resp.status()} for "${action.url}"`);
        }
        return ok(label, { url: action.url, httpStatus: resp.status() });
      }

      case 'eval': {
        const result = await page.evaluate(action.expression);
        return ok(label, { label: action.label ?? action.expression, result });
      }

      default:
        return fail(label, `Unknown action type: "${action.type}"`);
    }
  } catch (error) {
    return fail(label, error instanceof Error ? error.message : String(error));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const actions = await loadActions();
const browser = await chromium.launch({ headless: !headful });
const context = await browser.newContext({ viewport });
const page    = await context.newPage();

// Intercept console errors for evidence
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

let results = [];

try {
  // Navigate to starting URL first
  if (url) {
    page.setDefaultTimeout(timeout);
    await page.goto(url, { waitUntil: 'networkidle', timeout });
  }

  // Run actions
  for (let i = 0; i < actions.length; i++) {
    const result = await runAction(page, actions[i], i);
    results.push(result);
    process.stderr.write(`  ${result.status === 'pass' ? '✓' : '✗'} ${result.action}\n`);
    if (result.status === 'fail' && actions[i].stopOnFail !== false) {
      // Take failure screenshot automatically
      const failShot = `test-results/failure-step-${i + 1}.png`;
      await ensureDir(failShot);
      await page.screenshot({ path: failShot, fullPage: true }).catch(() => {});
      results.push({ status: 'info', action: 'auto-screenshot', path: failShot });
      break;
    }
  }
} catch (error) {
  results.push(fail('runner', error));
} finally {
  await browser.close();
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed  = results.filter((r) => r.status === 'pass').length;
const failed  = results.filter((r) => r.status === 'fail').length;
const summary = { ok: failed === 0, passed, failed, consoleErrors, results };

const output = JSON.stringify(summary, null, 2);
console.log(output);

if (outputFile) {
  await ensureDir(outputFile);
  await fs.writeFile(outputFile, output, 'utf8');
}

process.exitCode = failed > 0 ? 1 : 0;
