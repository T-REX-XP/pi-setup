#Requires -Version 5.1
# bin/pi.ps1 — Thin session-tagging wrapper for the `pi` coding agent on Windows.
#
# Place this directory first in PATH (done by install.ps1).  Every interactive
# `pi` invocation is tagged with a PI_TMUX_SESSION env var so the fleet daemon
# can discover and track active agent runs.
#
# Skip conditions (runs real pi directly):
#   - PI_NO_TMUX=1 or PI_SUBAGENT=1
#   - Any of --print / -p / --no-session in argv (subagent/daemon mode)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File bin\pi.ps1 [args...]

$SelfDir = $PSScriptRoot
$SelfDirNorm = [IO.Path]::GetFullPath($SelfDir).ToLowerInvariant()

# ─── Locate the real pi binary (not this wrapper) ───────────────────────────

function Find-RealPi {
    function Test-IsSelfRef {
        param([string]$Candidate)
        $candDir = [IO.Path]::GetFullPath((Split-Path $Candidate -Parent)).ToLowerInvariant()
        return ($candDir -eq $SelfDirNorm)
    }

    # 1. Explicit env override
    if ($env:PI_REAL_PI -and (Test-Path $env:PI_REAL_PI)) {
        if (-not (Test-IsSelfRef $env:PI_REAL_PI)) {
            return $env:PI_REAL_PI
        }
    }

    # 2. Walk PATH, skip our own bin/ directory
    $Extensions = @('pi.cmd', 'pi.ps1', 'pi.exe', 'pi')
    foreach ($dir in ($env:PATH -split ';')) {
        $dir = $dir.Trim()
        if (-not $dir) { continue }
        $dirNorm = try { [IO.Path]::GetFullPath($dir).ToLowerInvariant() } catch { continue }
        if ($dirNorm -eq $SelfDirNorm) { continue }
        foreach ($ext in $Extensions) {
            $candidate = Join-Path $dir $ext
            if (Test-Path $candidate) {
                return $candidate
            }
        }
    }

    # 3. Well-known npm global paths (Windows)
    $WellKnown = @(
        if ($env:APPDATA)     { Join-Path $env:APPDATA 'npm\pi.cmd' }
        if ($env:APPDATA)     { Join-Path $env:APPDATA 'npm\pi.ps1' }
        if ($env:APPDATA)     { Join-Path $env:APPDATA 'npm\node_modules\@mariozechner\pi-coding-agent\bin\pi.js' }
        if ($env:ProgramFiles){ Join-Path $env:ProgramFiles 'nodejs\pi.cmd' }
    )
    foreach ($p in $WellKnown) {
        if (Test-Path $p) {
            return $p
        }
    }

    return $null
}

# ─── Invoke real pi ─────────────────────────────────────────────────────────

function Invoke-RealPi {
    if ($RealPi -match '\.js$') {
        & node $RealPi @args
        exit $LASTEXITCODE
    } else {
        & $RealPi @args
        exit $LASTEXITCODE
    }
}

# ─── Main ────────────────────────────────────────────────────────────────────

$RealPi = Find-RealPi

if (-not $RealPi) {
    Write-Host 'bin/pi.ps1: cannot locate real pi binary.' -ForegroundColor Red
    Write-Host '  Set PI_REAL_PI=C:\path\to\pi in your PowerShell profile, or re-run install.ps1.' -ForegroundColor Red
    exit 1
}

# ─── Skip conditions ────────────────────────────────────────────────────────

if ($env:PI_NO_TMUX -eq '1') {
    Invoke-RealPi @args
}

if ($env:PI_SUBAGENT -eq '1') {
    Invoke-RealPi @args
}

foreach ($a in $args) {
    if ($a -eq '--print' -or $a -eq '-p' -or $a -eq '--no-session') {
        Invoke-RealPi @args
    }
}

# ─── Session tagging ────────────────────────────────────────────────────────

$bytes = [byte[]]::new(4)
try {
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
} catch {
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($bytes)
}
$hex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
$Session = "pi-$hex"

$env:PI_TMUX_SESSION = $Session
$env:PI_NO_TMUX = '1'

Invoke-RealPi @args
