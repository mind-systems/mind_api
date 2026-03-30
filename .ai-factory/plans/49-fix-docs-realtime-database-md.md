# Plan: Fix `docs/realtime/database.md`

## Context
The realtime database documentation is out of sync with the actual schema: table was renamed from `live_sessions` to `module_sessions`, `session_stream_samples` columns are wrong, indices are incorrect, the `resumed` status is missing, the `metadata` column is undocumented, `ModuleInstructionService` references should be `ModuleInstructionStreamService`, and `user_stats` is missing the `maxCompletedComplexity` column.

## Settings
- Testing: no
- Logging: no
- Docs: yes (this milestone is a doc fix)

## Tasks

### Phase 1: Fix module_sessions section

- [ ] **Task 1: Rename `live_sessions` → `module_sessions`, fix intro, and add missing column**
  Files: `docs/realtime/database.md`
  - Fix the broken introductory sentence on line 3: replace the empty backticks (`` ` ` ``) with `` `module_sessions` `` so it reads: "...три таблицы. `module_sessions` фиксирует жизненный цикл...".
  - In the same intro sentence, rename `ModuleInstructionService` → `ModuleInstructionStreamService` (the actual proto service name per `proto/module_instruction_stream.proto`).
  - Also in the same intro sentence, replace "хранит инструкции, переданные через" with "хранит батчи сэмплов, переданные через" so the file-level intro stays consistent with the rewritten `session_stream_samples` section (Task 2 will describe each row as a batch, not an individual instruction).
  - Rename the `## live_sessions` section header to `## module_sessions`.
  - Replace all remaining references to `live_sessions` throughout the file with `module_sessions` (including the FK description in `session_stream_samples` section where it says `FK → live_sessions`).
  - In the status enum description, add `resumed` to the list: `active`, `disconnected`, `completed`, `interrupted`, `abandoned`, `resumed`.
  - Add the missing `metadata` column to the schema table: `metadata` — jsonb nullable — произвольные метаданные сессии. The column exists in `ModuleSession` entity (`@Column({ type: 'jsonb', nullable: true })`) and in the `InitialSchema` migration.
  - Fix the indices paragraph: replace the composite indices claim (`(userId, status)` and `(userId, createdAt DESC)`) with the real single-column indices: `userId` and `status` — two separate indices.

### Phase 2: Rewrite session_stream_samples section

- [ ] **Task 2: Rewrite `session_stream_samples` schema table and fix service name**
  Files: `docs/realtime/database.md`
  - Replace the entire column table in the `## session_stream_samples` section. The current doc lists per-sample columns (`moduleId`, `instructionType`, `recordedAt`, `data`) that don't exist in the real entity (`src/realtime/entities/session-stream-sample.entity.ts`).
  - The correct columns are:
    - `id` — uuid PK
    - `moduleSessionId` — uuid FK → module_sessions (indexed, ON DELETE CASCADE)
    - `samples` — jsonb — array of sample objects (batch)
    - `flushedAt` — timestamp — time the buffer was flushed
    - `createdAt` — timestamp — auto-set on insert
  - Update the section description text to reflect that each row is a batch of samples (not individual instructions). The `StreamEngine` flushes the in-memory buffer periodically, and each flush produces one row with an array of samples in the `samples` column.
  - In the section description, rename `ModuleInstructionService` → `ModuleInstructionStreamService` (same stale reference as in the intro, line 26).
  - Keep the doc language in Russian, matching the existing style and neighboring docs.

### Phase 3: Fix user_stats section

- [ ] **Task 3: Add missing `maxCompletedComplexity` column to `user_stats` table**
  Files: `docs/realtime/database.md`
  - Add `maxCompletedComplexity` to the `user_stats` schema table between `longestStreak` and `lastSessionDate` (matching the column order in the entity `src/stats/entities/user-stats.entity.ts`).
  - Entry: `maxCompletedComplexity` — float default 0 — максимальная сложность среди завершённых квалифицирующих сессий.
