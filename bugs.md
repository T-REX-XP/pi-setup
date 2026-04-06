# Bugs

## 2026-04-06 — Project commands could fail from provider fallback and stale workflow state confusion

### Symptoms
- `/feature` could report that a workflow was already pending.
- `/continue` could be followed by confusing model/tool errors during recovery attempts.
- Plain interactive turns could fail with:
  - `No API key found for openrouter`

### Root cause
1. Project workflow state can legitimately remain pending until it is continued or explicitly cleared, so retrying `/feature` before clearing or finishing the prior workflow returns the pending-workflow guard.
2. The project did not pin a repository-local default provider/model, so sessions could fall back to a globally configured default provider such as `openrouter`.
3. When that fallback provider was not logged in for the local environment, regular turns failed before the project-specific workflow configuration could help.

### Fix
- Clear the stale workflow state when appropriate using the existing workflow clear path.
- Pin a repository-local default provider/model in `.pi/settings.json` so this project does not depend on a global `openrouter` default.
- Keep workflow agents pinned to validated provider/model IDs.

### Validation
- Starting ordinary turns in the project should no longer require an `openrouter` login when GitHub Copilot is available.
- Workflow commands should operate against the repo-local defaults and explicit agent models.
- If a workflow is truly pending, `/workflow-status` and `/workflow-clear` remain the recovery path.
