## Plan Review Summary

**Plan:** `08-emit-revoked-from-handlesessionrevoked-only-on-stopactivity-failure.md`
**Files Targeted:** 1 (`src/realtime/module-state.grpc.controller.ts`)
**Risk Level:** 🔴 High — plan, as written, will break the existing controller test suite.

### Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)**: not present at `mind_api/.ai-factory/`. WARN — no architectural rules to cross-check. Plan stays within the existing realtime module boundary (controller-only change, no cross-module coupling added).
- **Rules (`.ai-factory/RULES.md`)**: not present. WARN. Plan does honor the project's explicit "no `!` non-null assertion" rule via `?? null`.
- **Roadmap (`.ai-factory/ROADMAP.md`)**: not inspected for milestone linkage. This plan is sequenced after milestone 07 (which already added `SessionEvents.REVOKED`); the plan correctly defers the engine-side `@OnEvent` handler to a later milestone, matching note 04's touch list split.

### Critical Issues

1. **Constructor signature change silently breaks all `ModuleStateGrpcController` tests.**
   The plan inserts `EventEmitter2` at position 4 of the constructor, between `activeStreamRegistry` and `configService`. The existing spec at `src/realtime/module-state.grpc.controller.spec.ts:84-89` constructs the controller with exactly four positional arguments:
   ```ts
   controller = new ModuleStateGrpcController(
     activityEngine as any,
     rateLimiterService as any,
     activeStreamRegistry as any,
     configService as any,
   );
   ```
   After the proposed change, position 4 is `EventEmitter2`. The configService mock will be bound to `eventEmitter`, and the actual `configService` parameter will be `undefined`. The constructor body immediately calls `configService.get(...)` (current lines 58–65), so **every `beforeEach` will throw `TypeError: Cannot read properties of undefined (reading 'get')`**, failing the entire spec file (`trackActivity`, `handleSessionRevoked`, command routing — everything).
   The plan's "Verify after edit" checklist does not mention the spec, and "Settings: Testing: no" is being treated as license to ignore the regression. Existing tests must keep passing regardless of the testing setting.
   **Fix options (pick one and add to the plan):**
   - (a) Append `EventEmitter2` as the **last** constructor parameter (after `configService`) and explicitly update the spec `beforeEach` to pass a `makeEventEmitter()` mock as a 5th argument. This keeps positions 1–4 stable and only adds a new tail position.
   - (b) Keep the proposed mid-list position, but explicitly add a task to update `module-state.grpc.controller.spec.ts:84-89` (and `makeEventEmitter` factory) so the spec compiles and runs.
   Either way, the plan must explicitly include the spec update — not leave it implicit.

2. **`handleSessionRevoked` spec tests assert behavior that the new code path silently changes.**
   The existing tests at `module-state.grpc.controller.spec.ts:475-513` cover:
   - "calls closeAll even when stopActivity throws" (line 486)
   - "does not rethrow when stopActivity rejects" (line 492)
   With the rewrite, the throw-path also reads `activityEngine.getActiveSession(payload.userId)`. The current `makeActivityEngine` factory returns `undefined` from `getActiveSession`, so `sessionId` resolves to `null` and the `emit` is guarded out — the tests will still pass on behavior **if** issue (1) is resolved. However, the plan should add a task (or at minimum a "verify-after-edit" line) confirming the existing handleSessionRevoked tests still pass. The risk is that whoever applies the patch only patches the controller, sees green tests in their head, and skips actually running `npm test`.

### Findings (non-blocking)

3. **`getActiveSession` is called even when `stopActivity` will return `null` without throwing.**
   This is harmless (it's just an in-memory `Map.get`), but worth noting for accuracy: per note 04 §"Edge case", on the no-state / no-DB-row path `stopActivity` returns `null` and catch never fires, so `sessionId` is computed but unused. The plan is correct that this is fine; just flagging that the extra lookup is intentional.

4. **Engine-side listener deferred — confirm no consumer expects a same-milestone wiring.**
   The plan correctly defers `@OnEvent(SessionEvents.REVOKED)` in `StreamEngine` to a separate milestone. Until that listener exists, emitting `REVOKED` is a no-op (no handlers registered), so the failure-path buffer flush this whole effort is meant to deliver does **not** actually happen until the next milestone lands. This is acceptable as a phased rollout, but the plan should note that, in isolation, milestone 08 produces no observable behavior change on the failure path — it only emits an event nothing listens to yet. A one-line acknowledgement in Context would prevent confusion if someone tests the catch path manually and sees nothing flushed.

5. **Import grouping nit.**
   The plan instructs adding `import { EventEmitter2 } from '@nestjs/event-emitter';` alongside the existing `import { OnEvent } from '@nestjs/event-emitter';`. Cleanest is to merge into a single statement: `import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';`. Minor — either is fine, but worth specifying so the patch doesn't leave duplicate-source imports.

### Positive Notes

- Correctly identifies the duplicate-flush race rationale from note 04 and explains why catch-only emit is mandatory.
- Correctly resolves `sessionId` **before** `stopActivity` (because the success path deletes the in-memory state), even though success-path emission is suppressed — the explicit ordering future-proofs against refactors.
- Uses `?? null` instead of `!`, complying with the project's no-non-null-assertion rule.
- `sessionId !== null` guard correctly suppresses emit when there is no active session (no valid `moduleSessionId` FK target for engine handlers).
- Touches only the controller; correctly defers engine-side handler to a separate milestone, matching note 04's "Touch list".
- Payload shape `{ sessionId }` matches existing `SessionEvents.INTERRUPTED/COMPLETED/ABANDONED` so engine handlers can reuse signatures.
- `SessionEvents.REVOKED` constant was already added in milestone 07 — confirmed at `src/realtime/events/session.events.ts:5`. Import path in the plan is correct.
- `AuthEvents.SESSION_REVOKED` payload shape (`{ userId }`) confirmed at `src/users/events/auth.events.ts:5-7` — plan's read of the source is accurate.
- `ActivityEngine.getActiveSession` confirmed at `activity-engine.service.ts:312-314` returning `ActivityState | undefined`, and `ActivityState.sessionId: string` confirmed at `src/realtime/interfaces/activity-state.interface.ts:4`.
- `EventEmitter2` DI will resolve cleanly — `EventEmitterModule.forRoot()` is registered globally in `src/app.module.ts:30`.

### Required Plan Updates Before Implementation

1. Add an explicit task (or extend Task 1) to update `src/realtime/module-state.grpc.controller.spec.ts`: introduce a `makeEventEmitter()` factory (returning `{ emit: jest.fn() }`) and pass it to the controller constructor at the correct position. Without this, every test in that file fails on construction.
2. Decide and document constructor parameter position. Recommend appending `EventEmitter2` as the last constructor parameter to minimize churn (positions 1–4 unchanged, only add position 5 + matching mock).
3. Add to "Verify after edit": "Run `npx jest src/realtime/module-state.grpc.controller.spec.ts` — all existing tests still pass."
4. Optional: merge the two `@nestjs/event-emitter` imports into a single statement.
5. Optional: add a one-line note in Context that milestone 08 alone produces no observable failure-path flush until the engine-side `@OnEvent(SessionEvents.REVOKED)` handler ships in a subsequent milestone.
