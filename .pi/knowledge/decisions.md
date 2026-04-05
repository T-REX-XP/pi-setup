# Historical Decisions

- Use isolated subagent runs by spawning `pi --print --no-session` per phase.
- Pause `/feature`, `/task`, and `/quick` workflows between phases; resume with `/continue`.
- Store operational learnings under `.pi/knowledge/learnings/` using strict Summary/Detail/Action format.
- Keep secret material encrypted client-side before upload to Cloudflare KV.
- Use local Git hooks for automatic infrastructure patch bumps.
