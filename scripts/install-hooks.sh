#!/usr/bin/env bash
set -euo pipefail

git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh scripts/*.mjs 2>/dev/null || true
printf 'Configured git hooks at %s\n' "$(pwd)/.githooks"
