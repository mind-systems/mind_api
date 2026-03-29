# Plan: Rename `liveSessionId` in `SessionStreamSample`

## Context
Rename the `liveSessionId` column/field in the `SessionStreamSample` entity to `moduleSessionId` to align naming with the rest of the realtime module. The gRPC controller (`module-session.grpc.controller.ts`) already uses `moduleSessionId` in all seven response-mapping sites — no changes needed there.

**Follow-up required:** After this plan is implemented, ROADMAP task 7.6 must be updated to remove the `session_stream_samples` column/index rename steps (column rename, `IDX_session_stream_samples_liveSessionId` drop/recreate) from its migration — this plan handles them independently, and the 7.6 migration would fail at runtime if it tries to rename a column/index that no longer exists.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Database migration

- [x] **Task 1: Create migration to rename column and index**
  Files: `src/migrations/<timestamp>-RenameSessionStreamSampleLiveSessionId.ts`
  Generate migration scaffold via CLI: `npx typeorm migration:create src/migrations/RenameSessionStreamSampleLiveSessionId`. In the `up` method: (1) drop the existing index `IDX_session_stream_samples_liveSessionId`, (2) rename the column `ALTER TABLE "session_stream_samples" RENAME COLUMN "liveSessionId" TO "moduleSessionId"`, (3) create the new index `CREATE INDEX "IDX_session_stream_samples_moduleSessionId" ON "session_stream_samples" ("moduleSessionId")`. The `down` method reverses all three steps in opposite order. Follow the pattern in existing migrations (e.g. `1774552349945-DropActivityRefTypeFromLiveSessions.ts`).

### Phase 2: Entity and service code

- [x] **Task 2: Rename field in entity** (depends on Task 1)
  Files: `src/realtime/entities/session-stream-sample.entity.ts`
  Rename the `@Column()` property from `liveSessionId` to `moduleSessionId`. Update the `@Index(['liveSessionId'])` class-level decorator to `@Index(['moduleSessionId'])`.

- [x] **Task 3: Update StreamEngine service** (depends on Task 2)
  Files: `src/realtime/services/stream-engine.service.ts`
  In the `flush` method (line ~128), change the object literal key `liveSessionId: sessionId` to `moduleSessionId: sessionId` inside the `this.sampleRepo.create(...)` call.

- [x] **Task 4: Update StreamEngine spec** (depends on Task 2)
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  In the "saves batch to DB and clears buffer" test (line ~127), change the `expect.objectContaining` matcher key from `liveSessionId: 's1'` to `moduleSessionId: 's1'`.

### Phase 3: Update ROADMAP

- [x] **Task 5: Remove overlapping steps from ROADMAP task 7.6** (depends on Task 1)
  Files: `.ai-factory/ROADMAP.md`
  In ROADMAP task 7.6 ("Migrate `live_sessions` → `module_sessions`"), remove the `session_stream_samples` column rename and index steps from both the `up()` and `down()` descriptions — specifically: remove `rename column "liveSessionId" → "moduleSessionId" in session_stream_samples`, remove the drop/recreate of `IDX_session_stream_samples_liveSessionId` / `IDX_session_stream_samples_moduleSessionId`. These are now handled by plan 31's migration. Also update the ROADMAP 7.2 bullet for "Rename `liveSessionId` in `SessionStreamSample`" to remove the stale note about the controller — it already uses `moduleSessionId`.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Rename liveSessionId to moduleSessionId in SessionStreamSample entity and migration"
- **Commit 2** (after task 5): "Remove overlapping session_stream_samples steps from ROADMAP task 7.6"
