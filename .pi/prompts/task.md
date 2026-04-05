---
description: Shortened implementation workflow for predefined tasks.
---
Run the `/task` workflow for: $@

Fallback phase order:
1. plan
2. review
3. code
4. review
5. test
6. verify
7. improve
8. review

Each phase must use isolated context via `subagent`.
