# pi-setup

Single-repo pi setup for infrastructure, multi-agent workflows, Cloudflare-backed secret delivery, fleet monitoring, and self-improvement assets.

## Included
- `.pi/agents/` - 5 isolated role agents
- `.pi/extensions/pi-setup-orchestrator.ts` - workflow commands, context injection, subagent runner
- `.pi/prompts/` - workflow fallback templates
- `.pi/knowledge/` - rules, decisions, learnings, backlog
- `cloudflare/worker/` - encrypted secret blob API via Worker + KV
- `scripts/fleet-daemon.mjs` - local monitoring daemon
- `dashboards/fleet/index.html` - lightweight dashboard
- `.githooks/pre-commit` - automatic infrastructure patch bump
- `install.sh` - one-command bootstrap

## Quick start
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
| [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md) | Full Cloudflare Worker API reference, D1 schema, Durable Object relay, KV layout, and deployment |
| [`docs/SECRETS.md`](docs/SECRETS.md) | Step-by-step secret upload, pull, and machine enrollment workflow |
| [`docs/FLEET.md`](docs/FLEET.md) | Fleet daemon configuration, `fleetctl` usage, and dashboard |

## Secret flow
1. Deploy `cloudflare/worker/` with a KV namespace plus `PI_SETUP_BOOTSTRAP_TOKEN` and `PI_SETUP_ENROLLMENT_SIGNING_KEY` secrets.
2. Encrypt and upload a blob:
   ```bash
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MASTER_KEY=... \
   node scripts/secrets-encrypt-upload.mjs machine-prod .env.production
   ```
3. Existing machine pull with the admin bootstrap token:
   ```bash
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MASTER_KEY=... \
   node scripts/secrets-sync.mjs machine-prod .env.runtime
   ```
4. New machine enrollment with a short-lived Worker-issued token:
   ```bash
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... \
   node scripts/enrollment-token-issue.mjs machine-01 machine-prod

   PI_SETUP_WORKER_URL=... PI_SETUP_ENROLLMENT_TOKEN=... PI_SETUP_MASTER_KEY=... \
   node scripts/machine-enroll.mjs .env.runtime
   ```

## Fleet daemon
```bash
node scripts/fleet-daemon.mjs
node scripts/fleetctl.mjs status
node scripts/fleetctl.mjs diagnostics
open dashboards/fleet/index.html
```

To centralize fleet state in the Worker, start the daemon with:
```bash
PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MACHINE_ID=$(hostname) \
node scripts/fleet-daemon.mjs
```

Then query aggregated Worker heartbeats:
```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/fleet/heartbeats"
```

The Worker now adds structured JSON logs, propagates `x-request-id` correlation IDs, records websocket trace events through `/v1/observability/websocket-events`, and exposes operator diagnostics at `/v1/diagnostics`.

For a combined operator report:
```bash
PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... \
node scripts/observability-report.mjs
```
