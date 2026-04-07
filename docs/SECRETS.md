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

## Enroll a new machine with a short-lived Worker-issued token

**Two steps:** (1) issue a token with the **admin** bootstrap token; (2) on the **target machine**, call enroll with the **enrollment** JWT. Step 1 alone does not register the node in KV/D1 or the dashboard.

Issue the enrollment token from an already trusted operator environment:

```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_BOOTSTRAP_TOKEN=... \
node scripts/enrollment-token-issue.mjs <machine-id> <secret-name> [ttl-seconds]
```

Then run **on the machine being enrolled** (copy the `token` value from the JSON):

```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_ENROLLMENT_TOKEN='<JWT from enrollment-token-issue output>' \
PI_SETUP_MASTER_KEY=... \
node scripts/machine-enroll.mjs .env.runtime
```

That `POST /v1/machines/enroll` call writes `machine:<id>` in KV, upserts the row in D1 (so the fleet dashboard can list it), and fetches the encrypted secret using the short-lived bootstrap token from the response.

To show **live** status in the dashboard, run the fleet daemon with `PI_SETUP_WORKER_URL` and `PI_SETUP_BOOTSTRAP_TOKEN` so it posts heartbeats.

Behavior:
- enrollment tokens are signed by the Worker and expire quickly
- each enrollment token is single-use
- successful enrollment returns a 5-minute bootstrap token scoped to one secret
- secret reads with bootstrap tokens are constrained to the enrolled machine's secret

## Notes
- Credentials are encrypted before upload.
- Worker only stores encrypted blobs plus enrollment/bootstrap metadata.
- `PI_SETUP_MASTER_KEY` must stay outside git and outside KV.
- Never commit issued enrollment tokens or bootstrap tokens.

## See also
- [`docs/CLOUDFLARE.md`](CLOUDFLARE.md) — complete API reference and KV key layout
- [`docs/FLEET.md`](FLEET.md) — fleet daemon and dashboard setup
