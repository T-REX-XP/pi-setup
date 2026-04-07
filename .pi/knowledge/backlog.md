# Backlog

## Infrastructure

- [ ] **Install `pwsh` on dev machine** — `brew install --cask powershell`. Required for local `.ps1` syntax validation and PSScriptAnalyzer runs. Without it, PowerShell script testing is limited to static inspection. (Added: 2026-04-07, relates to: `2026-04-07-pwsh-not-on-macos-ci.md`)

- [ ] **Windows CI validation for `.ps1` files** — Add a CI job (GitHub Actions `windows-latest` runner or a pwsh step on macOS) that runs `Invoke-ScriptAnalyzer` on all `.ps1` files in the repo, enforcing at minimum: `PSUseDeclaredVarsMoreThanAssignments`, `PSAvoidUsingCmdletAliases`, `PSAvoidTrailingWhitespace`. Block merge on analyser errors. (Added: 2026-04-07, relates to: `2026-04-07-pwsh-not-on-macos-ci.md`, `2026-04-07-dead-code-plan-to-code-mismatch.md`)
