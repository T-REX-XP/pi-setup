# pi-setup

Single-repo pi setup for infrastructure, multi-agent workflows, Cloudflare-backed secret delivery, fleet monitoring, and self-improvement assets.

## First-time Cloudflare & dashboard setup

1. **Read** [`docs/SETUP.md`](docs/SETUP.md) — step-by-step API Worker, D1, secrets, and fleet dashboard (**local** or **Cloudflare Pages**).
2. **Run the interactive menu** from the repo root (requires `npm install` or `bun install` at the root first):

```bash
npm run init
```

Use it to deploy the API Worker, run `wrangler dev`, apply the D1 schema, start the dashboard dev server, deploy the dashboard to Pages, or run the fleet daemon.

## Included

- `.pi/agents/` — isolated role agents
- `.pi/extensions/pi-setup-orchestrator.ts` — workflow commands, context injection, subagent runner
- `.pi/prompts/` — workflow fallback templates
- `.pi/knowledge/` — rules, decisions, learnings, backlog
- `cloudflare/worker/` — encrypted secret API (Worker + KV + D1 + Durable Objects)
- `scripts/fleet-daemon.mjs` — local monitoring daemon
- `dashboards/fleet/` — SvelteKit fleet dashboard (run locally with Vite or deploy to Cloudflare Pages)
- `.githooks/pre-commit` — automatic infrastructure patch bump
- `install.sh` — one-command bootstrap for the `pi` coding agent

## Quick start (coding agent)

```bash
./install.sh
pi
```

## Workflow commands

Inside `pi`, use:

- `/feature <objective>`
- `/task <objective>`
- `/quick <objective>`
- `/recurse <goal>`
- `/review <objective>`
- `/brainstorm <objective>`
- `/plan <objective>`
- `/code <objective>`
- `/test <objective>`
- `/improve <objective>`
- `/idea <external concept>`
- `/continue`

## Documentation

| Doc | Description |
|-----|-------------|
| [**`docs/SETUP.md`**](docs/SETUP.md) | **Start here** — Worker, D1, secrets, dashboard (local + Cloudflare Pages), `npm run init` |
| [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md) | Worker API reference, schema, relay, deployment details |
| [`docs/SECRETS.md`](docs/SECRETS.md) | Encrypt, upload, enroll, sync |
| [`docs/FLEET.md`](docs/FLEET.md) | Fleet daemon, `fleetctl`, metrics |

## Secret flow (summary)

1. Deploy `cloudflare/worker/` with KV, D1, and secrets — see [`docs/SETUP.md`](docs/SETUP.md).
2. Encrypt and upload a blob:

   ```bash
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MASTER_KEY=... \
   node scripts/secrets-encrypt-upload.mjs machine-prod .env.production
   ```

3. Pull on an existing machine:

   ```bash
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MASTER_KEY=... \
   node scripts/secrets-sync.mjs machine-prod .env.runtime
   ```

4. New machine enrollment:

   ```bash
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... \
   node scripts/enrollment-token-issue.mjs machine-01 machine-prod

   PI_SETUP_WORKER_URL=... PI_SETUP_ENROLLMENT_TOKEN=... PI_SETUP_MASTER_KEY=... \
   node scripts/machine-enroll.mjs .env.runtime
   ```

## Fleet daemon (summary)

```bash
node scripts/fleet-daemon.mjs
node scripts/fleetctl.mjs status
node scripts/fleetctl.mjs diagnostics
```

To push heartbeats to the Worker, set `PI_SETUP_WORKER_URL`, `PI_SETUP_BOOTSTRAP_TOKEN`, and `PI_SETUP_MACHINE_ID`, then start the daemon — see [`docs/FLEET.md`](docs/FLEET.md).

**Dashboard:** run locally with `cd dashboards/fleet && npm run dev`, or deploy to Cloudflare Pages with `npm run deploy:cloudflare` — details in [`docs/SETUP.md`](docs/SETUP.md).

```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/fleet/heartbeats"
```

Combined operator report:

```bash
PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... \
node scripts/observability-report.mjs
```

The Worker emits structured JSON logs, `x-request-id` correlation IDs, websocket trace events (`/v1/observability/websocket-events`), and diagnostics at `/v1/diagnostics`.
