# Code Review — Plan 16: sync-stream.grpc.controller.ts (live push phase)

**Files reviewed:** `src/realtime/services/sync-stream.service.ts` (new), `src/realtime/sync-stream.grpc.controller.ts` (modified), `src/realtime/realtime.module.ts` (modified)
**TypeScript compilation:** clean (`npx tsc --noEmit` passes)

---

## Issues

### 1. Duplicate events at the replay/live boundary

`src/realtime/sync-stream.grpc.controller.ts:47-58`

`lastReplayedCursor` is scoped inside `replay()` (line 64), so `pushFn` cannot see it. The dedup filter in Step C (line 110) only applies to events already in `liveBuffer` at the moment replay finishes. Events still sitting in `SyncStreamService`'s 300ms debounce buffer at that point bypass the filter entirely.

Timeline that triggers a duplicate:

1. During the replay loop, a new event (id N) is DB-inserted. `CHANGE_EVENT_LOGGED` fires. `SyncStreamService` starts a 300ms timer.
2. Replay's `getChanges()` query returns event N (it's already in the DB). Replay sends it to the client. `lastReplayedCursor = N`.
3. Replay finishes in < 300ms. Step C flushes `liveBuffer` (empty — timer hasn't fired). `isDirect = true`.
4. 300ms timer fires. `SyncStreamService.flush()` calls `pushFn([{ id: N, ... }])`. `pushFn` is in direct mode — calls `subscriber.next()` with event N again.

The client receives event N twice.

**Fix:** Hoist `lastReplayedCursor` to the outer scope (alongside `isDirect` and `liveBuffer`) and add a filter in `pushFn`'s direct-mode path:

```typescript
const liveBuffer: SyncEventDto[] = [];
let isDirect = false;
let lastReplayedCursor = 0;        // ← hoist from replay()

const pushFn = (events: ...): void => {
  const stamped: SyncEventDto[] = events.map((e) => ({
    ...e,
    createdAt: new Date().toISOString(),
  }));
  if (isDirect) {
    const fresh = stamped.filter((e) => e.id > lastReplayedCursor);
    if (fresh.length > 0) {
      subscriber.next({ events: fresh });
    }
  } else {
    liveBuffer.push(...stamped);
  }
};
```

Inside `replay()`, assign `lastReplayedCursor = result.cursor` as it already does — the outer variable is now visible to the closure.

---

## Suggestions

### 2. Double `deregister()` in FAILED_PRECONDITION path

`src/realtime/sync-stream.grpc.controller.ts:78, 122-124`

When cursor is too old, `deregister(userId)` is called explicitly (line 78), then `subscriber.error()` triggers the teardown which calls `deregister(userId)` again (line 123). This is safe because `deregister()` is idempotent (`Map.delete` on a missing key is a no-op). Not a bug, but a brief inline comment would make the intentional double-deregister obvious to the next reader:

```typescript
// Explicit deregister before error — teardown will call deregister again (idempotent).
this.syncStreamService.deregister(userId);
```

### 3. Single stream per user assumption

`src/realtime/services/sync-stream.service.ts:28`

`streams` is keyed by `userId`. If the same user opens two concurrent `WatchChanges` streams (e.g., two devices), `register()` silently overwrites the first entry. Worse, when the first connection disconnects, its teardown calls `deregister(userId)`, which removes the second connection's entry — leaving the second stream without live events.

This matches the pre-existing `StateStore.socketMap` design (also keyed by `userId`), so it's not a regression. Flagging it for awareness — it should be addressed if multi-device support is planned.

---

## Verification

- [x] `SyncStreamService` correctly mirrors `SyncNotifierService`'s debounce/batching pattern (300ms trailing, no timer reset).
- [x] `@OnEvent(CHANGE_EVENT_LOGGED)` works — `EventEmitterModule.forRoot()` is registered in `AppModule`.
- [x] `SyncStreamService` is registered in `RealtimeModule.providers`.
- [x] `StateStore` / `streamMap` are not used in this controller — clean separation.
- [x] FAILED_PRECONDITION path deregisters before erroring, preventing dangling listeners.
- [x] Teardown is registered synchronously (before any `await` in `replay()`), so it's always active.
- [x] `onModuleDestroy()` clears all pending timers.
- [x] TypeScript compiles cleanly.
- [x] No RULES.md violations (no `!`, no PII in logs, logs are lean).
- [x] Architecture compliance: controller is thin, business logic is in the service.
