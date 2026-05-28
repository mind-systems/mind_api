# Plan: Emit `REVOKED` from `handleSessionRevoked` — only on `stopActivity` failure

## Context
Wire the controller side of the session-revoke flush fix: inject `EventEmitter2` into `ModuleStateGrpcController`, resolve `sessionId` *before* `stopActivity` is called, and emit `SessionEvents.REVOKED` **only inside the catch block** to avoid racing the in-flight `INTERRUPTED` flush on the happy path. Engine-side listener is a separate milestone — this plan only changes the controller.

Note on observability: milestone 08 alone produces **no observable failure-path flush**. `SessionEvents.REVOKED` will be emitted with no registered listener until the next milestone adds `StreamEngine.onSessionRevoked` (and Phase 19 wires the biometric engine). That is intentional — this milestone is the emit-side half of a two-step rollout.

## Settings
- Testing: no (no new tests authored — but the **existing** controller spec must keep compiling and passing)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rewrite `handleSessionRevoked`

- [x] **Task 1: Inject `EventEmitter2` and rewrite `handleSessionRevoked` with catch-only `REVOKED` emit**
  Files: `src/realtime/module-state.grpc.controller.ts`

  Changes, all confined to `src/realtime/module-state.grpc.controller.ts`:

  1. **Imports.** Merge the new symbol into the existing `@nestjs/event-emitter` import line — replace `import { OnEvent } from '@nestjs/event-emitter';` with:
     ```ts
     import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
     ```
     Do not leave two separate import statements from the same package.
  2. Add `import { SessionEvents } from './events/session.events';` (constant already exists from milestone 07, confirmed at `src/realtime/events/session.events.ts:5`).
  3. **Constructor parameter order — append at the tail.** Add `private readonly eventEmitter: EventEmitter2,` as the **last** constructor parameter, **after** the existing untyped `configService: ConfigService` parameter. Positions 1–4 (`activityEngine`, `rateLimiterService`, `activeStreamRegistry`, `configService`) stay byte-identical. Rationale: the existing spec at `src/realtime/module-state.grpc.controller.spec.ts:84-89` constructs the controller positionally with those four arguments; appending at the tail minimizes churn — only a new position 5 is added. Preserve the rest of the constructor body (rate-limit config reads) untouched.
  4. Replace the body of `handleSessionRevoked(payload: SessionRevokedPayload)` (currently lines 165–176) with the following exact order, per note `04-session-revoke-flush-fix.md` §"Emit-only-in-catch" and §"`userId` → `sessionId` resolution":

     1. Resolve `sessionId` **before** invoking `stopActivity`:
        ```ts
        const sessionId =
          this.activityEngine.getActiveSession(payload.userId)?.sessionId ?? null;
        ```
        Use `?? null` (not non-null assertion) — this complies with the project rule against `!`. `getActiveSession` returns `ActivityState | undefined` per `activity-engine.service.ts:312-314`.
        Note: this lookup runs on **every** call, even when `stopActivity` will return `null` without throwing. That is intentional and harmless — it's an in-memory `Map.get` — and keeping the resolution unconditional means the order requirement ("resolve before `stopActivity` may clear state") is enforced structurally rather than by inspecting later branches.
     2. `try { await this.activityEngine.stopActivity(payload.userId); }`.
     3. **Inside the `catch (err: unknown)` block, and only there**:
        - Keep the existing error log (`Failed to stop activity on session revoke: userId=${payload.userId}`).
        - If `sessionId !== null`, call `this.eventEmitter.emit(SessionEvents.REVOKED, { sessionId });`. No emit when `sessionId` is `null` — there is no buffer to flush and no valid `moduleSessionId` for engine handlers to target (edge case explicitly covered in note 04 §"Edge case: `stopActivity` returns `null` without throwing", which also clarifies that the no-throw / no-state branch must **not** emit).
     4. After the `try/catch`, call `this.activeStreamRegistry.closeAll(payload.userId);` exactly as today — unconditional, runs on both success and failure paths.

  5. Do **not** emit `REVOKED` on the happy path. Rationale (locked in note 04): on success `ActivityEngine.stopActivity` already emits `SessionEvents.INTERRUPTED` at its last line, the engine's `onSessionInterrupted` handler starts an async `flush` that does `const samples = buffer.samples.slice()` then `await sampleRepo.save(...)` before clearing `buffer.samples`. A second unconditional `REVOKED` emit would let a second handler slice the same non-empty array and produce a duplicate insert into `session_stream_samples` (and into `bio_session_samples` after Phase 19).

  6. Do **not** add new log lines beyond the existing error log — project rules require lean logging.
  7. Do **not** touch the engine (`stream-engine.service.ts`); the `@OnEvent(SessionEvents.REVOKED)` handler is a separate milestone in the roadmap.
  8. Do **not** modify `SessionRevokedPayload`, `AuthEvents`, or any other file.

