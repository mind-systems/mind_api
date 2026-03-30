# Plan: Delete all 14 existing migration files

## Status: ALREADY COMPLETED

This task was fully completed as part of commit `9a67290` ("Generate clean flat migration" — the implementation of plan 45). That commit deleted all 14 legacy migration files and created the flat replacement `1774863293946-InitialSchema.ts`.

No implementation is needed. The roadmap item should be marked as `[x]` (done).

## Context
Remove every legacy migration file from `src/migrations/`, keeping only the new flat `InitialSchema` migration that replaces them all. This is part of a migration-squash workflow.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Delete legacy migrations

- [x] **Task 1: Delete all 14 old migration files** — DONE in commit `9a67290`
  Files: `src/migrations/1739476800000-InitialSchema.ts`, `src/migrations/1773469567000-AddLiveSession.ts`, `src/migrations/1773473837884-AddSessionStreamSamples.ts`, `src/migrations/1773479812990-AddUserStats.ts`, `src/migrations/1773652922852-AddInterruptedSessionStatus.ts`, `src/migrations/1773909111537-CreatePersonalAccessTokensTable.ts`, `src/migrations/1773909910064-AddTimeOfDayToBreathSessions.ts`, `src/migrations/1773945801918-AddMaxCompletedComplexity.ts`, `src/migrations/1774011442219-AddSoftDeleteToBreathSessions.ts`, `src/migrations/1774011879392-CreateChangeEventsTable.ts`, `src/migrations/1774411084222-RenameActivityTypeBreathSessionToBreath.ts`, `src/migrations/1774552349945-DropActivityRefTypeFromLiveSessions.ts`, `src/migrations/1774778297835-RenameSessionStreamSampleLiveSessionId.ts`, `src/migrations/1774779899323-RenameToModuleSessions.ts`
  All 14 files were deleted in commit `9a67290`. The only file remaining in `src/migrations/` is `1774863293946-InitialSchema.ts`.
