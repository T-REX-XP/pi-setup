# Cloudflare Infrastructure

> **New to deployment?** Follow [`SETUP.md`](SETUP.md) first (API Worker, D1, secrets, fleet dashboard locally or on Cloudflare Pages, and `npm run init`).

This document is the single authoritative reference for the `pi.dev` Cloudflare backend.
It covers the Worker API, D1 database schema, Durable Object WebSocket relay, KV storage layout,
authentication model, and deployment procedures.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Cloudflare Worker  (pi-setup-secrets)                           │
│                                                                 │
│  ┌──────────────┐  ┌─────────────────────────────────────────┐ │
│  │ KV namespace │  │ D1 database (pi-setup-db)               │ │
│  │              │  │  machines · sessions · usage_metrics    │ │
│  │ secret:*     │  └─────────────────────────────────────────┘ │
│  │ enrollment:* │                                               │
│  │ machine:*    │  ┌─────────────────────────────────────────┐ │
│  │ fleet:*      │  │ Durable Object — PIRelayDurableObject   │ │
│  │ ws-event:*   │  │  one instance per machine               │ │
│  └──────────────┘  │  agent ←──websocket──→ observer(s)     │ │
│                    └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
        ▲                         ▲
        │ REST / WebSocket        │ WebSocket
   fleet-daemon.mjs          dashboards/fleet
```

---

## Configuration

### `cloudflare/worker/wrangler.toml`

| Key | Description |
|-----|-------------|
| `name` | Worker name — `pi-setup-secrets` |
| `main` | Entry point — `src/index.ts` |
| `kv_namespaces[].binding` | `PI_SETUP_SECRETS` |
| `kv_namespaces[].id` | KV namespace ID from `wrangler kv namespace create` |
| `d1_databases[].binding` | `PI_DB` |
| `d1_databases[].database_id` | D1 database ID from `wrangler d1 create pi-setup-db` |
| `durable_objects.bindings[].name` | `PI_RELAY` |
| `vars.PI_SETUP_ALLOWED_ORIGIN` | `*` or a specific origin for CORS |

### Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| `PI_SETUP_BOOTSTRAP_TOKEN` | Shared admin token; required on every privileged request |
| `PI_SETUP_ENROLLMENT_SIGNING_KEY` | HMAC-SHA-256 key used to sign/verify enrollment and bootstrap JWTs |

### `sync.json` (per-machine client config)

```jsonc
{
  "workerUrl": "https://<your-worker>.workers.dev",
  "heartbeatIntervalMs": 60000,      // how often the daemon posts /v1/fleet/heartbeat
  "gitSyncIntervalMs": 300000,        // how often the daemon syncs git
  "sessionScanIntervalMs": 120000,    // how often local pi sessions are scanned
  "daemonPort": 4269,                 // local fleet-daemon HTTP port
  "maxBackoffMs": 300000              // max retry back-off on network failure
}
```

---

## Authentication

All privileged endpoints require an `Authorization: Bearer <token>` header.

| Token type | Value | Scope |
|------------|-------|-------|
| **Admin / bootstrap** | `PI_SETUP_BOOTSTRAP_TOKEN` secret | Full access to all endpoints |
| **Enrollment JWT** (`typ: enrollment`) | Issued by `/v1/enrollment-tokens/issue` | One-time machine enrolment; TTL 60 s–3 600 s |
| **Bootstrap JWT** (`typ: bootstrap`) | Issued by `/v1/machines/enroll` | Secret read for one `secretName`; TTL 300 s |

JWTs are HS256 tokens signed with `PI_SETUP_ENROLLMENT_SIGNING_KEY`.

Every response and structured log line includes an `x-request-id` / `requestId` field for end-to-end tracing.

---

## API reference

Base path: `https://<worker-url>`

All endpoints return `application/json`. CORS headers are included on every response.

### `OPTIONS *`
Pre-flight CORS handshake — always returns 200.

---

### Secret management

#### `POST /v1/secrets/upsert` 🔐 admin
Store (or replace) an encrypted credential blob in KV.

**Request body**
```jsonc
{
  "name": "machine-prod",       // required; KV key suffix
  "ciphertext": "<base64>",     // required; AES-GCM encrypted payload
  "iv": "<base64>",             // required; 12-byte initialisation vector
  "tag": "<base64>",            // required; 16-byte authentication tag
  "algorithm": "AES-GCM",      // optional; default "AES-GCM"
  "version": "1",               // optional; schema version
  "machineId": "machine-prod"   // optional; associate blob with a machine
}
```

