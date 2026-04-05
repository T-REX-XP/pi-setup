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

Setup complete.

Next steps:
1. Run `pi` in this repo to load the local agents, prompts, skills, and extension.
2. Configure Cloudflare Worker secrets:
   - export PI_SETUP_WORKER_URL=...
   - export PI_SETUP_BOOTSTRAP_TOKEN=...
   - export PI_SETUP_ENROLLMENT_SIGNING_KEY=...   # worker deploy secret
   - export PI_SETUP_MASTER_KEY=...
3. Upload an encrypted secret blob:
   node scripts/secrets-encrypt-upload.mjs <secret-name> <input-file>
4. Existing machine sync:
   node scripts/secrets-sync.mjs <secret-name> [output-file]
5. New machine enrollment:
   node scripts/enrollment-token-issue.mjs <machine-id> <secret-name>
   PI_SETUP_ENROLLMENT_TOKEN=... node scripts/machine-enroll.mjs [output-file]
6. Start the fleet daemon:
   node scripts/fleet-daemon.mjs
   # optional centralized heartbeats:
   PI_SETUP_WORKER_URL=... PI_SETUP_BOOTSTRAP_TOKEN=... PI_SETUP_MACHINE_ID=$(hostname) node scripts/fleet-daemon.mjs
7. Validate the repo:
   node scripts/validate-setup.mjs

Workflow commands inside pi:
- /feature
- /task
- /quick
- /recurse
- /review
- /brainstorm /plan /code /test /improve
- /idea
- /continue
EOF
