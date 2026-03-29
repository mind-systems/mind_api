# Plan: Rename entity file and class

## Context
Rename the `LiveSession` entity to `ModuleSession` — file, class, and all imports/usages across the realtime module. This is a code-only rename: `@Entity('live_sessions')` stays unchanged because the database table rename is handled separately by ROADMAP Phase 7.6's comprehensive migration (which also renames the enum, indexes, PK constraint, and `liveSessionId` column in `session_stream_samples`).

**Scope:** covers ROADMAP 7.2 first bullet only. The second bullet of 7.2 (renaming `liveSessionId` → `moduleSessionId` in `SessionStreamSample`) and Phase 7.6 (database migration) are out of scope.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename entity file and class

- [x] **Task 1: Rename entity file and update class**
  Files: `src/realtime/entities/live-session.entity.ts` → `src/realtime/entities/module-session.entity.ts`
  Rename the file from `live-session.entity.ts` to `module-session.entity.ts`. Inside the file: rename class `LiveSession` → `ModuleSession`. Keep `@Entity('live_sessions')` unchanged — the table rename is deferred to ROADMAP 7.6's migration.

### Phase 2: Update all imports and usages

- [x] **Task 2: Update realtime module registration** (depends on Task 1)
  Files: `src/realtime/realtime.module.ts`
  Change import path from `./entities/live-session.entity` to `./entities/module-session.entity`. Change imported symbol from `LiveSession` to `ModuleSession`. Update `TypeOrmModule.forFeature([LiveSession, ...])` to `TypeOrmModule.forFeature([ModuleSession, ...])`.

- [x] **Task 3: Update activity-engine service and spec** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`, `src/realtime/services/activity-engine.service.spec.ts`
  **Service:** Change import path and symbol. Change `@InjectRepository(LiveSession)` → `@InjectRepository(ModuleSession)`. Change `Repository<LiveSession>` → `Repository<ModuleSession>`. Change return type `Promise<LiveSession>` → `Promise<ModuleSession>` on `startActivity`, `Promise<LiveSession | null>` → `Promise<ModuleSession | null>` on `endActivity`, `stopActivity`, `resumeActivity`, `handleReconnect`.
  **Spec:** Change import path and symbol. Update `makeSession` helper: change return type annotation from `LiveSession` to `ModuleSession`, change `Partial<LiveSession>` → `Partial<ModuleSession>`, change `as LiveSession` → `as ModuleSession`. Update test description string `creates LiveSession row` → `creates ModuleSession row`.

- [x] **Task 4: Update startup-recovery service and spec** (depends on Task 1)
  Files: `src/realtime/services/startup-recovery.service.ts`, `src/realtime/services/startup-recovery.service.spec.ts`
  **Service:** Change import path and symbol. Change `@InjectRepository(LiveSession)` → `@InjectRepository(ModuleSession)`. Change `Repository<LiveSession>` → `Repository<ModuleSession>`.
  **Spec:** Change import path and symbol. Update `makeSession` helper: change return type from `LiveSession` to `ModuleSession`, change `as LiveSession` → `as ModuleSession`.

- [x] **Task 5: Update stream-engine service and spec** (depends on Task 1)
  Files: `src/realtime/services/stream-engine.service.ts`, `src/realtime/services/stream-engine.service.spec.ts`
  **Service:** Change import path and symbol. Change `@InjectRepository(LiveSession)` → `@InjectRepository(ModuleSession)`. Change `Repository<LiveSession>` → `Repository<ModuleSession>`. Rename property `liveSessionRepo` → `moduleSessionRepo` and update all usages of this property within the file (the `.update()` call in `flush` and the field declaration).
  **Spec:** Rename helper `makeLiveSessionRepo()` → `makeModuleSessionRepo()`. Rename variable `liveSessionRepo` → `moduleSessionRepo` throughout the test file (declaration, `beforeEach` assignment, assertion in `flush` test).

- [x] **Task 6: Update comment in user-stats entity** (depends on Task 1)
  Files: `src/stats/entities/user-stats.entity.ts`
  Change comment `same pattern as LiveSession` → `same pattern as ModuleSession` (line 14).

## Commit Plan
- **Commit 1** (after task 1): "Rename LiveSession entity file and class to ModuleSession"
- **Commit 2** (after tasks 2-6): "Update all imports and usages of ModuleSession across realtime module"
