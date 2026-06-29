# Test plan — bio ingest ownership, not echo-match (T2, silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context (handoff 06-generic-session-data-flow, test philosophy)

Covers feature task [[35-generalize-bio-ingest-ownership]]. Committed **RED until** spec 35.

## Why this area (silent-failure filter)
The owner-resolution is the silent part: bio must always be **stored under the server-resolved root id** regardless of what the client echoes. A regression that pushes under the client echo (or rejects a valid batch) is invisible to the ingest path — the bug surfaces only later as bio missing from the windowed read. The batch-hygiene rejections (empty/inconsistent/missing-sampleType) are **loud** `INVALID_ARGUMENT` paths — smoke-check only.

## Red/Green contract
- **Target (RED until [[35-generalize-bio-ingest-ownership]]):** a batch whose echoed `session_id` is **not** the root id (a child id / stale id) is **accepted** and pushed under `root.id`. Today this is rejected `SESSION_MISMATCH` → clean RED; after spec 35 it acks and `pushBatch(root.id, …)` is called → GREEN.
- **Characterization (stay GREEN):** a batch echoing the correct root id still pushes under `root.id` and acks `sessionId: root.id`; batch-hygiene rejections (empty batch, missing/inconsistent sessionId, missing sampleType) still emit `INVALID_ARGUMENT`; `ensureRoot → undefined` still emits `NO_ROOT_SESSION`; overflow still surfaces `ack.droppedCount`.

## Two-state observability (validated at authoring)
- **Vantage:** drive `streamData(request$, user)` (or call the private `handleBatch(userId, batch, subscriber)` via `(controller as any)`), capture the **first non-`ready` frame** (the existing `firstNonReadyFrame` helper) — ack or error. Owner id is observable as the arg to the mocked `streamEngine.pushBatch` and as `ack.sessionId`.
- **RED now:** a child-id-echo batch → the controller emits a `SESSION_MISMATCH` error frame, `pushBatch` not called → the target (expecting an ack + `pushBatch('root-1', …)`) fails cleanly (wrong code / no push), no hang (P6 pattern).
- **GREEN after:** same batch → ack present, `pushBatch` called with `root.id`.

## Instantiation
`ModuleBiometricStreamGrpcController(streamEngine, activityEngine, activeStreamRegistry)` (3 ctor args, `module-biometric-stream.grpc.controller.ts:34-38`) with mocked `BiometricStreamEngine` (`pushBatch: jest.fn().mockReturnValue({ acceptedCount, droppedCount:0, totalReceived:1, totalDropped:0 })`, `maxSamplesPerSecond`), `ActivityEngine` (`ensureRoot: jest.fn().mockResolvedValue(makeRoot({id:'root-1'}))`), `ActiveStreamRegistry`. Reuse the existing `makeRoot()` fixture and `firstNonReadyFrame` helper.

## Inlined contracts (self-contained)
- **`activityEngine.ensureRoot(userId, clientTs?): Promise<ModuleSession | undefined>`** — owner field `root.id` (uuid PK; **no `sessionId` field**). `handleBatch` is async.
- **`streamEngine.pushBatch(sessionId, mapped): { acceptedCount, droppedCount, totalReceived, totalDropped }`** — keyed by the supplied id; controller acks `droppedCount: result.totalDropped`, `sessionId: <ownerId>`.
- **Error codes are literal strings in the controller:** `'INVALID_ARGUMENT'` (steps 1–4, `:92,:98,:106,:113`), `WsErrorCode.NO_ROOT_SESSION === 'NO_ROOT_SESSION'` (step 5). Spec 35 **removes** the step-6 `SESSION_MISMATCH` block (`:124-131`).
- **Batch shape** `BioSampleBatch`: `{ samples: [{ sessionId, timestamp, sampleType, data }] }`.

## Test cases
### Target (RED until 35)
- **child-id echo is accepted and stored under root** — `ensureRoot → root-1`, batch carries `sessionId: 'child-9'`; assert the first non-ready frame is an **ack** (not error), `pushBatch` called with `'root-1'`, `ack.sessionId === 'root-1'`. (Today → `SESSION_MISMATCH`, no push → RED.)
- **stale/arbitrary echo is accepted under root** — same with `sessionId: 'whatever'` → ack + `pushBatch('root-1', …)`.

### Characterization (stay GREEN)
- correct root-id echo → ack + `pushBatch('root-1', …)` (already GREEN; guards that spec 35 didn't break the happy path).
- empty batch / missing sessionId (`''`) / inconsistent sessionId / missing sampleType → `INVALID_ARGUMENT` (smoke, one assert each).
- `ensureRoot → undefined` → `NO_ROOT_SESSION`.
- paused root → batch still accepted (pause does not block bio).
- overflow → `ack.droppedCount` reflects `totalDropped` (do not inspect buffer internals).

## Anti-targets (INVERT, by file:line)
In `src/realtime/module-biometric-stream.grpc.controller.spec.ts`, the committed bio-root suite (shipped GREEN from [[10-bio-ingest-to-root]] / [[21-test-bio-ingest-to-root]]) contains the case `'[…] should reject a batch whose session_id is a child id with SESSION_MISMATCH'` (in `describe('streamData — bio bound to root')`, per note 10 §GREEN list around `spec :364-380`): it sets `ensureRoot → root-1`, sends a `child-9` batch, and asserts `frame.error.code === 'SESSION_MISMATCH'` with `pushBatch` NOT called. **INVERT** it to assert acceptance: `frame.ack` defined, `pushBatch('root-1', …)` called, no error. Before editing, grep the spec for `SESSION_MISMATCH` to confirm the exact line (the suite may have shifted since note 10); there is exactly one such case in the bio controller spec.

**Keep GREEN:** the correct-root-id, `NO_ROOT_SESSION`, paused-root, batch-hygiene, and overflow cases — spec 35 leaves all of those intact.

## Findings
- Spec 35's only structural edit is deleting the step-6 echo-match block; the engine and flush mechanics are untouched, so the engine-level lifecycle tests (`biometric-stream-engine.service.spec.ts`) are unaffected and out of scope for T2.
