# Code Review: ModuleBiometricStreamGrpcController (review 1)

**Plan:** `.ai-factory/plans/17-modulebiometricstreamgrpccontroller.md`
**Files reviewed:**
- `src/realtime/module-biometric-stream.grpc.controller.ts` (new, 173 lines)
- `src/realtime/realtime.module.ts` (controllers array + TypeOrmModule reflow)
- `src/migrations/1779990145496-AddBioSessionSamplesTable.ts` (whitespace-only re-indent)

## Verification methodology

- `git status` + `git diff HEAD` — full diff inspected.
- Each new/changed file read in full, not just the diff hunk.
- Cross-checked against:
  - `module-instruction-stream.grpc.controller.ts` (mirror pattern source).
  - `BiometricStreamEngine.pushBatch` signature (`acceptedCount/droppedCount/totalReceived/totalDropped`).
  - `ActivityEngine.getActiveSession` return shape (`ActivityState | undefined` with `sessionId`, `isPaused`).
  - `ActiveStreamRegistry.{register,deregister,closeAll}` — confirmed shared registry semantics.
  - `ModuleStateGrpcController.handleSessionRevoked` — confirmed it calls `activeStreamRegistry.closeAll(userId)`, so the bio subscriber is closed alongside the instruction one without a dedicated handler in this controller.
  - `proto/generated/module_biometric_stream.ts` — confirmed `BioSample.timestamp` decodes via `longToNumber()` → `number` (no Long), `BioStreamAck` has exactly the five fields populated, `BioStreamResponse.error` reuses `StateErrorEvent { code, message, timestamp }`.
  - `interfaces/bio-session-buffer.interface.ts` — `BioSampleInternal` shape matches the mapping.
  - `RULES.md` — `@Payload()` rule compliance.

## Correctness

### Validation chain (lines 82–131)

All seven steps are present in the exact mandated order:

| # | Code location | Code | Message | Verdict |
|---|---|---|---|---|
| 1 | L83-86 | `INVALID_ARGUMENT` | `Empty batch` | ✓ |
| 2 | L89-92 | `INVALID_ARGUMENT` | `Missing sessionId` | ✓ |
| 3 | L95-100 | `INVALID_ARGUMENT` | `Inconsistent sessionId in batch` | ✓ |
| 4 | L103-106 | `INVALID_ARGUMENT` | `Missing sampleType` | ✓ |
| 5 | L108-113 | `NO_SESSION` | `No active session found` | ✓ |
| 6 | L115-122 | `SESSION_MISMATCH` | `Session ID does not match active session` | ✓ |
| 7 | L124-131 | `SESSION_PAUSED` | `Cannot accept biometric samples while paused` | ✓ |

Order is correct: step 2 precedes step 3 (an empty-`sessionId` batch surfaces `Missing sessionId`, not `Inconsistent`); the `ActivityEngine` lookup is gated behind all structural checks (no wasted lookups on malformed input). Each failure short-circuits with `return` — no partial accept of the batch.

### Happy path (lines 133–158)

- `batchSessionId = batch.samples[0].sessionId` — correct, sessionId already validated as non-empty and consistent.
- Sample mapping populates the three `BioSampleInternal` fields (`timestamp`, `sampleType`, `data`); `BioSample.timestamp` is `number` under the ts-proto config (verified at `proto/generated/module_biometric_stream.ts:357-366` `longToNumber`), so the direct assignment is safe — no Long conversion needed.
- `pushBatch` is called with the validated session id and mapped samples.
- Ack envelope populates **all five** `BioStreamAck` fields — `sessionId`, `receivedCount` (= `result.totalReceived`, cumulative), `droppedCount` (= `result.totalDropped`, cumulative — matches the proto contract comment at module_biometric_stream proto L46-51), `maxSamplesPerSecond`, `timestamp`. ✓
- Per-call warn-log triggers on `result.droppedCount > 0` (NOT `totalDropped`), so the log fires exactly once per batch that lost samples, mirroring `module-instruction-stream.grpc.controller.ts:127-131`. ✓

### Error envelope / catch block (lines 159–171)

- Top-level `try/catch` around `handleBatch` body catches any unexpected throw (e.g., `JSON.stringify` in `pushBatch`, repo errors during inline operations) and emits a single `INTERNAL_ERROR` envelope. Pattern matches the instruction controller. ✓
- The catch path inlines the `subscriber.next({ error: ... })` literal rather than reusing `emitError` (which was scoped inside `try` — closure would be visible but the implementer chose clarity). Functionally equivalent.

### Stream lifecycle (lines 39–71)

