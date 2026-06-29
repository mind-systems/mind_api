# Code Review: Retire the store spec's userId-keyed grace-timer cases

**Scope of change:** test-only. The diff touches `src/realtime/services/activity-session-store.service.spec.ts` (plus `.ai-factory/` plan/roadmap docs). No production code (`activity-session-store.service.ts`) changed.

## What was verified

### Gate passes
```
grep -nE '\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(' \
  src/realtime/services/activity-session-store.service.spec.ts | grep -v ForSession
```
→ zero matches (exit 1). The dead userId-keyed trio is fully retired from the spec.

### Suite green
`npx jest src/realtime/services/activity-session-store.service.spec.ts` → **38 passed, 38 total**.

### Config assertions preserved
The default-30000ms and custom-`WS_RECONNECT_GRACE_MS` (5000ms) grace-period boundary assertions survive in `describe('constructor')` (`:41-63`), now firing through `startGraceTimerForSession`. The `graceMs` field is shared by both timer APIs, so the assertions remain meaningful. The `ConfigService.get('WS_RECONNECT_GRACE_MS')` key assertion (`:65-70`) and `size === 0` case were correctly left untouched.

### Invariants carried forward, not silently dropped
- **State-independence** (`set()`/`delete()` do not touch timers) was rewritten onto `*ForSession` (`:131-182`) rather than deleted. The timer keys match each mutated state's `sessionId` (`makeActivityState` defaults `sessionId: 'session-1'`, matching the `'session-1'`/`'session-b'` timer keys), so a regression where `set`/`delete` cascade-cancels a session's timer would still be caught.
- **Replace / post-expiry / Promise-void semantics / cancel no-op / hasPending** all re-expressed onto `*ForSession` (Phases 6–10).
- **Firing & expiry independence** between sessions is covered in `multi-session-lifecycle.spec.ts:185` ("should key grace timers by sessionId, not userId: two children expire independently"), so its userId-keyed duplicate was correctly removed. The **cancel-independence** sub-case was carried forward into the `cancelGraceTimerForSession()` describe (`:377-391`). Removal comments at `:224` and `:323` document this accurately.

### Downstream unblock confirmed
Repo-wide grep shows the only remaining userId-keyed trio reference in `src/` is the service's own internal self-call (`activity-session-store.service.ts:141`, `this.cancelGraceTimer(userId)`). No other spec or production caller depends on the trio, so the downstream method deletion ([[42-remove-userid-keyed-grace-trio]]) can proceed without orphaning any case.

### No unrelated cases weakened
`get()`/`has()`/`set()`/`delete()`/`size` state assertions and root/child accessor cases are unchanged.

## Findings
None. No bugs, security, or correctness issues. The refactor is faithful: the gate is met, the suite is green, every kept invariant has a sessionId-keyed home, and the path for the downstream deletion is clear.

REVIEW_PASS
