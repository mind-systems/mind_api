# Test plan — root reaping + deleteRun orphan cleanup (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature tasks [[08-janitor-empty-roots]] + [[15-deleterun-orphan-root-cleanup]].

## Test authoring constraints (the four lessons)
- **L1 — observe the outcome at a layer the unit test can actually see (two-state check).** Assert the OUTCOME of the reap predicate — did `abandonStale`/root-delete run for THIS root or not — not the SQL/predicate expression. **But that outcome is only observable if the feature reaps and counts through mock-visible calls** (`moduleSessionRepo.delete({ id })` per root, childless-ness via `moduleSessionRepo.count({ where: { rootSessionId } })` returning a stubbed number). If spec 08 instead reaps via a single bulk `createQueryBuilder().delete().where(…).execute()` or checks childless-ness via an in-SQL `NOT EXISTS`, a mocked QB ignores the WHERE — exactly the trap that made the spec-07 `listRuns` case permanently RED (note 18) — and the outcome assertion cannot work. **Pin this mechanism for spec 08 (see Exact pins) so it stays mock-observable; if it must be a bulk delete, that one case falls back to a builder-contract assertion** (assert the WHERE carries the childless + TTL predicate), the same carve-out note 18 used for `listRuns`. For deleteRun, assert the second (root) delete fires only when sibling count is 0; do not assert the count-query shape.
- **L2 — compile-now:** the children-existence check, the `WS_EMPTY_ROOT_TTL_MS` read, and any new sweep method on `SessionWatchdogService` do not exist yet — access via `(watchdog as any).<method>`. Fixture rows set `activityType: 'root' as any` and `rootSessionId` via `{ ... } as any` (column added in spec 02).
- **L3 — label by spec name:** janitor cases `RED until spec 08-janitor-empty-roots`; deleteRun cases `RED until spec 15-deleterun-orphan-root-cleanup`. Never phase numbers.
- **L4 — escalation valve:** "non-root stale reaping unchanged" is a characterization invariant — a RED there after spec 08 = genuine regression, escalate. The root-sweep cases are target, expected RED now.

## Why this area (silent-failure filter)
This is the highest-blast-radius silent area: the reap predicate gates a **cascading delete**. A wrong predicate either reaps a root that still has a practice (catastrophic silent data loss via FK cascade — child + bio gone, no error) or never reaps (slow leak of orphaned bio). Both fail silently.

## Behavior under change — think hard before writing
The reap rule changed mid-design from "no children AND no bio" to "**no children**" (bio no longer protects a root). Before writing, re-derive every state a root can be in — {live | disconnected} × {0 children | ≥1 child} × {0 bio | bio} — and assert exactly which are reaped. Confirm the live-subscriber skip and the `lastActivityAt`-refreshed-by-bio-flush interaction prevent reaping an actively-streaming pre-practice root. Any state the spec leaves ambiguous → **Findings**.

## Red/Green contract
- **Target (RED until [[08-janitor-empty-roots]] / [[15-deleterun-orphan-root-cleanup]]):** all cases below.
- **Characterization (GREEN, stay GREEN):** the existing watchdog reap of stale `active`/`disconnected` *practice* sessions (non-root) is unchanged — assert it still works and the new root sweep does not disturb it.

## Instantiation
`SessionWatchdogService(repo, activityEngine, activeStreamRegistry, configService)` (4 ctor args, `session-watchdog.service.ts:25-31`). `ConfigService.get` mock must return `WS_EMPTY_ROOT_TTL_MS` (config key already declared: `EMPTY_ROOT_TTL_MS: 'WS_EMPTY_ROOT_TTL_MS'`, `realtime-config.ts:14`) in addition to the existing `SESSION_MAX_IDLE_MS` (default 600_000) / `SESSION_SWEEP_INTERVAL_MS` (default 60_000) reads (`session-watchdog.service.ts:32-39`). For deleteRun, `SessionsService(moduleSessionRepo, bioSampleRepo, streamSampleRepo)` (3 ctor args, `sessions.service.ts:50-57`).

## Test cases
### Janitor (reap rule = no children)
- should reap a childless root past TTL even if it has bio — target→08 (the corrected rule)
- should NOT reap a root that has ≥1 child, regardless of bio or age — target→08 (data-loss guard)
- should NOT reap a root with a live subscriber — char/target→08 (reuse existing skip)
- should not reap a childless root whose `lastActivityAt` is still fresh (bio flush refreshes it) — target→08
- should leave non-root stale-session reaping behavior unchanged — char
### deleteRun orphan
- should delete the root after its last child is deleted (cascade removes bio) — target→15
- should keep the root when a sibling child remains — target→15 (shared bio preserved)
- should behave as today for an old session with `rootSessionId = null` — char
- should count siblings AFTER deleting the child (the deleted child not counted) — target→15

