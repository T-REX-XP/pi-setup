## 2026-04-07-vitest-bootstrap-sveltekit.md

Summary: New SvelteKit sub-projects ship with no test runner; bootstrapping vitest must be an explicit first step when the verifier phase is expected to run unit tests.

Detail: The fleet dashboard (`dashboards/fleet`) was a mature SvelteKit application with no vitest configuration, no test script in `package.json`, and no test files. When the tester/verifier agent attempted to run unit tests as part of the quality gate, there was nothing to run, producing a FAIL status. The fix—adding vitest, `@testing-library/svelte`, and 35 unit tests—was correct but happened reactively (after the verifier reported failure) rather than proactively during initial development.

The minimum viable vitest bootstrap for a SvelteKit project is:
1. `npm install -D vitest @vitest/coverage-v8 @testing-library/svelte jsdom` (or `happy-dom`).
2. Add a `vitest.config.ts` (or extend `vite.config.ts`) with `environment: 'jsdom'` and `include: ['src/**/*.{test,spec}.ts']`.
3. Add `"test": "vitest run"` and `"test:coverage": "vitest run --coverage"` to `package.json` scripts.
4. Commit at least one smoke-test file so the suite is never empty.

This is cheap (~10 min) and prevents the reactive cost (test infrastructure added under time pressure at the end of a feature).

Action: When a feature is scoped to a SvelteKit sub-project, the creator/implementer agent should check for the existence of a `vitest.config.ts` or `"test"` script in `package.json` before starting implementation. If absent, add the bootstrap as the first commit of the feature branch and note it in the plan. Add a checklist item to the feature workflow brainstorm template: "Does the target project have a test runner configured? If not, bootstrap it first."
Tag: process-recommendation
