## 2026-04-07-relay-restore-on-failed-mutation.md

Summary: When a UI component tears down a live connection (WebSocket, relay) as part of a mutating operation, the teardown must be reversed on failure — or the user is left with a degraded page state after an API error.

Detail: During the "Remove Machines" feature, cross-review of the machine detail page implementation found a silent regression: the delete handler called `relay.destroy()` at the start of the operation (anticipating a successful delete and redirect to `/`). When the `deleteMachine()` API call subsequently failed (network error, 404, 5xx), the handler surfaced an error banner — but the relay was already destroyed and was never re-initialised. The user now saw an error message on a page with a dead relay, with no way to recover without a full page reload.

The fix is to structure destructive operations that have side effects on live connections as: 
1. Call the API.
2. **Only on success** — tear down the connection and navigate away.
3. **On failure** — leave all connections intact, surface the error, allow retry.

```ts
// WRONG — destroy first, then handle failure
relay.destroy();
try {
  await deleteMachine(id);
  goto('/');
} catch (e) {
  error = userMessage(e);        // relay is gone, page is broken
}

// CORRECT — destroy only on success
try {
  await deleteMachine(id);
  relay.destroy();               // only now, because we're leaving
  goto('/');
} catch (e) {
  error = userMessage(e);        // relay still running, page is intact
}
```

This pattern generalises: any resource that provides ongoing value to the current view (relay, WebSocket, polling interval, subscriptions) must not be torn down speculatively before a mutating call succeeds.

Action: Add to the cross-review checklist for any UI flow that involves both a destructive API call and an active stateful resource: "Is the resource torn down before or after the API call? If before, what is the recovery path on API failure?" Prefer the "tear down on success only" pattern.
Tag: frontend, stateful-resources, error-handling
