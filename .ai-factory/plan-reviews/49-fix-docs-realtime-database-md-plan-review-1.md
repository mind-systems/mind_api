# Plan Review: Fix `docs/realtime/database.md`

**Plan file:** `.ai-factory/plans/49-fix-docs-realtime-database-md.md`
**Risk Level:** 🟢 Low (documentation-only change)

## Context Gates

- **ARCHITECTURE.md** — `WARN` No architectural concern; doc-only plan, no code or dependency changes.
- **RULES.md** — `WARN` No code changes, rules about non-null assertions and logging do not apply.
- **ROADMAP.md** — Phase 12 item "Fix `docs/realtime/database.md`" is the parent task. Plan covers the listed scope.

## Verification Against Codebase

### Task 1 — Rename `live_sessions` → `module_sessions` and fix intro

| Claim | Verified | Notes |
|-------|----------|-------|
| Header is `## live_sessions` | ✅ | Line 5 of `database.md` |
| Intro has empty backticks | ✅ | Line 3: `` ` ` `` where `module_sessions` should be |
| FK ref in `session_stream_samples` says `live_sessions` | ✅ | Line 31: `FK → live_sessions` |
| Status enum missing `resumed` | ✅ | Doc lists 5 values; `SessionStatus` enum has 6 (`resumed` missing) |
| Indices are wrong (composite vs single) | ✅ | Doc: `(userId, status)` and `(userId, createdAt DESC)`. Entity: separate `@Index(['userId'])` and `@Index(['status'])`. Migration confirms: `IDX_module_sessions_userId` on `(userId)`, `IDX_module_sessions_status` on `(status)` |

### Task 2 — Rewrite `session_stream_samples` schema

| Claim | Verified | Notes |
|-------|----------|-------|
| Doc lists wrong columns (`moduleId`, `instructionType`, `recordedAt`, `data`) | ✅ | Lines 32-35 of `database.md` |
| Real entity columns: `id`, `moduleSessionId`, `samples`, `flushedAt`, `createdAt` | ✅ | Confirmed in `session-stream-sample.entity.ts` and `InitialSchema` migration |
| `samples` type is `jsonb` | ✅ | Entity: `@Column({ type: 'jsonb' })`, migration: `"samples" jsonb NOT NULL` |
| FK has `ON DELETE CASCADE` | ✅ | Migration: FK to `module_sessions` with `ON DELETE CASCADE` |

## Issues

### 1. Missing `metadata` column in `module_sessions` schema

The `ModuleSession` entity (`src/realtime/entities/module-session.entity.ts`, line 44-45) has a `metadata` field:

```typescript
@Column({ type: 'jsonb', nullable: true })
metadata?: Record<string, unknown>;
```

The `InitialSchema` migration also creates it: `"metadata" jsonb`.

Neither the current documentation nor the plan mentions this column. Since the plan's purpose is to sync the doc with the actual schema, `metadata` must be added to the `module_sessions` table in Task 1.

**Suggested addition to the schema table:**

| `metadata` | jsonb nullable | Произвольные метаданные сессии. |

### 2. Stale `ModuleInstructionService` name not addressed

`database.md` references `ModuleInstructionService` in two places:
- **Line 3** (intro): `...переданные через \`ModuleInstructionService\``
- **Line 26** (session_stream_samples description): `Хранит инструкции, переданные через \`ModuleInstructionService\``

The actual proto service is `ModuleInstructionStreamService` (`proto/module_instruction_stream.proto`, line 69). The Phase 12 roadmap includes a fix for `protocol.md` to rename `ModuleInstructionService` → `ModuleInstructionStreamService`, but that task only targets `protocol.md`. No Phase 12 task covers the same stale reference in `database.md`.

Since the plan already touches both these lines (Task 1 fixes the intro, Task 2 rewrites the section description), the rename should be included here — otherwise `database.md` will remain out-of-sync after implementation.

## Positive Notes

- Both tasks correctly identify every discrepancy between the doc and the actual entity/migration schema.
- Index fix is precise — correctly distinguishes composite vs single-column indices.
- The plan correctly preserves Russian language per the existing doc style.
- Scope is well-bounded — one file, two phases, no unnecessary changes.
- Correctly identifies the `session_stream_samples` as batch-oriented (one row = one flush, not one row = one sample).

## Summary

The plan is well-researched and accurate in what it covers. Two gaps need to be addressed before implementation: the missing `metadata` column and the stale `ModuleInstructionService` name. Both are directly in scope — the plan's goal is to make the doc match the code, and these are cases where it wouldn't.
