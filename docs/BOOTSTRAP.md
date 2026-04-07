# Bootstrap & tmux session wrapping

This document covers two features built on top of the fleet daemon:

1. **`bin/pi` tmux wrapper** — every interactive `pi` invocation is automatically placed inside a named `tmux` session so the daemon can track live agent runs.
2. **Machine bootstrap** — one-liner that provisions a new machine (Mac or headless VPS) with the full pi stack including encrypted credentials.

---

## bin/pi — tmux session wrapper

### How it works

`bin/pi` is a thin Bash script that sits *first* in your `PATH`.  
When you type `pi`, the wrapper intercepts the call and:

1. **Finds the real `pi` binary** — walks `PATH` skipping itself, then tries common npm global locations. `PI_REAL_PI` env var can override this explicitly.
2. **Skips tmux** when any of the following are true:
   - Already inside a tmux session (`$TMUX` is set)
   - `PI_NO_TMUX=1` or `PI_SUBAGENT=1`
   - `--print`, `-p`, or `--no-session` in argv (subagent / non-interactive mode)
   - `tmux` is not installed
3. **Creates a named session** `pi-<8 hex chars>` with `tmux new-session`, forwarding `PI_TMUX_SESSION=<name>` and `PI_NO_TMUX=1` so sub-invocations don't nest.

The fleet daemon discovers these sessions via `tmux ls` filtered to `pi-*` and includes them in each heartbeat payload (field: `tmuxSessions`).

### Install (Mac / Linux with existing repo)

```bash
git clone <repo> pi.dev
cd pi.dev
./install.sh
source ~/.zshrc   # or ~/.bashrc / ~/.bash_profile
```

`install.sh` will:
- Find the real `pi` binary before modifying `PATH`
- Install repo dependencies (`npm install` / `bun install`)
- Prepend `<repo>/bin` to `PATH` in your shell profile
- Export `PI_REAL_PI=<path>` in your shell profile

### Manual PATH setup (alternative)

```bash
export PATH="/path/to/pi.dev/bin:$PATH"
export PI_REAL_PI="$(which pi)"   # run BEFORE the above export takes effect
```

---

## Headless VPS bootstrap

Provisions a brand-new Linux VPS with no browser needed.  
Credentials are pulled from Cloudflare KV as an AES-256-GCM encrypted blob.

### Prerequisites on the admin machine

1. `PI_SETUP_BOOTSTRAP_TOKEN` — the admin token stored in the Worker secret
2. `PI_SETUP_MASTER_KEY` — the local encryption passphrase (never stored in KV)
3. The VPS's secret must already be uploaded:

```bash
# Upload an existing .env.runtime to KV under name "pi-secrets-my-vps"
PI_SETUP_WORKER_URL=https://pi-setup-secrets.workers.dev \
PI_SETUP_BOOTSTRAP_TOKEN=<token> \
PI_SETUP_MASTER_KEY=<passphrase> \
node scripts/secrets-encrypt-upload.mjs pi-secrets-my-vps .env.runtime
```

### Bootstrap the VPS

```bash
curl -sL https://pi-setup-secrets.workers.dev/bootstrap.sh \
  | SYNC_TOKEN=<bootstrap-token> \
    SYNC_PASS=<master-key> \
    SECRET_NAME=pi-secrets-my-vps \
    bash
```

| Env var | Required | Purpose |
|---------|----------|---------|
| `SYNC_TOKEN` | ✓ | Bootstrap token (`PI_SETUP_BOOTSTRAP_TOKEN`) |
| `SYNC_PASS` | ✓ | Encryption passphrase (`PI_SETUP_MASTER_KEY`) |
| `SECRET_NAME` | ✗ | KV secret name (default: `pi-secrets-<hostname>`) |
| `REPO_URL` | ✗ | Override git repo URL |
| `INSTALL_DIR` | ✗ | Clone destination (default: `~/pi.dev`) |
| `SKIP_NVM` | ✗ | Set `1` to skip nvm/Node.js install |

The script will:
1. Install **Node.js** via `nvm` if not already present
2. **Clone** (or pull) the repo
3. Run `npm install`
4. Fetch and **decrypt** the named KV secret → write `.env.runtime`
5. Set up `bin/pi` wrapper + update `~/.bashrc`
6. Write `workerUrl` to `sync.json`
7. **Start the fleet daemon** (systemd user service if available, otherwise `nohup`)

### Worker configuration

The bootstrap script is served at `GET /bootstrap.sh` — no auth required, since credentials are only ever decrypted client-side.

Set the repo URL in `cloudflare/worker/wrangler.toml`:

```toml
[vars]
PI_SETUP_REPO_URL = "https://github.com/your-org/pi.dev"
```

Then redeploy:

```bash
cd cloudflare/worker
wrangler deploy
```

---

## Fleet dashboard — tmux sessions

When a machine's daemon is running and tmux sessions exist, the `/metrics` endpoint and fleet heartbeat payloads include:

```json
{
  "tmuxSessions": [
    { "name": "pi-a3f2b1c0", "createdAt": "2026-04-07T18:00:00.000Z", "attached": true, "windows": 1 }
  ]
}
```

These are `pi-*` sessions only (all others are ignored).

---

## See also

| Doc | Content |
|-----|---------|
| [`SETUP.md`](SETUP.md) | API Worker, D1, dashboard setup |
| [`SECRETS.md`](SECRETS.md) | Encrypt, upload, enroll, sync credentials |
| [`FLEET.md`](FLEET.md) | Daemon, fleetctl, systemd service |
| [`CLOUDFLARE.md`](CLOUDFLARE.md) | Worker API reference |
