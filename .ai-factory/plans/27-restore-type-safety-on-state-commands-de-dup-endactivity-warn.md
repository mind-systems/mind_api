# Plan: Restore type-safety on state commands + de-dup endActivity warn

## Context
Strictly behavior-preserving cleanup: drop five `(cmd as any)` casts in the module-state gRPC controller so the regenerated proto types are enforced again, and give the two identical `endActivity` warn messages distinct text so logs can tell which guard fired. No proto change, no migration, full suite stays green.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Cleanup

- [x] **Task 1: Drop `(cmd as any)` casts on state commands**
  Files: `src/realtime/module-state.grpc.controller.ts`
  Replace the five `(cmd as any).clientActivityId` / `(cmd as any).sessionId` reads with direct `cmd.clientActivityId` / `cmd.sessionId`:
  - `:386` — `const clientActivityId = cmd.clientActivityId;` (idempotency dedup block)
  - `:443` — `cmd.sessionId` in `handleActivityEnd`
  - `:484` — `cmd.sessionId` in `handleActivityStop`
  - `:526` — `cmd.sessionId` in `handleActivityPause`
  - `:562` — `cmd.sessionId` in `handleActivityResume`
  The generated types in `proto/generated/module_state.ts` already declare `ActivityStartCmd.clientActivityId?: string` and `Activity{End,Stop,Pause,Resume}Cmd.sessionId?: string`, both `string | undefined`, so the cast only strips compile-time checking. The `as string | undefined` annotation becomes redundant once the cast is gone — it may be dropped or kept (harmless). No runtime change: the values read identically.

- [x] **Task 2: Differentiate the two `endActivity` warn messages**
  Files: `src/realtime/services/activity-engine.service.ts`
  The two adjacent guards in `endActivity` (`:174-179` `!sid`, `:181-187` `!state`) currently log the identical string `endActivity: no active session in memory for userId=${userId}`. **Keep both guards** — the `!state` guard is load-bearing because the code below it (the root-skip check at `:189-197` and the DB path) dereferences `state`. Change only the two message strings so logs disambiguate which fired:
  - `!sid` branch → `endActivity: no resolvable session id for userId=${userId}`
  - `!state` branch → `endActivity: session ${sid} not in memory for userId=${userId}`
  Control flow is unchanged: both branches still `return null`. No other lines touched.

- [x] **Task 3: Verify build and test suite** (depends on Task 1, Task 2)
  Files: (no edits)
  Run `npm run build` to confirm the controller type-checks with the casts removed (this proves the proto fields are declared). Run `npm test` to confirm the full existing unit suite stays green — no committed test references the removed cast or asserts the warn message text.
