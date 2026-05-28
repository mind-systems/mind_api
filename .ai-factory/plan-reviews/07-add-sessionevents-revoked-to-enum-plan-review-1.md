# Plan Review: Add `SessionEvents.REVOKED` to enum

**Plan:** `07-add-sessionevents-revoked-to-enum.md`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md:** No conflicts. The change touches a leaf constant file under `src/realtime/events/`, fully inside the `realtime` module boundary. No cross-module dependency implications.
- **RULES.md:** No explicit convention violations. Existing entries use `SCREAMING_SNAKE_CASE` keys with `'session.<lowercase>'` string values and `as const` — the proposed `REVOKED: 'session.revoked'` matches the established style.
- **ROADMAP.md:** WARN — the plan does not link to a roadmap milestone, but the change is a tiny preparatory enum addition without a feature behind it yet, so this is acceptable for a standalone enum stub.

## Verification of plan assumptions

- File path `src/realtime/events/session.events.ts` exists and currently contains exactly:
  ```ts
  export const SessionEvents = {
    COMPLETED: 'session.completed',
    ABANDONED: 'session.abandoned',
    INTERRUPTED: 'session.interrupted',
  } as const;
  ```
  The plan's description of current structure (one entry per line, trailing comma, `as const`) is accurate.
- The plan correctly states this is standalone — `SessionEvents` is referenced in `stats.worker.ts`, `stream-engine.service.ts`, `activity-engine.service.ts`, and `activity-engine.service.spec.ts`, but none of those will be affected by adding a new key (no exhaustive-switch coverage that would break).
- The proposed value `'session.revoked'` does not collide with any existing string in the const.

## Critical Issues

None.

## Minor Notes

- The plan opts out of tests and documentation. For a single new enum entry with no consumer, this is reasonable — there is no behavior to test and no observable contract change.
- Once a producer/consumer for `session.revoked` is introduced, ensure the event payload shape is defined alongside (matching how other `session.*` events are emitted in `activity-engine.service.ts` / `stream-engine.service.ts`). Out of scope here, but worth tracking in a follow-up plan.

## Positive Notes

- Plan is appropriately scoped and explicit ("no consumers, imports, or other changes") — prevents scope creep.
- Correct, minimal file targeting.
- Preserves formatting conventions explicitly.

PLAN_REVIEW_PASS
