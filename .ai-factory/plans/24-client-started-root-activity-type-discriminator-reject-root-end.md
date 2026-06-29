# Plan: Client-started root + `activity_type` discriminator + reject root end

## Context
Make the realtime root session client-addressable: the client opens it via `activity:start { activity_type: ROOT }`, learns `root.id` from that response, reads `activity_type` on every state frame to tell root from child, and is rejected (`CANNOT_END_ROOT`) if it tries to end/stop the root. Purely a `proto/module_state.proto` + controller change — no migration (`activityType=root` already exists). Spec: `.ai-factory/notes/34-deliver-root-id-on-connect.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Add `ROOT` enum value and `activity_type` discriminator to proto**
  Files: `proto/module_state.proto`
  Additive change only (no `is_root`, no request-shape change):
  - In `enum ActivityType` (`:13-17`) add `ROOT = 3;` after `MEDITATION = 2;` (next free number is 3). Update the surrounding comment to note `ROOT` is the client-addressable root marker.
  - In `message StateEvent` (`:81-85`) add `ActivityType activity_type = 4;` after `optional bool is_paused = 3;` (field 4 is free). This is the per-frame discriminator; `ROOT` ⇒ the frame describes the root session.
  - Do NOT touch `ActivityStartCmd` — `activity_type` (field 1) already exists; the client uses it to send a ROOT start.

- [x] **Task 2: Regenerate ts-proto stubs** (depends on Task 1)
  Files: `proto/generated/module_state.ts` (generated)
  Run `npm run proto:gen` (the note-05 regen step) to regenerate the TypeScript stubs into `proto/generated`. Confirm the generated `ActivityType` enum now contains `ROOT = 3` and `StateEvent` carries an `activityType` field. Do not hand-edit generated files.

### Phase 2: Controller logic

- [x] **Task 3: Add `ROOT` arm to `mapProtoActivityType` + total reverse mapper** (depends on Task 2)
  Files: `src/realtime/module-state.grpc.controller.ts`
  - In `mapProtoActivityType` (`:41-64`) add `case ProtoActivityType.ROOT: return InternalActivityType.ROOT;` before the unsupported/exhaustive cases. The `_exhaustive: never` check (`:56`) will now narrow correctly with the new arm present (`InternalActivityType.ROOT = 'root'` already exists in `src/realtime/enums/activity-type.enum.ts`).
  - Add a module-level reverse mapper `function mapInternalActivityType(internal: InternalActivityType): ProtoActivityType` that maps `BREATH→ProtoActivityType.BREATH`, `MEDITATION→ProtoActivityType.MEDITATION`, `ROOT→ProtoActivityType.ROOT`. It MUST be **total** — the `default` arm returns `ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED` (do NOT `throw`). Rationale: the end/stop/pause/resume/reconnect emissions derive the type from a returned session/state object, and the committed unit-test mocks (`makeSession`, `makeActivityState`) return objects **without** an `activityType` field; a throwing mapper would replace the expected frame with `INTERNAL_ERROR` and turn the committed a1 acceptance tests RED. A `void _exhaustive` compile-time-only check may be kept for safety, but it must not throw at runtime. This mapper is used to stamp `activityType` on every emitted `session:state` (Tasks 5 & 7).

- [x] **Task 4: Add `getRootId` delegate to `ActivityEngine`** (depends on Task 2)
  Files: `src/realtime/services/activity-engine.service.ts`
  Add a thin public method `getRootId(userId: string): string | null { return this.activitySessionStore.getRootId(userId); }`. The store already exposes `getRootId` (`activity-session-store.service.ts:79`, returns `string | null`) and the engine uses it internally throughout; the controller has no store dependency, so this delegate is the only way the controller can compare a resolved session id against the root id (Task 6). Return type matches the store (`string | null`), not the spec note's `undefined`.

- [x] **Task 5: Branch `handleActivityStart` on ROOT and emit `activity_type`** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In `handleActivityStart` (`:315-393`), after `mapProtoActivityType` resolves `activityType`:
  - If `activityType === InternalActivityType.ROOT` → resolve the session via `const session = await this.activityEngine.ensureRoot(userId, cmd.clientTimestampMs);` (idempotent by userId — `activity-engine.service.ts:73-118`, returns a `ModuleSession` with `rootSessionId = null`). Do NOT route the root through `startActivity` (it would stamp a non-null `rootSessionId`).
  - Else → keep the existing `await this.activityEngine.startActivity(userId, { activityType, activityRefId: cmd.refId, clientTimestampMs: cmd.clientTimestampMs })`.
  - Keep the existing rate-limit guard (`:320-334`) and the `clientActivityId` dedup lookup/record (`:338-356`, `:379-382`) for BOTH paths (root start is deduped too).
  - Change the success emission (`:384-389`) to include the discriminator, derived from the **local mapped `activityType` variable** the controller already computed (`mapProtoActivityType(cmd.activityType)`), NOT from `session.activityType`: `sessionState: { moduleSessionId: session.id, status: ActivityStatus.ACTIVE, activityType: mapInternalActivityType(activityType) }`. This is both more correct (the discriminator reflects what the controller resolved) and necessary for the committed ROOT-start test (`:363-388`, asserts `activityType === 3`) — the mocked `ensureRoot` returns a session with no `activityType` field, so reading `session.activityType` would yield `undefined`. The root emits one `session:state` with `activity_type = ROOT`; a child emits its own type.
  - **Cache-hit ordering:** `StateEvent.activityType` is a required field after regen (see Task 7), so the idempotency cache-hit emission (`:347-355`) must also carry it — but that emission currently sits **before** `mapProtoActivityType` runs (`:358-360`). Move the `mapProtoActivityType(cmd.activityType)` call **above** the idempotency lookup so the local `activityType` variable is available for the cache-hit frame: `sessionState: { moduleSessionId: cachedId, status: ActivityStatus.ACTIVE, activityType: mapInternalActivityType(activityType) }`. Validating the type before the dedup short-circuit is harmless (a cached entry implies a previously-valid type). Keep the existing `try/catch` around `mapProtoActivityType` that emits `INVALID_ACTIVITY_TYPE` (`:359-370`) at the new earlier position.

- [x] **Task 6: Reject `activity:end` / `activity:stop` that target the root** (depends on Task 4)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In both `handleActivityEnd` (`:395-419`) and `handleActivityStop` (`:421-446`), after `resolveTargetSession` returns `resolved.ok === true` and before calling `endActivity`/`stopActivity`, guard:
  ```ts
  if (resolved.sessionId === this.activityEngine.getRootId(userId)) {
    subscriber.next({
      sessionError: {
        code: 'CANNOT_END_ROOT',
        message: 'Root session cannot be ended by the client',
        timestamp: Date.now(),
      },
    });
    return;
  }
  ```
  `'CANNOT_END_ROOT'` is a new literal matching the controller's existing literal-string error convention. The root ends only via grace/janitor. Add a one-line comment noting this controller guard is intentional double-defense: the engine already rejects root internally (`endActivity :189-197`, `stopActivity :396-404`, returns `null` → controller would otherwise emit nothing), and this guard upgrades that silent no-op into an explicit client-facing `CANNOT_END_ROOT` frame (asserted by the committed test `:464-481`). Do NOT add pause/resume guards for the root — out of scope.
  Note: `resolved.sessionId` is `string | undefined` and `getRootId` returns `string | null`; when there is no explicit `sessionId` and zero children, `resolved.sessionId` is `undefined`, which never equals a `string` root id or `null` — so no false `CANNOT_END_ROOT`.

- [x] **Task 7: Stamp `activity_type` on all remaining `session:state` emissions** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.ts`
  After regen, `StateEvent.activityType` is a **required** interface property (ts-proto emits non-optional proto3 enum fields as required — exactly like the existing `status` field). Therefore **every** `sessionState: { ... }` object literal in the controller must include `activityType`, or `npm run build` fails with TS2741. The total `mapInternalActivityType` (Task 3) makes this safe even when the source object lacks a concrete type. Add `activityType: mapInternalActivityType(...)` to each remaining emission, deriving the internal type from the available session/state object:
  - Reconnect RESUMED (`:138-144`) — from the `result` `ModuleSession` (`result.activityType`).
  - Reconnect ABANDONED (`:131-136`) — this path only has `clientSessionId` (a string), no session object and no reliable type. Stamp `activityType: ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED` (the `0` sentinel is exactly "type unknown"). **Do NOT leave it unset** — the field is required, so an unset literal is a compile error. The committed ABANDONED test (`:275-313`) uses `toMatchObject`, so the extra `activityType: 0` does not break it.
  - End COMPLETED (`:412-417`) — from `session.activityType`. (Mock returns no type → maps to `UNSPECIFIED`; test asserts only `status`/`moduleSessionId`.)
  - Stop INTERRUPTED (`:437-442`) — from `session.activityType`. (Same: maps to `UNSPECIFIED` under the mock; test asserts only `status`/`moduleSessionId`.)
  - Pause (`:464-470`) and Resume (`:499-505`) — from `state.activityType` (the `ActivityState` returned by `pauseActivity`/`unpauseActivity`). (Mock `makeActivityState` returns no type → maps to `UNSPECIFIED`; tests assert only `status`/`isPaused`/`moduleSessionId`.)
  - Leave the connect-time `await this.activityEngine.ensureRoot(userId)` at `:154` exactly as today (result discarded) — no unsolicited connect frame is emitted.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add ROOT activity type and activity_type discriminator to module state proto"
- **Commit 2** (after tasks 3-7): "Branch root start through ensureRoot, stamp activity_type on state frames, reject root end"
