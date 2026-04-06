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

## 2026-04-06 — Cleared/completed workflows could still block new `/feature` runs if stale state file remained

### Symptoms
- Starting a new workflow could fail with:
  - `Extension "command:feature" error: A workflow is already pending: ...`
- This could still happen even after the prior workflow had been cleared or completed in history.

### Root cause
1. The orchestrator treated `.pi/state/pending-workflow.json` as the sole source of truth for active workflow state.
2. If that file remained behind after a clear/complete event, the next `/feature` run still saw the old workflow as pending.
3. Completion emitted a UI event but did not append a durable `workflow-complete` history record.

### Fix
- Teach the orchestrator to auto-ignore and remove stale pending state when the same workflow was already marked `workflow-cleared`, `workflow-auto-cleared`, or `workflow-complete` in history.
- Append a durable `workflow-complete` history entry when the final phase finishes.

### Validation
- A cleared workflow in history no longer blocks a new `/feature` command even if `pending-workflow.json` lingers.
- A completed workflow now leaves an explicit `workflow-complete` entry in `.pi/state/workflow-history.jsonl`.
- New workflow starts only fail when an actually active pending workflow exists.
