# Plan Review 2: State controller — concurrent starts + session_id routing + idempotency dedup

**Plan:** `11-state-controller-concurrent-starts-session-id-routing-idempotency-dedup.md`
**Reviewed against:** the live `src/realtime/` code (controller, engine, store, interfaces, constants, rate limiter), the committed contract `src/realtime/concurrency-idempotency.spec.ts`, the old characterization suite `module-state.grpc.controller.spec.ts`, the engine specs, the generated proto, and plan-review-1.
**Risk Level:** 🟢 Low

This is the second iteration. Plan-review-1 raised one blocking item (Critical Issue 1) and three minor items (2–4). **All four are now resolved in the plan**, and every other claim re-verified against the code holds. The plan is faithful to the committed test contract and ready to implement.

---

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — WARN (acceptable, unchanged from review-1): the idempotency map is a controller-owned plain class (`new ActivityIdempotencyStore()`), not a NestJS provider, deviating slightly from the "modules communicate through exported providers" convention. The plan justifies it correctly — the committed test (`concurrency-idempotency.spec.ts:212-218`) instantiates the controller with exactly the current 5 constructor args (verified), so a 6th injected dependency would be `undefined` under test. Sound trade-off, no action.
- **Rules (`RULES.md`)** — PASS: the `listLiveSessions` formulation `root ? [root, ...children] : [...children]` avoids the non-null `!` assertion. (Note: the *existing* engine code at `activity-engine.service.ts:80` already uses `getRootId(userId)!`, but the plan doesn't touch that line, so it's out of scope.) No sensitive-data logging is introduced.
- **Roadmap (`ROADMAP.md`)** — WARN (informational): milestone 11 in the established TDD sequence (specs 01–10 have plan-reviews). The plan correctly identifies itself as the RED→GREEN turn for `concurrency-idempotency.spec.ts`. Linkage is implicit via numbering; no explicit roadmap line, acceptable for this milestone style.

---

## Review-1 findings — verification of resolution

1. **Critical Issue 1 (RESOLVED).** Review-1's blocker was that the `endActivity` reorder would leave `multi-session-lifecycle.spec.ts` red, because its `makeHelpers.end` wrapper (lines 108-109) passes a timestamp into the 2nd slot, exercised by the `coerceClientTs` Long-branch char at line ~550. The current plan's **Task 3 now lists `multi-session-lifecycle.spec.ts` in its file set** and specifies the wrapper migration to `engine.endActivity(userId, undefined, clientTimestampMs)` (Blocking Decision 1 and Task 3 bullet 3). Verified against code: the wrapper is at 108-109, the Long-branch test is at 536/550, the userId-only direct call at 836 is unaffected. ✅
2. **Minor Issue 2 (RESOLVED).** The plan's Task 8 now mocks the old-suite `listLiveSessions` with a **one-session array** `[{ sessionId: 'session-1', activityType: 'breath' }]` (not `[]`), with an explicit rationale that `[]` would silently neuter the revoke throw-path chars at `:578`/`:584`/`:591`. Verified those tests exist and use `stopActivity.mockRejectedValue`; with a one-session array the throw path stays live and `closeAll`-once coverage is meaningful. ✅
3. **Minor Issue 3 (RESOLVED/PINNED).** Task 5 explicitly keeps rate-limit → idempotency ordering and documents the conscious trade-off ("a true retry still consumes one `activity-start:${userId}` token before being deduped"). Matches the note's intent; test is isolated from rate limiting. ✅
4. **Minor Issue 4 (RESOLVED/PINNED).** Task 5 notes that `getActiveSession` has no remaining controller caller after the guard removal + revoke rewrite, and that ESLint `no-unused-vars` will catch a dangling reference. The engine method itself stays. Verified `getActiveSession` lives at `activity-engine.service.ts:540`. ✅

---

## Re-verified correct against the live code

