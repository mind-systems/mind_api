# Code Review — Tests: connection-loss markers + accurate abandon timestamp

**Scope reviewed:** `git diff HEAD` / `git status`
**Date:** 2026-06-29

## Changed files
- `src/realtime/services/activity-engine.service.spec.ts` — **only code change** (+342 lines, appended `describe('connection-loss', …)`)
- `.ai-factory/ROADMAP.md` — task marked `[x]` (plus incidental stripping of a few date tags on neighbouring lines; doc-only, harmless)
- `.ai-factory/plans/…` + `.ai-factory/plan-reviews/…` — artifacts, not code

Confirmed **no production source** changed (`git diff HEAD --name-only -- 'src/**/*.ts' ':!*.spec.ts'` → empty). This matches the milestone contract: test-only, no proto, no migration, no DI/ctor change. So there is no runtime/migration/type-mismatch surface to break.

## Verification performed
Ran the spec:

```
Tests: 3 failed, 36 passed, 39 total
```

This is the **intended** RED/GREEN split, and each RED fails for the correct reason (the feature, not a test bug):

| Target test | Failure | Correct reason? |
|---|---|---|
| spam guard (`disconnected` ×1 on root) | received length 0 | ✓ `handleTransportDisconnect` emits no marker today |
| `reconnected` ×1 on root | received length 0 | ✓ `handleReconnect` emits no marker today |
| `abandonActivity` `endedAt = disconnectedAt` | got `now` (`…31Z`) vs expected `…01Z` (−30s) | ✓ current code sets `endedAt = now` |

All 36 characterization + pre-existing cases stay GREEN.

## Correctness assessment

- **RED-now / GREEN-after both validated.** Assertions match note 23's contract precisely: one `'disconnected'`/`'reconnected'` push keyed to `rootId` with `dataType: SESSION_EVENT`, and `endedAt === disconnectedAt`. When note 23 emits once-on-root and sets `endedAt = disconnectedAt ?? now`, these flip GREEN with no test edit.
- **Literal event strings used** (`'disconnected'`/`'reconnected'`), not the not-yet-existing `StreamSessionEvent.DISCONNECTED`/`RECONNECTED` enum members — so the file compiles today (confirmed: ts-jest compiled and ran). Good.
- **Spam-guard is genuinely load-bearing:** seeds root + 2 children, filters `push.mock.calls` by event, asserts `toHaveLength(1)` **and** `calls[0][0] === rootId`. A per-child regression would fail it.
- **Reconnect test exercises the right branch:** store is seeded so `handleReconnect` takes the `sessionIds.length > 0` path (where the root reconnect marker would emit), not the `clientSessionId` abandoned-confirmation branch.
- **Characterization tests are robust against note 23.** The grace-timer characterization checks only `repo.update` calls + `hasPendingGraceTimerForSession`; adding a marker push doesn't perturb it. The marker characterizations assert only the existing push events. The `abandonStale` `now`-fallback case uses a `disconnectedAt: null` row and stays on the `now` branch — untouched by note 23.
- **Timer hygiene is correct.** `jest.useFakeTimers()` in the `describe`-level `beforeEach`, `clearAllTimers()` + `useRealTimers()` in `afterEach`, plus explicit `cancelGraceTimerForSession` after each `handleTransportDisconnect`. Modern fake timers don't fake microtasks, so the `await`ed mock promises resolve normally (proven by the 36 passes). No dangling 30 s handles, no expiry firing `abandonActivity` mid-test.
- **Store seeding mirrors production shape.** `seedMultiSession` sets `rootSessionId: null` on the root and `rootSessionId: rootId` on children, matching how `ensureRoot`/`startActivity` populate state. Fresh store per test (outer `beforeEach` runs before the inner one).

No bugs, no security issues, no race conditions, no false-GREEN risk found in the test logic.

## Informational notes (non-blocking, no action required)

1. **The suite is intentionally RED (3 failures) until spec 23 lands.** This is the documented committed-RED TDD pattern (same as the already-merged "immediate marker persistence" task) and is stated explicitly in the plan. Whoever runs `npm test` / CI must expect these 3 failures; they are not a defect. *No change requested.*

2. **ESLint reports 10 errors in the new code** (`no-unsafe-member-access` / `no-unsafe-assignment` from `push.mock.calls[...]` / `repo.save.mock.calls[...]` indexing). This is **not a regression and not a gate**: the comparable `multi-session-lifecycle.spec.ts` already carries 52 errors of the identical kind, and `no-explicit-any` is disabled in `eslint.config.mjs`, so lint is clearly not build-blocking in this repo. Some specs (e.g. `changelog.service.spec.ts`) avoid these via casts like `mock.calls[0] as [string, ...unknown[]]`; applying the same cast to the two `.mock.calls` filters here would silence them, but it is a purely cosmetic consistency choice. *Optional.*

REVIEW_PASS
