# pi-setup repository guidance

- Keep infrastructure, workflows, secrets, fleet, and dashboard assets inside this repo.
- Prefer updating knowledge files under `.pi/knowledge/` when refining rules, decisions, or learnings.
- Use the workflow commands from `.pi/extensions/pi-setup-orchestrator.ts` for multi-agent execution.
- Do not store plaintext credentials in the repo. Use `cloudflare/worker/` and `scripts/secrets-sync.mjs`.
- Infrastructure version bumps are managed by `.githooks/pre-commit`.
