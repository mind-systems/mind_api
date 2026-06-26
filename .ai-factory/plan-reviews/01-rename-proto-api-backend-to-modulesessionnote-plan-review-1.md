# Plan Review: Rename proto + API backend to ModuleSessionNote

**Plan:** `01-rename-proto-api-backend-to-modulesessionnote.md`
**Files cross-checked:** 10 (all references located)
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. The plan preserves the modular-monolith boundary rules — `ModuleSessionNotesModule` keeps `AuthModule` as an explicit import (Task 8) and owns its own entity via `TypeOrmModule.forFeature`. No cross-module internal imports introduced.
- **Rules (`.ai-factory/RULES.md`):** PASS. Migration is generated via CLI (no hand-crafted timestamp). `@Payload()` + `@GrpcCurrentUser()` pairing and `!user` guards are explicitly preserved (Task 6). No new non-null assertions or sensitive logging introduced.
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS. Directly implements Phase 53 → "Rename proto + API backend to ModuleSessionNote". Scope, field-number preservation, migration shape, and mapper rename all match the milestone text verbatim.

## Verification of Plan Assumptions Against the Codebase

Confirmed correct:
- **All consumers of the symbols are covered.** Grep over `src/` finds exactly: entity, service, controller, module, spec (the 5 in-module files), plus `main.ts` (protoPath line 123), `grpc-mappers.ts` (Task 7), `app.module.ts` (import line 20 + array line 45). All are addressed by the plan. The only other matches are the two historical migrations (`1780461720539`, `1780524587785`) — correctly left untouched.
- **Service signature change is consistent end-to-end.** Current `create(userId, sessionId, poseId, noteText)` → new `create(userId, sessionId, noteText)`; controller call site (Task 6) and spec fixtures (Task 9) are both updated to drop `poseId`. No caller is left passing 4 args.
- **23505 / 23503 handling survives.** The unique index `UQ_meditation_notes_session` and FK `FK_meditation_notes_session_id` (from migration `1780461720539`) remain on the table after `RENAME TO`, so the `ALREADY_EXISTS` / detach-session branches keep working. Nothing in the plan touches them.
- **proto:gen scope is correct.** The script globs `./proto/*.proto`; deleting `meditation_notes.proto` + adding `module_session_notes.proto` means the stale stub is not regenerated, and Task 2 deletes `proto/generated/meditation_notes.ts` explicitly. Good.
- **`reserved` usage is valid proto3.** Field-number and field-name reservations are listed as separate statements (`reserved 3;` / `reserved "pose_id";`), which is required — they cannot be combined in one statement.
- **Down-migration column re-add is sound.** Original `pose_id` was `NOT NULL` with no default; re-adding as `NOT NULL DEFAULT ''` (Task 4) lets existing rows backfill. Data-loss on `pose_id` is acknowledged.

## Findings (Non-blocking)

### 1. WARN — Service-name rename is a breaking wire change, not covered by the "wire compatibility" assumption
The plan's wire-compatibility assumption (line 12) reasons only about *field numbers*. But renaming `service MeditationNotesService` → `ModuleSessionNotesService` (proto + the three `@GrpcMethod('...Service', ...)` decorator strings) changes the fully-qualified RPC path from `mind.MeditationNotesService/*` to `mind.ModuleSessionNotesService/*`. Any not-yet-updated client will get `UNIMPLEMENTED`, regardless of field-number compatibility. This is consistent with the milestone (the rename is the point) and the assumption that consumers update separately — but the framing "wire compatibility is preserved" is misleading. Recommend noting in the plan that this requires **coordinated consumer deployment** (`mind_mcp` / `mind_mobile` must ship the renamed service before/with this), not just field-number care.

### 2. WARN — Indexes and constraints keep their old `meditation_notes` names after `RENAME TO`
Postgres does not rename indexes/constraints when a table is renamed. After Task 4 the renamed `module_session_notes` table will still carry `PK_meditation_notes_id`, `FK_meditation_notes_user_id`, `FK_meditation_notes_session_id`, `IDX_meditation_notes_user_id`, `IDX_meditation_notes_session_id`, `UQ_meditation_notes_session`. This is **functionally harmless** (no synchronize, runtime ignores names) but leaves a permanent naming inconsistency. Optional hygiene improvement for `up()` (with matching reversal in `down()`):
```sql
ALTER TABLE module_session_notes RENAME CONSTRAINT "PK_meditation_notes_id" TO "PK_module_session_notes_id";
ALTER TABLE module_session_notes RENAME CONSTRAINT "FK_meditation_notes_user_id" TO "FK_module_session_notes_user_id";
ALTER TABLE module_session_notes RENAME CONSTRAINT "FK_meditation_notes_session_id" TO "FK_module_session_notes_session_id";
ALTER INDEX "IDX_meditation_notes_user_id"    RENAME TO "IDX_module_session_notes_user_id";
ALTER INDEX "IDX_meditation_notes_session_id" RENAME TO "IDX_module_session_notes_session_id";
ALTER INDEX "UQ_meditation_notes_session"     RENAME TO "UQ_module_session_notes_session";
```
Not required for the milestone to be correct; flagging for completeness.

## Positive Notes
- Tasks are correctly ordered with explicit dependencies; the three-commit split is clean and each commit leaves the tree compiling.
- The final grep-for-stale-references + `npm run build` gate (after Task 9) is exactly the right closing check, and correctly anticipates the `meditation-poses` false-positive.
- The `AuthModule`-is-required rationale in Task 8 is spelled out — prevents a future "unused import" removal that would break `GrpcAuthInterceptor` DI.
- File paths and the CLI migration command all match actual repo layout and the project's migration rules.

The two findings are advisory (one is a deployment-coordination note already implied by proto-ownership scoping; the other is optional naming hygiene). Neither is a missing step, wrong path, incorrect API usage, or architectural error in the plan as written. The plan is implementable as-is.

PLAN_REVIEW_PASS
