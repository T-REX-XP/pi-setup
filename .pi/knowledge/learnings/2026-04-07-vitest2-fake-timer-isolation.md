## 2026-04-07-vitest2-fake-timer-isolation.md

Summary: In vitest 2.x, `vi.useRealTimers()` does not reliably restore `globalThis.setTimeout` between describe blocks; every describe block that calls `setTimeout` must set up its own fake-timer guards.

Detail: When a describe block uses `vi.useFakeTimers()` in `beforeEach` and `vi.useRealTimers()` in `afterEach`, vitest 2.x replaces `globalThis.setTimeout` with a fake implementation during each test and attempts to restore the real one afterward. However, the restore is not reliable when crossing describe-block boundaries — subsequent describe blocks that do not explicitly call `vi.useFakeTimers()` may find `setTimeout` undefined or non-functional, causing `ReferenceError: setTimeout is not defined` or `TypeError: setTimeout is not a function`.

This surfaced when `apiGet` and `apiDelete` each call `setTimeout(() => controller.abort(), TIMEOUT_MS)` to set up an abort timer. Tests in the `apiGet error classification` and `deleteMachine` describe blocks (which ran *after* the `withRetry` describe block that used fake timers) failed with `setTimeout is not defined` even though Node.js always has a real `setTimeout`.

Fix: add `vi.useFakeTimers()` / `vi.useRealTimers()` guards to **every** describe block whose production code under test calls `setTimeout` — not just the blocks that explicitly need to advance time. Fake timers *do* define `setTimeout`, so the abort-timer calls work correctly and tests remain fast (the fake timers are never advanced unless the test needs it).

```typescript
describe('someApiFunction', () => {
  beforeEach(() => {
    vi.useFakeTimers();          // ensures setTimeout is always defined
    vi.stubGlobal('localStorage', { ... });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('handles network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(myFetchFn()).rejects.toBeInstanceOf(ApiError);
    // no timer advance needed — fetch rejects before the abort timer fires
  });
});
```

The bug does not appear in vitest 4.x, which has different fake-timer lifecycle semantics.

Action: When writing vitest tests for code that internally calls `setTimeout` (e.g., request-timeout patterns), always add `vi.useFakeTimers()` in `beforeEach` and `vi.useRealTimers()` in `afterEach` for that describe block, even if the test never advances time. Do not rely on a sibling describe block's `vi.useRealTimers()` to leave `globalThis.setTimeout` in a usable state.
Tag: pitfall, vitest