- [x] **Task 2: Update `module-state.grpc.controller.spec.ts` to construct the controller with the new 5th argument**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`

  Without this update, every test in the file fails on construction because `configService` would still be bound to position 4 (good) but the new `eventEmitter` parameter at position 5 would be `undefined`. The controller doesn't dereference `eventEmitter` in the constructor body, so an `undefined` would actually compile and the existing tests would *appear* green — but the new `handleSessionRevoked` path calls `this.eventEmitter.emit(...)` in the catch block, and the existing "stopActivity throws" tests at `spec.ts:486-497` would then crash with `TypeError: Cannot read properties of undefined (reading 'emit')`. Provide a real mock.

  Exact edits:

  1. Add an `EventEmitter2` mock factory next to the other `make*` helpers (around `spec.ts:56-60`, after `makeConfigService`):
     ```ts
     function makeEventEmitter() {
       return {
         emit: jest.fn(),
       };
     }
     ```
  2. Declare `let eventEmitter: ReturnType<typeof makeEventEmitter>;` alongside the existing `let configService: ...` declaration (around `spec.ts:76`).
  3. In `beforeEach` (around `spec.ts:78-89`), add `eventEmitter = makeEventEmitter();` next to the other factory assignments, and extend the `new ModuleStateGrpcController(...)` call to pass `eventEmitter as any` as the **5th** positional argument — matching the tail position chosen in Task 1:
     ```ts
     controller = new ModuleStateGrpcController(
       activityEngine as any,
       rateLimiterService as any,
       activeStreamRegistry as any,
       configService as any,
       eventEmitter as any,
     );
     ```
  4. **Do not** add new test cases asserting emit behavior. Plan setting is `Testing: no`; the goal of this task is solely to keep the existing spec compiling and the existing assertions valid. New behavior coverage (emit on throw, no-emit on no-state, no-emit on happy path) belongs in `ROADMAP_TESTS.md`, not this milestone.

  Verify after edit:
  - The 5th positional argument lines up with the new `eventEmitter` constructor parameter introduced in Task 1.
  - The existing `handleSessionRevoked` tests at `spec.ts:475-513` still pass unchanged:
    - "should call activityEngine.stopActivity(payload.userId)" — unaffected (still called).
    - "should call activeStreamRegistry.closeAll(payload.userId)" — unaffected (still called, unconditionally, after try/catch).
    - "should call closeAll even when stopActivity throws" — still green: `makeActivityEngine.getActiveSession` returns `undefined`, so `sessionId` is `null`, the catch-block emit is guarded out, no crash; `closeAll` still runs.
    - "should not rethrow when stopActivity rejects" — still green for the same reason.
    - "should call stopActivity before closeAll" — still green; the new `getActiveSession` call happens *before* `stopActivity` and is not in the recorded `callOrder`.

### Verify after milestone

- `EventEmitter2` is imported (merged with `OnEvent` into a single `@nestjs/event-emitter` import) and injected as a constructor field at the tail position.
- `SessionEvents` is imported from `./events/session.events`.
- `sessionId` is resolved on the line **before** `try { await this.activityEngine.stopActivity(...) }`.
- The emit statement appears **only** inside the catch block and is guarded by `sessionId !== null`.
- `closeAll(payload.userId)` remains the final statement of the method.
- No usage of the `!` non-null assertion operator anywhere in the new code.
- Run `npx jest src/realtime/module-state.grpc.controller.spec.ts` — all existing tests still pass with zero behavioral changes to assertions.
- Run `npm run build` — TypeScript compiles clean (catches missing/extra constructor args at call sites elsewhere, if any).

<!-- orchestrator-sessions
planner: 935acc24-6610-4ccf-a3be-11d9c67d6e7f
elapsed: 709
implementer: 2f834344-e036-432d-a4a8-3936365b5d92
-->
