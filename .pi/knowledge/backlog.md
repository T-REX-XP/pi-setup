# Backlog

## Open

- [ ] **Integrate VS Code for the Web** — Support browser-based editing and inspection alongside the repo: e.g. document or automate opening this clone in **vscode.dev** / **github.dev**, optional **dev container** metadata for consistent environments, and/or fleet-dashboard links that jump to the right GitHub path in the web editor. If remote machines are involved, evaluate **code tunnel** / forwarded ports vs. static Pages-only flows; keep auth and secrets out of the browser surface.

- [ ] **Telegram chatbot integration** — Expose controlled interactions over **Telegram Bot API**: webhook or long-poll receiver (e.g. Cloudflare Worker route or daemon-side), **bot token** and optional **allowlisted chat/user IDs** stored via existing secrets patterns (no tokens in repo). Scope candidates: fleet status summaries, enrollment or health alerts, or a thin bridge to agent sessions with strict rate limits and audit logging.

## Completed

- [x] **Fix SvelteKit peer-dependency warnings in `dashboards/fleet`** — Bumped `@sveltejs/adapter-cloudflare` from `^4.0.0` to `^5.0.0` (accepts `wrangler ^3.87.0 || ^4.0.0`); downgraded `vitest` from `^4.1.3` to `^2.1.9` (compatible with `vite ^5`); added `vitest.config.ts`; fixed fake-timer guards in tests. `npm install` now runs clean with zero peer-dep errors. (Completed: 2026-04-07)

- [x] **Install `pwsh` on dev machine** — Installed via `brew install powershell` (v7.6.0). PSScriptAnalyzer module also installed. (Completed: 2026-04-07)

- [x] **Windows CI validation for `.ps1` files** — Added `.github/workflows/ps1-lint.yml` GitHub Actions workflow on `windows-latest` that runs PSScriptAnalyzer with required rules on all `.ps1` files. Blocks merge on errors. (Completed: 2026-04-07)

- [x] **Windows installer (`install.ps1` + `bin/pi.ps1`)** — PowerShell install script that locates the real `pi` binary, installs repo deps, configures git hooks, and injects `PATH`/`PI_REAL_PI` into `$PROFILE`. Thin `bin/pi.ps1` wrapper tags each session with `PI_TMUX_SESSION` for fleet discovery. PATHEXT-aware binary lookup, BOM-preserving profile writes, long-path-safe summary box. (Completed: 2026-04-07)

- [x] **tmux wrapper for macOS/Linux (`bin/pi`)** — Bash wrapper that finds the real `pi` binary, skips wrapping for subagents/daemon/`--print` invocations, and wraps interactive runs in a named `tmux` session (`pi-<hex>`). Fleet daemon discovers sessions via `tmux ls`. (Completed: 2026-04-07)

- [x] **Headless VPS bootstrap (`bootstrap.sh`)** — `curl | bash` installer for headless machines. Pulls encrypted credentials from Cloudflare KV via `SYNC_TOKEN`/`SYNC_PASS`, installs node/bun/pi, clones the repo, enrolls the machine in the fleet. No browser required. (Completed: 2026-04-07)

- [x] **Systemd user service for fleet daemon** — `install.sh` generates and installs a `~/.config/systemd/user/pi-fleet-daemon.service` unit. Daemon starts on login and survives terminal closure. `install.sh` also documents enabling lingering for auto-start at boot. (Completed: 2026-04-07)

- [x] **Multi-machine fleet infrastructure** — Cloudflare D1 schema (`machines`, `sessions`, `usage_metrics`), Durable Object WebSocket relay, fleet daemon v2 (heartbeat, session tracking, KV sync), admin Worker API, SvelteKit fleet dashboard with live relay. (Completed: 2026-04-07)

- [x] **Fleet dashboard — machine deletion** — `DELETE /v1/machines/:id` Worker endpoint (admin-only) that deletes D1 rows in FK order and removes KV keys. Dashboard shows inline two-step confirmation on both the overview cards and the machine detail page. Relay torn down only on confirmed success. (Completed: 2026-04-07)

- [x] **Fleet dashboard — API error handling and retry logic** — `ApiError` class with `status`/`retryable`/`cloudflareCode` fields, `withRetry()` exponential-backoff helper, `userMessage()` formatter, and per-endpoint error banners in the dashboard UI. (Completed: 2026-04-07)

- [x] **WebSocket relay authentication** — Admin token required to open a relay connection; `401` returned for missing/invalid tokens. Dashboard passes token via `Authorization` header on the upgrade request. (Completed: 2026-04-07)

- [x] **CORS handling** — Worker sets correct `Access-Control-Allow-*` headers for all API routes including `DELETE`. Preflight `OPTIONS` requests handled explicitly. (Completed: 2026-04-07)

- [x] **WebSocket relay lifecycle fix** — Fixed race condition where a `destroy()` call during reconnect left the relay permanently dead. `manualReconnect` flag prevents reconnect after intentional teardown; relay stays intact on API failure. (Completed: 2026-04-07)

- [x] **Vitest unit tests for fleet dashboard** — 35 unit tests covering `ApiError`, `userMessage`, `withRetry`, and `apiGet` (timeout, retry, error classification). `vitest.config.ts` bootstrapped with `jsdom` environment. (Completed: 2026-04-07)

- [x] **Extensions — usage-logger, context-compressor, notification-ping, auto-sync** — Four pi extensions providing token/cost logging, context window compression, macOS notification pings, and automatic `.pi/` sync to git remote. (Completed: 2026-04-07)

- [x] **Session-bridge extension (REQ-EXT-002)** — Extension that surfaces live daemon session data (active tmux sessions, heartbeats) into the agent context at each turn. Fleet dashboard shows live session summary. (Completed: 2026-04-07)

- [x] **Compounding context injection** — All agents receive accumulated decisions, rules, learnings, and workflow history at the start of each phase via the system prompt. (Completed: 2026-04-07)

- [x] **Self-healing workflow queue** — Orchestrator detects stale/stuck workflow phases, auto-clears them, and recovers gracefully from phase errors without requiring a manual `/clear`. (Completed: 2026-04-07)

- [x] **Browser/Playwright E2E support** — `browser-e2e` skill with headless Playwright helpers, screenshot capture, and evidence collection for UI verification phases. (Completed: 2026-04-07)
