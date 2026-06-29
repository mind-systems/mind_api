# Plan: Remove the dead userId-keyed grace-timer trio

## Context
Delete the unused userId-keyed grace-timer methods from `ActivitySessionStore`; production keys all grace timers by sessionId, and the only caller of the userId-keyed trio is its own internal self-call. Behavior-preserving dead-code removal.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Remove dead code

- [x] **Task 1: Delete the userId-keyed grace-timer trio**
  Files: `src/realtime/services/activity-session-store.service.ts`
  Remove the three legacy userId-keyed methods and their section comment at lines 138-158:
  - `startGraceTimer(userId, onExpiry)` (`:140-147`) — including its internal `this.cancelGraceTimer(userId)` self-call at `:141`
  - `cancelGraceTimer(userId)` (`:149-154`)
  - `hasPendingGraceTimer(userId)` (`:156-158`)
  - the section comment `// ── Grace timers — userId-keyed (legacy, preserved for store spec) ──` (`:138`)
  Leave the sessionId-keyed trio `startGraceTimerForSession` / `cancelGraceTimerForSession` / `hasPendingGraceTimerForSession` (`:162-183`) and the shared `this.timers` map + `this.graceMs` field completely untouched — `*ForSession` reads/writes the same `timers` map and is the live production mechanism.

- [x] **Task 2: Verify build and suite are clean** (depends on Task 1)
  Files: (no edits)
  Confirm the deletion left no dangling references:
  - `grep -rn --include='*.ts' -E '\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(' src/ | grep -v ForSession` → must return zero matches (the only prior match was the deleted self-reference at `:141`).
  - `npm run build` → clean compile.
  - `npm test` → full suite green (store spec cases referencing the removed methods were already retired by note 41, confirmed: no `.spec.ts` references remain).

## Notes
- Single-concern change → one commit at the end. Suggested message: `Remove dead userId-keyed grace-timer trio from ActivitySessionStore`.
- Do not modify the sessionId-keyed `*ForSession` methods or the `timers` / `graceMs` fields under any circumstances.