- **`endActivity` current signature** is `endActivity(userId, clientTimestampMs?, sessionId?)` (`activity-engine.service.ts:168-172`), with the `number | { toNumber?: () => number } | string` union — exactly what Task 3 reorders to `(userId, sessionId?, clientTimestampMs?)`. The committed test asserts `endActivity('user-1', 'session-A', undefined)` (`concurrency-idempotency.spec.ts:470-474`). ✅
- **Only production caller of `endActivity` is the controller** (grep confirmed: single hit at `module-state.grpc.controller.ts:330`). ✅
- **Engine-spec call sites** at 227/253/282 pass a timestamp in the 2nd slot and must migrate to the 3rd; 189/205 are userId-only and correctly left alone. Matches Task 3. ✅
- **Store accessors exist**: `getSoleChild` (132), `getRoot` (75), `getRootId` (79), `listChildren` (116). `listLiveSessions = root ? [root, ...children] : [...children]` is correct — `listChildren` excludes root. ✅
- **`ActivityState` shape** carries `sessionId`, `activityType` (typed as the internal `ActivityType` enum), `isPaused` — the resolver's `s.activityType !== InternalActivityType.ROOT` filter is valid; `InternalActivityType.ROOT === 'root'` and the spec's `'breath'` mocks pass the filter. ✅
- **Constants absent** as claimed: `AMBIGUOUS_SESSION` not in `ws-error-codes.ts`, `IDEMPOTENCY_WINDOW_MS` not in `realtime-config.ts`; both additions follow the SCREAMING_SNAKE / `WS_*` conventions. Config mock returns `10_000` for the literal key (`spec:109`). ✅
- **Proto cmd types & fields** present in `proto/generated/module_state.ts`: `ActivityStartCmd.clientActivityId` (65), `ActivityEndCmd.{sessionId,clientTimestampMs}` (74/78), `ActivityStop/Pause/ResumeCmd.sessionId` (84/89/94). Task 6's imports are valid. ✅
- **Controller call shapes** — `handleActivityStop/Pause/Resume` currently take `(userId, subscriber)` (no cmd), so Task 6's `routeCommand` change to pass the whole cmd is required and correct. The singleton guard sits at controller `284-293`, teardown `rateLimiterService.evict` at `196`, `handleSessionRevoked` at `201-217` — all matching the plan's line references. ✅
- **Revoke fan-out** test (`spec:544-573`) expects `stopActivity` called 3× including the root id `session-root`; Task 7 iterates `listLiveSessions` without filtering root, matching. Calling `stopActivity` on root is harmless (engine guards root → returns `null`). ✅
- **Idempotency teardown / per-user scope** tests (`spec:356`, `spec:397`) confirm `evictUser(userId)` prefix-delete (`${userId}:`) is correct and collision-safe (the `:` delimiter prevents `user-1` evicting `user-12:`). ✅

---

## Minor notes (non-blocking, optional)

### A. Controller needs a new `WsErrorCode` import (Task 6)

Task 6 specifies emitting `sessionError { code: WsErrorCode.AMBIGUOUS_SESSION, ... }`, but the controller does **not** currently import `WsErrorCode` — every code it emits today is a raw string literal (`'RATE_LIMIT_EXCEEDED'`, `'INVALID_COMMAND'`, etc.). An implementer following the plan literally must add `import { WsErrorCode } from './constants/ws-error-codes';`. The TypeScript compiler will force this, so it cannot ship broken — but the plan doesn't mention it. Equivalent and arguably more consistent with the surrounding code would be to emit the **string literal** `'AMBIGUOUS_SESSION'` directly (which is exactly what `spec:530` compares against). Either is fine; just be aware the constant reference adds an import the plan doesn't call out.

### B. Task 6 resolver step 4 label is slightly imprecise (cosmetic)

Step 4 is labeled "else (0 children) → `{ ok: true, sessionId: undefined }`". The actual guard is "neither `getSoleChild` truthy nor `children.length > 1`", which in a *consistent* store means 0 children. But in the migrated old-suite routing chars (Task 8) the mock is deliberately inconsistent — `listLiveSessions` returns one child while `getSoleChild` returns `undefined` — so step 4 also catches that `length === 1` artifact and yields `sessionId: undefined`, which is exactly what Task 8 asserts (`(userId, undefined)`). Behaviour is correct; only the inline comment "(0 children)" undersells the branch. No code impact.

---

## Summary

All blocking and minor items from plan-review-1 are resolved in this revision, and an independent re-verification of every load-bearing claim — the `endActivity` reorder and its sole production caller, the two new engine accessors backed by existing store methods, the controller-internal idempotency store with 5-arg constructor preservation, the 0-vs->1 ambiguity detection via `listLiveSessions`, the revoke fan-out including root, and the per-user prefix eviction — holds against the live code and the committed contract. The two remaining notes (a missing `WsErrorCode` import and a cosmetic comment) are non-blocking and self-correcting. The plan is solid and ready to implement.

PLAN_REVIEW_PASS
