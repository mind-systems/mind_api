# Plan Review: SyncService spec

**Plan:** `.ai-factory/plans/65-syncservice-spec.md`
**Target:** `src/sync/sync.service.spec.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md:** PASS — adding a unit spec inside the owning module follows the modular-monolith convention; no boundary crossing.
- **RULES.md:** PASS — plan does not introduce `!` non-null assertions, log sensitive data, or touch gRPC `@Payload()` patterns. Test code only.
- **ROADMAP_TESTS.md:** PASS — task is the explicit `SyncService spec` entry on the test-coverage roadmap; cases listed in the plan match the roadmap item and the supporting note `notes/07-sync-service-test-plan.md`.

## Codebase Alignment

Cross-checked plan against `src/sync/sync.service.ts` and `src/changelog/changelog.service.ts`:

- Single collaborator is `ChangeLogService` — matches plan.
- Public surface: `getChanges(userId, afterId, limit)` and `purgeOldEvents()` — matches plan.
- Early-return condition in source is `minEventId !== null && afterId !== 0 && afterId < minEventId` — Phase 2 Tasks 3 & 4 enumerate exactly these branches and the sentinel cases.
- Event projection in source is `{ id, entity, refId, action, createdAt }` — Phase 3 Task 5 asserts this and that `userId` is stripped. Realistic, since `ChangeEvent` entity carries `userId`, `user`, and other fields.
- `purgeOldEvents()` calls `this.changeLogService.purge()` with no arguments (default 30-day window applied inside `ChangeLogService`) — Phase 4 Task 6's "no arguments" assertion is correct; the 30-day default is not the responsibility of `SyncService` and is correctly out of scope here.
- `@Cron` decorator is correctly treated as inert in unit tests (call the method directly) — consistent with sibling specs (e.g. `stats.service.spec.ts`) and with the gotcha in the note.

## Critical Issues

None.

## Minor Observations (non-blocking)

1. **Error-propagation symmetry for `getChanges()`** — Phase 4 Task 6 explicitly tests that `purge()` rejections propagate, but there is no equivalent test that rejections from `changeLogService.getMinEventId()` or `changeLogService.getChanges()` propagate from `SyncService.getChanges()`. Note `07` gotcha #6 (“No error handling — exceptions propagate unchanged”) covers both methods; consider adding one rejection-propagation case to Phase 1 or Phase 2 for parity. Not blocking.

2. **Boundary `afterId === minEventId`** — Phase 2 Task 4 covers `afterId >= minEventId` as a single bullet. A dedicated equality case (e.g. `afterId === minEventId`, both non-zero) would harden the off-by-one, since the source uses strict `<`. Optional.

3. **Phase 3 Task 5 duplication** — `should forward the cursor and hasMore from changeLogService unchanged alongside the projected events` overlaps with Phase 1 Task 1 bullets 1–3. Harmless; either consolidate or leave as a regression-safety duplicate.

## Positive Notes

- Plan and supporting note (`notes/07-sync-service-test-plan.md`) are tightly aligned; no contradictions.
- Sentinel `afterId === 0` and `minEventId === null` branches are both explicitly covered — these are the two easy-to-miss corners in the early-return logic.
- Cursor-collapse case (`cursor must not collapse to 0` when no events) is captured in Phase 1 Task 2 — matches the source's `events.length > 0 ? ... : afterId` fallback.
- `getChanges()` is asserted **not** called on the full-resync path (Phase 2 Task 3) — this is the most important behavioral assertion for the early-return branch.
- Test-command path, spec file path, and target paths are all correct and use the existing `npx jest <relative-spec>` convention used elsewhere in the project.

PLAN_REVIEW_PASS
