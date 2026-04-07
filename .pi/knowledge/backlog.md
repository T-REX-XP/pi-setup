# Backlog

## Infrastructure

_No open items._

## Completed

- [x] **Install `pwsh` on dev machine** — Installed via `brew install powershell` (v7.6.0). PSScriptAnalyzer module also installed. (Completed: 2026-04-07)

- [x] **Windows CI validation for `.ps1` files** — Added `.github/workflows/ps1-lint.yml` GitHub Actions workflow on `windows-latest` that runs PSScriptAnalyzer with required rules on all `.ps1` files. Blocks merge on errors. (Completed: 2026-04-07)
