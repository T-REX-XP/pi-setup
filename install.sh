#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

printf '\n==> pi-setup bootstrap\n'

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required.' >&2
  exit 1
fi

if [ -f package.json ]; then
  echo 'Installing npm dependencies...'
  npm install
fi

mkdir -p .pi/state .pi/runtime .pi/meta .pi/knowledge/learnings dashboards/fleet cloudflare/worker/src

bash scripts/install-hooks.sh
chmod +x install.sh .githooks/pre-commit scripts/*.mjs scripts/*.sh || true

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  git config core.hooksPath .githooks
fi

cat <<'EOF'

╔══════════════════════════════════════════════════════════════╗
║  Setup complete!                                             ║
╚══════════════════════════════════════════════════════════════╝

── First-time infrastructure setup (do once) ─────────────────

  npm run init
    Interactive menu: deploy Worker, apply D1 schema,
    run dashboard locally, deploy to Cloudflare Pages.

── Onboard a new machine (two commands total) ─────────────────

  On the ADMIN machine — issue an enrollment token:

    node scripts/device-onboard.mjs --issue
      (prompts for Worker URL, admin token, master key; prints
       a single ready-to-paste command for the new device)

  On the NEW machine — paste the printed command:

    PI_SETUP_WORKER_URL='...' \
    PI_SETUP_ENROLLMENT_TOKEN='...' \
    PI_SETUP_MASTER_KEY='...' \
    node scripts/device-onboard.mjs
      (enrolls the device, decrypts secrets, starts the daemon)

── Pi workflows ───────────────────────────────────────────────

  Run `pi` in this repo to load local agents and extensions.
  Commands: /feature  /task  /quick  /review  /brainstorm

── Docs ───────────────────────────────────────────────────────

  docs/SETUP.md      — infra overview & step-by-step
  docs/CLOUDFLARE.md — Worker API & wrangler.toml
  docs/FLEET.md      — daemon, fleetctl, systemd
  docs/SECRETS.md    — encrypt, upload, enroll, sync

EOF
