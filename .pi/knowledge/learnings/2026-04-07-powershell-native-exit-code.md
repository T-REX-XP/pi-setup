## 2026-04-07-powershell-native-exit-code.md

Summary: PowerShell `try/catch` does NOT catch non-zero exit codes from native external programs; always check `$LASTEXITCODE` explicitly.

Detail: In PowerShell 5.1 (and even 7.x without `$ErrorActionPreference = 'Stop'` + `$PSNativeCommandUseErrorActionPreference`), invoking an external binary like `bun`, `npm`, or `git` that exits with a non-zero code does NOT throw a terminating error. A `try/catch` block around the call silently swallows the failure and execution continues. During the `install.ps1` implementation, install commands appeared to succeed when they had actually failed, because the error was never surfaced.

Fix: after every native command call, immediately check `$LASTEXITCODE`:
```powershell
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed (exit $LASTEXITCODE)"; exit 1 }
```
Or set at the top of the script:
```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# For PS 7.3+: $PSNativeCommandUseErrorActionPreference = $true
```
and still guard each native call with an explicit check for cross-version safety.

Action: Any PowerShell script that calls native binaries must check `$LASTEXITCODE -ne 0` after each call and halt with a clear error message. Add this as a code-review checklist item for all `.ps1` files.
Tag: pitfall
