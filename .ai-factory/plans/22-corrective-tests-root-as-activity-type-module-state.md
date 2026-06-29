# Plan: Corrective tests — root-as-activity-type (module-state)

## Context
Supersede the withdrawn connect-frame/`isRoot` assertions that T1 committed in `module-state.grpc.controller.spec.ts` (`5221b38`) and replace them with the new contract: the root is a **client-started** module session opened by `activity:start { activity_type: ROOT }`, discriminated by `activity_type === ROOT` (not a connect-time ROOT frame, not an `isRoot` boolean). This is a test-only change in `mind_api`.

## Settings
- Testing: yes (the deliverable is the corrected spec file)
- Logging: no
- Docs: no

## Notes / Constraints
- **Single file touched:** `src/realtime/module-state.grpc.controller.spec.ts`. No production code, no proto, no migration.
- **Two-state contract** (from `.ai-factory/notes/37-test-root-as-activity-type.md`):
  - **Characterization** cases (auth, teardown, setup-error, `handleSessionRevoked`, command-routing, and the reverted RESUMED/ABANDONED reconnect frames) must stay **GREEN**.
  - **Target** cases (new client-started-root contract) stay **RED until a1** (`.ai-factory/notes/34-deliver-root-id-on-connect.md`).
- **Compile-now rule:** `ActivityType.ROOT` and `StateEvent.activity_type` do not exist in the generated stub until a1 regenerates. So the spec must compile today:
  - For the ROOT input enum value use a numeric cast — `activityType: 3 as ActivityType` (a1 adds `ROOT = 3`), ideally via a local `const ROOT_ACTIVITY_TYPE = 3 as ActivityType` with an explanatory comment.
  - For the discriminator assertion read the field via a cast using its **camelCased** name: `(frame.sessionState as any).activityType === 3` (ROOT). `ts-proto` camelCases every snake_case proto field (`module_session_id → moduleSessionId`, `is_paused → isPaused`), so a1's `ActivityType activity_type = 4` generates as `activityType` — asserting `.activity_type` would read a key that never exists and leave the target falsely RED forever. The `as any` cast is still required (the field is absent from the stub until a1 regenerates). Never reference a not-yet-generated symbol directly.
- Line numbers below are against the **current committed** file (verified during planning); apply the edits by content, not by absolute line.
- **Advisory for a1 (not a task here):** the reject-root-end/stop targets this plan adds, together with the existing no-explicit-sessionId characterization cases (e.g. "should call `endActivity(userId)` when ActivityEnd is received", ~`:874`), will catch a naive a1 guard. a1's reject must be `resolved.sessionId !== undefined && resolved.sessionId === getRootId(userId)` — a bare `resolved.sessionId === getRootId(userId)` compares `undefined === undefined` for a no-sessionId end and would wrongly reject `CANNOT_END_ROOT`, breaking those GREEN cases. No action in this plan; flagged so a1 isn't surprised.

## Tasks

### Phase 1: Revert the withdrawn connect-ROOT / `isRoot` assertions

- [x] **Task 1: Revert the RESUMED `(a)` and fresh-connect reconnect cases**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  In `describe('trackActivity — reconnect path')`:
  - `(a)` RESUMED case (`it('should emit StateResponse.sessionState with status RESUMED ...')`, ~`:152-180`): drop the `activityEngine.ensureRoot.mockResolvedValue({ id: 'root-1' })` setup (~`:156-158`); change `expect(values).toHaveLength(2)` → `toHaveLength(1)`; keep the `values[0].sessionState` `toMatchObject({ status: RESUMED, isPaused: false })`; delete the `values[1]` `moduleSessionId === 'root-1'` and `isRoot === true` assertions (~`:176-177`). Update the leading comment (~`:151`) from `emits [RESUMED, ROOT]` to `emits [RESUMED]` only.
  - Fresh-connect case (`it('should emit the root frame on a fresh connect when handleReconnect returns null ...')`, ~`:202-223`): drop the `ensureRoot` setup; change the assertion to **no emission** — `expect(values).toHaveLength(0)`; delete the `moduleSessionId`/`isRoot` assertions; rename the `it` title to `'should not emit any frame on a fresh connect'`.
  - Leave the GREEN cases untouched: resumed-id at `values[0]` (~`:182-200`), subscribe-ordering (~`:225-244`), subscriber-closed → len 0 (~`:246-281`).

- [x] **Task 2: Revert the ABANDONED `(b)` and no-clientSessionId `(c)` reconnect cases**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  - `(b)` ABANDONED case (~`:284-312`): drop the `ensureRoot` setup; change `toHaveLength(2)` → `toHaveLength(1)`; keep the `values[0]` `toMatchObject({ status: ABANDONED, moduleSessionId: 'client-session-id' })`; delete the `values[1]` root-1 + `isRoot` assertions (~`:308-309`). Update the leading comment to `[ABANDONED]`.
  - `(c)` case (`it('(c) should emit the root frame on connect when handleReconnect returns null and no clientSessionId ...')`, ~`:315-336`): drop the `ensureRoot` setup; change to **no emission** — `expect(values).toHaveLength(0)`; delete the `moduleSessionId`/`isRoot` assertions; update the title/comment to reflect "no frame".

