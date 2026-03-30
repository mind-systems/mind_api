# Plan: Fix `docs/realtime/database.md`

## Context
The realtime database documentation is out of date — table was renamed (`live_sessions` → `module_sessions`), columns were added/changed, indices differ from code, and the `session_stream_samples` section describes a per-sample schema that no longer exists (now batch-based). This plan brings the doc in sync with the actual entities.

## Settings
- Testing: no
- Logging: no
- Docs: yes (single file edit)

## Tasks

### Phase 1: Fix intro and `module_sessions` section

- [x] **Task 1: Fix introductory paragraph (line 3)**
  Files: `docs/realtime/database.md`
  Line 3 has a broken backtick gap where the table name was dropped and references the old service name.
  - Replace the empty backtick pair `` ` ` `` with `module_sessions`
  - Replace `ModuleInstructionService` → `ModuleInstructionStreamService`
  - Replace `хранит инструкции, переданные через` → `хранит батчи сэмплов, переданные через` (aligns with the new batch model)

- [x] **Task 2: Rewrite `module_sessions` section (lines 5–22)**
  Files: `docs/realtime/database.md`
  The section header and body still say `live_sessions` and have wrong column types / missing columns / wrong indices.
  - Rename section header `## live_sessions` → `## module_sessions`
  - Change `activityType` type from `varchar` to `enum` and note the value: `breath`
  - Add `resumed` to the `status` enum list — full list: `active`, `disconnected`, `completed`, `abandoned`, `interrupted`, `resumed`
  - Add missing `metadata` column (`jsonb nullable`) between `lastActivityAt` and `createdAt` — description: "Произвольные метаданные сессии."
  - Replace the indices paragraph: remove composite `(userId, status)` and `(userId, createdAt DESC)`; replace with two single-column indices: `IDX … (userId)` and `IDX … (status)` — explain first is for user lookup, second for resumable-session search by status

### Phase 2: Fix `session_stream_samples` and `user_stats`

- [x] **Task 3: Rewrite `session_stream_samples` section (lines 24–36)**
  Files: `docs/realtime/database.md`
  Current doc lists per-sample columns (`moduleId`, `instructionType`, `recordedAt`, `data`) that don't exist in the entity. Real entity stores a batch.
  - Replace the section description: "Хранит батчи сэмплов, переданные через `ModuleInstructionStreamService`." Mention that `StreamEngine` flushes the buffer every 5 seconds or on session end.
  - Replace the column table with the real schema:
    - `id` — uuid PK
    - `moduleSessionId` — uuid FK → module_sessions (ON DELETE CASCADE), indexed
    - `samples` — jsonb, array of sample objects
    - `flushedAt` — timestamptz, time the batch was flushed
    - `createdAt` — timestamptz
  - Remove old columns (`liveSessionId`, `moduleId`, `instructionType`, `recordedAt`, `data`)

- [x] **Task 4: Add `maxCompletedComplexity` to `user_stats` section**
  Files: `docs/realtime/database.md`
  The entity has a `maxCompletedComplexity` column (float, default 0) between `longestStreak` and `lastSessionDate` that is missing from the doc.
  - Insert a row for `maxCompletedComplexity` (`float default 0`) between `longestStreak` and `lastSessionDate` in the table — description: "Максимальная сложность завершённой сессии."
