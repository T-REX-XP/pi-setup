## 2026-04-07-dead-code-plan-to-code-mismatch.md

Summary: Variables scaffolded during planning but never used in the final implementation create dead code that signals a plan-to-code drift review was skipped.

Detail: Both `install.ps1` and `bin/pi.ps1` were shipped with `$selfEntrypoints`/`$SelfNames` arrays that were explicitly included in the brainstorm plan. During implementation, the guard logic was correctly refactored into a dedicated helper function — but the now-unused arrays were retained verbatim from the plan. The dead variables compiled without errors (PowerShell does not warn on unused variables by default), so they survived all reviews. The issue was only caught during a post-implementation static inspection pass.

Root causes:
1. The implementer copied plan scaffolding into code without verifying each declared variable was actually consumed.
2. No linter or strict-mode flag was enabled to catch unused symbols.
3. The code review checklist did not include "search for variables declared but never read".

Mitigations:
- Enable `Set-StrictMode -Version Latest` in all `.ps1` scripts (catches some unused-variable patterns).
- Run `PSScriptAnalyzer` (the PowerShell static analyser) as part of CI: it includes `PSUseDeclaredVarsMoreThanAssignments` rule.
- During implementation, explicitly cross-check the plan's data structures against the final code before committing.

Action: Add a closing checklist item to all script implementation tasks: "Grep for every variable declared in the plan/scaffold and confirm it appears in at least one non-assignment expression in the final code. Delete any that do not." Add `Invoke-ScriptAnalyzer` to CI for `.ps1` files when `pwsh` is available.
Tag: process-recommendation
