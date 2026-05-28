# Plan Review: ModuleBiometricStreamGrpcController (review 1)

**Plan:** `.ai-factory/plans/17-modulebiometricstreamgrpccontroller.md`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md:** No conflict. Plan stays inside `RealtimeModule`, uses already-registered providers, and respects the modular-monolith boundary — no cross-module entity injection. ✓
- **RULES.md:** `@Payload()` requirement is explicitly enforced (Task 2). No non-null `!`, no sensitive data in logs. ✓
- **ROADMAP.md:** Sequential milestone (#17) in the bio-stream rollout (`11 → 16 → 17`); fits the established milestone sequence. ✓

## Codebase Verification

Cross-checked against the implementation surfaces the plan touches:

- `BiometricStreamEngine.pushBatch(sessionId, samples)` exists with signature
  `{ acceptedCount, droppedCount, totalReceived, totalDropped }`.
  Plan's mapping (`receivedCount: totalReceived`, `droppedCount: totalDropped` in ack
  vs. `if (result.droppedCount > 0)` for the warn log) is correct — `droppedCount`
  is the per-call delta and `totalDropped` is cumulative, matching proto's
  cumulative-ack contract.
- `BiometricStreamEngine.maxSamplesPerSecond` is exposed via getter — usable from controller. ✓
- `ActivityEngine.getActiveSession(userId)` returns `ActivityState | undefined` with `sessionId` and `isPaused`. ✓
- `ActiveStreamRegistry.register/deregister` accept `Subscriber<any>` — compatible with `Subscriber<BioStreamResponse>`. ✓
- `ModuleStateGrpcController.handleSessionRevoked` calls `activeStreamRegistry.closeAll(userId)` — plan's claim that a per-controller `@OnEvent(SESSION_REVOKED)` is unnecessary is correct because the shared registry closes every subscriber, including bio. ✓
- Proto: `BioSample.timestamp` decodes via `longToNumber()` → `number`. Plan's "no Long conversion needed" is accurate. ✓
- Proto: `BioStreamAck` has exactly `sessionId, receivedCount, droppedCount, maxSamplesPerSecond, timestamp` — plan populates all five. ✓
- Proto: `BioStreamResponse.error` reuses `StateErrorEvent { code, message, timestamp }` — matches the `emitError` helper. ✓
- `module-instruction-stream.grpc.controller.ts:127-131` line references the warn-log block as claimed; teardown shape on lines 150-154 matches. ✓
- `RULES.md` `@Payload()` rule is explicitly stated and complied with in Task 2. ✓

## Critical Issues

None.

## Minor Issues / Suggestions

1. **Missing `Subscriber` import in Task 1's import list.**
   Task 3 declares `private handleBatch(... subscriber: Subscriber<BioStreamResponse>): void`,
   so the file needs `Subscriber` imported from `rxjs`. Task 1 only lists `Observable` from `rxjs`.
   Recommend adding to Task 1:
   ```
   Observable, Subscriber from 'rxjs'
   ```
   Without this, `npm run build` (Task 6) will fail with `TS2304: Cannot find name 'Subscriber'`.

2. **Constructor field name not pinned.**
   Task 1 says "inject `BiometricStreamEngine` (do not copy `StreamEngine`)", but Task 4's code snippets use `this.streamEngine.pushBatch(...)` and `this.streamEngine.maxSamplesPerSecond`. The implementer needs to know whether the private field is named `streamEngine` (mirroring the instruction controller) or `biometricStreamEngine` (more descriptive given the type). Recommend Task 1 spell out the constructor signature explicitly, e.g.:
   ```typescript
   constructor(
     private readonly streamEngine: BiometricStreamEngine,
     private readonly activityEngine: ActivityEngine,
     private readonly activeStreamRegistry: ActiveStreamRegistry,
   ) {}
   ```
   Either name works at runtime; the issue is consistency between Task 1 and Task 4 snippets.

3. **`BioSampleInternal.data` typing.**
   `BioSample.data` (proto) is `{ [key: string]: any } | undefined`; `BioSampleInternal.data` is `unknown`. The mapping `data: s.data` will compile (unknown accepts anything), but downstream `JSON.stringify(sample)` in `BiometricStreamEngine.pushBatch` will silently serialize `undefined` as if the field is absent. Not a correctness bug — flushed rows preserve the structure — but worth being aware of: empty-data samples write `{"timestamp":..., "sampleType":..., "data":null/missing}` to jsonb. No plan change required; flagging for verification stage.

4. **Pause-drops-whole-batch — UX consideration.**
   Plan's reasoning (mobile note 26 §7 contractually guarantees no client production during pause) is sound. Worth confirming the mobile client truly stops producing on pause; otherwise a single misbehaving client floods the controller with `SESSION_PAUSED` errors. This is a contract assumption, not a plan defect.

## Positive Notes

- Validation chain ordering rationale (step 2 before step 3; structural before semantic) is explicit and correct — avoids surfacing "Session mismatch" for malformed empty-sessionId batches.
- The plan correctly distinguishes per-call (`droppedCount` → warn log) vs. cumulative (`totalDropped` → ack payload) drop semantics, matching `BiometricStreamEngine`'s return shape.
- Correctly leverages the existing shared `ActiveStreamRegistry` instead of creating a bio-specific one — keeps `handleSessionRevoked` correct without duplication.
- `@Payload()` rule is restated inline (RULES.md compliance is hard to miss).
- Commit plan is sensibly split between controller body and module wiring.

PLAN_REVIEW_PASS