**Response `200`**
```jsonc
{ "ok": true, "stored": "machine-prod", "updatedAt": "<iso8601>", "requestId": "..." }
```

---

#### `GET /v1/secrets` 🔐 admin
List names of all stored secret blobs.

**Response `200`**
```jsonc
{ "ok": true, "keys": ["machine-prod", "machine-staging"], "requestId": "..." }
```

---

#### `GET /v1/secrets/:name` 🔐 admin or bootstrap JWT
Retrieve a single encrypted blob.

**Response `200`**
```jsonc
{
  "ok": true,
  "machineId": "machine-01",    // null when called by admin
  "secret": {
    "name": "machine-prod",
    "ciphertext": "...",
    "iv": "...",
    "tag": "...",
    "algorithm": "AES-GCM",
    "version": "1",
    "updatedAt": "<iso8601>"
  },
  "requestId": "..."
}
```

---

### Machine enrollment

#### `POST /v1/enrollment-tokens/issue` 🔐 admin
Issue a short-lived signed enrollment JWT for a new machine.

**Request body**
```jsonc
{
  "machineId": "machine-01",    // required
  "secretName": "machine-prod", // required
  "ttlSeconds": 600,            // optional; range 60–3600, default 600
  "metadata": {}                // optional; arbitrary key/value pairs
}
```

**Response `200`**
```jsonc
{
  "ok": true,
  "token": "<jwt>",
  "expiresAt": "<iso8601>",
  "machineId": "machine-01",
  "secretName": "machine-prod",
  "requestId": "..."
}
```

---

#### `POST /v1/machines/enroll` 🔐 enrollment JWT (Bearer)
Redeem a one-time enrollment token, register the machine, and obtain a short-lived bootstrap JWT
that can be used to pull the credential blob.

**Request body** (optional metadata merged into the enrollment record and stored on the D1 `machines` row)
```jsonc
{
  "hostname": "MacBook-Pro.local",
  "platform": "darwin",
  "arch": "arm64",
  "osRelease": "23.4.0",
  "enrolledFrom": "scripts/pi-enroll.mjs"
}
```

`osRelease` is typically `os.release()` (kernel version). `enrolledFrom` is a short client id string.

**Response `200`**
```jsonc
{
  "ok": true,
  "machineId": "machine-01",
  "secretName": "machine-prod",
  "bootstrapToken": "<jwt>",   // valid 300 s; use with GET /v1/secrets/:name
  "bootstrapExpiresAt": "<iso8601>",
  "requestId": "..."
}
```

Returns `409` if the enrollment token has already been used.

---

### Fleet heartbeats

#### `POST /v1/fleet/heartbeat` 🔐 admin
Report a machine liveness snapshot. The fleet daemon calls this every `heartbeatIntervalMs`.

**Request body**
```jsonc
{
  "machineId": "mac-mini-01",   // required
  "hostname": "mac-mini-01",    // required
  "platform": "darwin",
  "release": "24.4.0",
  "uptimeSeconds": 12345,
  "loadavg": [0.5, 0.8, 1.0],
  "memory": { "total": 17179869184, "free": 4294967296, "used": 12884901888 },
  "cpuCount": 8,
  "arch": "arm64",
  "timestamp": "<iso8601>"      // required; used to compute staleness
}
```

**Response `200`**
```jsonc
{ "ok": true, "machineId": "mac-mini-01", "receivedAt": "<iso8601>", "requestId": "..." }
```

A heartbeat is flagged `stale: true` when `receivedAt − timestamp > 60 s`.

---

#### `GET /v1/fleet/heartbeats` 🔐 admin
Retrieve all machine heartbeats, newest first.

**Response `200`**
```jsonc
{
  "ok": true,
  "count": 2,
  "heartbeats": [ { ...heartbeat, "stale": false }, ... ],
  "requestId": "..."
}
```

---

### Sessions (D1)

#### `POST /v1/sessions` 🔐 admin
Create or update a pi session record.

**Request body**
```jsonc
{
  "sessionId": "<uuid>",        // required
  "machineId": "mac-mini-01",   // required
  "startedAt": "<iso8601>",     // required
  "cwd": "/home/user/project",
  "model": "claude-opus-4.6",
  "provider": "github-copilot",
  "endedAt": "<iso8601>",       // omit while active
  "status": "active",           // "active" | "ended" | "crashed"
  "messageCount": 12
}
```

