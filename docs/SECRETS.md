# Cloudflare Worker + KV Secret Flow

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
Issue the enrollment token from an already trusted operator environment:
```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_BOOTSTRAP_TOKEN=... \
node scripts/enrollment-token-issue.mjs <machine-id> <secret-name> [ttl-seconds]
```

Then run enrollment on the target machine:
```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_ENROLLMENT_TOKEN=... \
PI_SETUP_MASTER_KEY=... \
node scripts/machine-enroll.mjs .env.runtime
```

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
