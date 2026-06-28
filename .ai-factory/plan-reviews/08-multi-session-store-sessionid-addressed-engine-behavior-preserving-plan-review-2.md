# Plan Review #2 — 08 Multi-session store + sessionId-addressed engine (behavior-preserving)

**Plan:** `.ai-factory/plans/08-multi-session-store-sessionid-addressed-engine-behavior-preserving.md`
**Verdict:** 🟢 **Low risk — APPROVED.** Every Critical and Major finding from review #1 is resolved, and each resolution was re-verified against the actual committed specs and source. The plan can satisfy its own `Verify` section as written.

---

## Summary

This is a full rewrite of the plan that previously failed review #1 (verdict: High risk, C1–C5 blocking). The new version is built around the correct forcing rule — **every new `sessionId` parameter is optional and appended so it never displaces an existing positional arg** — and it explicitly enumerates all four committed spec files as the contract. I re-derived each frozen call shape from source and traced the GREEN characterization flows through the proposed engine logic; they hold.

## Files Reviewed

- `activity-session-store.service.ts` (target) + `activity-session-store.service.spec.ts` (frozen)
- `activity-engine.service.ts` (target) + `activity-engine.service.spec.ts` (frozen)
- `module-state.grpc.controller.ts` (caller) + `module-state.grpc.controller.spec.ts` (frozen)
- `multi-session-lifecycle.spec.ts` (characterization + target blocks)
- `session-watchdog.service.ts`, `observability.service.ts` (callers)

---

## Context Gates

- **ARCHITECTURE.md / RULES.md / ROADMAP.md** (`mind_api/.ai-factory/`): all present. The one prior boundary concern (controller reaching into `ActivitySessionStore` to fan out revokes) is explicitly **deferred** to phase `06-state-controller-concurrent-idempotency` (plan §25, Task 5). No new boundary violation. `OK`.
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): absent — no project-specific review overrides to apply. `WARN` (optional file missing; non-blocking).
- **Migrations**: none required. `rootSessionId` column + `root` enum value already landed in phase 07; the plan correctly keeps `rootSessionId` null and creates no roots. `OK`.
- **Roadmap linkage**: this is a behavior-preserving refactor inside the multi-session milestone chain; correctly scoped as internal, no new roadmap entry needed. `OK`.

---

## Verification of review #1 findings (all resolved)

- **C1 (userId-keyed grace trio)** — Plan §24 + Task 1 keep `startGraceTimer`/`cancelGraceTimer`/`hasPendingGraceTimer` unchanged and *add* the `…ForSession` family over the same `timers` map. Confirmed the store spec drives the userId trio (`store.startGraceTimer('user-1', cb)` at `:44/:56`, `hasPendingGraceTimer` at `:168/:181`). ✅
- **C2 (`onDisconnect` optional + guard)** — Plan Task 3 keeps `onDisconnect(userId, sessionId?)` optional with sole-child resolution and an early-return guard. Confirmed the engine spec calls single-arg `onDisconnect('user-1')` (`:300`, `:315`) and asserts `repo.update` NOT called with no session (`:317`) and store-entry survives (`:310`). ✅
- **C3 (`endActivity` arg order)** — Plan §22 + Task 2 append `sessionId` **last**: `endActivity(userId, clientTimestampMs?, sessionId?)`. Confirmed against the controller assertion `toHaveBeenCalledWith('user-1', undefined)` (`:783`) and the `multi-session-lifecycle` Long-branch characterization `h.end('user-1', longLike)` expecting `endedAt = new Date(clientEndMs)` (`:536–553`). The 2nd positional stays the timestamp. ✅
- **C4 (controller call sites)** — Plan Task 5 leaves all controller call sites unchanged. Confirmed source: `endActivity(userId, clientTimestampMs)` (`:327`), `stopActivity(userId)` (`:345`/`:203`), `pauseActivity(userId)` (`:363`), `unpauseActivity(userId)` (`:388`), `getActiveSession(...)` (`:201`/`:281`). All match the frozen single-arg / two-arg assertions. ✅
- **C5 (revoke fan-out)** — Deferred. `handleSessionRevoked` keeps `stopActivity(payload.userId)`, matching `:569`. The controller has no store injected (verified — constructor lacks `ActivitySessionStore`), so the fan-out genuinely cannot live here. ✅
- **M1 (zero-edit precision)** — The new plan's "zero edits" is now *correct* rather than impossible: because the params are append-only-optional, the `makeHelpers` wrapper bodies (`engine.endActivity(userId, clientTimestampMs)` at `:108–109`, etc.) keep compiling and keep binding the timestamp to the right slot with **no body change**. Review #1's claim that helper bodies "must change" was predicated on the broken 2nd-positional insertion; with append-only it no longer applies. ✅
- **M2 (`size` + pruning)** — Plan §63 + Task 1 specify that `delete`/`removeChild` prune the empty user bucket and `size = activityMap.size`. Confirmed the size spec: set user-1/user-2 → 2, delete user-1 → 1 (`:210–214`), overwrite stays 1 (`:203–207`). Also confirmed `delete()` must NOT cancel the userId-keyed timer (`:162–172`) — the plan's `delete` shim touches only `children`, never `timers`, so this stays GREEN. ✅
- **M3 (`removeRoot`)** — Added to the store method list (Task 1) with prune-on-empty semantics. ✅
- **N1 (reconnect gate)** — Plan Task 3 gates on `getRootId(userId) || listChildren(userId).length > 0`, not legacy `has()`. ✅
- **N2 (watchdog)** — Confirmed `session-watchdog.service.ts:82` already passes the explicit `sessionId` (`abandonStale(row.userId, row.id)`); no change needed. ✅

