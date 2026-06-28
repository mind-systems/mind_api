# Plan Review: Janitor for childless root sessions

**Plan:** `.ai-factory/plans/13-janitor-for-childless-root-sessions.md`
**Target:** `mind_api`
**Risk Level:** 🟡 Medium

## Code Review Summary

**Files Reviewed:** 7 (plan target + committed test + entity + enum + config + migration + activity engine/store)
**Verdict:** The plan is mostly accurate and will turn the four `[RED]` spec cases green without perturbing the characterization/lifecycle cases. However, **Task 3 is built on an incorrect premise** — the prescribed call does not do what the plan says it does, and may leave a latent dangling-state bug. Address Task 3 before implementing.

### Context Gates
- **Architecture** (`.ai-factory/ARCHITECTURE.md`): not present at the path checked — WARN (optional file absent, no boundary check performed).
- **Rules** (`.ai-factory/RULES.md`): not present — WARN. Project conventions were instead checked against `mind_api/CLAUDE.md`: logging via NestJS `Logger` (the plan reuses `this.logger` ✓), `synchronize=false`/migration discipline (no schema change here, prerequisite migration `1782658936664-AddRootSessionLink` already landed ✓), thin-controller/module-ownership rules (`@InjectRepository(ModuleSession)` is used inside the owning realtime module ✓). No violations.
- **Roadmap** (`.ai-factory/ROADMAP.md`): not inspected for milestone linkage; this is a `feat`-shaped change (a new reaper). Recommend the implementer confirm the corresponding roadmap milestone is checked off — WARN (non-blocking).

### Verified assumptions (all correct)
- `RealtimeConfig.EMPTY_ROOT_TTL_MS` = `'WS_EMPTY_ROOT_TTL_MS'` exists at `constants/realtime-config.ts:14` and is currently orphaned. ✓
- `ActivityType.ROOT = 'root'` exists (`enums/activity-type.enum.ts:4`). ✓ `.toBe('root')` in the spec at line 428 holds because the enum member is the string literal `'root'`.
- Self-FK `rootSessionId` is nullable with `ON DELETE CASCADE` (`migrations/1782658936664-AddRootSessionLink.ts:10-11`); `bio_session_samples` (`1779990145496:13`) and `session_stream_samples` (`InitialSchema:293`) both cascade on `module_sessions` delete. So `repo.delete({ id })` correctly reaps carried bio/stream rows. ✓
- Imports: `In`, `LessThan` (line 8), `SessionStatus` (line 11), `RealtimeConfig` (line 14) are already present; `ActivityType` is NOT imported — the plan correctly calls for adding it. ✓
- `activeStreamRegistry.hasLiveSubscriber` / `closeAll` and `repo.count` / `repo.delete` exist and are mocked in the committed spec (`session-watchdog.service.spec.ts:51-69`). ✓
- The committed test contract is satisfied: per-row `repo.delete({ id })` (visible, not bulk QB), `repo.count({ where: { rootSessionId } })`, `repo.find` called exactly once per `sweepEmptyRoots()` (count uses `repo.count`, so the `toHaveBeenCalledTimes(1)` assertion at line 412 holds), live-subscriber skip before reap, and `sweep()` left byte-identical so the characterization + lifecycle specs stay green. ✓

---

### Critical Issues

**1. Task 3 — `closeAll()` does not clear `ActivitySessionStore`; the stated goal is not achieved.**

Task 3 instructs: after `repo.delete`, call `this.activeStreamRegistry.closeAll(row.userId)` *"so a deleted row is not still referenced by `store.getRoot(userId)`."* This reasoning is wrong:

- `ActiveStreamRegistry.closeAll()` (`active-stream-registry.service.ts:38-45`) only completes RxJS subscribers and deletes the user's entry from its own `streams` map. It **never touches `ActivitySessionStore`**.
- The only code that clears a root from the in-memory store is `ActivitySessionStore.removeRoot(userId)`, reached via `ActivityEngine.removeSessionFromStore()` (`activity-engine.service.ts:60-66`). The watchdog does **not** inject `ActivitySessionStore`, and the delete path calls neither it nor `abandonStale`.
- Worse, by the time the delete path runs, the live-subscriber guard (`!hasLiveSubscriber`) has already guaranteed the user has **zero** entries in `ActiveStreamRegistry`. So `closeAll(userId)` here is a **guaranteed no-op** (it returns early at `active-stream-registry.service.ts:39`). Task 3 as written accomplishes literally nothing.

