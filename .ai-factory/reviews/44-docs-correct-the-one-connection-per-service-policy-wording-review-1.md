# Review: Docs — correct the one-connection-per-service policy wording

## Scope
Only tracked code/content change is `docs/realtime/overview.md` (the `.ai-factory/` plan/plan-review/json are process artifacts, not code). Docs-only edit, no runtime surface — no migrations, types, or race conditions to break. Review focused on whether every documented claim matches the shipped code.

## Verification against shipped code

Each rewritten sentence was checked against the implementation:

1. **Nested-map structure** — `ActiveStreamRegistry` is `Map<userId, Map<StreamService, Subscriber>>`, one slot per `(userId, service)`; different services coexist. Matches `active-stream-registry.service.ts:7-10,38`. ✓
2. **`closeAll(userId)` all-channels close** — `closeAll` iterates the user's service map and completes every subscriber. Matches `active-stream-registry.service.ts:59-64`. ✓
3. **Last-connect-wins, graceful (not error)** — `register` evicts the prior subscriber via `existing.complete()` (graceful), not an error. Matches `active-stream-registry.service.ts:25-30`. ✓
4. **STATE `CONNECTION_SUPERSEDED` warning before close** — the STATE controller passes an `onEvict` that pushes `sessionError { code: 'CONNECTION_SUPERSEDED' }` before `complete()`. Matches `module-state.grpc.controller.ts:146-156` + registry `:28-29`. ✓
5. **Takeover: root persists, children ended** — teardown branches on `wasEvicted`; eviction calls `supersedeChildren`, which ends every child and leaves the root untouched. Matches `module-state.grpc.controller.ts:257-283` + `activity-engine.service.ts:694-715`. ✓
6. **Genuine drop unaffected — root and children go through the grace path** — non-evicted teardown calls `handleTransportDisconnect`, which runs `onDisconnect` + arms a grace timer for the root and every child. Matches `activity-engine.service.ts:663-692`. ✓
7. **Other three services: stop only, no frame, no lifecycle effect** — the instruction, bio, and sync controllers call `register` with no `onEvict` and only `deregister` on teardown (no `wasEvicted` branch). Matches `module-instruction-stream.grpc.controller.ts:56-60`, `module-biometric-stream.grpc.controller.ts:58`, `sync-stream.grpc.controller.ts:50-54`. ✓

## Constraint compliance
- No `INTERRUPTED` / `WeakSet` / race-ordering terms leaked into the doc — behavior-level only. ✓
- Takeover vs. abandon kept distinct (children ended immediately vs. grace path). ✓
- Only the `ActiveStreamRegistry` bullet and the "Политика одного соединения" section changed; the diff touches nothing else. ✓
- Russian, current-state phrasing (no "было/стало"). ✓

## Findings
None. Every claim is checkable against a specific line in the shipped implementation, and the edit respects all scope/style constraints.

REVIEW_PASS
