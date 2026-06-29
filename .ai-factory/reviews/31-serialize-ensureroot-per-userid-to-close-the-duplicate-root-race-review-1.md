# Code Review: Serialize `ensureRoot` per userId to close the duplicate-root race

**Plan:** `31-serialize-ensureroot-per-userid-to-close-the-duplicate-root-race.md`
**Files reviewed:** `src/realtime/services/activity-engine.service.ts`, `src/realtime/services/activity-engine.service.spec.ts`

## Summary

The change adds a per-`userId` in-flight promise map (`ensureRootInFlight`) that serializes the
store-check → `repo.create`/`save` → `setRoot` critical section, closing the check-then-create
TOCTOU. The implementation matches the plan and the spec note exactly. Two new tests cover the
concurrent-create race (target) and the existing-root fast path (characterization). Full test run
(`activity-engine.service.spec.ts` + `multi-session-lifecycle.spec.ts`): **46 passed**.

## Correctness Verification

- **Lock is registered before any yield.** `ensureRootInFlight.set(userId, p)` (`:153`) runs
  synchronously after the IIFE `p` is constructed and before `await p` (`:155`). The IIFE itself
  runs synchronously up to its first `await this.repo.save(...)` (`:135`), so `repo.create` is the
  only synchronous side effect prior to the `set`. A second concurrent `ensureRoot('u')` therefore
  deterministically observes the in-flight promise at `:111-112` and joins it — verified by the
  passing `Promise.all` target test, which asserts `repo.create`/`repo.save` called exactly once.
- **Map cleanup is leak-free and poison-free.** `try { return await p } finally { delete }`
  (`:154-158`) clears the entry on both resolve and reject, so a failed `save` does not block a
  subsequent retry and no entry leaks.
- **`reconstructRoot` honors RULES.md.** The prior non-null assertion (`getRootId(userId)!`) is
  replaced with an explicit `if (!rootId) return null` guard (`:78-79`). Both call sites
  (`:104-107` fast path, `:119-123` re-check) correctly treat `null` as "fall through to create",
  never returning a synthesized object with a missing id.
- **Re-check inside the critical section** (`:119-123`) covers the (currently unreachable, since
  only one caller enters the section at a time per userId) case where a root appeared between the
  fast-path miss and section entry — harmless and defensive.
- **Field parity preserved.** The `repo.create` payload (`:126-134`) and `setRoot` payload
  (`:137-144`) are byte-for-byte the pre-change values, including `startedAt: coerceClientTs(...) ?? now`,
  `lastActivityAt: now`, and `rootSessionId: null`. The existing `Root session created` log line is
  preserved; no new logs added.
- **No DB/migration impact.** In-process lock only; no unique index added, janitor untouched —
  consistent with the roadmap scope (multiple roots per user over time remain legitimate).

## Test Verification

- **Target test** asserts call counts (`repo.create`/`repo.save` once) as the primary RED→GREEN
  discriminator, with id-equality as a documented secondary check — exactly as the plan specifies
  after plan-review Finding 3.
- **Characterization test** seeds via the real store's `setRoot('u', 'existing-root', state)` so
  both `getRoot` and `getRootId` stay consistent (plan-review Finding 2), then asserts zero
  `repo.create`/`repo.save` and the returned id — fast path unchanged.
- `beforeEach` reconstructs `repo`, the store, and the engine per test, so call-count assertions are
  not polluted across tests.
- Pre-existing `multi-session-lifecycle.spec.ts` root-reuse coverage stays green, confirming no
  regression to the idempotent fast path.

## Scope Note (not a defect)

The lock collapses only *simultaneous* creates within a single Node process; it does not serialize
across multiple API instances. This is the explicitly accepted design for the current
single-instance deployment. If the API is ever horizontally scaled, the duplicate-root race reopens
and would need a DB-level guard. No action required for this task.

REVIEW_PASS
