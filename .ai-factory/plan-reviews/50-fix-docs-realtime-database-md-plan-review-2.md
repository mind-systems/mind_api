# Plan Review: Fix `docs/realtime/database.md`

**Plan file:** `.ai-factory/plans/50-fix-docs-realtime-database-md.md`
**Files reviewed:** 8 (plan + doc + 3 entities + 2 enums + migration)
**Risk Level:** Low

## Context Gates

- **ARCHITECTURE.md:** WARN — no conflicts. Plan edits a doc file only; no code or module boundary changes.
- **RULES.md:** WARN — no violations. No code changes involved.
- **ROADMAP.md:** OK — plan maps directly to Phase 12 roadmap item "Fix `docs/realtime/database.md`".

## Verification Against Codebase

Every claim in the plan was verified against the actual source of truth:

### Task 1 (intro paragraph, line 3)
- Empty backtick pair `` ` ` `` where `module_sessions` was dropped — confirmed in doc line 3.
- `ModuleInstructionService` rename to `ModuleInstructionStreamService` — confirmed: `ModuleInstructionStreamServiceController` in `src/realtime/module-instruction-stream.grpc.controller.ts` (proto service name is `ModuleInstructionStreamService`). No class named `ModuleInstructionService` exists anywhere in the codebase.
- `хранит инструкции` → `хранит батчи сэмплов` — consistent with the batch model in `SessionStreamSample` entity (`samples: Record<string, unknown>[]`).

### Task 2 (module_sessions section, lines 5-22)
- Table name `live_sessions` → `module_sessions` — entity: `@Entity('module_sessions')`.
- `activityType` type `varchar` → `enum` with value `breath` — entity: `@Column({ type: 'enum', enum: ActivityType })`, migration: `"public"."activity_type_enum"`, enum: `BREATH = 'breath'`.
- Status enum with `resumed` added — `SessionStatus` enum confirmed: `active`, `disconnected`, `completed`, `abandoned`, `interrupted`, `resumed` (6 values).
- `metadata` column (`jsonb nullable`) between `lastActivityAt` and `createdAt` — entity lines 44-45: `@Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, unknown>`, positioned exactly between those two columns.
- Indices: single-column `@Index(['userId'])` and `@Index(['status'])` on entity lines 12-13. Migration confirms: `IDX_module_sessions_userId` and `IDX_module_sessions_status`. Doc's current composite `(userId, status)` and `(userId, createdAt DESC)` do not exist.

### Task 3 (session_stream_samples section, lines 24-36)
- `moduleSessionId` (uuid FK, ON DELETE CASCADE, indexed) — entity: `@Column({ type: 'uuid' }) moduleSessionId`, `@Index(['moduleSessionId'])`. Migration: `FK_session_stream_samples_moduleSessionId ... ON DELETE CASCADE`.
- `samples` (jsonb) — entity: `@Column({ type: 'jsonb' }) samples: Record<string, unknown>[]`.
- `flushedAt` — entity: `@Column() flushedAt: Date`. Migration: `"flushedAt" TIMESTAMP NOT NULL`.
- `createdAt` — entity: `@CreateDateColumn() createdAt: Date`. Migration: `"createdAt" TIMESTAMP NOT NULL DEFAULT now()`.
- Old columns (`liveSessionId`, `moduleId`, `instructionType`, `recordedAt`, `data`) do not exist in entity or migration.
- `StreamEngine` flush interval: `flushIntervalMs` defaults to `5000` (5 seconds). Session-end flush confirmed via `@OnEvent` handlers for `COMPLETED`, `ABANDONED`, `INTERRUPTED`.

### Task 4 (user_stats — maxCompletedComplexity)
- Entity line 32-33: `@Column({ type: 'float', default: 0 }) maxCompletedComplexity: number`, positioned between `longestStreak` and `lastSessionDate`.
- Migration line 215: `"maxCompletedComplexity" double precision NOT NULL DEFAULT 0`.

## Critical Issues

None.

## Suggestions

None. The plan is precise, every claim matches the codebase, and the scope is correctly limited to a single documentation file as specified by the roadmap item.

## Positive Notes

- Every column, type, index, and service name was verified against the actual entities, enums, and migration SQL. No fabricated claims.
- The plan preserves the existing doc's language (Russian) and formatting conventions.
- Task breakdown is granular: intro paragraph, each table section, and the new column are handled as separate tasks with explicit line references — easy to implement and verify.
- The plan correctly scopes itself to only `docs/realtime/database.md`, leaving other Phase 12 doc fixes to their own plans.

PLAN_REVIEW_PASS
