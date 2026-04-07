# Domain Rules

- Never commit plaintext credentials.
- Cross-reviewer is comment-only and must not mutate files.
- Tester must try to break the system and collect screenshots when browser tests are executed.
- Improver must only touch process, rules, skills, learnings, or backlog assets.
- Minimal self-improvement changes may update prompts, skills, or rules automatically; larger changes go to `.pi/knowledge/backlog.md`.
- For any DELETE/remove handler that touches multiple stores (D1 tables, KV, external APIs): verify the parent record exists first and return a 404 early before issuing any destructive side effects; delete FK children before the parent.
- Stateful resources providing ongoing value to the current view (WebSocket, relay, polling interval) must only be torn down after a mutating API call succeeds, never before. On API failure, all resources must remain intact so the user can retry without a page reload.
- In any PowerShell script that calls native binaries (`npm`, `bun`, `git`, etc.): check `$LASTEXITCODE -ne 0` explicitly after each call and halt with a clear error. Never rely on `try/catch` alone to catch external-program failures.
- PowerShell PATH-walks for a CLI binary must enumerate `$env:PATHEXT` extensions per directory; never test bare filenames on Windows. Always null-guard `$env:APPDATA`, `$env:ProgramFiles`, and other env vars before passing them to `Join-Path`.
