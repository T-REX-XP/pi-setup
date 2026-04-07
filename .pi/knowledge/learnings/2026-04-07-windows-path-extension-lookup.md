## 2026-04-07-windows-path-extension-lookup.md

Summary: On Windows, finding a CLI binary in PATH requires checking all PATHEXT extensions (`cmd`, `ps1`, `exe`) — bare `Join-Path $dir 'pi'` misses npm global shims.

Detail: npm on Windows installs global package shims as `pi.cmd`, `pi.ps1`, and sometimes `pi.exe` in the npm global bin directory. A PATH-walk that constructs `Join-Path $dir 'pi'` and tests `Test-Path` against the result will never find any of these shims, because Windows executables always have extensions. The bare name `pi` does not exist as a file.

Correct approach — iterate over `$env:PATHEXT` extensions for each directory:
```powershell
$extensions = ($env:PATHEXT -split ';') + ''   # include bare name last as fallback
foreach ($dir in $env:PATH -split ';') {
    foreach ($ext in $extensions) {
        $candidate = Join-Path $dir "pi$ext"
        if (Test-Path $candidate -PathType Leaf) { return $candidate }
    }
}
```

Also check well-known locations explicitly:
```powershell
"$env:APPDATA\npm\pi.cmd", "$env:APPDATA\npm\pi.ps1",
"$env:ProgramFiles\nodejs\pi.cmd"
```

Action: Any PowerShell PATH-walk for a binary must enumerate PATHEXT variants. Do not assume bare names are valid file paths on Windows. Include well-known npm global paths as fallback candidates.
Tag: pitfall
