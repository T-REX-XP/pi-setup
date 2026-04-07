## 2026-04-07-powershell-profile-block-regex.md

Summary: A regex that removes a profile block by consuming both the preceding and trailing newline concatenates adjacent lines, breaking the profile.

Detail: When `install.ps1` idempotently removes its own injected block from `$PROFILE`, the first attempt used the pattern `(?s)(\r?\n)?# >>> pi-tmux-wrapper >>>.*?# <<< pi-tmux-wrapper <<<(\r?\n)?`. This consumed the newline **before** the block (to avoid a blank line) and also the newline **after** the block. The result was that the line above the block and the line below it were concatenated with no separator — silently breaking any code that followed the block.

The correct approach is to consume only the **trailing** newline (so the block and its terminator are removed as one unit), leaving the preceding content untouched:
```powershell
$content = $content -replace '(?s)# >>> pi-tmux-wrapper >>>.*?# <<< pi-tmux-wrapper <<<(\r?\n)?', ''
```

If a blank line is left behind after removal, it can be cleaned separately with a targeted `(\r?\n){3,}` → `\r\n\r\n` normalisation pass.

Action: Profile/config block removal regexes must only consume the trailing newline of the block, not the preceding one. After any block removal, verify that adjacent lines in the resulting string are still correctly separated before writing back to disk.
Tag: pitfall
