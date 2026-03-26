# Plan: Remove `activityRefType` from LiveSession entity and migrate

## Context
`activity_ref_type` column on `live_sessions` is redundant now that gRPC is the only transport — the proto contract (`ActivityStartCmd`) never included this field, and module identity is already carried by the `activityType` enum column. This milestone drops the DB column, removes the field from all TypeScript layers, and replaces the one business-logic guard in `StatsService` with an `activityType`-based check.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Database migration

- [x] **Task 1: Create migration to drop `activityRefType` column**
  Files: `src/migrations/<timestamp>-DropActivityRefTypeFromLiveSessions.ts`
  Generate migration via CLI: `npx typeorm migration:create src/migrations/DropActivityRefTypeFromLiveSessions`. In the `up` method drop the column: `ALTER TABLE "live_sessions" DROP COLUMN "activityRefType"`. In `down` re-add it: `ALTER TABLE "live_sessions" ADD "activityRefType" character varying`. Follow the existing migration pattern (see `1774411084222-RenameActivityTypeBreathSessionToBreath.ts` for a recent single-column-alter example).

### Phase 2: Entity, DTO, and interface cleanup

- [x] **Task 2: Remove `activityRefType` from LiveSession entity**
  Files: `src/realtime/entities/live-session.entity.ts`
  Delete the `@Column({ nullable: true }) activityRefType?: string;` block (lines 26-27). No other columns or decorators are affected.

- [x] **Task 3: Remove `activityRefType` from ActivityStartDto**
  Files: `src/realtime/dto/activity-start.dto.ts`
  Delete the three lines: `@IsString()`, `@IsOptional()`, `activityRefType?: string;` (lines 8-10). The `class-validator` imports `IsString` and `IsOptional` may become unused if `activityRefId` still uses them — check and remove only if unused.

- [x] **Task 4: Remove `activityRefType` from ActivityState interface**
  Files: `src/realtime/interfaces/activity-state.interface.ts`
  Delete `activityRefType?: string;` (line 6). The interface retains `activityRefId`.

### Phase 3: Service logic cleanup

- [x] **Task 5: Remove all `activityRefType` references from ActivityEngine**
  Files: `src/realtime/services/activity-engine.service.ts`
  Five locations to clean up:
  - `startActivity` (line 43): remove `activityRefType: dto.activityRefType,` from the `repo.create()` call.
  - `startActivity` (line 54): remove `activityRefType: saved.activityRefType,` from the `ActivityState` construction.
  - `endActivity` (line 134): remove `activityRefType: saved.activityRefType,` from the `eventEmitter.emit` payload.
  - `abandonActivity` (line 197): remove `activityRefType: saved.activityRefType,` from the `eventEmitter.emit` payload.
  - `stopActivity` (line 247): remove `activityRefType: saved.activityRefType,` from the `eventEmitter.emit` payload.

- [x] **Task 6: Replace `activityRefType` guard with `activityType` check in StatsService** (depends on Task 5)
  Files: `src/stats/stats.service.ts`
  Two changes in this file:
  1. **`SessionEvent` interface** (lines 8-15): remove `activityRefType?: string;` field. Add `activityType: ActivityType;` field — import `ActivityType` from `src/realtime/enums/activity-type.enum`. The event emitters in `ActivityEngine` already emit `activityType` (typed as `ActivityType`) in the payload, so no upstream change needed — Task 5 keeps that field intact.
  2. **`finalise` method** (line 100): replace `event.activityRefType === 'breath_session'` with `event.activityType === ActivityType.BREATH` for full compile-time type safety.

- [x] **Task 7: Fix test helpers to include `activityType` in `SessionEvent`** (depends on Task 6)
  Files: `src/stats/stats.service.spec.ts`, `src/stats/stats.worker.spec.ts`
  Task 6 adds a required `activityType: ActivityType` field to `SessionEvent`. Two test files construct `SessionEvent` objects without it, causing a compile-time break:
  1. **`stats.service.spec.ts`** (line 13): in the `makeEvent()` helper, add `activityType: ActivityType.BREATH` to the returned object. Add `import { ActivityType } from '../realtime/enums/activity-type.enum';` at the top.
  2. **`stats.worker.spec.ts`** (line 12): same change — add `activityType: ActivityType.BREATH` to the returned object in `makeEvent()`, and add the `ActivityType` import.

### Phase 4: Documentation

- [x] **Task 8: Update socket documentation**
  Files: `docs/socket/database.md`, `docs/socket/protocol.md`, `docs/socket/session-lifecycle.md`
  All three docs are in Russian — keep the same language:
  - `database.md` (line 14): remove the `activityRefType` row from the `live_sessions` table.
  - `protocol.md` (line 17): remove the mention of `activityRefType` from the `activity:start` event description. Keep `activityRefId`.
  - `session-lifecycle.md` (line 17): rewrite the paragraph to only mention `activityRefId` for entity binding, removing `activityRefType`.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Drop activityRefType column and remove field from entity, DTO, and interface"
- **Commit 2** (after tasks 5-8): "Remove activityRefType from services, fix tests, and update docs"
