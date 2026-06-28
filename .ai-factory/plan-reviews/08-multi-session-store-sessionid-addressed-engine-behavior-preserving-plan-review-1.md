# Plan Review — 08 Multi-session store + sessionId-addressed engine (behavior-preserving)

**Plan:** `.ai-factory/plans/08-multi-session-store-sessionid-addressed-engine-behavior-preserving.md`
**Verdict:** 🔴 **High risk — do NOT implement as written.** The plan will fail its own `Verify` section (`npm run build` + `npm test`) because it changes method signatures and call shapes that are frozen by **committed specs the plan never accounts for**.

---

## Summary

The plan's stated contract is "behavior-preserving, **make zero test edits**, all listed spec blocks stay GREEN." That goal is sound, but the concrete instructions in Tasks 1–5 contradict it. The plan only treats two spec files as "the contract" (`multi-session-lifecycle.spec.ts`, `activity-session-store.service.spec.ts`) and **completely omits two more committed specs that directly exercise the exact methods being changed**:

- `src/realtime/services/activity-engine.service.spec.ts`
- `src/realtime/module-state.grpc.controller.spec.ts`

Both assert **exact call signatures and argument shapes** (single-arg `onDisconnect`, `stopActivity('user-1')`, `endActivity('user-1', undefined)`, etc.). Several Task 1/3/5 instructions break them at compile time or assertion time.

There is also an internal contradiction: the plan says "Make zero test edits," but the committed `multi-session-lifecycle.spec.ts` **documents in its own header that the helper wrappers (`makeHelpers`) are the designated Phase-55 change point** ("only these helper bodies change … compile-checked"). So *some* test edits (the helper bodies) are not just allowed but required, while other specs that call directly must NOT break.

---

## Context Gates

- **ARCHITECTURE.md / RULES.md / ROADMAP.md (`.ai-factory/`)**: present at repo root; no per-rule violation specific to this refactor beyond the module-boundary concern noted in Critical #5 (controller reaching into store state). `WARN`.
- **Migrations**: none required — `rootSessionId` column + `root` enum value already landed (commit `2a052d8`). Plan correctly avoids a migration. `OK`.

---

## Critical Issues (blocking)

### C1 — Removing the userId-keyed grace trio breaks `activity-session-store.service.spec.ts` (82 references)
Task 1 says: *"**Remove** `startGraceTimer`/`cancelGraceTimer`/`hasPendingGraceTimer` (userId-keyed)."*

But `src/realtime/services/activity-session-store.service.spec.ts` is a **committed test with 82 references** to exactly these three methods (constructor tests, Phases 6–12). Removing them makes that spec file fail to compile — the whole suite goes red.

This **directly contradicts the plan's own Verify line**: *"`activity-session-store.service.spec.ts` stays GREEN."* You cannot both remove the methods and keep the spec green with zero edits.

**Fix:** Keep the userId-keyed trio as-is (let it coexist with the new `…ForSession` methods over the same `timers` map). Move only the *engine callers* onto the `…ForSession` variants. Do not delete the trio.

### C2 — `onDisconnect` made `sessionId`-required breaks `activity-engine.service.spec.ts`
Task 3 says: *"`onDisconnect(userId, sessionId)` — `sessionId` now **required**; … No timer logic here"* and drops the no-session guard (unconditional `repo.update`).

The committed `activity-engine.service.spec.ts` has a dedicated `describe('onDisconnect')`:
- Line 300/315: `await engine.onDisconnect('user-1')` — **single arg** → with a required 2nd param this is a TS compile error.
- Line 314–318: `'no-op when no active session'` asserts `repo.update` is **NOT** called when there is no stored session. The plan's new unconditional `repo.update(sessionId, …)` would call it → assertion fails.
- Line 291–312: `'kept in store, no emit'` calls single-arg `onDisconnect` and expects the store entry to survive.

The plan never lists this spec and never reconciles it.

**Fix:** Keep `onDisconnect(userId, sessionId?)` with `sessionId` **optional**, resolve sole-child when omitted, and **keep the early-return guard** when nothing resolves. `handleTransportDisconnect` passes the explicit `sessionId` per session and owns the timer.

