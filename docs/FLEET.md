# Fleet Daemon

## Start locally
```bash
node scripts/fleet-daemon.mjs
```

## Query
```bash
node scripts/fleetctl.mjs status
node scripts/fleetctl.mjs health
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

## Centralized dashboard data
Fetch aggregated machine heartbeats from the Worker:
```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/fleet/heartbeats"
```

The bundled `dashboards/fleet/index.html` supports both:
- local mode via `http://127.0.0.1:4269/metrics`
- remote mode via `https://<worker>/v1/fleet/heartbeats` with a bearer token entered at runtime

## Service install
Copy `services/systemd/pi-setup-fleet.service` to your user systemd directory and enable it.

## Dashboard
Open `dashboards/fleet/index.html` after the daemon is running.
