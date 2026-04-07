#!/usr/bin/env bash
# install.sh — Set up the pi-tmux wrapper and fleet daemon on a Mac or Linux box.
#
# Usage (clone-and-go):
#   git clone <repo> pi.dev && cd pi.dev && ./install.sh
#
# What it does:
#   1. Finds the real `pi` binary (before modifying PATH)
#   2. Installs repo dependencies (npm / bun)
#   3. Makes bin/pi executable
#   4. Prepends <repo>/bin to PATH in your shell profile
#   5. Exports PI_REAL_PI=<path> in your shell profile
#
# After install, reload your shell and run `pi` — it will automatically wrap
# each invocation in a named tmux session (pi-<hex>).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$REPO_ROOT/bin"

_log()  { echo "  [install] $*"; }
_ok()   { echo "  ✓ $*"; }
_warn() { echo "  ⚠ $*" >&2; }
_err()  { echo "  ✗ $*" >&2; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              pi-setup  ·  install.sh                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── 1. Find real pi binary BEFORE we touch PATH ────────────────────────────
_log "Locating real pi binary…"

REAL_PI=""

# Walk every PATH entry, skip our own bin/
_old_ifs="$IFS"
IFS=':'
for _dir in $PATH; do
  IFS="$_old_ifs"
  [[ "$_dir" == "$BIN_DIR" ]] && continue
  [[ -x "$_dir/pi" ]] && REAL_PI="$_dir/pi" && break
done
IFS="$_old_ifs"

# Fall back to well-known npm global paths
if [[ -z "$REAL_PI" ]]; then
  for _p in \
      "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/bin/pi.js" \
      "/opt/homebrew/bin/pi" \
      "$HOME/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/bin/pi.js" \
      "/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/bin/pi.js" \
      "/usr/lib/node_modules/@mariozechner/pi-coding-agent/bin/pi.js"; do
    [[ -f "$_p" ]] && REAL_PI="$_p" && break
  done
fi

if [[ -n "$REAL_PI" ]]; then
  _ok "Found pi binary: $REAL_PI"
else
  _warn "pi binary not found. Install pi first (npm install -g @mariozechner/pi-coding-agent),"
  _warn "then re-run ./install.sh to set PI_REAL_PI correctly."
fi

# ─── 2. Check prerequisites ──────────────────────────────────────────────────
_log "Checking prerequisites…"

command -v node &>/dev/null || _err "Node.js is required. Install via https://nodejs.org or nvm."
command -v git  &>/dev/null || _err "git is required."

if ! command -v tmux &>/dev/null; then
  _warn "tmux not found — pi sessions won't be wrapped. Install tmux:"
  _warn "  Mac:   brew install tmux"
  _warn "  Linux: sudo apt install tmux  /  sudo dnf install tmux"
fi

# ─── 3. Install repo dependencies ────────────────────────────────────────────
_log "Installing repo dependencies…"

cd "$REPO_ROOT"
if command -v bun &>/dev/null && [[ -f bun.lock ]]; then
  bun install --frozen-lockfile 2>/dev/null || bun install
  _ok "bun install done"
else
  npm install --loglevel=warn
  _ok "npm install done"
fi

# ─── 4. Make wrapper executable ──────────────────────────────────────────────
chmod +x "$BIN_DIR/pi"
_ok "bin/pi is executable"

# ─── 5. Update shell profile ─────────────────────────────────────────────────
_log "Detecting shell profile…"

SHELL_NAME="$(basename "${SHELL:-bash}")"
case "$SHELL_NAME" in
  zsh)  PROFILE="$HOME/.zshrc" ;;
  bash)
    if [[ "$(uname)" == "Darwin" ]]; then
      PROFILE="$HOME/.bash_profile"
    else
      PROFILE="$HOME/.bashrc"
    fi
    ;;
  *)    PROFILE="$HOME/.profile" ;;
esac

_ok "Shell profile: $PROFILE"

BLOCK_START="# >>> pi-tmux-wrapper >>>"
BLOCK_END="# <<< pi-tmux-wrapper <<<"

# Remove existing block
if grep -q "$BLOCK_START" "$PROFILE" 2>/dev/null; then
  _log "Replacing existing pi-tmux-wrapper block in $PROFILE…"
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "/$BLOCK_START/,/$BLOCK_END/d" "$PROFILE"
  else
    sed -i "/$BLOCK_START/,/$BLOCK_END/d" "$PROFILE"
  fi
fi

{
  printf '\n%s\n' "$BLOCK_START"
  printf '# Added by pi-setup install.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'export PATH="%s:$PATH"\n' "$BIN_DIR"
  if [[ -n "$REAL_PI" ]]; then
    printf 'export PI_REAL_PI="%s"\n' "$REAL_PI"
  fi
  printf '%s\n' "$BLOCK_END"
} >> "$PROFILE"

_ok "PATH and PI_REAL_PI written to $PROFILE"

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Installation complete!                                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf  "║  Wrapper:   %-44s║\n" "$BIN_DIR/pi"
printf  "║  Real pi:   %-44s║\n" "${REAL_PI:-not found — set PI_REAL_PI manually}"
printf  "║  Profile:   %-44s║\n" "$PROFILE"
echo    "╠══════════════════════════════════════════════════════════╣"
echo    "║  Next steps:                                             ║"
printf  "║    source %-46s║\n" "$PROFILE"
echo    "║    pi                  # opens pi in a tmux session      ║"
echo    "║    npm run init        # configure daemon & enrollment   ║"
echo    "╚══════════════════════════════════════════════════════════╝"
echo ""
