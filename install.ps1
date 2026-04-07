#Requires -Version 5.1
# install.ps1 — Set up the pi wrapper on Windows.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# What it does:
#   1. Finds the real `pi` binary (before modifying PATH)
#   2. Installs repo dependencies (npm / bun)
#   3. Configures git hooks
#   4. Prepends <repo>\bin to PATH in your PowerShell profile
#   5. Exports PI_REAL_PI=<path> in your PowerShell profile
#
# After install, reload your shell and run `pi` — it will automatically tag
# each invocation with a session name (pi-<hex>).

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$BinDir = Join-Path $RepoRoot 'bin'

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Log  { param([string]$Msg) Write-Host "  [install] $Msg" }
function Ok   { param([string]$Msg) Write-Host "  ✓ $Msg" -ForegroundColor Green }
function Warn { param([string]$Msg) Write-Host "  ⚠ $Msg" -ForegroundColor Yellow }
function Err  { param([string]$Msg) Write-Host "  ✗ $Msg" -ForegroundColor Red; exit 1 }

# ─── Banner ──────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════════╗'
Write-Host '║              pi-setup  ·  install.ps1                   ║'
Write-Host '╚══════════════════════════════════════════════════════════╝'
Write-Host ''

# ─── 1. Find real pi binary BEFORE we touch PATH ────────────────────────────

Log 'Locating real pi binary…'

$RealPi = $null
$BinDirNorm = [IO.Path]::GetFullPath($BinDir).ToLowerInvariant()

function Test-IsSelfRef {
    param([string]$Candidate)
    $candDir = [IO.Path]::GetFullPath((Split-Path $Candidate -Parent)).ToLowerInvariant()
    if ($candDir -eq $BinDirNorm) { return $true }
    return $false
}

# 1a. Check $env:PI_REAL_PI
if ($env:PI_REAL_PI -and (Test-Path $env:PI_REAL_PI)) {
    if (-not (Test-IsSelfRef $env:PI_REAL_PI)) {
        $RealPi = $env:PI_REAL_PI
    }
}

# 1b. Walk $env:PATH
if (-not $RealPi) {
    # Enumerate extensions from $env:PATHEXT (e.g. .CMD;.PS1;.EXE) so we honour
    # user/system customisations; always include bare name as final fallback.
    $pathExtList = if ($env:PATHEXT) { $env:PATHEXT -split ';' | Where-Object { $_ } } else { @('.COM','.EXE','.BAT','.CMD','.PS1') }
    $Extensions  = ($pathExtList | ForEach-Object { "pi$_" }) + 'pi'
    foreach ($dir in (if ($env:PATH) { $env:PATH -split ';' } else { @() })) {
        $dir = $dir.Trim()
        if (-not $dir) { continue }
        $dirNorm = try { [IO.Path]::GetFullPath($dir).ToLowerInvariant() } catch { continue }
        if ($dirNorm -eq $BinDirNorm) { continue }
        foreach ($ext in $Extensions) {
            $candidate = Join-Path $dir $ext
            if (Test-Path $candidate) {
                $RealPi = $candidate
                break
            }
        }
        if ($RealPi) { break }
    }
}

# 1c. Well-known fallback paths
if (-not $RealPi) {
    $WellKnown = @(
        if ($env:APPDATA)     { Join-Path $env:APPDATA 'npm\pi.cmd' }
        if ($env:APPDATA)     { Join-Path $env:APPDATA 'npm\pi.ps1' }
        if ($env:APPDATA)     { Join-Path $env:APPDATA 'npm\node_modules\@mariozechner\pi-coding-agent\bin\pi.js' }
        if ($env:ProgramFiles){ Join-Path $env:ProgramFiles 'nodejs\pi.cmd' }
    )
    foreach ($p in $WellKnown) {
        if (Test-Path $p) {
            $RealPi = $p
            break
        }
    }
}

if ($RealPi) {
    Ok "Found pi binary: $RealPi"
} else {
    Warn 'pi binary not found. Install pi first (npm install -g @mariozechner/pi-coding-agent),'
    Warn 'then re-run .\install.ps1 to set PI_REAL_PI correctly.'
}

# ─── 2. Check prerequisites ─────────────────────────────────────────────────

Log 'Checking prerequisites…'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err 'Node.js is required. Install via https://nodejs.org or nvm-windows.'
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Err 'git is required.'
}

# tmux is not available natively on Windows — informational only
Log 'tmux is not available on Windows; sessions will use env-var tagging instead.'

# ─── 3. Install repo dependencies ───────────────────────────────────────────

Log 'Installing repo dependencies…'

Set-Location $RepoRoot

$hasBun = [bool](Get-Command bun -ErrorAction SilentlyContinue)
$hasBunLock = Test-Path (Join-Path $RepoRoot 'bun.lock')

if ($hasBun -and $hasBunLock) {
    & bun install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) {
        & bun install
    }
    if ($LASTEXITCODE -eq 0) {
        Ok 'bun install done'
    } else {
        Log 'bun install failed, falling back to npm install…'
        & npm install --loglevel=warn
        if ($LASTEXITCODE -ne 0) {
            Err 'npm install failed'
        }
        Ok 'npm install done (bun fallback)'
    }
} else {
    & npm install --loglevel=warn
    if ($LASTEXITCODE -ne 0) {
        Err 'npm install failed'
    }
    Ok 'npm install done'
}

