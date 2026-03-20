# Review: 06 — WebSocket Sync Push (iteration 1)

## Scope

7 files changed (1 new). Adds real-time push of change events via `sync:changed` on `/live` namespace with 300ms per-user debounce.

## Files reviewed

| File | Verdict |
|------|---------|
| `src/changelog/changelog.events.ts` | OK |
| `src/changelog/changelog.service.ts` | OK |
| `src/breath-sessions/breath-sessions.service.ts` | OK |
| `src/realtime/events/live.events.ts` | OK |
| `src/realtime/services/sync-notifier.service.ts` | OK |
| `src/realtime/realtime.module.ts` | OK |

## Findings

### 1. Test mock returns `undefined` instead of `number` — low

`breath-sessions.service.spec.ts` has 4 `beforeEach` blocks that mock `changeLogService.log` as:

```ts
const mockChangeLogService = { log: jest.fn().mockResolvedValue(undefined) } as any;
```

Now that `log()` returns `Promise<number>`, the mock should return a number (e.g., `1`) to match the contract. The tests still pass because no assertion inspects the emitted payload, and the `as any` cast bypasses type checking. Not a runtime issue — pure test hygiene.

### 2. `(socket as Socket)` cast in `flush()` — fine, matches existing pattern

`StateStore.socketMap` holds `AuthenticatedSocket`, whose `EmitEvents` generic is `Record<string, never>` — TypeScript would reject `.emit(SYNC_CHANGED, ...)` without the cast. The gateway handles this identically: parameters are typed as plain `Socket`, cast to `AuthenticatedSocket` only for `.data.userId`. The cast here is correct.

### 3. Race between `has()` check and `flush()` — handled

A user could disconnect during the 300ms debounce window. `flush()` re-checks `socketMap.get(userId)` and returns early if no socket is found. No data loss — the events are already persisted in `change_events` and will be picked up via REST poll on reconnect.

### 4. `onModuleDestroy` clears pending timers — correct

Prevents dangling `setTimeout` callbacks during graceful shutdown.

### 5. Pre-existing test failures (not introduced by this PR)

`live.gateway.spec.ts` (18 tests) fails due to a constructor argument count mismatch predating this change. `BreathSessionsService` tests: 13/13 pass. `tsc --noEmit` reports the same pre-existing spec errors only.

## Conclusion

No bugs, no security issues, no runtime risks. The implementation follows existing patterns, handles edge cases (offline users, disconnect during debounce, shutdown cleanup), and all affected tests pass.

REVIEW_PASS
