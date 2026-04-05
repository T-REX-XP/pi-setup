# Technical Backlog

- [x] Add signed machine enrollment with short-lived bootstrap tokens issued from the Worker.
- [x] Push daemon heartbeats to the Worker for centralized fleet dashboards.
- [x] Add richer review deduplication using semantic clustering.
- [x] Align `nas-ui` project documentation with the current Go + Svelte architecture.
- [x] Create `nas-ui` architecture and API reference docs for HTTP and WebSocket surfaces.
- [ ] Refactor `nas-ui` backend startup/orchestration out of `src/backend/cmd/nas-ui/main.go`.
- [ ] Split `nas-ui` frontend state management into feature-specific store modules.
- [x] Audit and document `nas-ui` WebSocket handler parity across backend and frontend.
- [x] Remove hardcoded `nas-ui` hotspot reconnect host/port assumptions.
- [ ] fix the WebSocket ERROR payload shape mismatch next.     
