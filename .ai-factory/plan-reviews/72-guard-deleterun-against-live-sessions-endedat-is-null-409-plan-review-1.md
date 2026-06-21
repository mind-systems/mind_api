# Plan Review: Guard `deleteRun` against live sessions (`endedAt IS NULL` → 409)

**Plan:** `72-guard-deleterun-against-live-sessions-endedat-is-null-409.md`
**Files Reviewed:** 3 (`sessions.service.ts`, `sessions.service.spec.ts`, `module-session.entity.ts`) + ROADMAP / RULES / ARCHITECTURE gates
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. The plan explicitly keys on the DB `endedAt` column and forbids reaching into `RealtimeModule` in-memory state, preserving the modular-monolith boundary (`SessionsModule` already owns `ModuleSession` via `TypeOrmModule.forFeature`). No new cross-module dependency introduced.
- **Rules (`.ai-factory/RULES.md`):** PASS. No non-null assertion (`!`) is introduced — the guard uses loose `== null`. Logging stays lean (the existing single `logger.log` line is kept, no entry/exit logging added). No PII logged.
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS. The plan maps 1:1 to the open milestone on line 267 (Phase 46), including the exact predicate, message text, check ordering, and the `assertSessionOwnership` return-value approach. Direct linkage present.

## Verification of Plan Assumptions

All codebase claims in the plan were checked against the actual source and are correct:

- **Task 1** — `assertSessionOwnership` currently returns `Promise<void>` (lines 105–118); changing it to return the loaded `ModuleSession` is backward-compatible. The two other callers, `listBiometrics` (line 132) and `listInstructions` (line 206), `await` it and discard the result, so they remain green. `ModuleSession` is already imported (line 16). The comment block at lines 102–104 is correctly identified. ✅
- **Task 2** — Insertion point (after ownership check, before `moduleSessionRepo.delete({ id: sessionId })` on line 122) is accurate. `ModuleSession.endedAt` is declared `endedAt?: Date` (entity line 38–39, nullable column), so a live row yields `undefined`/`null` — the loose `== null` correctly covers both. Check ordering (404/403 → 409) is preserved. ✅
- **Task 3** — Current `@nestjs/common` import block (lines 1–7) imports `ForbiddenException`, `Injectable`, `Logger`, `NotFoundException`, `PayloadTooLargeException`. Adding `ConflictException` is correct; NestJS maps it to HTTP 409 automatically, so no controller change is needed. ✅
- **Task 4** — The most important catch in the plan is correct and well-reasoned: the existing owned-session success tests (spec lines 45, 60) call `makeSession({ id, userId })` with **no `endedAt`**, and `makeSession`'s default (spec lines 7–17) sets `status: COMPLETED` but omits `endedAt`. After the guard lands, those rows would hit `undefined == null` → `ConflictException`, breaking the 204/delete path. The plan explicitly requires giving the owned cases a non-null `endedAt` (e.g. via `makeSession` default `endedAt: new Date()`). Without this note the implementation would regress two passing tests. ✅

## Controller / HTTP path

`DELETE /sessions/runs/:id` carries `@HttpCode(204)` (controller lines 28–35). This affects only the success path; a thrown `ConflictException` is handled by Nest's exception layer and returns 409 regardless. No controller edit required, as the plan states.

## Critical Issues

None.

## Minor Notes (non-blocking)

- **No e2e coverage mentioned.** The plan covers the unit branch only, consistent with the milestone scope ("unit test for the new branch"). The existing `@HttpCode(204)` + automatic 409 mapping means an e2e is not strictly required, but if a sessions e2e suite exists it would be worth a glance that none asserts deletion of a non-finalized row. Not a blocker.
- **Implementation choice for Task 4 left open** (update `makeSession` default vs. per-case override). Updating the `makeSession` default to include `endedAt: new Date()` is the cleaner option since the default `status` is already `COMPLETED` (a finalized state), keeping the helper's defaults internally consistent. Either approach satisfies the plan.

## Positive Notes

- Correctly avoids a second DB round-trip by threading the already-loaded entity out of `assertSessionOwnership` instead of re-querying.
- Strong rationale captured (live deletion leaves `StreamEngine`/`BiometricStreamEngine`/`ActivitySessionStore` referencing a deleted parent → FK violation on next flush), matching the ROADMAP intent.
- Explicitly preserves the Phase 45 cascade / no-touch set (`breath_sessions`, `user_stats`, `meditation_notes`, no sync event), correctly scoping the change to a pure additive guard with no migration/proto/module impact.
- Check-order guard (ownership before finalized) prevents leaking liveness state to non-owners.

PLAN_REVIEW_PASS
