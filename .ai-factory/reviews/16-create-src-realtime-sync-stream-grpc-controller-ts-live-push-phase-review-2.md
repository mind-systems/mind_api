# Code Review — Plan 16: sync-stream.grpc.controller.ts (live push phase) — Review 2

**Files reviewed:** `src/realtime/services/sync-stream.service.ts` (new), `src/realtime/sync-stream.grpc.controller.ts` (modified), `src/realtime/realtime.module.ts` (modified)
**TypeScript compilation:** clean (`npx tsc --noEmit` passes)

---

## Review-1 issues — resolved

1. **Duplicate events at replay/live boundary** — Fixed. `lastReplayedCursor` is hoisted to the outer scope (line 45). `pushFn`'s direct-mode path filters by `e.id > lastReplayedCursor` (line 59). Events whose 300ms debounce timer straddles the replay/live boundary are now correctly deduplicated.

2. **Double deregister clarity** — Fixed. Comment on line 82 explains the intentional idempotent double-call.

---

## Correctness analysis

**Gap-free catchup-to-live:** Listener registers (line 68) before `replay()` starts (line 124). Between these two points there are only synchronous variable assignments and function definitions — no `await` yields. No event can slip through.

**Buffer/direct mode transition:** `isDirect` flips to `true` only after Step C flushes and deduplicates `liveBuffer` (line 121). Between Step C flush (line 115) and `isDirect = true` (line 121) there's no yield, so no `pushFn` call can interleave.

**Live-only mode (`afterId === undefined`):** `lastReplayedCursor` stays at 0. Filter `e.id > 0` passes all events (ids are positive auto-increment integers). `isDirect = true` is set synchronously before any yield (line 73). Correct.

**Teardown ordering:** `subscriber.add(teardownFn)` (line 127) executes during the first synchronous frame, before `replay()`'s first `await` (line 79: `getMinEventId()`). So teardown is always registered regardless of when replay fails.

**FAILED_PRECONDITION path:** Explicit `deregister()` (line 83) before `subscriber.error()` (line 84). Teardown fires again — idempotent. No dangling listener. No events can accumulate because `deregister()` clears the pending timer.

**Subscriber safety after close:** If the gRPC client disconnects mid-replay, RxJS marks the subscriber as closed. Subsequent `subscriber.next()` calls in the replay loop become no-ops. The loop finishes naturally (bounded by DB pages). No crash, no data corruption — just a few wasted DB queries.

**`SyncStreamService.flush()` after deregister:** `clearTimeout` in `deregister()` prevents the callback. Even if somehow reached, `flush()` checks `this.streams.get(userId)` — returns `undefined` after delete — and exits early.

**Type compatibility:** `ChangeEventPayload.entity` (`ChangeEntity` string enum) and `.action` (`ChangeAction` string enum) are assignable to `LiveEvent`'s `string` fields. `LiveEvent` spread + `createdAt` matches `SyncEventDto`. `{ events: SyncEventDto[] }` matches `ChangeEvent`. TypeScript compilation confirms.

---

## Verification

- [x] `SyncStreamService` debounce pattern matches `SyncNotifierService` (300ms trailing, no timer reset)
- [x] `@OnEvent(CHANGE_EVENT_LOGGED)` works — `EventEmitterModule.forRoot()` registered in `AppModule`
- [x] `ChangelogModule` is `@Global()` — `ChangeLogService` injectable without explicit import
- [x] `SyncStreamService` registered in `RealtimeModule.providers`
- [x] No `StateStore` / `streamMap` usage in this controller
- [x] `deregister()` is idempotent — safe for double-call in FAILED_PRECONDITION path
- [x] `onModuleDestroy()` clears all pending timers
- [x] No `!` non-null assertions (RULES.md)
- [x] No PII in logs (RULES.md)
- [x] Controller is thin, business logic in service (ARCHITECTURE.md)
- [x] TypeScript compiles cleanly

REVIEW_PASS
