# Plan: Remove `activityRefType` from LiveSession entity and migrate

## Context
The `activityRefType` column in `live_sessions` is redundant now that gRPC is the only transport — the proto's `ActivityStartCmd` already omits `ref_type` (reserved slot 3), and module identity is fully carried by `activityType`. This milestone drops the column, removes the field from all TypeScript layers, and updates `StatsService` to derive the same logic from `activityType` instead.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Decouple business logic from `activityRefType`

- [ ] **Task 1: Replace `activityRefType` guard in StatsService with `activityType`**
  Files: `src/stats/stats.service.ts`
  In the `finalise()` method (line ~100), replace:
  ```
  if (event.activityRefType === 'breath_session' && event.activityRefId) {
  ```
  with a check based on `activityType`:
  ```
  if (event.activityType === ActivityType.BREATH && event.activityRefId) {
  ```
  Import `ActivityType` from `src/realtime/enums/activity-type.enum`. Remove `activityRefType` from the `SessionEvent` interface (keep `activityRefId` — it is still needed to look up the breath session's complexity). Add `activityType` to the `SessionEvent` interface (it is already emitted by `ActivityEngine` but not declared on the type).

### Phase 2: Remove field from all TypeScript layers

- [ ] **Task 2: Remove `activityRefType` from `LiveSession` entity**
  Files: `src/realtime/entities/live-session.entity.ts`
  Delete the `activityRefType` property and its `@Column({ nullable: true })` decorator (lines 26-27).

- [ ] **Task 3: Remove `activityRefType` from `ActivityState` interface**
  Files: `src/realtime/interfaces/activity-state.interface.ts`
  Delete the `activityRefType?: string` property (line 6).

- [ ] **Task 4: Remove `activityRefType` from `ActivityStartDto`**
  Files: `src/realtime/dto/activity-start.dto.ts`
  Delete the `activityRefType` property and its `@IsString()` / `@IsOptional()` decorators (lines 8-10).

- [ ] **Task 5: Remove all `activityRefType` references from `ActivityEngine`**
  Files: `src/realtime/services/activity-engine.service.ts`
  - In `startActivity()`: remove `activityRefType: dto.activityRefType` from the `repo.create()` call (line 43) and from the `ActivityState` object (line 54).
  - In `endActivity()`: remove `activityRefType: saved.activityRefType` from the emitted `session.completed` event payload (line 134).
  - In `abandonActivity()`: remove `activityRefType: saved.activityRefType` from the emitted `session.abandoned` event payload (line 197).
  - In `stopActivity()`: remove `activityRefType: saved.activityRefType` from the emitted `session.interrupted` event payload (line 247).

### Phase 3: Database migration

- [ ] **Task 6: Generate and implement migration to drop `activityRefType` column**
  Files: `src/migrations/<timestamp>-DropActivityRefTypeFromLiveSessions.ts`
  Generate the migration scaffold with CLI:
  ```bash
  npx typeorm migration:create src/migrations/DropActivityRefTypeFromLiveSessions
  ```
  Implement:
  - `up()`: `ALTER TABLE "live_sessions" DROP COLUMN "activityRefType"`
  - `down()`: `ALTER TABLE "live_sessions" ADD "activityRefType" character varying`
  Follow the existing migration style: separate `await queryRunner.query(...)` calls, `public async` methods.

### Phase 4: Update documentation

- [ ] **Task 7: Update socket docs to remove `activityRefType` references**
  Files: `docs/socket/protocol.md`, `docs/socket/session-lifecycle.md`, `docs/socket/database.md`
  Remove or update all mentions of `activityRefType` / `activity_ref_type`:
  - `protocol.md`: remove from the `activity:start` payload description.
  - `session-lifecycle.md`: remove the design rationale paragraph about the polymorphic soft-reference pattern (or simplify it to only mention `activityRefId`).
  - `database.md`: remove the `activityRefType` column from the `live_sessions` table description.
  Match the language of existing docs (Russian).

## Commit Plan
- **Commit 1** (after tasks 1-5): "Remove activityRefType field from entity, DTO, interface, service, and stats"
- **Commit 2** (after task 6): "Add migration to drop activityRefType column from live_sessions"
- **Commit 3** (after task 7): "Update socket docs to reflect activityRefType removal"
