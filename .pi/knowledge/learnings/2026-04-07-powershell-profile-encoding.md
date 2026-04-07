## 2026-04-07-powershell-profile-encoding.md

Summary: Reading and writing `$PROFILE` with naive `Get-Content`/`Set-Content -Encoding UTF8` corrupts existing profiles that use UTF-16LE, UTF-8 BOM, or ANSI encoding.

Detail: On Windows 5.1, PowerShell profile files (`$PROFILE`) created by different tools or Windows versions may be encoded as UTF-16LE (the Windows default for some editors), UTF-8 with BOM, or ANSI. When `install.ps1` read such a file with `Get-Content -Encoding UTF8` and then wrote it back with `Set-Content -Encoding UTF8`, the byte-level representation changed silently — stripping BOMs, misreading multi-byte characters, or writing a mismatched encoding. This breaks the profile for users who open it in tools that rely on the BOM.

Correct approach:
1. Read as raw bytes: `[IO.File]::ReadAllBytes($profilePath)`
2. Detect BOM: if bytes start with `0xFF 0xFE` → UTF-16LE; `0xEF 0xBB 0xBF` → UTF-8 BOM; otherwise UTF-8 no-BOM.
3. Decode with the detected encoding.
4. Modify content in memory.
5. Write back with `[IO.File]::WriteAllText($profilePath, $newContent, (New-Object Text.UTF8Encoding $false))` (UTF-8 no-BOM is the safest portable default for new writes; preserve original encoding for re-writes).

Action: Any PowerShell script that modifies `$PROFILE` or other system text files must use byte-level BOM detection before reading and writing. Never use `Get-Content -Encoding UTF8` on files you did not create.
Tag: pitfall
