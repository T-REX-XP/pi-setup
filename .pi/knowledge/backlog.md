# Technical Backlog

## Project Purpose

Build `pi.dev` into an operator-friendly automation and fleet-management workspace, while evolving `nas-ui` into a reliable, low-friction local-first appliance UI for storage, networking, services, and device administration on constrained hardware.

## pi.dev

### Completed
- [x] Add signed machine enrollment with short-lived bootstrap tokens issued from the Worker.
- [x] Push daemon heartbeats to the Worker for centralized fleet dashboards.
- [x] Add richer review deduplication using semantic clustering.
- [x] Auto-clear stale completed pending workflows in the pi.dev orchestrator.

### Backlog
- [x] Implement browser/Playwright support for the current `pi.dev` setup.
- [ ] Standardize versioning and release automation across `pi.dev`, the Worker, and `nas-ui` artifacts.

## nas-ui

### Completed
- [x] Align `nas-ui` project documentation with the current Go + Svelte architecture.
- [x] Create `nas-ui` architecture and API reference docs for HTTP and WebSocket surfaces.
- [x] Refactor `nas-ui` backend startup/orchestration out of `src/backend/cmd/nas-ui/main.go`.
- [x] Split `nas-ui` frontend state management into feature-specific store modules.
- [x] Audit and document `nas-ui` WebSocket handler parity across backend and frontend.
- [x] Remove hardcoded `nas-ui` hotspot reconnect host/port assumptions.
- [x] Fix the WebSocket ERROR payload shape mismatch.
- [x] Consolidate `nas-ui` frontend WebSocket message handling and remove component-level `onmessage` overrides.
- [x] Add unit tests for the backend app.
- [x] Add frontend test coverage for the `nas-ui` Svelte app.
- [x] Increase `nas-ui` frontend code quality coverage to at least 80% across the intended quality gates and define exactly which metrics are enforced in CI.
- [x] Add a root-level quality command for `nas-ui` that runs backend tests, frontend tests, coverage, and production builds in one step.
- [x] Add CI coverage reporting and fail pull requests when the configured frontend or backend quality thresholds regress.
- [x] Replace remaining implicit frontend/backend contract assumptions with shared typed message schemas or generated protocol docs.
- [x] Add resilient error states and retry UX for websocket disconnects, slow device commands, and partial backend failures.
- [x] Expand backend tests around websocket handlers, network edge cases, and service/storage command failures.
- [x] Increase frontend test breadth beyond the current focused surfaces to cover auth flows, websocket handling, and page-level behavior.
- [x] Break down remaining large modules with mixed responsibilities into smaller units with explicit interfaces.
- [x] Add stronger security defaults: tighter CSRF/session controls, safer local token handling, audit logging, and permission boundaries.
- [x] Add role-based auth/session hardening for local admin, remote admin, and read-only viewers.
- [x] Add authenticated file browsing, upload, download, rename, move, and delete flows in `nas-ui`.
- [x] Improve observability with structured logs, request correlation, websocket event tracing, and operator-facing diagnostics.
- [x] Add file icons to the file gallery.
- [x] Implement image preview/thumbnails following thumbnail-generation best practices.
- [x] Add mobile-friendly onboarding for first boot, network setup, storage initialization, and service enablement, with config-based enable/disable control.
- [x] Implement single-command installer for `nas-ui` via curl/wget with release-artifact bootstrap and README updates.
- [x] Add `nas-ui` CI/CD pipeline improvements with matrix-based Go backend builds for Linux `amd64`, `arm64`, and `armv7`.

### Product UX Backlog
- [ ] Add notifications/alerting for disk pressure, offline nodes, hotspot state changes, failed jobs, and update availability.
- [ ] Add job history and activity timeline for copy operations, network changes, updates, and administrative actions.
- [ ] Add user-visible storage health reporting: SMART status, temperature, filesystem usage trends, and disk failure warnings.
- [ ] Add service management UI for common self-hosted apps with status, logs, restart, and enable/disable controls.
- [ ] Add system update management with version checks, release notes, safe restart flow, and rollback guidance.
- [ ] Add backup/restore workflows for app configuration, user data, and external storage targets.

### Fleet / Multi-Device Backlog
- [ ] Add multi-device/fleet view so several NAS nodes can be monitored and administered from one dashboard.
- [ ] Reduce coupling in the frontend orchestration layer by separating transport concerns from domain actions even further.

### Technical Debt
- [ ] Audit `nas-ui` for stale docs, legacy file references, and naming drift left over from earlier architecture iterations.
- [ ] Remove or rewrite compatibility barrels once all consumers are migrated to the feature-specific store modules.
- [ ] Introduce linting/formatting/typecheck enforcement where missing, and make local/CI output consistent.
- [ ] Review embedded frontend build artifacts and generated files to ensure repository hygiene and avoid accidental source-of-truth confusion.
