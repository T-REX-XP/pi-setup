# Setup guide

This is the **recommended starting point** for Cloudflare, secrets, fleet, and the dashboard. For API details see [`CLOUDFLARE.md`](CLOUDFLARE.md); for secret workflows see [`SECRETS.md`](SECRETS.md).

---

## Prerequisites

- **Node.js** (LTS) for scripts and Wrangler
- **Cloudflare account** and [`wrangler` login](https://developers.cloudflare.com/workers/wrangler/commands/#login) (`wrangler login`)
- **Repo dependencies** from the repository root:

```bash
cd /path/to/pi.dev
npm install
# or: bun install
```

---

## Interactive menu (fastest path)

From the repo root:

```bash
npm run init
# or: node scripts/pi-init.mjs
```

Use the menu to deploy the API Worker, run `wrangler dev`, set secrets, apply the D1 schema, run the fleet dashboard locally, deploy the dashboard to **Cloudflare Pages**, or start the fleet daemon.

---

## Architecture (two separate apps)

| Piece | What it is | Where it runs |
|-------|------------|----------------|
| **API Worker** | `pi-setup-secrets` — REST, KV, D1, WebSocket relay | Cloudflare Workers (or `localhost:8787` with `wrangler dev`) |
| **Fleet dashboard** | SvelteKit UI in `dashboards/fleet` | **Locally:** Vite `http://localhost:5173` · **Cloud:** Cloudflare Pages |

The dashboard is only a **browser client**. It talks to the API Worker URL you enter (same as `PI_SETUP_WORKER_URL` / `sync.json` → `workerUrl`).

---

## One-time: API Worker (Cloudflare)

Do this in order.

### 1. Create KV and D1, wire `wrangler.toml`

From `cloudflare/worker`:

```bash
cd cloudflare/worker
wrangler kv namespace create PI_SETUP_SECRETS
wrangler d1 create pi-setup-db
```

Put the returned **KV id** and **D1 database_id** into `wrangler.toml` (see table in [`CLOUDFLARE.md`](CLOUDFLARE.md#configuration)).

### 2. Apply the D1 schema (remote database)

Still in `cloudflare/worker`:

```bash
wrangler d1 execute pi-setup-db --file=schema.sql --remote
```

Use `--remote` so it targets the hosted D1 database (not the local dev DB).

**Already have a `machines` table?** If enrollment OS columns are missing, run once:

```bash
wrangler d1 execute pi-setup-db --file=schema-migrate-machine-os.sql --remote
```

(`schema-migrate-machine-os.sql` adds `os_release` and `enrolled_from`; ignore errors if columns already exist.)

### 3. Create secrets (tokens)

Generate two **different** random strings (see menu option **11** or):

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Store them in the Worker:

```bash
wrangler secret put PI_SETUP_BOOTSTRAP_TOKEN
wrangler secret put PI_SETUP_ENROLLMENT_SIGNING_KEY
```

### 4. Deploy

```bash
wrangler deploy
```

Copy the printed **`https://…workers.dev`** URL (or use a custom domain from the Cloudflare dashboard). That value is your **`PI_SETUP_WORKER_URL`** and should go into `sync.json` as `workerUrl` for clients and daemons.

---

## Fleet dashboard: run **locally**

```bash
cd dashboards/fleet
npm install
# or: bun install
npm run dev
```

Open **http://localhost:5173** (or the URL Vite prints). Enter:

- **Worker URL** — `PI_SETUP_WORKER_URL` (e.g. `https://pi-setup-secrets.<subdomain>.workers.dev`, or `http://localhost:8787` if the API Worker is running via `wrangler dev`)
- **Bearer token** — `PI_SETUP_BOOTSTRAP_TOKEN`

---

## Fleet dashboard: deploy to **Cloudflare Pages**

The dashboard build uses `@sveltejs/adapter-cloudflare`. Output goes to `.svelte-kit/cloudflare`.

### First time only: create a Pages project

Either in the [Cloudflare dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages**, or:

```bash
cd dashboards/fleet
npx wrangler pages project create pi-fleet-dashboard
```

You can change the name; if you do, update the `--project-name` in `package.json` script `deploy:cloudflare`.

### Build and deploy

```bash
cd dashboards/fleet
npm install
npm run deploy:cloudflare
```

After deploy, Cloudflare gives you a **`*.pages.dev`** URL. Open that URL in a browser and enter the same **Worker URL** and **bootstrap token** as in local mode.

**CORS:** The API Worker defaults to `PI_SETUP_ALLOWED_ORIGIN = "*"` in `wrangler.toml`, so the Pages origin can call the Worker. If you lock CORS to specific origins, add your `*.pages.dev` (or custom domain) there.

---

## Fleet daemon (optional)

Push heartbeats and local metrics to the Worker:

```bash
export PI_SETUP_WORKER_URL='https://…'
export PI_SETUP_BOOTSTRAP_TOKEN='…'
export PI_SETUP_MACHINE_ID=$(hostname)
node scripts/fleet-daemon.mjs
```

See [`FLEET.md`](FLEET.md) for `fleetctl` and systemd.

---

## Environment cheat sheet

| Variable | Used by | Purpose |
|----------|---------|---------|
| `PI_SETUP_WORKER_URL` | Scripts, daemon, dashboard (when not using `sync.json` only) | Base URL of the API Worker |
| `PI_SETUP_BOOTSTRAP_TOKEN` | Scripts, daemon, dashboard | Admin `Authorization: Bearer` token |
| `PI_SETUP_ENROLLMENT_SIGNING_KEY` | Worker secret only | Signs enrollment/bootstrap JWTs (not for browser) |
| `PI_SETUP_MASTER_KEY` | Local encrypt/sync scripts | Local AES key; never stored in KV |

---

## Local API Worker development

```bash
cd cloudflare/worker
```

Add **`cloudflare/worker/.dev.vars`** (do not commit) with the same names as production secrets:

```
PI_SETUP_BOOTSTRAP_TOKEN=...
PI_SETUP_ENROLLMENT_SIGNING_KEY=...
```

Then:

```bash
wrangler dev
```

API base: **http://localhost:8787**. Set `sync.json` → `workerUrl` to that URL for local end-to-end tests.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| D1 error `10021` (invalid id) | `database_id` in `wrangler.toml` must be the UUID from `wrangler d1 list` |
| Durable Object error `10097` (free plan) | Migration must use `new_sqlite_classes` in `wrangler.toml` |
| Dashboard overlay / Vite error | `dashboards/fleet/vite.config.ts` must import `sveltekit` from `@sveltejs/kit/vite` |
| `ws://localhost:undefined` / HMR WebSocket failed | Use **http://localhost:5173** (not a bare host without port). Restart `npm run dev` after pulling; port **5173** must be free (`strictPort` is on). |
| 404 on `favicon.png` | Fixed: app uses `static/favicon.svg`. Hard-refresh the browser. |
| `runtime.lastError: Receiving end does not exist` | Comes from a **browser extension** (not this app). Ignore or test in a clean profile. |
| Pages deploy fails | Create the Pages project first; ensure `npm run build` succeeds in `dashboards/fleet` |

---

## See also

| Document | Content |
|----------|---------|
| [`CLOUDFLARE.md`](CLOUDFLARE.md) | Full Worker API, bindings, `wrangler.toml` |
| [`SECRETS.md`](SECRETS.md) | Encrypt, upload, enroll, sync |
| [`FLEET.md`](FLEET.md) | Daemon, `fleetctl`, metrics |
| [`README.md`](../README.md) | Repo overview and `pi` workflows |
