## 2026-04-07-powershell-null-env-join-path.md

Summary: `Join-Path $null 'something'` throws in PowerShell; always null-check environment variables like `$env:APPDATA` before using them in path construction.

Detail: During `install.ps1` development, well-known npm global paths were constructed as `Join-Path $env:APPDATA 'npm\pi.cmd'`. In environments where `$env:APPDATA` is not set (minimal CI containers, some non-standard Windows configurations, or any non-Windows platform the script might accidentally run on), `$env:APPDATA` is `$null`. PowerShell's `Join-Path` throws a `ParameterBindingException` when passed a null first argument, crashing the script with an unhelpful error.

Fix:
```powershell
if ($env:APPDATA) {
    $candidate = Join-Path $env:APPDATA 'npm\pi.cmd'
    if (Test-Path $candidate) { ... }
}
```
Or consolidate all well-known fallback paths through a helper that skips null-rooted paths:
```powershell
function Test-WellKnown($base, $rel) {
    if (-not $base) { return $null }
    $p = Join-Path $base $rel
    if (Test-Path $p -PathType Leaf) { return $p }
}
```

Action: Treat all `$env:*` values as potentially null. Never pass them directly to `Join-Path` or string interpolation without a null/empty guard. Add a static-analysis note to `.ps1` code reviews: check every `Join-Path` call for null-capable inputs.
Tag: pitfall
