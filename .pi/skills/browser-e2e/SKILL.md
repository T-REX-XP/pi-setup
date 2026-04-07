---
name: browser-e2e
description: Run headless browser end-to-end checks with Playwright helpers and capture screenshots. Use when the tester needs browser evidence.
---
# Browser E2E

## Purpose
Use this skill to run reproducible headless browser tests, interact with UI, assert page state, and capture screenshots as evidence.

## Quick Mode — single screenshot

```bash
node scripts/browser-e2e.mjs \
  --url http://127.0.0.1:3000 \
  --screenshot test-results/home.png
```

## Action Mode — multi-step test script

Pass a JSON array of actions via `--actions` (inline string or file path):

```bash
node scripts/browser-e2e.mjs \
  --url http://127.0.0.1:3000 \
  --actions '[
    {"type":"screenshot","path":"test-results/01-landing.png","fullPage":true},
    {"type":"assert-title","contains":"My App"},
    {"type":"click","selector":"button[data-testid=login]"},
    {"type":"fill","selector":"input[name=username]","value":"admin"},
    {"type":"fill","selector":"input[name=password]","value":"wrong"},
    {"type":"press","selector":"input[name=password]","key":"Enter"},
    {"type":"assert-visible","selector":".error-message"},
    {"type":"screenshot","path":"test-results/02-bad-login.png"}
  ]'
```

Or save to a file and reference it:

```bash
node scripts/browser-e2e.mjs --url http://127.0.0.1:3000 --actions tests/login.json --output test-results/login.json
```

## All Action Types

| type | required fields | optional fields | description |
|---|---|---|---|
| `navigate` | `url` | `waitUntil`, `timeout` | Go to a URL |
| `click` | `selector` | `timeout` | Click an element |
| `fill` | `selector`, `value` | `timeout` | Type into an input |
| `select` | `selector`, `value` | `timeout` | Choose a `<select>` option |
| `press` | `selector`, `key` | `timeout` | Press a keyboard key on an element |
| `hover` | `selector` | `timeout` | Hover over an element |
| `scroll` | `selector` | `direction` (`bottom`), `timeout` | Scroll element into view or to bottom |
| `wait` | `ms` | — | Pause for milliseconds |
| `wait-for` | `selector` | `state` (`visible`/`hidden`/`attached`), `timeout` | Wait for element state |
| `screenshot` | — | `path`, `fullPage` | Capture screenshot |
| `assert-url` | `contains` or `equals` | — | Assert current URL |
| `assert-title` | `contains` or `equals` | — | Assert page title |
| `assert-text` | `selector`, `contains` or `equals` | `timeout` | Assert element text |
| `assert-visible` | `selector` | `timeout` | Assert element is visible |
| `assert-hidden` | `selector` | `timeout` | Assert element is hidden |
| `assert-count` | `selector`, `count` | — | Assert number of matching elements |
| `assert-attr` | `selector`, `attr`, `contains` or `equals` | `timeout` | Assert attribute value |
| `assert-response` | `url`, `status` | — | Assert HTTP response status |
| `eval` | `expression` | `label` | Evaluate JS and capture result |

## CLI Flags

| flag | description |
|---|---|
| `--url <url>` | Starting URL (navigated before actions run) |
| `--screenshot <path>` | Quick single-screenshot (shorthand for simple flows) |
| `--actions <json\|file>` | JSON action array (inline or path to `.json` file) |
| `--timeout <ms>` | Default timeout for all actions (default: `30000`) |
| `--width <px>` | Viewport width (default: `1280`) |
| `--height <px>` | Viewport height (default: `800`) |
| `--output <file>` | Write full JSON result to file |
| `--headful` | Run with visible browser (for local debugging only) |

## Output

The script writes structured JSON to stdout:

```json
{
  "ok": false,
  "passed": 4,
  "failed": 1,
  "consoleErrors": ["TypeError: Cannot read ..."],
  "results": [
    { "status": "pass", "action": "[1] screenshot", "path": "test-results/01-landing.png" },
    { "status": "fail", "action": "[3] assert-text", "error": "Text \"Hello\" does not contain \"Welcome\"", "selector": "h1" },
    { "status": "info", "action": "auto-screenshot", "path": "test-results/failure-step-3.png" }
  ]
}
```

Exit code is `1` if any assertion failed, `0` otherwise. On first failure an automatic screenshot is captured to `test-results/failure-step-N.png`.

## Guidance for the Tester agent

- Capture at least one screenshot per critical flow as evidence.
- Assert actual content (`assert-text`, `assert-visible`) — don't just screenshot and assume.
- Use `assert-response` to verify API endpoints alongside UI.
- Use `eval` to inspect DOM state not exposed via selectors.
- Check `consoleErrors` in the output — browser JS errors are bugs.
- Your job is not to confirm it works — it is to try to break it.