---

## Independent trace of the GREEN flows (spot-check)

- **target — "transport disconnect moves EVERY live session"** (`:583`): seeds `setRoot` + 2 `addChild`. `handleTransportDisconnect` id-list = `[getRootId, ...listChildren]` = `[session-root, session-A, session-B]`; each `onDisconnect(userId, sid)` resolves via `getSession` (root resolves through the `getRootId === sid` branch) and `repo.update` fires for all three; each gets `startGraceTimerForSession`. Matches all six assertions. ✅
- **characterization — "disconnect→grace→abandon"** (`:347`): `store.set` → single child; id-list `[session-1]`; grace callback `abandonActivity('user-1', 'session-1')`; terminal `removeChild` prunes bucket → `store.has` false. ✅
- **characterization — "abandon no-ops when already ACTIVE"** (`:487`): single-arg `abandonActivity('user-1')` resolves sole child, status-guard short-circuits, `removeChild` clears, no save/emit. ✅
- **No external consumer breaks**: only `observability.service.ts:17` reads `.size` (as the "active sessions" gauge); per-user bucket count is behavior-identical in single-session practice. ✅

---

## Minor Notes (non-blocking, no action required this phase)

- **`getSoleChild` with >1 child is undefined behavior.** In the `target — reconnect resumes EVERY session` test two children coexist, and `handleReconnect`'s "return the resumed sole-child result if present" would call `getSoleChild` against a 2-child bucket. The test does not assert the return value, and this phase has exactly one live child in practice, so it is harmless now. Worth pinning a deterministic rule (first child / throw / undefined) when the concurrent phase lands. Suggest the implementer make `getSoleChild` return `undefined` when `children.size !== 1` to fail loud later rather than silently pick one.
- **abandonActivity has three `store.delete(userId)` sites** (no-DB-row, already-resumed guard, terminal). Task 2's "terminal states clear via `removeChild`/`removeRoot`" covers the intent, and the `Verify` line "no `store.get(userId)`-as-singleton resolution remains" backstops it, but the implementer must convert *all three* sites, not just the terminal one. Calling this out so it is not missed.

Neither note affects any committed assertion or the build.

---

## Conclusion

The plan is implementable exactly as written, makes zero test-file edits, keeps the build green, flips the intended `multi-session-lifecycle` target blocks GREEN while leaving the `ensureRoot / linking` block RED, and respects the thin-controller boundary. No blocking issues.

PLAN_REVIEW_PASS
