## 2026-04-07-fk-delete-ordering-existence-check.md

Summary: When deleting a record that has child rows via FK, always verify the parent exists before executing any cascade deletes, or a partial-delete leaves the database in a corrupt state.

Detail: During the "Remove Machines" feature the brainstorm/cross-review phase caught a critical ordering bug in the proposed Worker DELETE handler. The original plan deleted child rows first (`usage_metrics`, `sessions`) then the parent `machines` row. If the machine ID did not exist, the child deletes would succeed against zero rows (no error), the parent delete would also succeed against zero rows, and the handler would return `{ ok: true }` — giving the caller a false success while performing a no-op silently. Worse, if any step failed mid-sequence, some child rows could be orphaned permanently.

The fix is a two-phase pattern:

1. **Existence check** (read-before-write): query the parent row first. If it does not exist, return a 404 immediately — no deletes are issued at all.
2. **Cascade order**: only after the parent is confirmed to exist, delete child rows first (FK dependents), then the parent. This preserves referential integrity if the transaction is interrupted.

In D1 (Cloudflare) without transactions, the safest sequence is:
```
SELECT machine_id FROM machines WHERE machine_id = ?   -- existence check
DELETE FROM usage_metrics WHERE machine_id = ?
DELETE FROM sessions WHERE machine_id = ?
DELETE FROM machines WHERE machine_id = ?
DELETE FROM KV: machine:{id}, fleet:{id}
```

The same class of bug appears whenever a multi-step destructive operation starts executing side effects (including writes, KV deletes, or external API calls) before confirming the target actually exists.

Action: For any DELETE handler that cascades across multiple tables or external stores: (1) read the parent row first and 404 early if absent, (2) delete children before the parent. Include a cross-review checklist item: "Does this handler confirm the target exists before issuing any destructive side effects?"
Tag: api-design, data-integrity
