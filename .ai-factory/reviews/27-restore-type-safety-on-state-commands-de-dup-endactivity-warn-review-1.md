# Code Review: Restore type-safety on state commands + de-dup endActivity warn

**Branch:** feature/root-session
**Files changed (source):** 2
- `src/realtime/module-state.grpc.controller.ts`
- `src/realtime/services/activity-engine.service.ts`

## Scope

Strictly behavior-preserving cleanup. Two source files touched (plus plan/review artifacts under `.ai-factory/`, not reviewed for code correctness). No proto change, no migration, no entity change.

## Verification

### Task 1 — cast removal (controller)
All five `(cmd as any)` casts removed and replaced with direct field reads:
- `:386` `cmd.clientActivityId` (idempotency dedup, `handleActivityStart`)
- `:441` `cmd.sessionId` (`handleActivityEnd`)
- `:482` `cmd.sessionId` (`handleActivityStop`)
- `:524` `cmd.sessionId` (`handleActivityPause`)
- `:560` `cmd.sessionId` (`handleActivityResume`)

Type-safety confirmed end to end:
- Each handler parameter is typed with the matching generated interface (`ActivityStartCmd`, `ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`).
- `proto/generated/module_state.ts` declares the fields as `string | undefined`: `clientActivityId?` (`:68`), `sessionId?` (`:81`, `:87`, `:92`, `:97`).
- `clientActivityId` flows into a `!== undefined` check (`:387`) — narrowing still works identically.
- The four `cmd.sessionId` reads flow into `resolveTargetSession(userId, explicitSessionId: string | undefined, …)` (`:314-318`) — argument type matches the parameter exactly. No widening or narrowing change.

Runtime behavior is identical: removing a TypeScript cast and a redundant `as string | undefined` annotation produces no emitted-JS difference.

### Task 2 — differentiated warn messages (engine)
Both guards in `endActivity` are preserved; only the two log strings changed:
- `!sid` branch (`:174-179`) → `endActivity: no resolvable session id for userId=${userId}` — fires when no explicit `sessionId` and no sole child resolves.
- `!state` branch (`:181-187`) → `endActivity: session ${sid} not in memory for userId=${userId}` — fires when `sid` resolved but absent from the store.

The `!state` guard remains load-bearing: the code below (`:189-197` root-skip check dereferencing `state.activityType`, and the DB path) requires `state` to be non-null. Both branches still `return null`; control flow and short-circuit order are unchanged. The new `${sid}` interpolation is safe — `sid` is guaranteed defined at that point (the `!sid` guard above returns). No PII logged (userId + session id only).

### Build / suite
- `npm run build` (nest build) completes with no errors — proves all five fields are declared on their interfaces and the cast removal type-checks.

## Findings

None. The diff matches the plan exactly, compiles cleanly, and is genuinely behavior-preserving — no runtime change, no missing migration, no type mismatch, no control-flow alteration.

REVIEW_PASS
