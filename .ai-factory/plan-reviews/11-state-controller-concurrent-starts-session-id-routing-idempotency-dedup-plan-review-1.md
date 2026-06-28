# Plan Review: State controller — concurrent starts + session_id routing + idempotency dedup

**Plan:** `11-state-controller-concurrent-starts-session-id-routing-idempotency-dedup.md`
**Reviewed against:** `src/realtime/` (controller, engine, store, constants), the committed contract `concurrency-idempotency.spec.ts`, the old characterization suite, and the engine specs.
**Risk Level:** 🟡 Medium

The plan is well-researched and mostly accurate — the proto fields it depends on already exist, the engine accessors and constants are correctly scoped, and the controller wiring matches the committed test contract. However, there is **one concrete missing step** that will leave the test suite RED after Commit 1, plus a few smaller items worth pinning before implementation.

---

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — WARN (acceptable): The idempotency map is implemented as a controller-owned plain class (`new ActivityIdempotencyStore()`), not a NestJS provider. This deviates slightly from the "modules communicate through exported providers" convention, but the plan explicitly and correctly justifies it: the committed test instantiates the controller with exactly 5 constructor args (`concurrency-idempotency.spec.ts:212-218`), so a 6th injected dependency would be `undefined` under test. The trade-off is sound. No action required.
- **Rules (`RULES.md`)** — PASS with one reminder: Rule "NEVER use non-null assertion `!`" applies to the new engine accessor `listLiveSessions`. The plan's formulation `root ? [root, ...children] : [...children]` already avoids `!` — keep it that way (do **not** write `getRoot(userId)!`). No sensitive-data logging and no `@GrpcCurrentUser`/`@Payload` surface is touched, so the other two rules are not implicated.
- **Roadmap (`ROADMAP.md`)** — WARN (informational): This is milestone 11 in an established TDD sequence (specs 01–10 already have plan-reviews). The plan correctly identifies itself as the RED→GREEN turn for `concurrency-idempotency.spec.ts`. No explicit roadmap linkage line is present in the plan, but the milestone numbering makes the linkage obvious.

---

## Critical Issues

### 1. Task 3 misses a second test caller of `endActivity` — `multi-session-lifecycle.spec.ts` will go RED after the signature reorder

The plan's Blocking Decision 1 and Task 3 reorder `endActivity` from `(userId, clientTimestampMs?, sessionId?)` to `(userId, sessionId?, clientTimestampMs?)` and commit to migrating **only** the three call sites in `activity-engine.service.spec.ts` (lines 227, 253, 282). It states "The only production caller of `endActivity` is the controller (verified via grep)" — true for production, but there is a **second test file** that calls `endActivity` with a timestamp in the 2nd positional slot:

`src/realtime/services/multi-session-lifecycle.spec.ts` defines a wrapper:

```ts
// lines 108-109 (makeHelpers)
end: (userId: string, clientTimestampMs?: number) =>
  engine.endActivity(userId, clientTimestampMs),
```

This wrapper is exercised by a **characterization test marked "GREEN now, must survive"**:

```ts
// line 536-553 — coerceClientTs Long branch on endActivity
const longLike = { toNumber: () => clientEndMs };
await h.end('user-1', longLike as any);          // line 550
expect(session.endedAt).toEqual(new Date(clientEndMs));   // line 552
```

After the reorder, `engine.endActivity(userId, clientTimestampMs)` passes the `longLike` timestamp object into the **`sessionId`** slot. Inside `endActivity`, `sid = sessionId ?? getSoleChild(...)` resolves `sid` to the truthy `longLike` object, `getSession(userId, longLike)` returns `undefined`, and the method returns `null` without ever setting `endedAt`. The assertion at line 552 fails — a Class-B silent regression introduced by Commit 1, exactly the kind the spec header warns to escalate rather than patch.

**Fix:** Add `src/realtime/services/multi-session-lifecycle.spec.ts` to Task 3's file list and update the `makeHelpers` `end` wrapper body to:

```ts
end: (userId: string, clientTimestampMs?: number) =>
  engine.endActivity(userId, undefined, clientTimestampMs),
```

That single wrapper change covers both usages (`h.end('user-1')` at line 276 and `h.end('user-1', longLike)` at line 550). The direct `engine.endActivity('user-1')` at line 836 is userId-only and is unaffected. This is mechanical and preserves the asserted behaviour, but the plan must name the file or the implementer (following the plan literally) will leave the suite red and may misdiagnose it.

---

## Minor Issues / Recommendations

### 2. Revoke error-path characterization tests become vacuous under the new mock (Task 8)

Task 8 adds `listLiveSessions: jest.fn().mockReturnValue([])` to the old controller-spec mock engine. With the fan-out rewrite (Task 7), `handleSessionRevoked` iterates `listLiveSessions(...)` — which returns `[]` — so `stopActivity` is **never called**. This correctly forces the update of `:567-571` (`stopActivity` called with `'user-1'`), which the plan already flags. But it also silently neuters two adjacent tests that the plan does **not** mention:

