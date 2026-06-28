# Code Review — 08 Multi-session store + sessionId-addressed engine (behavior-preserving)

**Scope reviewed:** `git diff HEAD` — two production files changed:
- `src/realtime/services/activity-session-store.service.ts` (full rewrite of the store shape)
- `src/realtime/services/activity-engine.service.ts` (sessionId threading + fan-out)

The controller (`module-state.grpc.controller.ts`) and watchdog (`session-watchdog.service.ts`) are **unchanged**, as the corrected plan requires (revoke fan-out deferred to Phase 56). Plan doc + roadmap + plan-review files also changed but are not code.

**Verdict:** ✅ No correctness, security, or behavior-preservation defects found. The implementation faithfully matches the corrected plan, and the failing tests are exactly the ones the plan declares must stay RED for future phases.

---

## What I verified

### Build
- `npm run build` (nest build / tsconfig.build.json) — **clean, exit 0**. The 3 `tsc --noEmit` errors against the full `tsconfig.json` are all inside `biometric-stream-engine.service.spec.ts` (a pre-existing spec-file type-cast issue, identical count on the base commit `HEAD`) and are excluded from the production build. Not introduced by this diff.

### Test suite (the committed contract)
- `activity-session-store.service.spec.ts` — **GREEN** (userId-keyed grace trio, `set/get/has/delete`, `size` all intact).
- `activity-engine.service.spec.ts` — **GREEN** (single-arg `onDisconnect`, no-op-when-no-session, store-entry-survives, `endActivity` timestamp ordering, `handleReconnect` (a)-(e), `abandonActivity`, `abandonStale` (a)-(d), `resumeActivity`, `getActiveSession`).
- `module-state.grpc.controller.spec.ts` — **63/63 GREEN** (frozen call shapes `endActivity('user-1', undefined)`, `stopActivity('user-1')`, `pauseActivity('user-1')`, revoke single-arg all preserved). The `Error: unexpected` lines in the log are `logger.error` output from error-path tests that **pass**, not failures.
- `multi-session-lifecycle.spec.ts` — characterization **GREEN**, `target — multi-session store` and `target — engine multi-session` **flipped GREEN**, and the `target — ensureRoot / linking` block correctly **still RED** (2 tests — that is the next phase, lazy-root-creation / spec 04; the plan explicitly forbids implementing it here).

### Did this diff introduce any new failures? No.
Stashed the two source files and re-ran on the base commit: the bio controller spec was **already** `4 failed` and the bio-engine spec tsc errors were **already** present. The 4 bio failures are all labelled `[RED until spec 10-bio-ingest-to-root]` (Phase 58) and reference `getRoot`/`ensureRoot`/`NO_ROOT_SESSION` — features not in this milestone. With the diff applied, the bio suite actually gains 7 passing tests (the new `getRoot`/`getRootId` store methods let previously-broken setup run) while the 4 future-phase tests stay RED. Net: **zero regressions; only intended-RED future-phase tests fail.**

### Behavior-preservation spot checks (logic, not just tests)
- **Iteration safety:** `handleTransportDisconnect` and `handleReconnect` capture the session-id list *before* the loop, so the in-loop store mutations (`removeChild`/`removeRoot` via `resumeActivity`/`abandonActivity`) cannot corrupt iteration. ✔
- **`removeSessionFromStore`** correctly branches root-vs-child on `getRootId`; idempotent (removeChild returns false if absent), so the `stopActivity` not-found path + `finally` cannot double-fault. ✔
- **`getSession`** is the right resolver for the fan-out paths: `onDisconnect`/`resumeActivity` of a seeded root resolve via the root slot (plain `getChild` would have missed it and skipped the root's DB update — the implementer got this right, and the disconnect/reconnect target tests prove it). ✔
- **Empty-bucket pruning** (`pruneIfEmpty`) keeps `size` semantics correct so the store-spec `size` cases pass. ✔
- All event emits, stream pushes, status transitions, and the `abandonActivity` "already ACTIVE → skip" guard are preserved verbatim. ✔

---

## Non-blocking observations (informational — no change required this phase)

1. **The userId-keyed grace trio is now dead code in production.** No production caller uses `startGraceTimer`/`cancelGraceTimer`/`hasPendingGraceTimer` anymore (the engine uses only the `…ForSession` variants; confirmed by grep across `src/`). They are retained solely to keep `activity-session-store.service.spec.ts` green — which the plan explicitly chose. Acceptable; when that spec is rewritten in a later phase, this trio can be deleted. Because they share the one `timers` map with the `…ForSession` family but are never invoked in production, there is no key-collision risk in practice.

2. **Forward-compat note for the next phase (lazy-root-creation / spec 04):** `onDisconnect` and the disconnect fan-out require the root's in-memory `ActivityState` to be present (`getSession` → root slot) for the root's DB row to be marked `DISCONNECTED`. `setRoot(userId, sessionId)` called *without* a `state` argument would leave `getRoot` undefined and silently skip the root's transition. The Phase-55 contract tests always pass a root state, so this is correct now; the lazy-root-creation implementer must pass the root `ActivityState` to `setRoot`.

3. **Minor cosmetic:** `endActivity` emits two identical `"no active session in memory"` warn logs (one for `!sid`, one for `!state`). Harmless; the `!state` branch is only reachable via an explicit unknown `sessionId`, which no current caller passes.

None of these affect correctness, security, or behavior preservation for this milestone.

REVIEW_PASS