## Exact pins (read from source)
- **Existing sweep (characterization baseline):** `SessionWatchdogService.sweep()` (`session-watchdog.service.ts:56-91`) finds `status IN (ACTIVE, DISCONNECTED)` AND `lastActivityAt < threshold` (threshold = `now - maxIdleMs`, line 57), skips rows with a live subscriber (`activeStreamRegistry.hasLiveSubscriber(row.userId)`, line 71), then calls `activityEngine.abandonStale(row.userId, row.id)` + `activeStreamRegistry.closeAll(row.userId)` (lines 82-83). This loop must stay intact for the "non-root unchanged" char case. Spec 08 adds a SEPARATE root sweep — assert it does not perturb this one.
- **Reap rule = NO CHILDREN (not no-bio):** assert a childless root past `WS_EMPTY_ROOT_TTL_MS` IS reaped even with bio present, and a root with ≥1 child is NEVER reaped (data-loss guard) regardless of bio/age. The "live subscriber skip" reuses `hasLiveSubscriber` (line 71). `lastActivityAt` is refreshed by bio flush (`biometric-stream-engine.service.ts:183-184` updates `lastActivityAt` on flush) — drive the "fresh lastActivityAt → not reaped" case via that.
- **Reap mechanism must be mock-observable (escalate to spec 08 BEFORE it lands):** for the root-sweep outcome to be unit-testable, spec 08's separate root sweep must (a) determine childless-ness via a **mock-visible count** — `moduleSessionRepo.count({ where: { rootSessionId: root.id } })` (or `exist`/`findOne`) returning a number the test stubs — and (b) reap via a **per-root** `moduleSessionRepo.delete({ id: root.id })` / `abandonStale(root.userId, root.id)`. A single bulk `createQueryBuilder().delete().where('activityType = root AND lastActivityAt < ttl AND NOT EXISTS (children)').execute()` would hide both the WHERE childless-predicate and which root was targeted from a mocked QB — making the "≥1 child → not reaped" data-loss guard unobservable. If spec 08 insists on a bulk delete, this milestone's data-loss-guard case must drop to a **builder-contract assertion** (assert the delete WHERE carries the childless + TTL predicate), per the L1 carve-out. Decide this with spec 08 first; record the resolution here.
- **deleteRun sibling-count mechanism (escalate to spec 15):** the "count siblings AFTER delete" branch needs the count to be mock-stubbable — `moduleSessionRepo.count({ where: { rootSessionId } })` returning `0` vs `1` drives the keep-vs-delete-root branches. The outcome assertion (one delete vs two, child-then-root order) is observable as long as both deletes are discrete `moduleSessionRepo.delete({ id })` calls (extending today's `sessions.service.ts:144`), not a bulk delete.
- **deleteRun today:** `sessions.service.ts:137-146` — asserts `endedAt != null` (else `ConflictException`, line 139-143) then `moduleSessionRepo.delete({ id: sessionId })` (line 144). No sibling/root logic yet. The "behaves as today for `rootSessionId = null`" char case: a legacy row with `rootSessionId = null` → only the single delete fires, no root delete. Set `rootSessionId: null as any` on the fixture.
- **Sibling count AFTER delete:** spec 15 must count remaining children with the SAME `rootSessionId` AFTER deleting the target child; if 0 → delete the root (cascade removes shared bio), if ≥1 → keep the root. Assert: with a sibling present, only one delete (the child) fires; with no sibling, two deletes (child then root) fire in that order.

## Gotchas
- FK is `ON DELETE CASCADE` self-referential (`02-root-session-schema`: `FK_module_sessions_rootSessionId … ON DELETE CASCADE`) — a wrong root delete silently removes children + bio; assert the predicate OUTCOME (was the root delete reached?), not just any delete call.
- deleteRun should wrap child+root delete in a transaction; assert atomicity intent (e.g. both deletes go through the same manager/runner) — but assert the OUTCOME order, not the transaction internals.
- Use fake timers for the TTL sweep; stub the threshold via injected `WS_EMPTY_ROOT_TTL_MS` config, not `Date.now()` in the test.

## Findings
_(fill during test-writing; escalate to the feature task before implementing it)_