- [x] **Task 3: Delete the obsolete connect-ROOT target tests and revert `(d)`** (depends on Task 1, Task 2)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  - **Delete** `it('should emit a session:state carrying the root id on a fresh connect ...')` (~`:340-361`) — there is no connect root frame; its intent moves to the new ROOT-start target (Task 4).
  - **Delete** `it('should distinguish the root frame from a child by isRoot === true ...')` (~`:363-401`) — replaced by the `activity_type` discriminator target (Task 4).
  - **Delete** `it('should announce the root id after the RESUMED frame on a resumed-child reconnect ...')` (~`:403-432`) — no announced ROOT frame; the RESUMED-only shape is already covered by the reverted `(a)`.
  - **Revert** `(d)` (`it('(d) stream stays open after abandoned emit ...')`, ~`:436-474`): drop the `ensureRoot` setup (~`:438-440`); after connect change `toHaveLength(2)` → `toHaveLength(1)` and delete the `values[1]` root-1 assertion (~`:460`), keeping `values[0]` ABANDONED; after the `activityStart`, change `toHaveLength(3)` → `toHaveLength(2)` and move the ACTIVE/new-session assertions from `values[2]` to `values[1]`. Update the surrounding comments (~`:434-435`, `:457`) to drop the `[ABANDONED, ROOT]` wording.
  - Optional cleanup: the `setupRoutingStream` drain comment (~`:757-762`) still references "root frame emitted by feature 34"; the drain itself is now a harmless no-op on the default `handleReconnect → null` path — refresh the comment so it no longer implies a connect-time root frame (keep the `values.length = 0` drain).

### Phase 2: Add the client-started-root target cases (RED until a1)

- [x] **Task 4: Add `getRootId` mock and the `client-started root` target describe** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  - In `makeActivityEngine()` (~`:28-44`) add **only** `getRootId: jest.fn()` (the delegate a1 uses on the reject-end path; do **not** add `getSession` — these targets do not need it). Leave the existing `ensureRoot`/`startActivity`/etc. mocks intact.
  - Add a new `describe('trackActivity — client-started root', ...)` block. Use the established vantage: capture `values[]` from `controller.trackActivity(request$, user).subscribe(...)`, drive commands via `request$.next(...)`, and `await flushMicrotasks()` between steps. Define `const ROOT_ACTIVITY_TYPE = 3 as ActivityType` (a1's `ROOT = 3`) with a comment so it compiles before regen. Cases:
    - **ROOT start emits an ACTIVE frame with `activityType === ROOT`** — `ensureRoot.mockResolvedValue(makeSession({ id: 'root-1' }))`; send `{ activityStart: { activityType: ROOT_ACTIVITY_TYPE } }`; assert one `session:state` with `moduleSessionId === 'root-1'`, `status === ActivityStatus.ACTIVE`, and `(frame.sessionState as any).activityType === 3` (ROOT, camelCased field). RED today: `mapProtoActivityType` throws on ROOT → `INVALID_ACTIVITY_TYPE` instead.
    - **ROOT start routes through `ensureRoot`, not `startActivity`** — assert `activityEngine.ensureRoot` was called and `activityEngine.startActivity` was **not** called for the ROOT command.
    - **Idempotent** — two `activity:start ROOT` commands for one user → assert **both frames are `sessionState` (not `sessionError`)** and each `moduleSessionId === 'root-1'` (the ensureRoot identity), independent of any `client_activity_id`. Do **not** assert `values[0].moduleSessionId === values[1].moduleSessionId` as self-equality — today both commands emit `sessionError` with `moduleSessionId === undefined`, so `undefined === undefined` would pass and provide no RED signal. Asserting the literal `'root-1'` is RED today (no `sessionState`) and GREEN after a1.
    - **Child start carries a non-ROOT `activityType`** — `startActivity.mockResolvedValue(makeSession({ id: 'child-1' }))` (do **not** pass `activityType` to `makeSession` — the helper is typed `Partial<{ id: string }>`, so an extra property fails TypeScript's excess-property check, and a1 derives the emitted discriminator from `mapProtoActivityType(cmd.activityType)`, not from the session entity, so the property has no effect); send `{ activityStart: { activityType: ActivityType.BREATH } }`; assert the frame's `(sessionState as any).activityType !== 3` (negative "child is not root" guard).

- [x] **Task 5: Add the reject-root-end / reject-root-stop targets** (depends on Task 4)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Inside the same `trackActivity — client-started root` describe:
  - **Reject root end** — `activityEngine.getRootId.mockReturnValue('root-1')` so the controller resolves the target as the root; send `{ activityEnd: { sessionId: 'root-1' } }`; assert a `sessionError` frame with `code === 'CANNOT_END_ROOT'`, that `activityEngine.endActivity` was **not** called, and that no COMPLETED `sessionState` frame was emitted.
  - **Reject root stop** — same `getRootId` setup; send `{ activityStop: { sessionId: 'root-1' } }`; assert `code === 'CANNOT_END_ROOT'`, `stopActivity` not called, no INTERRUPTED frame.
  - Note (do not assert against `getSession`): mock **`getRootId`**, not `getSession` — a1's guard reads `getRootId`; leaving it `undefined` would make the reject condition false and the target would falsely stay RED after a1 lands.
