# Plan: Client `client_timestamp_ms` on `ActivityStartCmd`/`ActivityEndCmd` → `startedAt`/`endedAt`

## Context
Put the activity lifecycle on the same client clock as phase markers and biometric samples by letting the client stamp `startedAt`/`endedAt` via an optional `client_timestamp_ms`, removing the server-receipt latency that currently leaks into `endedAt`. Backward compatible: absent field → server `now()` (today's behavior).

## Settings
- Testing: yes (update `activity-engine.service.spec.ts` only — required by the spec)
- Logging: minimal (keep existing `Session started`/`Session ended … durationMs` logs)
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Add optional `client_timestamp_ms` to both commands**
  Files: `proto/module_state.proto`
  In `ActivityStartCmd` (currently `activity_type = 1`, `optional ref_id = 2`, `reserved 3`) add `optional int64 client_timestamp_ms = 4;` — keep `reserved 3` untouched. In `ActivityEndCmd` (currently `{}`) add `optional int64 client_timestamp_ms = 1;`. Add a short comment on each field noting it is the client wall-clock instant driving `startedAt`/`endedAt`, optional for backward compatibility. Do NOT touch `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`.

- [x] **Task 2: Regenerate gRPC stubs** (depends on Task 1)
  Files: `proto/generated/` (generated — do not hand-edit)
  Run `npm run proto:gen`. Verify the regenerated `module_state` types expose `clientTimestampMs` on `ActivityStartCmd` and `ActivityEndCmd`. Commit the generated output as-is; never hand-edit files under `proto/generated/`.

### Phase 2: Engine

- [x] **Task 3: Add `coerceClientTs` helper to the engine** (depends on Task 2)
  Files: `src/realtime/services/activity-engine.service.ts`
  Add a private helper `coerceClientTs(clientTimestampMs?: number | Long | string): Date | null`. ts-proto int64 arrives as a `Long`/string, so coerce with `Number(...)` (same pitfall as the bio-sample Long handling). Return `null` when the value is absent, `0`, `NaN`, or non-finite; otherwise return `new Date(Number(ts))`. Treating all invalid inputs as absent lets callers fall back to `now()`.

- [x] **Task 4: Make `startActivity` accept a client start timestamp, splitting the shared `now`** (depends on Task 3)
  Files: `src/realtime/services/activity-engine.service.ts`, `src/realtime/dto/activity-start.dto.ts`
  Add `clientTimestampMs?: number` to `ActivityStartDto` (`@IsOptional()` `@IsNumber()`). In `startActivity`, keep `const now = new Date()` but **split the assignments**: `startedAt = this.coerceClientTs(dto.clientTimestampMs) ?? now`, while `lastActivityAt = now` stays server `now()` — never the client value. Mirror the same split into the in-memory `ActivityState` (`state.startedAt = saved.startedAt` may be client; `state.lastActivityAt = saved.lastActivityAt` stays server `now`). This split is mandatory load-bearing: coupling `lastActivityAt` to a behind client clock makes the watchdog reap a freshly-DISCONNECTED session inside the reconnect-grace window. Keep the `SESSION_EVENT` `STARTED` marker on server `Date.now()`.

- [x] **Task 5: Make `endActivity` accept a client end timestamp with the sanity rule** (depends on Task 3)
  Files: `src/realtime/services/activity-engine.service.ts`
  Change signature to `endActivity(userId: string, clientTimestampMs?: number)`. Keep `const now = new Date()`. Compute `const clientEnd = this.coerceClientTs(clientTimestampMs)` and set `session.endedAt = (clientEnd && clientEnd.getTime() >= session.startedAt.getTime()) ? clientEnd : now`. Single sanity rule: if the client end is absent/invalid OR lands before `startedAt`, use `now()` — no clamping, no negative values. Do NOT touch `lastActivityAt` (session goes `COMPLETED`, ignored by the watchdog). Keep the `SESSION_EVENT` `ENDED` marker on server `Date.now()` and the existing `durationMs = endedAt - startedAt` log so the chosen value is visible.

### Phase 3: Controller wiring

- [x] **Task 6: Pass client timestamps from the gRPC controller into the engine** (depends on Task 4, Task 5)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In `handleActivityStart`, pass `clientTimestampMs: cmd.clientTimestampMs` into the `startActivity(userId, { activityType, activityRefId, … })` call. Update the end dispatch (`else if (msg.activityEnd !== undefined)` at ~line 208) and `handleActivityEnd` to forward `msg.activityEnd.clientTimestampMs`: change `handleActivityEnd(userId, subscriber)` to also accept the cmd (or the raw `clientTimestampMs`) and call `endActivity(userId, cmd.clientTimestampMs)`. Do not alter stop/pause/resume routing.

### Phase 4: Tests

- [x] **Task 7: Update `activity-engine.service.spec.ts` expectations** (depends on Task 4, Task 5)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Update/extend cases: (a) with a client ts on start/end → `startedAt`/`endedAt` equal the supplied instant; without → `expect.any(Date)` as today. (b) Negative/garbage/`endedAt < startedAt` client ts → falls back to `now()`, `durationMs >= 0`. (c) **New case (the critical guard):** supply a past `clientTimestampMs` to `startActivity` and assert `lastActivityAt` stays server-clocked — `lastActivityAt !== startedAt` and `lastActivityAt ≈ now` (not the client value).

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add optional client_timestamp_ms to activity start/end proto"
- **Commit 2** (after tasks 3-5): "Use client-sourced timestamps for activity startedAt/endedAt"
- **Commit 3** (after tasks 6-7): "Wire client activity timestamps through controller and update engine tests"
