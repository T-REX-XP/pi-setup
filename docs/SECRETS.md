# Cloudflare Worker + KV Secret Flow

## Goal
Store encrypted credential blobs in Cloudflare KV and pull them onto new or existing machines without a browser.

## Provision
1. Create a KV namespace.
2. Update `cloudflare/worker/wrangler.toml` with the namespace ID.
3. Set the Worker secret:
   ```bash
   wrangler secret put PI_SETUP_BOOTSTRAP_TOKEN
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

## Pull on a headless VPS
```bash
PI_SETUP_WORKER_URL=https://<worker-url> \
PI_SETUP_BOOTSTRAP_TOKEN=... \
PI_SETUP_MASTER_KEY=... \
node scripts/secrets-sync.mjs <secret-name> .env.runtime
```

## Notes
- Credentials are encrypted before upload.
- Worker only stores encrypted blobs.
- `PI_SETUP_MASTER_KEY` must stay outside git and outside KV.