Why this matters (latent bug, not caught by tests): if a lazy root is still resident in `ActivitySessionStore` (`getRoot(userId)` non-undefined) when the janitor deletes its DB row, the store now points at a non-existent `rootSessionId`. On the user's next connect, `materializeRoot` is documented as idempotent — *"if a root is already in the store, returns a synthesized ModuleSession with no DB access"* (`activity-engine.service.ts:68-72`). It would hand back the stale, deleted root id; a subsequently-created child referencing that `rootSessionId` would hit the `FK_module_sessions_rootSessionId` constraint. The committed root-reaping specs do **not** assert any store cleanup for roots, so this ships green while leaving the defect.

Recommended resolution (pick one, and fix the justification text either way):
- **If store cleanup is genuinely required:** inject `ActivitySessionStore` into `SessionWatchdogService` and call `removeRoot(row.userId)` after a successful delete (guarding that `getRootId(userId) === row.id` to avoid evicting a freshly-materialized root for a reconnected user). Note this **breaks the plan's "all changes confined to `session-watchdog.service.ts`" scope claim** (a new constructor dependency + provider availability check in the module). Verify `ActivitySessionStore` is exported/available to this service's module.
- **If store cleanup is NOT required** (e.g. because grace-expiry already evicts lazy roots via `removeSessionFromStore`/`removeRoot` long before the 10-min TTL — see `onDisconnect` at `:259-276` which defers eviction to the grace path): then **drop the `closeAll` call entirely** and delete Task 3, since it is a confirmed no-op with a false rationale. Confirm the grace path actually abandons childless roots before relying on this.

The implementer must determine which case holds (trace the transport-disconnect → grace-timer → abandon path for a childless root) rather than shipping the current no-op with a misleading comment.

### Minor Issues

**2. No early-return / empty-result guard in `sweepEmptyRoots()`.**
`sweep()` guards with `if (staleSessions.length === 0) return;` (`session-watchdog.service.ts:65-67`). The plan's `sweepEmptyRoots()` sketch jumps straight to "Loop per candidate" with no guard. In production `repo.find` always returns an array, so this is cosmetic — but note the lifecycle spec *"should invoke sweep when the interval callback fires"* (`spec.ts:491-509`) spies only `sweep` and lets `sweepEmptyRoots()` run for real against a default `repo.find` mock that resolves to `undefined`. Iterating `undefined` throws, but the throw is swallowed by the per-call `.catch(...)` in the interval callback, so the test still passes. Recommend adding the same `if (!staleRoots?.length) return;` guard for parity and defensiveness.

**3. TOCTOU between `count` and `delete` (acceptable, note only).**
A child could be created between `repo.count(...) === 0` and `repo.delete(...)`. In practice creating a child implies an active stream / `activity:start`, which the `hasLiveSubscriber` guard already excludes, so the window is negligible for a background janitor. No change required; just be aware the reap is not transactional.

### Positive Notes
- Correctly keeps `sweep()` byte-identical and adds a **separate** `sweepEmptyRoots()` rather than folding delete-vs-abandon semantics together — this is exactly what the characterization specs (P1/P2) pin.
- The mandatory `activityType: ROOT` query scope is called out with the right rationale (a disconnected practice child would otherwise read as "childless" via `count({ rootSessionId: child.id }) === 0` and cascade-delete a real session + bio). Matches spec P6 at `spec.ts:422-428`.
- Reaping via per-row `repo.delete({ id })` (not a bulk QueryBuilder delete) matches the mock-visibility contract (P3) and lets the cascade do the bio/stream cleanup.
- Scheduling both sweeps in the **same** `setInterval` callback with independent `.catch` handlers preserves the lifecycle assertions (`toHaveBeenCalledTimes(1)`, interval `60_000`, `sweep` spy fired once).
- The `600_000` default and config-read pattern correctly mirror the `SESSION_MAX_IDLE_MS` precedent; the spec injects `WS_EMPTY_ROOT_TTL_MS = 300_000` and the threshold math lines up (`spec.ts:418`).

---

**Action required:** Resolve Critical Issue #1 (Task 3) before implementation — decide whether store cleanup is needed, and either wire `ActivitySessionStore.removeRoot` (updating the scope claim) or remove the no-op `closeAll` and its false justification. Minor #2 is a recommended robustness add.
