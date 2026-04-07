## 2026-04-07-cross-review-websocket-lifecycle-bugs.md

Summary: Cross-review by a separate agent catches WebSocket lifecycle bugs that the implementing agent consistently misses because it shares the same mental model of the code it just wrote.

Detail: During the "add error handling for accessing the Cloudflare API for the fleet dashboard" feature, the implementer correctly added exponential backoff and a `relayDestroyed` guard to the WebSocket reconnect path. However, cross-review by a second agent identified two distinct lifecycle bugs that static self-review had not caught:

1. **Reconnect-after-destroy**: The reconnect timer could fire after `relayDestroyed` was set to `true`, because the destroy path did not cancel the pending setTimeout. The implementer had added the guard at the top of the reconnect callback but had not cleared the timer handle on destroy.
2. **`manualReconnect()` race**: Calling `manualReconnect()` while a reconnect timer was already pending created two concurrent paths to open a new socket. The fix required nulling out handlers on the old socket before closing it and clearing the pending timer before scheduling a new one.

Both bugs were real runtime hazards (not hypothetical), would have been invisible during happy-path testing, and were only surfaced because a fresh reader traced all execution paths without assuming correctness.

Action: Always include a cross-review phase for any code that manages stateful async resources (WebSockets, timers, event listeners, file handles). The cross-reviewer should specifically be asked to trace all teardown/destroy paths and confirm that every timer handle is cancelled on cleanup and that manual-trigger paths cannot race with automatic-retry paths.
Tag: process-recommendation