**Response `200`**
```jsonc
{ "ok": true, "sessionId": "<uuid>", "requestId": "..." }
```

---

#### `GET /v1/sessions` 🔐 admin
List sessions, optionally filtered by machine, newest first.

| Query param | Default | Description |
|-------------|---------|-------------|
| `machineId` | — | Filter to one machine |
| `limit` | 50 | Max rows returned (hard cap 200) |

**Response `200`**
```jsonc
{ "ok": true, "count": 3, "sessions": [...], "requestId": "..." }
```

---

### Usage metrics (D1)

#### `POST /v1/usage` 🔐 admin
Record token-level usage for a model call.

**Request body**
```jsonc
{
  "machineId": "mac-mini-01",   // required
  "sessionId": "<uuid>",
  "model": "claude-opus-4.6",
  "provider": "github-copilot",
  "inputTokens": 1024,
  "outputTokens": 512,
  "costUsd": 0.0042
}
```

**Response `200`**
```jsonc
{ "ok": true, "requestId": "..." }
```

---

#### `GET /v1/usage` 🔐 admin
List usage metrics, optionally filtered by machine, newest first.

| Query param | Default | Description |
|-------------|---------|-------------|
| `machineId` | — | Filter to one machine |
| `limit` | 100 | Max rows returned (hard cap 500) |

---

### Machines (D1)

#### `GET /v1/machines` 🔐 admin
List all registered machines, sorted by most-recently seen.

**Response `200`**
```jsonc
{
  "ok": true,
  "count": 2,
  "machines": [
    {
      "machine_id": "mac-mini-01",
      "hostname": "mac-mini-01",
      "platform": "darwin",
      "arch": "arm64",
      "enrolled_at": "<iso8601>",
      "last_seen_at": "<iso8601>",
      "status": "active"
    }
  ],
  "requestId": "..."
}
```

---

### WebSocket relay (Durable Objects)

#### `GET /v1/relay/:machineId` 🔐 admin + WebSocket upgrade
Open a real-time relay channel for a machine. Each machine gets its own Durable Object instance.

**Query params**
| Param | Values | Description |
|-------|--------|-------------|
| `role` | `agent` \| `observer` | `agent` — fleet daemon or pi process; `observer` — dashboard |
| `token` | bootstrap secret | **Browsers:** pass `PI_SETUP_BOOTSTRAP_TOKEN` here (WebSocket cannot send `Authorization`). **Server:** `Authorization: Bearer` is enough. |

**Relay behaviour**
- When an `observer` connects it receives an immediate `relay:welcome` frame: `{ "type": "relay:agent-connected" }` or `{ "type": "relay:agent-disconnected" }`.
- Messages sent by the `agent` are broadcast to all connected `observer`s and vice versa.
- When an `agent` connects/disconnects, all observers are notified.

**Example (browser — token in query)**
```js
const ws = new WebSocket(
  `wss://<worker-url>/v1/relay/${encodeURIComponent(machineId)}?role=observer&token=${encodeURIComponent(token)}`
);
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