# ─── 4. Git hooks ───────────────────────────────────────────────────────────

$GitHooksDir = Join-Path $RepoRoot '.githooks'
if (Test-Path $GitHooksDir) {
    & git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        & git config core.hooksPath .githooks
        if ($LASTEXITCODE -ne 0) {
            Warn 'git config core.hooksPath failed — hooks not configured'
        } else {
            Ok 'Git hooks configured (.githooks)'
        }
    } else {
        Log 'Skipped git hooks (not inside a git work tree)'
    }
} else {
    Log 'Skipped git hooks (.githooks dir not found)'
}

# ─── 5. Update PowerShell profile ───────────────────────────────────────────

Log 'Updating PowerShell profile…'

$ProfilePath = $PROFILE

# Ensure parent directory exists
$profileDir = Split-Path $ProfilePath -Parent
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

# Read existing content (UTF-8)
$content = ''
if (Test-Path $ProfilePath) {
    # Read as raw bytes and detect encoding to avoid corrupting existing profiles
    $rawBytes = [IO.File]::ReadAllBytes($ProfilePath)
    # Detect BOM and record the encoding so we can preserve it on write-back.
    $detectedEncoding = $null
    if ($rawBytes.Length -ge 2 -and $rawBytes[0] -eq 0xFF -and $rawBytes[1] -eq 0xFE) {
        # UTF-16LE BOM
        $detectedEncoding = [Text.Encoding]::Unicode
        $content = [Text.Encoding]::Unicode.GetString($rawBytes, 2, $rawBytes.Length - 2)
    } elseif ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF) {
        # UTF-8 BOM
        $detectedEncoding = New-Object Text.UTF8Encoding $true
        $content = [Text.Encoding]::UTF8.GetString($rawBytes, 3, $rawBytes.Length - 3)
    } elseif ($rawBytes.Length -gt 0) {
        # Default: try UTF-8. If the file contains code-page/ANSI bytes that are
        # invalid UTF-8, fall back to the system default encoding (ANSI on en-US
        # Windows) so we don't mangle existing content.
        try {
            $detectedEncoding = New-Object Text.UTF8Encoding $false
            $content = (New-Object Text.UTF8Encoding $false, $true).GetString($rawBytes)
        } catch {
            $detectedEncoding = [Text.Encoding]::Default
            $content = [Text.Encoding]::Default.GetString($rawBytes)
        }
    }
}

# Remove old pi-tmux-wrapper block (handle CRLF and LF)
# Pattern does NOT consume the newline before the block start, so adjacent
# content lines are never merged together.
$content = $content -replace '(?s)# >>> pi-tmux-wrapper >>>.*?# <<< pi-tmux-wrapper <<<(\r?\n)?', ''

# Build new block
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$blockLines = @(
    '# >>> pi-tmux-wrapper >>>',
    "# Added by pi-setup install.ps1 on $timestamp"
    "`$env:PATH = `"$BinDir;`$env:PATH`""
)
if ($RealPi) {
    $blockLines += "`$env:PI_REAL_PI = `"$RealPi`""
}
$blockLines += '# <<< pi-tmux-wrapper <<<'
$block = $blockLines -join "`n"

# Append block with surrounding newlines
$content = $content.TrimEnd() + "`n`n" + $block + "`n"

# Write back using the detected encoding to preserve the original file encoding.
# For new files (detectedEncoding is $null) default to UTF-8 no-BOM.
$writeEncoding = if ($detectedEncoding) { $detectedEncoding } else { New-Object Text.UTF8Encoding $false }
[IO.File]::WriteAllText($ProfilePath, $content, $writeEncoding)

Ok "PATH and PI_REAL_PI written to $ProfilePath"

# ─── Done ────────────────────────────────────────────────────────────────────

$realPiDisplay = if ($RealPi) { $RealPi } else { 'not found - set PI_REAL_PI manually' }

Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════════╗'
Write-Host '║  Installation complete!                                  ║'
Write-Host '╠══════════════════════════════════════════════════════════╣'
# Fit a string into exactly $w chars, ellipsizing if too long.
function Fit([string]$s, [int]$w) {
    if ($null -eq $s) { return ' ' * $w }
    if ($s.Length -le $w) { return $s.PadRight($w) }
    return $s.Substring(0, $w - 1) + [char]0x2026  # …
}
Write-Host ('║  Wrapper:   {0}║' -f (Fit (Join-Path $BinDir 'pi.ps1') 44))
Write-Host ('║  Real pi:   {0}║' -f (Fit $realPiDisplay 44))
Write-Host ('║  Profile:   {0}║' -f (Fit $ProfilePath 44))
Write-Host '╠══════════════════════════════════════════════════════════╣'
Write-Host '║  Next steps:                                             ║'
Write-Host ('║    . {0}║' -f (Fit $ProfilePath 50))
Write-Host '║    pi                  # opens pi with session tagging   ║'
Write-Host '║    npm run init        # configure daemon & enrollment   ║'
Write-Host '╚══════════════════════════════════════════════════════════╝'
Write-Host ''
