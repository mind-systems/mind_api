# Code Review: State controller — concurrent starts + session_id routing + idempotency dedup

**Plan:** `11-state-controller-concurrent-starts-session-id-routing-idempotency-dedup.md`
**Reviewed:** full `git diff HEAD` + each changed/new file read in full, against the committed contract `concurrency-idempotency.spec.ts` and the engine/store internals.
**Risk Level:** 🟢 Low — no bugs, security, or correctness defects found. Three non-blocking recommendations.

## What was verified

**Build & tests.**
- `tsc --noEmit -p tsconfig.build.json` — clean, no type errors.
- The four affected suites (`concurrency-idempotency`, `module-state.grpc.controller`, `multi-session-lifecycle`, `activity-engine.service`) — **115/115 pass**.
- Full `src/realtime` run: 344 pass, 8 fail. **All 8 failures are intentional future-milestone TARGETs** marked `[RED until spec 08-janitor-empty-roots]` (4 in `session-watchdog.service.spec.ts`) and `[RED until spec 10-bio-ingest-to-root]` (4 in `module-biometric-stream.grpc.controller.spec.ts`). They reference specs 08/10, are outside this milestone's scope, and are unaffected by this diff (this change touches neither the watchdog nor the bio controller). Not regressions.

**Correctness of each contract point:**
- **`endActivity` reorder (the GAP-B reconciliation)** — signature is now `(userId, sessionId?, clientTimestampMs?)` (`activity-engine.service.ts:166-172`), and *every* caller was migrated in lockstep: the controller (`:399-403` passes `userId, resolved.sessionId, cmd.clientTimestampMs`), the three `activity-engine.service.spec.ts` call sites (227/253/282 → `('user-1', undefined, <ts>)`), and the `makeHelpers.end` wrapper in `multi-session-lifecycle.spec.ts:109` (the fix from plan-review-1). The two remaining 1-arg `endActivity('user-1')` calls (`activity-engine.service.spec.ts:189,205`; `multi-session-lifecycle.spec.ts:836`) are userId-only and correctly unaffected. Grep confirms no stale 2-arg `(userId, timestamp)` caller remains.
- **Engine accessors** — `getSoleChild` delegates to the store; `listLiveSessions` returns `root ? [root, ...children] : [...children]` (`:544-551`), correctly including root for the revoke fan-out and excluding nothing improperly (`listChildren` already excludes root). No non-null assertions.
- **Resolver (`resolveTargetSession`, `:282-312`)** — priority is correct: explicit sessionId → sole child → `>1` children (filtered against `InternalActivityType.ROOT`) emits `AMBIGUOUS_SESSION` and does **not** call any mutator → 0 children returns `{ok:true, sessionId:undefined}` so the engine yields `null`/throws `no_active_session`, preserving today's no-session behaviour. The 0-vs->1 distinction uses `listLiveSessions`, never `getSoleChild` alone, exactly as the contract requires.
- **Idempotency store** — `lookup` returns the cached id only while `Date.now()-storedAt < windowMs` (strict `<` handles the deliberate 10_001 ms off-by-one probe), deletes stale entries on access; `record` stamps `Date.now()`; `evictUser` deletes by `` `${userId}:` `` prefix — collision-safe because the `:` delimiter prevents `user-1` from evicting `user-12:` keys. Window read in the constructor with default `10_000`, mirroring `rateLimitWindowMs`; constructor stays at 5 args (no DI param), so the committed `new ModuleStateGrpcController(...5)` instantiation holds.
- **`handleActivityStart`** — singleton guard removed; dedup lookup sits after the rate-limit `consume` (intentional, per note); `record` fires only on a real create with a token; absent `clientActivityId` always creates. Teardown calls `idempotency.evictUser(userId)` alongside the rate-limiter evict.
- **`handleSessionRevoked` fan-out** — iterates the `listLiveSessions` snapshot (safe against store mutation during the loop), per-session try/catch logging + `SessionEvents.REVOKED { sessionId }` on failure, `closeAll` once after the loop. Calling `stopActivity` on the root id is harmless (engine guards root → `null`).
- **Constants** — `AMBIGUOUS_SESSION` (SCREAMING_SNAKE, value===key) and `IDEMPOTENCY_WINDOW_MS: 'WS_IDEMPOTENCY_WINDOW_MS'` added per convention.
- **Old-suite migration** — the three singleton-guard echo tests deleted; the four routing chars updated to the `(userId, undefined)` / `(…, undefined, undefined)` shapes; revoke char updated to `('user-1','session-1')`; mock seeded with `getSoleChild→undefined` and `listLiveSessions→[1 child]` so the revoke throw-path tests (`:578/:584/:589`) stay meaningful (plan-review-1 Minor Issue 2 honoured).

## Non-blocking recommendations

1. **Unnecessary `(cmd as any)` casts defeat type safety.** The controller reads `(cmd as any).clientActivityId`, `(cmd as any).sessionId` (`:336, :397, :423, :447, :476`). The regenerated proto types already declare these fields (`ActivityStartCmd.clientActivityId`, `ActivityEndCmd/Stop/Pause/ResumeCmd.sessionId` — verified in `proto/generated/module_state.ts:65,78,84,89,94`). The `as any` was only needed in the pre-regen committed *test*; in production code direct access (`cmd.sessionId`, `cmd.clientActivityId`) type-checks and gives compile-time protection against a future proto rename. Recommend dropping the casts. Not a runtime bug.

2. **Dedup is best-effort under truly concurrent retries (document, don't fix).** `record` runs after `await startActivity`, and the command subscription does not await `routeCommand` (`this.routeCommand(...).catch(...)`). Two `activity:start` with the same `clientActivityId` that arrive before the first `startActivity` resolves would both miss `lookup` and create two sessions. This matches the note's short-window best-effort design — real retries are time-separated (post-timeout/disconnect) and the committed test separates them via `flushMicrotasks` — so it is acceptable. Worth a one-line code comment so a future reader doesn't mistake it for a strong idempotency guarantee.

3. **Mock internal inconsistency in `module-state.grpc.controller.spec.ts` (cosmetic).** The mock sets `getSoleChild→undefined` while `listLiveSessions→[one child]`; in real code a single child would make `getSoleChild` return it. The tests only assert the resolved call shape `(userId, undefined)`, so this is harmless, but the mock state does not correspond to any real store state. Optional cleanup for fidelity.

## Summary

The implementation faithfully realises the plan and the committed `concurrency-idempotency.spec.ts` contract. The hard reconciliations (the `endActivity` arg-order reorder applied across all callers, the controller-internal idempotency store keeping the constructor at 5 args, the 0-vs->1 ambiguity detection, the revoke fan-out) are all correct. Build is clean and every in-scope test is green; the only red tests belong to future specs 08/10. No blocking findings — the three items above are optional polish.

REVIEW_PASS
