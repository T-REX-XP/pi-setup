# Fleet Daemon

> For the Worker-side fleet API endpoints (`/v1/fleet/*`, `/v1/relay/*`, `/v1/diagnostics`) see [`docs/CLOUDFLARE.md`](CLOUDFLARE.md).

## Start locally
```bash
node scripts/fleet-daemon.mjs
```

## Query
```bash
node scripts/fleetctl.mjs status
node scripts/fleetctl.mjs health
node scripts/fleetctl.mjs diagnostics
```

## Push heartbeats to the Worker
Set these environment variables before starting the daemon:
```bash
export PI_SETUP_WORKER_URL=https://<worker-url>
export PI_SETUP_BOOTSTRAP_TOKEN=...
export PI_SETUP_MACHINE_ID=$(hostname)
# optional, defaults to 15000
export PI_SETUP_HEARTBEAT_INTERVAL_MS=15000
```

When configured, the daemon posts snapshots to `POST /v1/fleet/heartbeat` and stores the latest sync result in local metrics under `heartbeat`.

Each daemon request and remote heartbeat push carries an `x-request-id` correlation ID. The daemon and Worker emit structured JSON logs including that request ID so operators can trace a heartbeat end-to-end.

## Centralized dashboard data
Fetch aggregated machine heartbeats from the Worker:
```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/fleet/heartbeats"
```

Fetch operator-facing diagnostics from the Worker:
```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/diagnostics"
```

Record and inspect websocket trace events:
```bash
PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... \
node scripts/websocket-event-trace.mjs machine-01 connected system ok conn-1

curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/observability/websocket-events?limit=20"
```

The bundled `dashboards/fleet/index.html` supports both:
- local mode via `http://127.0.0.1:4269/metrics`
- remote mode via `https://<worker>/v1/fleet/heartbeats` with a bearer token entered at runtime

## Service install
Copy `services/systemd/pi-setup-fleet.service` to your user systemd directory and enable it.

## Dashboard
Open `dashboards/fleet/index.html` after the daemon is running.

## See also
- [`docs/CLOUDFLARE.md`](CLOUDFLARE.md) — Worker API reference, heartbeat schema, WebSocket relay
- [`docs/SECRETS.md`](SECRETS.md) — credential upload and machine enrollment
