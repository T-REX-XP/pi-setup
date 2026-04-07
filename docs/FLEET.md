# Fleet daemon & dashboard

> **Setup:** [`SETUP.md`](SETUP.md) covers the fleet dashboard (run **locally** or on **Cloudflare Pages**), daemon env vars, and `npm run init`.

For Worker endpoints (`/v1/fleet/*`, `/v1/relay/*`, `/v1/diagnostics`) see [`CLOUDFLARE.md`](CLOUDFLARE.md).

---

## Fleet daemon

### Start locally

```bash
node scripts/fleet-daemon.mjs
```

### Query

```bash
node scripts/fleetctl.mjs status
node scripts/fleetctl.mjs health
node scripts/fleetctl.mjs diagnostics
```

### Push heartbeats to the Worker

After **`npm run enroll`**, `.env.runtime` usually contains `PI_SETUP_WORKER_URL`, `PI_SETUP_BOOTSTRAP_TOKEN`, and `PI_SETUP_MACHINE_ID`; **`fleet-daemon.mjs` loads those automatically** (`.env.runtime` or `PI_SETUP_ENV_FILE`; env vars win).

```bash
export PI_SETUP_WORKER_URL=https://<worker-url>
export PI_SETUP_BOOTSTRAP_TOKEN=...
export PI_SETUP_MACHINE_ID=$(hostname)
# optional, defaults to 15000
export PI_SETUP_HEARTBEAT_INTERVAL_MS=15000
```

When configured, the daemon posts to `POST /v1/fleet/heartbeat` and stores the latest sync result in local metrics under `heartbeat`.

Each request carries an `x-request-id` for tracing.

---

## Centralized data (curl)

```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/fleet/heartbeats"

curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/diagnostics"
```

Websocket trace helper:

```bash
PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... \
node scripts/websocket-event-trace.mjs machine-01 connected system ok conn-1

curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/observability/websocket-events?limit=20"
```

---

## Fleet dashboard (browser UI)

The UI lives in **`dashboards/fleet`** (SvelteKit). It is **only a client** to the API Worker: you enter the Worker base URL and the bootstrap token in the UI (or rely on `sync.json` / env for scripts).

### Run locally (development)

```bash
cd dashboards/fleet
npm install
npm run dev
```

Open **http://localhost:5173** (or the URL Vite prints).

- **Worker URL** — your `PI_SETUP_WORKER_URL` (deployed `https://…workers.dev`, or `http://localhost:8787` if using `wrangler dev` for the API)
- **Bearer token** — `PI_SETUP_BOOTSTRAP_TOKEN`

### Run on Cloudflare (production-style)

Build and deploy to **Cloudflare Pages**:

```bash
cd dashboards/fleet
npm install
npm run deploy:cloudflare
```

First-time: create a Pages project (e.g. `pi-fleet-dashboard`) in the Cloudflare dashboard or with `wrangler pages project create`. Change `--project-name` in `package.json` if you use another name.

After deploy, open the **`*.pages.dev`** URL, then enter the same Worker URL and token as above.

See [`SETUP.md`](SETUP.md) for CORS notes and troubleshooting.

---

## Service install (systemd)

Copy `services/systemd/pi-setup-fleet.service` to your user systemd directory and enable it.

---

## See also

- [`docs/SETUP.md`](SETUP.md) — full setup, `npm run init`, dashboard deploy
- [`docs/CLOUDFLARE.md`](CLOUDFLARE.md) — Worker API, heartbeats, WebSocket relay
- [`docs/SECRETS.md`](SECRETS.md) — credentials and enrollment
