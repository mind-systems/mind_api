# Review: 30 — Rename entity file and class

**Plan:** `.ai-factory/plans/30-rename-entity-file-and-class.md`
**Scope:** ROADMAP 7.2 first bullet — code-only rename of `LiveSession` → `ModuleSession`

## Verification

- **TypeScript compilation:** clean (`tsc --noEmit` — no errors)
- **Unit tests:** 29/29 pass across all three affected spec files
- **Stale references:** `grep -r LiveSession src/` returns only migration files (expected — migration names are historical)
- **No dangling imports:** `grep -r live-session.entity src/` returns zero results

## File-by-file review

### `src/realtime/entities/module-session.entity.ts`

Correct. Class renamed `LiveSession` → `ModuleSession`. `@Entity('live_sessions')` intentionally kept unchanged — table rename deferred to ROADMAP 7.6.

### `src/realtime/realtime.module.ts`

Correct. Import path and symbol updated. `TypeOrmModule.forFeature([ModuleSession, ...])` matches.

### `src/realtime/services/activity-engine.service.ts`

Correct. `@InjectRepository(ModuleSession)`, `Repository<ModuleSession>`, and all five method return types updated.

### `src/realtime/services/activity-engine.service.spec.ts`

Correct. Import, `makeSession` helper type annotations, cast, and test description string all updated.

### `src/realtime/services/startup-recovery.service.ts`

Correct. `@InjectRepository` and `Repository` generic updated.

### `src/realtime/services/startup-recovery.service.spec.ts`

Correct. Import, `makeSession` return type, and cast updated.

### `src/realtime/services/stream-engine.service.ts`

Correct. Import updated, `@InjectRepository(ModuleSession)`, property renamed `liveSessionRepo` → `moduleSessionRepo`, usage in `flush()` updated.

### `src/realtime/services/stream-engine.service.spec.ts`

Correct. Helper renamed `makeLiveSessionRepo` → `makeModuleSessionRepo`, variable renamed throughout, assertion updated.

### `src/stats/entities/user-stats.entity.ts`

Correct. Comment `same pattern as LiveSession` → `same pattern as ModuleSession`.

## No issues found

The change is a clean, mechanical rename confined to TypeScript types and imports. No runtime behavior changes. No migration needed (entity still maps to `live_sessions` table). All affected files identified in the plan were modified, and no files were missed.

REVIEW_PASS
