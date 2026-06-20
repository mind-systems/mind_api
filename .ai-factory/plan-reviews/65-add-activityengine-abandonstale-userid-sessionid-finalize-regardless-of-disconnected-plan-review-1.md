# Plan Review: `ActivityEngine.abandonStale(userId, sessionId)`

**Plan:** `65-add-activityengine-abandonstale-userid-sessionid-finalize-regardless-of-disconnected.md`
**Risk Level:** 🟢 Low — verified against current source; no blocking issues.

## Verification Against Codebase

All claims in the plan check out against the actual files:

- **`abandonActivity` finalizes only from `DISCONNECTED`** — confirmed (`activity-engine.service.ts:165`, guard `if (session.status !== SessionStatus.DISCONNECTED)`). The new method's broader `ACTIVE` **or** `DISCONNECTED` scope is the genuine differentiator and is correctly justified.
- **Imports already present** — `SessionStatus`, `StreamDataType`, `StreamSessionEvent`, `SessionEvents`, `Logger` are all imported (`activity-engine.service.ts:9-21`). No new imports required, as the plan states.
- **`SessionEvents.ABANDONED` handlers exist and flush + `buffers.delete`** — confirmed in `StreamEngine.onSessionAbandoned` (`stream-engine.service.ts:196`) and `BiometricStreamEngine.onSessionAbandoned` (`biometric-stream-engine.service.ts:216`). The cited line numbers are exact. The "route through emit, never bare `repo.save`" constraint is correct — buffers are only cleared by these handlers.
- **`streamEngine.push(sessionId, …)` signature** — matches existing call sites (`activity-engine.service.ts:174`). Using the `sessionId` argument (not store state) is correct for the DB-only case.
- **Repository API** — `repo.findOne({ where: { id } })` and `repo.save(session)` match existing usage exactly.
- **Test helpers** — `makeRepo`/`makeEmitter`/`makeStreamEngine`/`makeActivitySessionStore`/`makeSession` all exist in the spec (`activity-engine.service.spec.ts:9-46`), and the existing `abandonActivity` describe block (`:162-211`) is a faithful template for the new tests.
- **No migration needed** — correct. The method only mutates `status`/`endedAt` on existing rows; no schema change.

## Observations (non-blocking)

1. **`SessionStatus.RESUMED` falls through to the abandon branch.** The enum has a sixth value, `RESUMED` (`session-status.enum.ts:7`), not covered by the already-finalized guard (`COMPLETED`/`INTERRUPTED`/`ABANDONED`). A grep confirms `SessionStatus.RESUMED` is **never assigned** anywhere in `src/` — it is effectively a dead value, so in practice the only reachable live states are `ACTIVE`/`DISCONNECTED`. The plan's "otherwise" branch is therefore safe today. No change required; flagging only so the implementer doesn't treat `RESUMED` as a real live state to preserve.

2. **Narrow double-fire race remains (acceptable).** The plan's already-finalized guard makes a *sequential* double-fire with the grace timer safe. A truly concurrent fire (watchdog + `abandonActivity` both read `DISCONNECTED` before either saves) could still emit `ABANDONED` twice. This is harmless: the handlers are idempotent (second `flush` runs on an already-emptied buffer, `buffers.delete` is a no-op), and both writes set the same terminal status. Worth no code change for this building-block milestone, but the implementer should not assume the guard provides full mutual exclusion.

3. **`userId` argument vs `session.userId`.** The method emits with the passed `userId` and deletes the store entry keyed by it. For the watchdog's DB-only path these must be the row's owner; the sweep is responsible for passing the correct `userId`. The plan implicitly assumes this — fine, since the emit payload consumers only read `sessionId`, and the store delete is a harmless no-op on mismatch.

## Completeness

- Three required test branches (stale `ACTIVE`, already-`COMPLETED` no-op, DB-only row) are all specified with concrete mock setups and assertions — matches the milestone's "unit tests for the three branches" requirement.
- Logging is minimal and mirrors `abandonActivity` (`durationMs` included), consistent with the per-class `Logger` convention in `mind_api/CLAUDE.md`.
- File paths are correct and the insertion point (next to `abandonActivity`, ~line 195) is accurate.

## Conclusion

The plan is accurate, internally consistent, and correctly grounded in the current code. File paths, API usage, event wiring, and line references all verify. No missing steps, no wrong assumptions, no missing migration, no security concerns. The observations above are advisory only.

PLAN_REVIEW_PASS
