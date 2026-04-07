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

### Sessions in the dashboard

The daemon periodically scans **`~/.pi/agent/sessions/<encoded-cwd>/`** for `*.jsonl` Pi transcripts and POSTs them to **`/v1/sessions`** (same bootstrap token as heartbeats). **`process.cwd()`** when the daemon starts must match the directory you use when running **`pi`** — otherwise the encoded path does not match and nothing is uploaded. The first scan runs about **30s** after startup; adjust **`PI_SETUP_SESSION_SCAN_INTERVAL_MS`** / `sync.json` → `sessionScanIntervalMs` if needed.

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

We support two styles. Use **only one** (both would fight over the same daemon port).

### Why `systemctl --user` exists

**User units** live under `~/.config/systemd/user/` and are installed **without sudo**. They run as you, with your home and repo permissions. The tradeoff is systemd’s default: **your user manager often starts only when you log in** (SSH, desktop), unless you enable [lingering](#after-reboot-the-daemon-only-starts-once-you-ssh--why).

That default is why we document **`loginctl enable-linger`** for headless machines if you stay on a user unit.

### System unit (boot without login, no lingering)

A **system** unit is installed under **`/etc/systemd/system/`** with **`sudo`**. It is started at **`multi-user.target`** (normal boot). The service still runs the daemon **as your normal UNIX user** (`User=` / `Group=` in the unit), so it can read **`~/.env.runtime`** in the repo — you are not running Node as root.

On Linux, **`./install.sh`** writes a ready-made file:

**`~/.config/pi-setup/pi-setup-fleet.system.service`**

Install it:

```bash
sudo cp ~/.config/pi-setup/pi-setup-fleet.system.service /etc/systemd/system/pi-setup-fleet.service
sudo systemctl daemon-reload
sudo systemctl enable --now pi-setup-fleet.service
sudo systemctl status pi-setup-fleet.service
```

If you previously enabled the **user** unit, disable it first:

```bash
systemctl --user disable --now pi-setup-fleet.service
```

Example for manual editing: [`services/systemd/pi-setup-fleet.system.service.example`](../services/systemd/pi-setup-fleet.system.service.example).

### User unit (no sudo)

**`./install.sh`** also writes **`~/.config/systemd/user/pi-setup-fleet.service`**. Enable with:

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-setup-fleet.service
```

### After reboot the user unit only starts once you SSH — why?

**`systemctl --user` units are tied to your login session.** Until something starts a session for that user (SSH, graphical login, etc.), systemd does **not** run your user services. That is normal default behavior, not a bug in this repo.

To keep a **user** unit but still run at boot without logging in, enable **lingering** (once per machine):

```bash
loginctl enable-linger "$USER"
# or: sudo loginctl enable-linger pi
```

Verify: `loginctl show-user "$USER" -p Linger` → `Linger=yes`.

**Manual user-unit install:** copy `services/systemd/pi-setup-fleet.service` to `~/.config/systemd/user/` and set `WorkingDirectory` to your repo path (the default in the repo file is `%h/pi.dev` for a home-directory clone named `pi.dev`).

---

## See also

- [`docs/SETUP.md`](SETUP.md) — full setup, `npm run init`, dashboard deploy
- [`docs/CLOUDFLARE.md`](CLOUDFLARE.md) — Worker API, heartbeats, WebSocket relay
- [`docs/SECRETS.md`](SECRETS.md) — credentials and enrollment
