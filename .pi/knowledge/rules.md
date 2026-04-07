# Domain Rules

- Never commit plaintext credentials.
- Cross-reviewer is comment-only and must not mutate files.
- Tester must try to break the system and collect screenshots when browser tests are executed.
- Improver must only touch process, rules, skills, learnings, or backlog assets.
- Minimal self-improvement changes may update prompts, skills, or rules automatically; larger changes go to `.pi/knowledge/backlog.md`.
- For any DELETE/remove handler that touches multiple stores (D1 tables, KV, external APIs): verify the parent record exists first and return a 404 early before issuing any destructive side effects; delete FK children before the parent.
- Stateful resources providing ongoing value to the current view (WebSocket, relay, polling interval) must only be torn down after a mutating API call succeeds, never before. On API failure, all resources must remain intact so the user can retry without a page reload.
