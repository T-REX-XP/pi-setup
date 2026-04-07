## 2026-04-07-gitignore-wildcard-force-add.md

Summary: A `dir/*` wildcard in `.gitignore` ignores all new files under that directory; already-tracked files still work, but adding new files requires `git add -f`.

Detail: The repo's `.gitignore` contains the line `dashboards/fleet/*`, which was added to avoid committing build artifacts and `node_modules` from the dashboard. However, because the glob is a wildcard over the entire directory rather than specific subdirectories (e.g., `dashboards/fleet/node_modules/`, `dashboards/fleet/.svelte-kit/`), it also silently ignores any *new* files created at any depth under `dashboards/fleet/`. Files that were already tracked before the gitignore entry was added continue to be versioned normally, but `git add <new-file>` silently refuses to stage them and `git status` shows them as untracked-and-ignored.

This caused the new `vitest.config.ts` (and changes to `src/lib/api.test.ts`) to be refused by `git add`, with the error:
```
The following paths are ignored by one of your .gitignore files:
  dashboards/fleet/vitest.config.ts
hint: Use -f if you really want to add them.
```

Workaround: `git add -f <file>` forces staging of an ignored file. Once tracked, the file behaves normally.

Better fix: replace the catch-all glob with targeted ignores:
```gitignore
dashboards/fleet/node_modules/
dashboards/fleet/.svelte-kit/
dashboards/fleet/.wrangler/
dashboards/fleet/dist/
```
This prevents build artifacts from being committed while allowing new source files to be added normally.

Action: Avoid `dir/*` wildcard gitignore entries for directories that contain source files. Use specific subdirectory or extension patterns instead. If a `dir/*` entry already exists and a new source file must be tracked, use `git add -f` and consider tightening the gitignore rule as a follow-up.
Tag: pitfall, git