- `@Payload()` on `request` + `@GrpcCurrentUser()` on `user` — RULES.md rule respected; without `@Payload()`, NestJS would deliver `undefined` to the first param. ✓
- Auth gate: `if (!user)` emits `RpcException(UNAUTHENTICATED)` and returns before any registration — no leaked subscriber. ✓
- Register-before-subscribe order matches instruction controller; teardown reliably deregisters and unsubscribes (`subscriber.add(...)`). ✓
- No per-controller `@OnEvent(AuthEvents.SESSION_REVOKED)` — confirmed unnecessary, since `ModuleStateGrpcController.handleSessionRevoked:182` calls `this.activeStreamRegistry.closeAll(userId)` which iterates and completes every subscriber registered under that user (instruction + biometric).

### Class shape

- `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`, `@ModuleBiometricStreamServiceControllerMethods()` — all present in the required order.
- Class does **not** include `implements ModuleBiometricStreamServiceController` despite the plan listing it. This matches the existing convention: `ModuleInstructionStreamGrpcController` also omits the corresponding `implements` clause. The gRPC binding comes from the decorator `@ModuleBiometricStreamServiceControllerMethods()`; the interface is purely informational. Behaviorally identical and consistent with the codebase pattern — not a defect.
- Constructor injects exactly three providers: `BiometricStreamEngine` (not `StreamEngine`), `ActivityEngine`, shared `ActiveStreamRegistry`. ✓

### Module wiring (`realtime.module.ts`)

- Import added: `ModuleBiometricStreamGrpcController` from `./module-biometric-stream.grpc.controller`. ✓
- Added to `controllers` array (not `providers`). ✓
- `TypeOrmModule.forFeature([...])` reflowed across multiple lines — cosmetic, no semantic change. The three entities (`ModuleSession`, `SessionStreamSample`, `BioSessionSample`) are preserved. ✓
- No new `ActiveStreamRegistry` instance — existing shared one is reused. ✓

### Migration whitespace edit

`src/migrations/1779990145496-AddBioSessionSamplesTable.ts` — only indentation re-flow (4-space → 2-space, removed trailing blank line) and `"typeorm"` → `'typeorm'`. SQL bodies (CREATE TABLE / INDEX / DROP) byte-identical. Safe; migration hash unchanged. No runtime impact.

## Security

- No PII in logs. Only `sessionId`, `userId` (UUIDs) appear in log lines — same hygiene as the instruction controller. RULES.md compliance ✓
- No `!` non-null assertions used. ✓
- Auth path emits `UNAUTHENTICATED` before any registry interaction; an unauth'd client can't open a session-scoped subscriber slot. ✓
- Input validation is comprehensive (empty batch, missing/inconsistent sessionId, missing sampleType, no-session, mismatch, pause). A malformed sample can't reach `pushBatch`.

## Runtime risk assessment

- **Migration:** unchanged SQL — no risk.
- **Types:** all imports resolve to existing exports. `Subscriber<BioStreamResponse>` is assignable to `Subscriber<any>` (the registry's parameter type). No TS strictness issues anticipated.
- **Race conditions:** `register` happens synchronously before `request.subscribe`; teardown via `subscriber.add(...)` fires on both client disconnect and `closeAll`'s `subscriber.complete()`. `closeAll` deletes the user's set from the map and then teardown's `deregister` is a no-op against a missing/empty set — graceful, no double-free, no leak.
- **Memory:** subscribers are removed from the registry on teardown; no leak path observed.
- **Backpressure:** the controller does not implement client-side backpressure — same as the instruction controller. `pushBatch` already enforces a buffer byte cap; drops are reported via `droppedCount`/`totalDropped` in the ack. Acceptable for this milestone.

## Plan adherence

| Plan item | Implementation | Verdict |
|---|---|---|
| Decorators + class shell | L24-28 | ✓ |
| Three injected providers, no `StreamEngine` mixup | L33-37 | ✓ |
| `@Payload()` + `@GrpcCurrentUser()` on `streamData` | L40-41 | ✓ |
| `Observable` wrap + auth gate | L43-52 | ✓ |
| Registry register/deregister + teardown logging | L56, L65-69 | ✓ |
| Subscribe to upstream batch stream | L58-63 | ✓ |
| 7-step validation in exact order | L82-131 | ✓ |
| Sample mapping with no Long conversion | L136-140 | ✓ |
| All 5 ack fields populated | L144-152 | ✓ |
| Per-call warn-log on `droppedCount > 0` | L154-158 | ✓ |
| Try/catch with `INTERNAL_ERROR` fallback | L78, L159-171 | ✓ |
| Controller registered in `controllers`, not `providers` | `realtime.module.ts:35` | ✓ |
| No new bio-only registry; share existing one | confirmed | ✓ |

## Findings

None.

REVIEW_PASS