- `:578` `should call closeAll even when stopActivity throws` — the `stopActivity.mockRejectedValue` never fires, so the throw path is no longer exercised (test still passes, but vacuously).
- `:584` `should not rethrow when stopActivity rejects` — same; passes vacuously.

These won't turn the suite red, so this is not blocking. But the per-session try/catch + `SessionEvents.REVOKED` fallback that Task 7 introduces ends up with **no characterization coverage** in the old suite, and `concurrency-idempotency.spec.ts:543` only covers the happy path. Recommend Task 8 either (a) point the old-suite mock's `listLiveSessions` at a one-session array so the throw-path tests stay meaningful, or (b) explicitly note these two tests are superseded and acceptable as-is. Pin the choice so it's not left to chance.

### 3. Idempotent-hit requests still consume the rate-limit budget

In Task 5 the order is rate-limit → idempotency lookup. A true client retry with the same `clientActivityId` therefore still consumes a `activity-start:${userId}` token before being deduped. This matches the note ("rate limiter stays … caps creation regardless of tokens") and the committed test is isolated from rate limiting (`consume` always returns `true`), so it is **not** a blocker. Flagging only so it is a conscious decision: a burst of retries of one activity could exhaust the start budget even though no new sessions are created. If undesired, move the idempotency lookup ahead of `consume`. Leave as-is if the note's intent stands.

### 4. `getActiveSession` becomes dead in the controller after Tasks 5 & 7 — confirm intent

Removing the singleton guard (Task 5) and rewriting `handleSessionRevoked` (Task 7) eliminates both controller uses of `activityEngine.getActiveSession`. The engine method stays (still used by other code paths/specs), so this is fine — just confirm no lingering import/reference is left dangling in the controller after the edits (no separate action needed; ESLint `no-unused-vars` will catch it).

---

## Verified Correct (high-confidence)

These were checked against the actual code and the committed contract and are accurate as written:

- **Proto fields already exist** — `clientActivityId`, and `sessionId` on End/Stop/Pause/Resume cmds are present in `proto/generated/module_state.ts` (lines 65, 78, 84, 89, 94). Task 6's import of the cmd types is valid; spec 05/10 landed.
- **Engine signature reorder matches the test** — `concurrency-idempotency.spec.ts:470-474` asserts `endActivity('user-1', 'session-A', undefined)`, which the reordered `(userId, sessionId?, clientTimestampMs?)` satisfies. The three `activity-engine.service.spec.ts` call-site updates (227/253/282 → `('user-1', undefined, <ts>)`) are correct and preserve the `endedAt` assertions.
- **Store accessors exist for the new engine methods** — `getSoleChild`, `getRoot`, `listChildren` are all present in `ActivitySessionStore` (lines 132, 75, 116). `listLiveSessions` = `root ? [root, ...children] : [...children]` is correct (`listChildren` already excludes root).
- **Resolver ambiguity logic is right** — `listLiveSessions(userId).filter(s => s.activityType !== InternalActivityType.ROOT).length > 1` works: `InternalActivityType.ROOT === 'root'`, and the ambiguity test (`spec:509-512`) supplies two `'breath'` children → length 2 → `AMBIGUOUS_SESSION` emitted, mutator not called. The 0-vs->1 distinction via `listLiveSessions` (not `getSoleChild`) is correctly preserved.
- **Constants** — `AMBIGUOUS_SESSION` is absent from `ws-error-codes.ts` and `IDEMPOTENCY_WINDOW_MS` is absent from `realtime-config.ts`; both additions follow the existing SCREAMING_SNAKE / `WS_*` conventions. The config-mock returns `10_000` for the literal key (`spec:109`) and the controller reads it with default `10_000`.
- **Idempotency window math** — `lookup` returning the cached id only when `Date.now() - storedAt < windowMs` makes the "within window" (immediate repeat → dedupe) and "after window" (advance 10_001 ms → new session) tests both pass; the strict `<` avoids the off-by-one the test deliberately probes.
- **Per-user prefix eviction is collision-safe** — `evictUser` deleting keys with prefix `` `${userId}:` `` correctly handles the teardown test and does not cross-evict `user-12:` when evicting `user-1` (the `:` delimiter prevents the prefix overlap).
- **Constructor stays at 5 args** — the controller-owned `idempotency` field and `idempotencyWindowMs` read mirror the existing `rateLimitWindowMs` pattern without adding a DI parameter, matching `spec:212-218`.
- **Revoke fan-out** — enumerating `listLiveSessions` (3 entries incl. root) and calling `stopActivity(userId, sessionId)` per entry, then `closeAll` once, matches `spec:544-573`. Calling `stopActivity` on the root id is harmless (engine guards root → returns `null`).

---

## Summary

The plan is structurally sound and faithful to the committed test contract — the hard reconciliation work (the GAP-B arg-order reorder, the constructor-arity constraint, the controller-internal idempotency store, the 0-vs->1 ambiguity detection) is correctly identified and resolved. The one blocking gap is **Critical Issue 1**: Task 3 must also migrate the `endActivity` wrapper in `multi-session-lifecycle.spec.ts`, or Commit 1 leaves a "GREEN now, must survive" characterization test red. Address that, optionally pin the choices in Minor Issues 2 and 3, and the plan is ready to implement.
