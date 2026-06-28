# Exclude root sessions from stats and run history

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The root session is presence, not a practice. It must never count toward streak / total duration, and must never appear in the run-history list. Without this guard, a root abandoned on disconnect grace would emit `SessionEvents.ABANDONED` and pollute `user_stats`.

## Details

### Current state (verified line numbers)
- `src/stats/stats.worker.ts` — three handlers, each calling `this.statsService.finalise(event)`: `onSessionCompleted` `@OnEvent(SessionEvents.COMPLETED)` (lines 13-30), `onSessionAbandoned` `@OnEvent(SessionEvents.ABANDONED)` (lines 32-49), `onSessionInterrupted` `@OnEvent(SessionEvents.INTERRUPTED)` (lines 51-68). Payload type `SessionEvent` (`stats.service.ts:9-16`) carries `activityType: ActivityType` (field at line 14) plus `sessionId`, `userId`, `startedAt`, `endedAt`, optional `activityRefId`.
- `src/stats/stats.service.ts` — `finalise(event)` (lines 36-120) updates `user_stats`. Only filter is min-duration (`durationSeconds < this.minSessionDurationS`, lines 45-50); no type exclusion.
- `src/sessions/sessions.service.ts` `listRuns` — `baseQuery` built at lines 78-90; `.where('ms.userId = :userId', …)` is line 88, `.andWhere('ms.endedAt IS NOT NULL')` is line 89, `.orderBy('ms.startedAt', 'DESC')` is line 90. A root (abandoned → has `endedAt`) would surface.

### Inlined contracts (this note is self-contained — do not open other notes)
- **`ActivityType` enum** (`src/realtime/enums/activity-type.enum.ts`) — string enum. Today it has `BREATH = 'breath'`, `MEDITATION = 'meditation'`. The root member `ROOT = 'root'` (literal string `'root'`) is introduced by the schema task ([[02-root-session-schema]], breadcrumb). If `ROOT` is not yet on the enum when this note is implemented, add `ROOT = 'root'` to it as part of this change — the guard compares `event.activityType === ActivityType.ROOT`.
- **`SessionEvent` shape** (the argument to `finalise`, defined `stats.service.ts:9-16`): `{ sessionId: string; userId: string; startedAt: Date; endedAt: Date; activityType: ActivityType; activityRefId?: string }`. The guard branches on the `activityType` field only.

### Change
1. Guard placement: at the **top of `StatsService.finalise`** (`stats.service.ts:36-37`, before the duration computation at line 41) add an early return:
   ```ts
   if (event.activityType === ActivityType.ROOT) return;
   ```
   `ActivityType` is already imported at `stats.service.ts:7` (`../realtime/enums/activity-type.enum`); `ROOT` is the `'root'` member (see Inlined contracts). The guard MUST be a single early-return at the top of `StatsService.finalise`, keyed on `event.activityType === ActivityType.ROOT`, before the duration computation — it covers all three worker handlers in one place. Do **not** guard the `StatsWorker` handlers instead: the worker forwards every event type unconditionally, and the committed test (`stats.service.spec.ts:114`) calls `svc.finalise(...)` directly and asserts `repo.manager.transaction` was not called — a worker-level guard would leave that test permanently RED.
2. `listRuns` baseQuery: insert an additional `.andWhere` after the `endedAt` filter (between current lines 89 and 90, before `.orderBy`):
   ```ts
   .andWhere('ms.activityType != :root', { root: ActivityType.ROOT })
   ```
   `ActivityType` is already imported at `sessions.service.ts:20`.

### Guards / gotchas
- Do **not** skip the bio flush for root. The bio flush lives in `src/realtime/services/biometric-stream-engine.service.ts` as **separate** `@OnEvent` handlers keyed by `payload.sessionId`: `onSessionCompleted` `@OnEvent(SessionEvents.COMPLETED)` (lines 204-213), `onSessionAbandoned` `@OnEvent(SessionEvents.ABANDONED)` (lines 216-225), `onSessionInterrupted` `@OnEvent(SessionEvents.INTERRUPTED)` (lines 228-238), `onSessionRevoked` `@OnEvent(SessionEvents.REVOKED)` (line 240+). These must still run on root abandon so buffered bio is persisted. Guarding the *stats* path (`StatsService.finalise`) does not touch these handlers — leave `biometric-stream-engine.service.ts` untouched.
- The min-duration filter (`WS_MIN_SESSION_DURATION_S`, default 10 — `stats.service.ts:30-33`) is orthogonal and stays.

### Verify
- Connect + disconnect a stream with no activity → root abandoned → `user_stats` unchanged.
- `GET /users/me/stats` ignores root.
- Run-history list excludes root rows.

## Test reconciliation (committed tests)

### GREEN list — cases this note flips RED→GREEN
- `stats.service.spec.ts:114` `finalise — root excluded › should NOT write user_stats for a root session` — depends on the early-return at the **top of `StatsService.finalise`** keyed on `event.activityType === ActivityType.ROOT`, placed BEFORE `repo.manager.transaction` (`stats.service.ts:58`). The test asserts `repo.manager.transaction` was NOT called. The guard MUST be in the service, not the worker (see Change-1).
- `sessions.service.spec.ts:325` `listRuns › should add an activityType != root filter` — depends on the `.andWhere('ms.activityType != :root', { root: ActivityType.ROOT })` clause. The test reads `qb.andWhere.mock.calls.some(([sql]) => /activityType/.test(sql) && /!=/.test(sql))`; the literal SQL satisfies both regexes. The bound param value is intentionally not asserted (so `ActivityType.ROOT` may lag from spec 02).

### Invariants that must stay GREEN (this note must NOT perturb)
- `stats.service.spec.ts:100` `short session skipped` — the min-duration gate is orthogonal and stays. The root early-return sits ABOVE the duration computation, so it neither bypasses nor duplicates the min-duration check for non-root types.
- `stats.service.spec.ts:133-282` all non-root `finalise` write cases (first / same-day / consecutive / broken / longest) — these use `ActivityType.BREATH`; the guard fires only on `ROOT`, so the transaction still runs.
- `sessions.service.spec.ts:349` `listRuns › still return breath and meditation rows` — the new `.andWhere` is an inert stub in the mock and does not touch JS-side row mapping.
- `biometric-stream-engine.service.spec.ts:254` `root ABANDONED › should still flush the bio buffer` — the bio flush is a SEPARATE `@OnEvent` handler keyed by `payload.sessionId` in `biometric-stream-engine.service.ts`; the stats guard does not reach it. Leave that file untouched (see Guards / gotchas).

### Resolved gap-fix
- DROPPED the "alternatively guard each `StatsWorker` handler" alternative. The guard is pinned to a single early-return at the top of `StatsService.finalise` — a worker-level guard leaves `stats.service.spec.ts:114` permanently RED because the test calls `finalise` directly.

## Open Questions
- None.