### C3 — Inserting `sessionId` as the **2nd positional** arg breaks `endActivity`'s timestamp contract
GAP-03-B and Task 2 define `endActivity(userId, sessionId?, clientTimestampMs?)` — sessionId inserted **before** the existing `clientTimestampMs`.

`endActivity` already has `clientTimestampMs` as its 2nd positional arg, and multiple frozen call sites depend on that position:
- `module-state.grpc.controller.spec.ts:783` asserts `endActivity` was called with **`('user-1', undefined)`** (userId, clientTimestampMs).
- `multi-session-lifecycle.spec.ts:108` helper forwards `engine.endActivity(userId, clientTimestampMs)`, and the characterization test `'coerceClientTs Long branch on endActivity'` (line 536–553) calls `h.end('user-1', longLike)` expecting the Long to become `endedAt`.

If `sessionId` is inserted as the 2nd param, the timestamp lands in the `sessionId` slot → `endedAt` falls back to server-now → **characterization assertion fails** (a Class-B silent regression by the plan's own definition), and the controller-spec assertion mismatches.

**Fix:** For `endActivity` specifically, append `sessionId` **last** (`endActivity(userId, clientTimestampMs?, sessionId?)`) or resolve it purely internally. The "optional 2nd positional" rule is only safe for `stop/pause/unpause/resume/abandon`, which have no other positional arg.

### C4 — Threading `sessionId` through the controller (Task 5) breaks `module-state.grpc.controller.spec.ts`
The controller spec freezes the **exact** engine call shapes:
- `:835` `expect(stopActivity).toHaveBeenCalledWith('user-1')` — single arg.
- `:891` `expect(pauseActivity).toHaveBeenCalledWith('user-1')` — single arg.
- `:783` `expect(endActivity).toHaveBeenCalledWith('user-1', undefined)`.
- `:569` `handleSessionRevoked` → `expect(stopActivity).toHaveBeenCalledWith('user-1')` — single arg.

Task 5 rewrites these call sites to pass a resolved `sessionId` (e.g. `endActivity(userId, sessionId, clientTimestampMs)`, `stopActivity(userId, sessionId)`). Every one of those assertions then mismatches (extra/extra-position arg), so the controller suite goes red. Jest's `toHaveBeenCalledWith('user-1')` does **not** ignore a trailing `undefined` 2nd arg.

**Fix:** Leave the controller call sites **unchanged**. The whole point of optional-internal sole-child resolution (GAP-03-B) is that callers don't pass `sessionId` yet. Task 5's controller rewrite is unnecessary for this phase and actively breaks the frozen spec.

### C5 — Revoke fan-out (Task 5) is architecturally unimplementable as specified, and breaks the frozen revoke spec
Task 5 wants `handleSessionRevoked` to loop over `[getRootId(), ...listChildren()]` and call `stopActivity(userId, sessionId)` per session. Two problems:

1. **No store access in the controller.** `ModuleStateGrpcController` is injected with `activityEngine`, `rateLimiterService`, `activeStreamRegistry`, `configService`, `eventEmitter` — **not** `ActivitySessionStore`. `getRootId`/`listChildren` are store methods. The controller cannot enumerate root+children. Implementing this would require either injecting the store into the controller (violates the thin-controller / module-boundary convention in `CLAUDE.md`) or adding a new engine fan-out method — neither is in the plan.
2. **The frozen spec forbids it anyway.** `:569` asserts revoke calls `stopActivity('user-1')` exactly once with a single arg. A per-session loop cannot satisfy that.

**Fix:** Defer the revoke fan-out to a later phase (when the controller spec is updated and an engine-level `stopAllForUser`-style method exists). For this behavior-preserving phase, keep `handleSessionRevoked` calling `stopActivity(payload.userId)` unchanged.

---

## Major Issues

### M1 — "Make zero test edits" is wrong and contradicts the committed test contract
`multi-session-lifecycle.spec.ts` (lines 90–119) explicitly states the `makeHelpers` wrapper bodies are *"the single point Phase 55 will update … mechanical, loud, compile-checked."* Once engine signatures gain `sessionId`, those helper bodies (`end`, `disconnect`, `reconnect`, etc.) **must** be updated to keep compiling and to keep the timestamp landing in the right slot (see C3). The correct rule is: **zero edits to assertions/characterization expectations; helper wrapper bodies in `multi-session-lifecycle.spec.ts` may/ must change.** The plan should state this precisely instead of the blanket "zero test edits," which is both impossible (helpers) and falsely permissive (it implies the engine/controller specs can be left to break).

### M2 — `size` getter + legacy `delete`/`removeChild` pruning is unspecified and will fail size tests
`activity-session-store.service.spec.ts` Phase 5 asserts `size` decrements by 1 after `delete()` removes a user's sole child (e.g. set user-1, set user-2, delete user-1 → `size === 1`). With `activityMap` re-keyed to `Map<userId, UserSessions>` and `get size` "unchanged" (= `activityMap.size`), removing the *child* must also **prune the empty `UserSessions` entry** for that user, or `size` stays 2. The plan does not state that `removeChild`/legacy `delete` prunes empty user buckets, nor what `size` counts now. Specify: `delete`/`removeChild` remove the user's map entry when no root and no children remain; define `size` (users-with-state vs total sessions) so Phase 5 stays green.

### M3 — No store method to clear/remove a root, yet Task 4 requires root cleanup
Task 4 says a stale **root** must be cleaned "via the root slot, not `removeChild`." But the store method list (setRoot/getRoot/getRootId/addChild/getChild/listChildren/removeChild/getSoleChild) has **no `removeRoot`/`clearRoot`**. `abandonStale` cannot evict a stale root from the store. Add a root-clearing method (or define `setRoot(userId, null)` semantics) even if the root branch is dormant this phase.

---

## Minor Issues

- **N1 — `handleReconnect` gating.** Task 3 should gate the resume-fan-out on `(getRootId(userId) || listChildren(userId).length > 0)` rather than the legacy `has()` (which is "≥1 child" and would skip a root-only user). Harmless this phase (no roots created, target test has children), but worth pinning so it's correct when lazy-root-creation lands.
- **N2 — Watchdog (Task 5).** Correctly identified as no-change: `session-watchdog.service.ts:82` already calls `abandonStale(row.userId, row.id)` with the sessionId. Good. The `abandonStale` engine spec cases (a)–(d) remain compatible with the `getChild`/`removeChild` rewrite, assuming M2's pruning is handled.
- **N3 — `ActivityState.rootSessionId`** already exists on the interface (`activity-state.interface.ts:7`), so threading it later needs no interface change. Plan correctly leaves the `ensureRoot / linking` block RED.

---

## What a corrected plan looks like (for the implementer)

1. **Store:** add the new multi-session shape + `…ForSession` grace methods, **keep** the userId-keyed grace trio (C1), specify empty-bucket pruning + `size` semantics (M2), add a root-clear method (M3). Legacy `set/get/has/delete` become sole-child shims over children only.
2. **Engine:** append `sessionId` as an **optional** param, placed so existing positional calls keep binding — **last** for `endActivity` (C3), 2nd for the no-other-arg methods. Keep `onDisconnect(userId, sessionId?)` optional with sole-child resolution + early-return guard (C2). Do the disconnect/reconnect fan-out internally via `…ForSession` + iterate root+children.
3. **Controller:** **leave call sites unchanged** (C4); **defer** the revoke fan-out (C5).
4. **Tests:** edit only the `makeHelpers` wrapper bodies in `multi-session-lifecycle.spec.ts` (M1); make zero assertion edits; leave `activity-engine.service.spec.ts`, `activity-session-store.service.spec.ts`, and `module-state.grpc.controller.spec.ts` untouched **and** green.

---

Because Critical issues C1–C5 each cause the committed test suite or the build to fail, the plan as written cannot satisfy its own `Verify` section and must be revised before implementation.