**Example (fetch from Worker / Node — header)**
```js
// Subrequests can set Authorization; query token is optional.
await fetch(`https://worker/v1/relay/${id}?role=agent`, {
  headers: { Authorization: `Bearer ${token}`, Upgrade: 'websocket', ... },
});
```

---

### Observability

#### `POST /v1/observability/websocket-events` 🔐 admin
Record a structured WebSocket trace event in KV.

**Request body**
```jsonc
{
  "machineId": "mac-mini-01",   // required
  "direction": "in",            // required: "in" | "out" | "system"
  "eventType": "connected",     // required
  "connectionId": "conn-1",
  "payloadSize": 128,
  "status": "ok",               // "ok" | "error"
  "metadata": {},
  "timestamp": "<iso8601>"      // optional; defaults to server time
}
```

**Response `200`**
```jsonc
{ "ok": true, "recordedAt": "<iso8601>", "requestId": "..." }
```

---

#### `GET /v1/observability/websocket-events` 🔐 admin
Retrieve recorded trace events, newest first.

| Query param | Default | Description |
|-------------|---------|-------------|
| `machineId` | — | Filter to one machine |
| `limit` | 25 | Max events returned (hard cap 100) |

---

#### `GET /v1/diagnostics` 🔐 admin
Full operator health snapshot: KV counts, D1 fleet status, auth config, latest heartbeats, and
latest WebSocket trace events.

**Response shape (condensed)**
```jsonc
{
  "ok": true,
  "requestId": "...",
  "diagnostics": {
    "counts": {
      "secrets": 2, "enrollments": 1, "machines": 2,
      "fleetHeartbeats": 2, "websocketEvents": 14
    },
    "auth": {
      "allowedOrigin": "*",
      "bootstrapTokenConfigured": true,
      "enrollmentSigningKeyConfigured": true
    },
    "fleet": {
      "staleCount": 0,
      "latestHeartbeats": [ ... ]
    },
    "websocket": {
      "latestEvents": [ ... ]
    }
  }
}
```

---

## KV storage layout

| Key prefix | Content | TTL |
|------------|---------|-----|
| `secret:<name>` | `SecretRecord` JSON | none |
| `enrollment:<jti>` | `EnrollmentRecord` JSON | matches token `exp` |
| `machine:<machineId>` | Machine registration metadata | none |
| `fleet:<machineId>` | Latest `FleetHeartbeat` JSON | none |
| `ws-event:<timestamp>:<uuid>` | `WebsocketTraceEvent` JSON | none |

---

## D1 schema

Source file: `cloudflare/worker/schema.sql`

```sql
CREATE TABLE machines (
  machine_id   TEXT PRIMARY KEY,
  hostname     TEXT NOT NULL,
  platform     TEXT,
  arch         TEXT,
  enrolled_at  TEXT,
  last_seen_at TEXT,
  status       TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE sessions (
  session_id    TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL REFERENCES machines(machine_id),
  cwd           TEXT,
  model         TEXT,
  provider      TEXT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER DEFAULT 0
);

CREATE TABLE usage_metrics (
  id            TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL REFERENCES machines(machine_id),
  session_id    TEXT,
  model         TEXT,
  provider      TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0.0,
  recorded_at   TEXT NOT NULL
);
```

---

## Deployment

### 1. Create resources

```bash
# KV namespace
wrangler kv namespace create PI_SETUP_SECRETS
# → paste the returned id into wrangler.toml kv_namespaces[].id

# D1 database
wrangler d1 create pi-setup-db
# → paste the returned database_id into wrangler.toml d1_databases[].database_id

# Apply schema to the *remote* D1 database (use --remote for hosted DB)
wrangler d1 execute pi-setup-db --file=schema.sql --remote
```
(Run these commands from `cloudflare/worker`, or pass `--file=cloudflare/worker/schema.sql` from the repo root.)

### 2. Set secrets

```bash
cd cloudflare/worker
wrangler secret put PI_SETUP_BOOTSTRAP_TOKEN
wrangler secret put PI_SETUP_ENROLLMENT_SIGNING_KEY
```

### 3. Deploy

```bash
cd cloudflare/worker
wrangler deploy
```

### 4. Verify

```bash
curl -H "authorization: Bearer $PI_SETUP_BOOTSTRAP_TOKEN" \
  "$PI_SETUP_WORKER_URL/v1/diagnostics"
```

---

## Local development

```bash
cd cloudflare/worker
wrangler dev
```

The Worker binds to `http://localhost:8787`. Set `workerUrl` in `sync.json` accordingly.

D1 is fully supported in `wrangler dev`. KV and Durable Objects work in local mode with
in-memory persistence that resets on restart.

---

## Error responses

All errors follow a consistent shape:

```jsonc
{ "ok": false, "error": "<message>", "requestId": "<uuid>" }
```

| HTTP status | Meaning |
|-------------|---------|
| 400 | Missing or invalid request fields |
| 401 | Missing, invalid, or expired token |
| 403 | Token valid but not authorised for this resource |
| 404 | Resource not found |
| 409 | Enrollment token already consumed |
| 426 | WebSocket upgrade required |
| 500 | Unexpected internal error |
| 503 | D1 not configured |

---

## Related documentation

| Document | Content |
|----------|---------|
| [`docs/SETUP.md`](SETUP.md) | Step-by-step setup, dashboard (local + Cloudflare Pages), `npm run init` |
| [`docs/SECRETS.md`](SECRETS.md) | Step-by-step secret upload, pull, and machine enrolment workflow |
| [`docs/FLEET.md`](FLEET.md) | Fleet daemon configuration, `fleetctl` usage, and dashboard |
| [`README.md`](../README.md) | Quick-start, workflow commands, and full system overview |
