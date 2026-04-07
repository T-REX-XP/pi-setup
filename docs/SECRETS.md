# Cloudflare Worker + KV Secret Flow

> **Provisioning and deploy:** see [`docs/SETUP.md`](SETUP.md). For the full Worker API reference, D1 schema, Durable Objects, and deployment details see [`docs/CLOUDFLARE.md`](CLOUDFLARE.md).

## Goal
Store encrypted credential blobs in Cloudflare KV and pull them onto new or existing machines without a browser.

## Provision
1. Create a KV namespace.
2. Update `cloudflare/worker/wrangler.toml` with the namespace ID.
3. Set the Worker secrets:
   ```bash
   wrangler secret put PI_SETUP_BOOTSTRAP_TOKEN
   wrangler secret put PI_SETUP_ENROLLMENT_SIGNING_KEY
   ```
4. Deploy:
   ```bash
   cd cloudflare/worker
   wrangler deploy
   ```

## Upload
Encrypt locally, then upload:
```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_BOOTSTRAP_TOKEN=... \
PI_SETUP_MASTER_KEY=... \
node scripts/secrets-encrypt-upload.mjs <secret-name> <input-file>
```

## Pull on an existing machine
```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_BOOTSTRAP_TOKEN=... \
PI_SETUP_MASTER_KEY=... \
node scripts/secrets-sync.mjs <secret-name> .env.runtime
```

## Enroll a new machine (single command)

Use **`npm run enroll`** (`scripts/pi-enroll.mjs`). It loads **`PI_SETUP_*` from `.env.runtime`** (or `PI_SETUP_ENV_FILE`) and **`workerUrl` / optional `secretName` from `sync.json`**. Nothing is prompted.

### Admin (issue enrollment)

In `.env.runtime` (gitignored):

- `PI_SETUP_BOOTSTRAP_TOKEN` — Worker admin token  
- `PI_SETUP_MASTER_KEY` — same passphrase used for `secrets-encrypt-upload` (needed to build the one-line bundle for the target)  
- `PI_SETUP_WORKER_URL` — optional if `sync.json` already has `workerUrl`  

Optional overrides (env, same file, or **`sync.json`**):

- `PI_SETUP_ENROLL_MACHINE_ID` or **`sync.json` → `enrollMachineId`** — defaults to **slug(this machine’s hostname)** if both unset (only right when you enroll the same box you issue from).  
- `PI_SETUP_SECRET_NAME` or **`sync.json` → `secretName`** — else **`pi-secrets-<machineId>`**; must match the KV secret from upload.  
- `PI_SETUP_ENROLLMENT_TTL_SECONDS` — default `600` (min 60).  

Run:

```bash
npm run enroll
```

 stderr prints **one command** for the target; stdout prints minimal JSON (`machineId`, `secretName`, `ttlSeconds`).

### Target (enroll this machine)

Paste the printed command (it sets **`PI_SETUP_ENROLL_BUNDLE`** and runs enroll). That single invocations enrolls, decrypts KV into **`.env.runtime`**, and appends fleet vars (`PI_SETUP_WORKER_URL`, `PI_SETUP_BOOTSTRAP_TOKEN`, `PI_SETUP_MACHINE_ID`) unless you pass **`--plain`**.

```bash
npm run daemon
```

### Without a bundle (file-only)

Put `PI_SETUP_ENROLLMENT_TOKEN`, `PI_SETUP_MASTER_KEY`, and worker URL in `.env.runtime`, then:

```bash
npm run enroll
```

### Flags

`--pi-runtime <path>` (dotenv file; Node reserves `--env-file`) · `--out <path>` (default `.env.runtime`) · `--plain` (decrypted blob only, no fleet footer)

---

That `POST /v1/machines/enroll` call writes `machine:<id>` in KV, upserts D1 (fleet dashboard), and fetches the encrypted secret with the short-lived bootstrap JWT from the response.

Behavior:

- Enrollment tokens expire quickly and are single-use.
- Successful enrollment returns a short-lived bootstrap token scoped to one secret.

## Notes
- Credentials are encrypted before upload.
- Worker only stores encrypted blobs plus enrollment/bootstrap metadata.
- `PI_SETUP_MASTER_KEY` must stay outside git and outside KV.
- Never commit bootstrap tokens, bundles, or enrollment JWTs.

## See also
- [`docs/CLOUDFLARE.md`](CLOUDFLARE.md) — complete API reference and KV key layout
- [`docs/FLEET.md`](FLEET.md) — fleet daemon and dashboard setup
