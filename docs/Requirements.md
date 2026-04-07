Technical Requirements Specification: pi.dev Self-Improving Fleet Architecture

1. System Overview

The system is a highly automated, multi-agent development environment built around pi.dev. It features a compounding self-improvement mechanism, an event-driven extension ecosystem, and a multi-machine fleet management infrastructure powered by Cloudflare and Node.js.

2. Core Architecture & Bootstrapping

2.1 Monorepo Structure

REQ-CORE-001: All configurations, agent prompts, workflows, extensions, dashboard code, and daemon logic MUST reside in a single Git repository (pi-setup).

REQ-CORE-002: The repository MUST implement auto-versioning (patch bumping) on every commit.

2.2 Session Wrapping (Tmux Integration)

REQ-WRAP-001: The execution of pi MUST be wrapped in a shell script (bin/pi).

REQ-WRAP-002: The wrapper MUST automatically launch the pi instance inside a named tmux session (e.g., pi-<random_id>).

REQ-WRAP-003: The wrapper MUST forward necessary environment variables to the tmux session.

REQ-WRAP-004: The wrapper MUST detect subagents or daemon-spawned processes and bypass the tmux wrapper to prevent recursive session nesting.

2.3 Bootstrapping

REQ-BOOT-001: The system MUST support minimal bootstrap for interactive environments (git clone, dependency install, optional hooks; no separate install script required).

REQ-BOOT-002: The system MUST support headless bootstrapping via a remote script (curl -sL [URL] | SYNC_PASS=[pwd] SYNC_TOKEN=[token] bash).

REQ-BOOT-003: Headless bootstrapping MUST securely pull encrypted credentials from Cloudflare KV without requiring a browser interface.

3. Multi-Agent Orchestration

3.1 Agent Roles & Guarantees

Creator (Claude Opus): Responsible for brainstorming, planning, and coding. MUST NOT modify code outside the requested scope.

Cross-reviewer (GPT-5.4): Reviews steps from other models to eliminate blind spots. MUST operate in read/comment-only mode.

Tester (GPT-5.4): Performs E2E testing via headless browser. Prompted explicitly to break the application, not to confirm it works.

Test-verifier (Claude Opus): Audits the Tester's actions to ensure full requirements coverage.

Improver (Claude Opus): Executes the self-improvement step. MUST NOT touch application code directly.

3.2 Workflows

REQ-WF-001: Workflows MUST consist of strict, guaranteed sub-agent chains with clean contexts per step.

REQ-WF-002: The system MUST support standard pipelines (/feature, /task, /quick, /review).

REQ-WF-003: The system MUST support a /recurse pipeline (work -> test -> evaluate) that passes previous error logs into new iterations and instructs the agent to avoid failed approaches.

REQ-WF-004: The system MUST include a guaranteed improve step at the end of execution pipelines.

4. The "Improve" Engine (Self-Improvement)

4.1 Session Reflection

REQ-IMP-001: The Improver MUST analyze the workflow session to identify bottlenecks, bugs, and successful workarounds.

REQ-IMP-002: Learnings MUST be recorded in a strict structured format: Summary (1 line), Detail (context), Action (resolution).

REQ-IMP-003: Learnings MUST be categorized by type (pitfall, workaround, convention, tool-recommendation).

4.2 Creative Scanning & Backlog

REQ-IMP-004: The Improver MUST scan recent histories, skills, and rules to propose optimizations.

REQ-IMP-005: Minor setup variables/prompts MUST be updated automatically. Complex architectural improvements MUST be appended to a technical backlog.

4.3 External Idea Integration

REQ-IMP-006: The system MUST provide a mechanism to ingest external workflows, prompts, or concepts provided by the user.

REQ-IMP-007: An agent MUST analyze the external input and automatically generate a plan/patch to integrate the useful concepts into the current pi-setup.

5. Extension System (Event Hooks)

The pi.dev setup MUST support event-driven plugins (extensions) that hook into session events.

REQ-EXT-001 (auto-sync): MUST monitor credential files. Upon /login, it MUST encrypt and push credentials to Cloudflare KV for near-instant multi-machine synchronization.

REQ-EXT-002 (session-bridge): MUST capture all session events (user inputs, model outputs, tool calls) and write them to a JSONL file for the daemon to consume.

REQ-EXT-003 (notification-ping): MUST trigger cross-platform alerts when the agent awaits user input. Features include:

Playing custom sound packs (e.g., Warcraft, Portal).

Firing macOS notifications with click-to-focus routing (WezTerm, VS Code).

Dynamically updating the terminal tab header.

REQ-EXT-004 (context-compressor): MUST automatically truncate or summarize excessively large tool outputs to conserve context window tokens.

REQ-EXT-005 (usage-logger): MUST log all model API calls for token/cost analytics.

REQ-EXT-006 (subagent-thinking): MUST provide a vendored subagent wrapper that supports native "thinking" processes to prevent subagent freezing/hanging.

6. Multi-Machine Fleet Infrastructure

6.1 Backend (Cloudflare)

REQ-INF-001: A Cloudflare Worker MUST serve as the central API/registry.

REQ-INF-002: A Cloudflare D1 database MUST store machine registries, heartbeats, session metadata, and usage metrics.

REQ-INF-003: Cloudflare KV MUST act as an encrypted vault for cross-machine credentials.

REQ-INF-004: The Worker MUST utilize a Durable Object to establish a WebSocket relay for real-time streaming of agent activities across machines.

6.2 Fleet Daemon (Node.js)

REQ-DMN-001: A background Node.js process managed by pm2 MUST run on every machine in the fleet.

REQ-DMN-002: The daemon MUST send a heartbeat to the CF Worker every 60 seconds.

REQ-DMN-003: The daemon MUST parse local pi session logs (from session-bridge JSONL files) and push transcripts and usage data to the backend.

REQ-DMN-004: The daemon MUST periodically execute git pull to synchronize the pi-setup monorepo.

REQ-DMN-005: The daemon MUST implement exponential backoff for network requests during connectivity outages.

REQ-DMN-006: The daemon MUST be capable of discovering active tmux pi sessions and recovering state after a crash.

6.3 Real-Time Dashboard

REQ-UI-001: A web dashboard MUST be deployed via Cloudflare Pages, built with SvelteKit.

REQ-UI-002: Access MUST be secured via Cloudflare Access (Zero Trust).

REQ-UI-003: The UI MUST employ a mobile-first, dark-theme, glass-card aesthetic.

REQ-UI-004: The dashboard MUST display all registered fleet machines and their current statuses (Online/Offline/Busy).

REQ-UI-005: The dashboard MUST connect to the CF Worker Durable Object via WebSockets to display live terminal sessions from any machine.

REQ-UI-006: The dashboard MUST allow the user to trigger new pi sessions remotely on any specific machine in the fleet.