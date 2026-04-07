## 2026-04-07-pwsh-not-on-macos-ci.md

Summary: `pwsh` (PowerShell Core) is not installed on macOS dev machines or CI by default; `.ps1` validation must account for its absence and be explicitly provisioned.

Detail: After implementing `install.ps1` and `bin/pi.ps1`, the tester phase attempted to validate PowerShell syntax with `pwsh -Command ...` and `pwsh -File ...` — and found `pwsh: command not found`. PowerShell Core is a separate install from macOS system tools and is not included in Homebrew's default formulae or macOS Xcode CLT. As a result, syntax checking was limited to static inspection (reading the file) rather than execution or parse-tree validation. Real runtime bugs (null coercions, wrong parameter types, encoding issues) could not be caught without an actual PS environment.

Consequences:
- The dead-code issue (see `2026-04-07-dead-code-plan-to-code-mismatch.md`) survived because PSScriptAnalyzer could not run.
- Several subtle bugs were only found via manual code reading.

Mitigations:
- Install `pwsh` on the primary dev machine: `brew install --cask powershell` (macOS) or `winget install Microsoft.PowerShell`.
- In CI, add a step to install `pwsh` and run `Invoke-ScriptAnalyzer` on all `.ps1` files.
- Until `pwsh` is available, use `PSScriptAnalyzer` via the VSCode PowerShell extension locally as a minimum bar.

Action: Add "Install pwsh (`brew install --cask powershell`) on dev machine" to `.pi/knowledge/backlog.md` as a near-term infrastructure task. Add a CI job for `.ps1` linting (PSScriptAnalyzer) to the backlog for the next Windows-targeting feature.
Tag: tool-recommendation
