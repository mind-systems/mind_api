# Deliver the root session id to the client on connect (F1)

**Date:** 2026-06-29
**Source:** conversation context (handoff 06-generic-session-data-flow §F1)

Feature task. Tested by [[31-test-root-id-on-connect]]. First task of the generic session-data-flow epic; **unblocks the mobile bio rollout** (`mind_mobile/.ai-factory/handoffs/12-mobile-root-child-rollout.md`).

## Problem today
The state stream creates the root but never tells the client its id, so the client cannot tag root-level data (bio, root marks). In `src/realtime/module-state.grpc.controller.ts` the `setup()` closure does:

```ts
// :153-154
if (subscriber.closed) return;
await this.activityEngine.ensureRoot(userId);   // ← result DISCARDED
```

`ensureRoot(userId)` returns the root `ModuleSession`, but the resolved value is thrown away. The only `session:state` frames the client receives carry **child** ids (from `activity:start`) or a resumed-child id (reconnect block `:128-148`). The root id reaches the client today **only** on the narrow reconnect-when-a-child-was-resumed path — never on a fresh connect, never on a bio-only connect. That is the mobile blocker.

## The change (locked: explicit `is_root` proto field + emission)
Two parts, both owned by this task.

### Part 1 — proto field (loud, additive)
Add `optional bool is_root = 4;` to `StateEvent` in **`proto/module_state.proto`** (field 4 is free; additive; proto3 backward-compatible — existing readers ignore it) and **regenerate the ts-proto stubs** into `proto/generated` (the same regen step Phase 56 / note [[05-proto-session-id-idempotency]] used). After this, `StateEvent` is:

```proto
message StateEvent {
  string module_session_id = 1;
  ActivityStatus status = 2;
  optional bool is_paused = 3;
  optional bool is_root = 4;   // ← added: true on the connect root frame, false/absent on child frames
}
```

The generated TS field is camelCase `isRoot?: boolean`.

### Part 2 — emission (silently testable)
After `ensureRoot` resolves in `setup()`, **emit the root id** on the existing `session:state` frame, tagged with `is_root = true`:

```ts
if (subscriber.closed) return;
const root = await this.activityEngine.ensureRoot(userId);
if (root && !subscriber.closed) {
  subscriber.next({
    sessionState: {
      moduleSessionId: root.id,
      status: ActivityStatus.ACTIVE,
      isRoot: true,              // ← the explicit discriminator (proto field 4)
    },
  });
}
```

- Emit **once per connect**, right where `ensureRoot` is awaited (`:154`), AFTER the reconnect-result block (`:128-149`) and BEFORE `request.subscribe` (`:156`). Ordering on a resumed-child reconnect is therefore `[RESUMED(child), ROOT(is_root=true)]`; on a fresh connect it is `[ROOT(is_root=true)]`.
- **Child `session:state` frames carry `is_root = false`/absent** — the client distinguishes the root **only** by `is_root === true`, never by frame ordering. (The other emission sites — RESUMED reconnect `:138-144`, ABANDONED `:131-136`, `activity:start` ACTIVE, pause/resume — leave `is_root` unset; the field defaults falsy, which reads as "not the root.")
- Keep the existing `if (subscriber.closed) return;` guard (`:153`) so a client that hangs up mid-setup gets nothing (characterization `spec :235-270` stays GREEN).
- The `!clientSessionId`-abandoned early-return path (`:130`) still returns before `:154` and emits no root frame — unchanged, acceptable (that path emits nothing today).

## Inlined contracts (self-contained — do not open other notes)
- **`activityEngine.ensureRoot(userId: string, clientTs?: number): Promise<ModuleSession | undefined>`** (`src/realtime/services/activity-engine.service.ts:73`) — returns the user's existing root or lazily creates one; idempotent by `userId`. Owner field is **`root.id`** (the uuid PK on `ModuleSession`, `@PrimaryGeneratedColumn('uuid')`); there is **no `sessionId` field** on the entity.
- **`StateEvent`** (`proto/module_state.proto:81-85`, generated `proto/generated/module_state.ts`): today
  ```proto
  message StateEvent {
    string module_session_id = 1;
    ActivityStatus status = 2;
    optional bool is_paused = 3;
  }
  ```
  This task **adds** `optional bool is_root = 4;` (see §The change Part 1), yielding `{ moduleSessionId, status, isPaused?, isRoot? }` on the generated TS type (camelCase). Field 4 is free today.
- **`StateResponse`** is a oneof of `session_state: StateEvent` (1) and `session_error: StateErrorEvent` (2). Emission shape: `subscriber.next({ sessionState: {...} })`.
- **`ActivityStatus`** (proto enum): `ACTIVE = 1`, `RESUMED = 6`, `ABANDONED = 4`, etc. Import already present in the controller (`:22`).

## Consumer implication (mobile-facing — note, do not edit mind_mobile here)
This is a **`proto/module_state.proto` change** and `mind_api/proto/` is the single source of truth, so consumers must copy the updated proto and regenerate stubs (`mind_mobile`; `mind_mcp` carries no realtime proto, so it needs no change). The mobile client follow-up (its own `/aif-plan` in that repo — do **not** edit mind_mobile from here) must:
- (a) handle a `session:state` arriving **on connect, before any command is sent** (today the client only expects state frames in response to its own commands); and
- (b) treat the frame with **`is_root === true`** as the root, store its `module_session_id`, and tag root-level bio/marks with it. Distinction is by the field, never by ordering.

This is referenced by `mind_mobile/.ai-factory/handoffs/12-mobile-root-child-rollout.md`.

## Guards / gotchas
- Do **not** reorder `ensureRoot` before the reconnect-result block — `handleReconnect` (`:122`) owns resume/abandon semantics; the announce sits after it.
- The root frame uses `status: ACTIVE` (the root is the live "app is open" container) — it is **not** RESUMED/ABANDONED; those statuses belong to the reconnect block.
- This adds exactly one connect emission → it shifts the `values[]` length/index of several committed connect-path tests. Those are enumerated as anti-targets in [[31-test-root-id-on-connect]] and inverted there.

## Verify
- Fresh connect (`handleReconnect → null`) → client receives exactly one `session:state` carrying `root.id` with `is_root === true`.
- Resumed-child reconnect → client receives `[RESUMED(child, is_root falsy), ROOT(root.id, is_root=true)]`.
- Subscriber closed mid-setup → no root frame.
- Mobile can read the root id off the connect frame and tag bio with it (F2 then stores it under the root).

## Anti-targets
Enumerated and inverted in the test note [[31-test-root-id-on-connect]] (committed connect-path tests asserting `values` length/index, in `src/realtime/module-state.grpc.controller.spec.ts`).
