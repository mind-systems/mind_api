## Code Review Summary

**Files Reviewed:** 3
**Risk Level:** 🟡 Medium

| File | Status |
|------|--------|
| `src/realtime/services/sync-stream.service.ts` | NEW (70 lines) |
| `src/realtime/sync-stream.grpc.controller.ts` | MODIFIED (138 lines) |
| `src/realtime/realtime.module.ts` | MODIFIED (1 line) |

### Context Gates

- **ARCHITECTURE.md:** OK — `SyncStreamService` is an `@Injectable()` service in the same module as its consumer. Controller stays thin: it delegates event routing to the service and only adds `createdAt` stamping + buffer flushing. Proto-to-DTO mapping is inline in the controller, which is mechanical and acceptable.
- **RULES.md:** OK — No `!` non-null assertions. No sensitive data logged. No logging at all in the new code (consistent with "lean logs" rule).
- **ROADMAP.md:** OK — Milestone "Create src/realtime/sync-stream.grpc.controller.ts (live push phase)" is marked `[x]`.

### Critical Issues

**1. `SyncStreamService` silently overwrites on concurrent streams — reconnection kills the new stream**
`src/realtime/services/sync-stream.service.ts:28`

`register()` uses `this.streams.set(userId, ...)` which silently replaces any existing entry. In a real gRPC reconnection scenario (network switch, TCP keepalive timeout), the server sees two concurrent streams for the same user before the old one is detected as dead:

1. Stream A is active, registered in both `ActiveStreamRegistry` (Set) and `SyncStreamService` (Map)
2. Client reconnects (network change) — Stream B opens and calls `register(userId, pushB)` — **overwrites** Stream A's push callback. If Stream A had a pending debounce timer, it becomes orphaned (never cleared)
3. Events flow correctly to Stream B via `pushB`
4. TCP keepalive detects Stream A is dead — teardown fires — `syncStreamService.deregister(userId)` **deletes the entire Map entry**, removing Stream B's push callback
5. Stream B's subscriber is still open (it's still in `ActiveStreamRegistry`), but `SyncStreamService` no longer routes events to it — Stream B silently stops receiving live updates

The client must disconnect and reconnect a **third** time to recover. This contrasts with `ActiveStreamRegistry` which correctly uses `Map<string, Set<Subscriber>>` and scopes deregister to a specific subscriber instance.

Fix — use the same set-based pattern as `ActiveStreamRegistry`, or key by a unique stream identifier:

```typescript
// Option A: key by subscriber identity
private readonly streams = new Map<string, Set<StreamEntry>>();

// Option B: close old stream explicitly on re-register
register(userId: string, push: (events: LiveEvent[]) => void): void {
  const existing = this.streams.get(userId);
  if (existing?.pending) {
    clearTimeout(existing.pending.timer);
  }
  this.streams.set(userId, { push, pending: null });
}
```

Option B is simpler if the product intent is single-stream-per-user — but the old stream should be closed explicitly (via subscriber.complete()) so the client gets a clean signal. Option A is consistent with `ActiveStreamRegistry`.

**2. Orphaned debounce timer on overwrite**
`src/realtime/services/sync-stream.service.ts:28`

Related to issue 1: when `register()` overwrites an existing entry whose `pending` field has an active timer, that timer is never cleared. When it fires 300ms later, `flush(userId)` reads the **new** entry's `pending` field. If the new entry has accumulated events, they get flushed early (before their own 300ms window completes). If not, it's a no-op.

At minimum, `register()` should clear any existing entry's timer:

```typescript
register(userId: string, push: (events: LiveEvent[]) => void): void {
  const existing = this.streams.get(userId);
  if (existing?.pending) {
    clearTimeout(existing.pending.timer);
  }
  this.streams.set(userId, { push, pending: null });
}
```

### Suggestions

None beyond the critical issues above.

### Positive Notes

- **Gap-free catchup-to-live design:** The register-before-replay + buffer-then-flush approach (Steps A-C in the controller) is a textbook pattern for eliminating the replay-to-live gap. Events that arrive during replay are buffered, then filtered by `lastReplayedCursor` to deduplicate, and flushed before switching to direct mode. Well thought out.
- **Direct-mode filtering:** The `id > lastReplayedCursor` guard in `pushFn` direct mode (line 63) correctly handles debounced events whose timer straddles the replay/live boundary — they won't be sent twice.
- **`subscriber.closed` guard:** The replay loop exits early on client disconnect, preventing unbounded DB queries against a dead connection.
- **FAILED_PRECONDITION cleanup:** Explicit `deregister()` before `subscriber.error()` in the full-resync path (line 87), with a comment acknowledging the teardown will call it again (idempotent). Clean error handling.
- **Live-only mode:** `afterId === undefined` correctly skips replay and switches to direct mode immediately. `lastReplayedCursor = 0` ensures all events pass the `id > 0` filter since IDs are auto-increment starting at 1.
- **TypeScript compilation:** `npx tsc --noEmit` passes cleanly.
- **Module registration:** `SyncStreamService` correctly added to `RealtimeModule.providers` without export (internal to the module).
- **`onModuleDestroy` lifecycle:** Clears all pending timers on shutdown, matching the pattern expected by the plan.
