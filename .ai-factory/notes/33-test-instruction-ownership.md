# Test plan — instruction ingest ownership for N sessions (T3, silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context (handoff 06-generic-session-data-flow, test philosophy)

Covers feature task [[36-generalize-instruction-ingest-ownership]]. Committed **RED until** spec 36. The meaty test task — it proves concurrent phase streams and root marks route correctly.

## Why this area (silent-failure filter)
Routing is the silent part: a `breath_phase` for a live owned child must reach `streamEngine.push(<that child id>, …)`. Today the controller resolves the **sole** child (`getActiveSession → getSoleChild`), so with two concurrent children it silently rejects **both** (sole-child is undefined → `NO_SESSION`), and it rejects a root-tagged mark (`SESSION_MISMATCH`). Mis-routing or wrong rejection corrupts the timeline with no exception. The `INVALID_ARGUMENT` missing-sessionId path and the auth path are loud — smoke only.

## Red/Green contract
- **Target (RED until [[36-generalize-instruction-ingest-ownership]]):**
  - phases tagged with **two different live child ids** are both accepted → two `push` calls, one per child id;
  - a mark tagged with the **root id** is accepted → `push(root.id, …)`;
  - a `sessionId` **not owned** by the user is rejected `SESSION_NOT_FOUND`, no `push`.
- **Characterization (stay GREEN):** auth (null user → `UNAUTHENTICATED`, no register); the `ready` frame still emits on subscribe; a `breath_phase` for a **paused but owned** session still pushes + acks (no `SESSION_PAUSED`); missing `sessionId` → `INVALID_ARGUMENT`.

## Two-state observability (validated at authoring)
- **Vantage:** the mocked `streamEngine.push` (jest.fn) — assert it is called with the expected `sessionId`(s); and the emitted frames on the subscriber (ack vs error). Resolution physically lands at the controller's per-sample handler (where the feature swaps `getActiveSession` → `getSession`), which the mock observes directly.
- **RED now:** with the **new** mock (`getSession`), today's controller never calls `getSession` (it calls `getActiveSession`) → for a two-children scenario it emits `NO_SESSION` and never pushes → the target (expecting two `push` calls) fails cleanly. Drive via `streamData(request$, user)` and assert on the first relevant frame / the `push` spy — no hang.
- **GREEN after:** the controller calls `getSession(userId, msg.sessionId)`; owned ids push, unowned ids reject.

## Instantiation
`ModuleInstructionStreamGrpcController(streamEngine, activityEngine, activeStreamRegistry)` (3 ctor args, `module-instruction-stream.grpc.controller.ts:32-36`). Mocks:
- `streamEngine`: `{ maxSamplesPerSecond: 50, push: jest.fn().mockReturnValue({ accepted:true, droppedCount:0, totalReceived:1 }) }`.
- `activityEngine`: **`{ getSession: jest.fn() }`** (replacing the old `{ getActiveSession }` — see anti-targets). Configure per test: `getSession.mockImplementation((u, sid) => OWNED.has(sid) ? makeState(sid) : undefined)`.
- `activeStreamRegistry`: `{ register, deregister, closeAll }`.
Drive `streamData(request$, user)`; push `StreamSample`s via `request$.next(...)`.

## Inlined contracts (self-contained)
- **`activityEngine.getSession(userId, sessionId): ActivityState | undefined`** — spec 36 adds this to `ActivityEngine` as a thin delegate to `activitySessionStore.getSession`, which resolves **child-or-root**: returns the `ActivityState` for any owned child or the root, else `undefined`. (The engine has `getActiveSession`/`getSoleChild`/`listLiveSessions` today, but **not** `getSession` — spec 36 adds it.)
- **`streamEngine.push(sessionId, { timestamp:number, moduleId, instructionType, data })`** → `{ accepted, droppedCount, totalReceived }`. Keyed by `sessionId`; different ids buffer independently.
- **`StreamSample`** (proto): `{ sessionId, timestamp, moduleId, instructionType, data }`. Helper: `makeBreathPhaseSample(sessionId)` (existing in spec, `:56-64`) builds one with `instructionType = StreamDataType.BREATH_PHASE`, `data: undefined`.
- **Rejection code:** literal **`'SESSION_NOT_FOUND'`** (spec 36's new ownership-miss code; the controller emits literal strings, not `WsErrorCode`). The retired `'NO_SESSION'`/`'SESSION_MISMATCH'` codes are gone.
- Frames: `{ ready }`, `{ ack: { sessionId, receivedCount, droppedCount, maxSamplesPerSecond, timestamp } }`, `{ error: { code, message, timestamp } }`.

## Test cases
### Target (RED until 36)
- **two concurrent children both accepted** — `getSession` returns a state for `child-A` and `child-B` (and undefined otherwise); push a `breath_phase` for each; assert `push` called with `'child-A'` and with `'child-B'` (two calls), two acks, no error.
- **root-tagged mark accepted** — `getSession(u,'root-1')` returns the root state; push a sample with `sessionId:'root-1'`; assert `push('root-1', …)` and an ack.
- **unowned session rejected** — `getSession(u,'someone-else')` returns undefined; push a sample with `sessionId:'someone-else'`; assert an `error` frame with `code === 'SESSION_NOT_FOUND'` and `push` NOT called for that id.

### Characterization (stay GREEN)
- null user → `UNAUTHENTICATED` RpcException, `register` not called (`spec :88-107`).
- `ready` frame emitted synchronously on subscribe (`spec :182-204`).
- **paused owned session** → `breath_phase` still pushes + acks, no `SESSION_PAUSED` error (`spec :109-217`, the pause pass-through suite — preserved, but its mock wiring is inverted, see anti-targets).
- missing `sessionId` (`''`/undefined) → `INVALID_ARGUMENT`, no push.

## Anti-targets (INVERT, by file:line — `module-instruction-stream.grpc.controller.spec.ts`)
The committed spec pins the retired `getActiveSession` mechanism; invert the mock wiring (the assertions about pushing-while-paused stay, only the resolver changes):
- **`:42-46`** `makeActivityEngine()` exposes `getActiveSession: jest.fn().mockReturnValue(undefined)` → **INVERT** to `getSession: jest.fn()` keyed by `(userId, sessionId)`.
- **`:114`** `activityEngine.getActiveSession.mockReturnValue(makePausedSession({ sessionId }))` → **INVERT** to `activityEngine.getSession.mockReturnValue(makePausedSession({ sessionId }))` (or `.mockImplementation((u,sid)=>sid===sessionId?makePausedSession({sessionId}):undefined)`).
- **`:136`** same → **INVERT** to `getSession`.
- **`:159`** same → **INVERT** to `getSession`.

No committed test asserts the `NO_SESSION`/`SESSION_MISMATCH` error frames (the spec only covers auth + pause pass-through), so those two deleted guards have **no** test to invert — confirmed by reading the whole spec (218 lines). The four lines above are the complete anti-target set.

## Findings
- The pause pass-through suite is **characterization** that survives spec 36 (instruction ingest never had a pause block), but it is coupled to the retired resolver — hence the mock-wiring inversion above. Its behavioral assertions (push happens, ack not `SESSION_PAUSED`) are unchanged.
- `streamEngine.push` is keyed by the supplied `sessionId` with no change in spec 36, so per-child buffering is automatic — the target asserts the **call args**, never buffer internals.
