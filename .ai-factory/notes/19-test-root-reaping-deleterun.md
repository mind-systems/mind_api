# Test plan — root reaping + deleteRun orphan cleanup (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature tasks [[08-janitor-empty-roots]] + [[15-deleterun-orphan-root-cleanup]].

## Why this area (silent-failure filter)
This is the highest-blast-radius silent area: the reap predicate gates a **cascading delete**. A wrong predicate either reaps a root that still has a practice (catastrophic silent data loss via FK cascade — child + bio gone, no error) or never reaps (slow leak of orphaned bio). Both fail silently.

## Behavior under change — think hard before writing
The reap rule changed mid-design from "no children AND no bio" to "**no children**" (bio no longer protects a root). Before writing, re-derive every state a root can be in — {live | disconnected} × {0 children | ≥1 child} × {0 bio | bio} — and assert exactly which are reaped. Confirm the live-subscriber skip and the `lastActivityAt`-refreshed-by-bio-flush interaction prevent reaping an actively-streaming pre-practice root. Any state the spec leaves ambiguous → **Findings**.

## Red/Green contract
- **Target (RED until [[08-janitor-empty-roots]] / [[15-deleterun-orphan-root-cleanup]]):** all cases below.
- **Characterization (GREEN, stay GREEN):** the existing watchdog reap of stale `active`/`disconnected` *practice* sessions (non-root) is unchanged — assert it still works and the new root sweep does not disturb it.

## Instantiation
`SessionWatchdogService` with mocked `Repository<ModuleSession>` (stub the children/bio existence queries), `ActivityEngine`, `ActiveStreamRegistry`, `ConfigService` (`WS_EMPTY_ROOT_TTL_MS`). For deleteRun, `SessionsService` with mocked repos; assert child-delete then conditional root-delete order.

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

## Gotchas
- FK is `ON DELETE CASCADE` self-referential — a wrong delete silently removes children + bio; assert the predicate, not just the delete call.
- deleteRun must wrap child+root delete in a transaction; assert atomicity intent.
- Use fake timers for the TTL sweep; stub `Date`-derived threshold via injected config, not `Date.now()` in the test.

## Findings
_(fill during test-writing; escalate to the feature task before implementing it)_
