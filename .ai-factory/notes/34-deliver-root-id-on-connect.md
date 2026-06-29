# Client-started root via `activity:start { activity_type: ROOT }` + `activity_type` discriminator (a1)

**Date:** 2026-06-29
**Source:** conversation context (handoff 08-root-as-module-activity-type)

Feature task. Tested by the corrective test note [[37-test-root-as-activity-type]] (which supersedes the now-wrong connect-frame assertions of the committed [[31-test-root-id-on-connect]]). First task of the generic session-data-flow epic; **unblocks the mobile bio rollout** (`mind_mobile/.ai-factory/handoffs/12-mobile-root-child-rollout.md`).

> **Filename is legacy** (`34-deliver-root-id-on-connect.md`) — kept so the roadmap `Spec:` tag stays valid. The design below is **client-started root**, not a connect-time delivery; ignore the old title.

## Decision (settled — handoff 08)
The root is a **normal module session of `activityType=root`**, opened by the client through the **same `activity:start` command** as any child (`activity_type = ROOT`). The discriminator the client reads is the **`activityType` enum value**, never a boolean. There is **no unsolicited connect frame** and **no `is_root` field** — both are withdrawn from the prior design. The client learns `root.id` as the **response to its own `activity:start { ROOT }`**. Root end is **implicit** (grace/janitor only); explicit `activity:end`/`activity:stop` on the root is rejected.

## Problem today — `src/realtime/module-state.grpc.controller.ts`
- The proto `ActivityType` enum has no `ROOT` value (`proto/module_state.proto:13-17`), so the client cannot send a ROOT start. `mapProtoActivityType` (`:41-64`) maps only `BREATH`/`MEDITATION` and **throws** `INVALID_ARGUMENT` on anything else.
- `setup()` calls `await this.activityEngine.ensureRoot(userId)` (`:154`) and **discards** the result — fine, keep it (defensive lazy root for a bio-only connection), but it stays server-internal; nothing is emitted to the client on connect.
- `handleActivityStart` (`:316-393`) always routes through `startActivity` (`:372-376`), which stamps `rootSessionId = getRootId(userId)` (`activity-engine.service.ts:124-136`) — correct for a child, **wrong for the root** (the root must have `rootSessionId = null`).
- `handleActivityEnd` (`:395-419`) and `handleActivityStop` (`:421-446`) resolve a target and end/stop it with **no guard** against the target being the root.
- Every emitted `session:state` (`:384-389`, `:412-417`, `:437-442`, reconnect `:138-144`) carries `moduleSessionId` + `status` but **not** the session's `activity_type`, so the client cannot tell root from child.

## The change

### Part 1 — proto (additive; regenerate ts-proto into `proto/generated`, the note-05 regen step)
- **`ActivityType += ROOT = 3`** (`proto/module_state.proto:13-17`; next free number is 3). Reverses [[02-root-session-schema]]'s "root is server-internal" — the root is now client-addressable.
- **`StateEvent += ActivityType activity_type = 4`** (`proto/module_state.proto:81-85`; field 4 free). This is the discriminator on every state frame. **Do NOT add `is_root`** — it never ships.
  ```proto
  message StateEvent {
    string module_session_id = 1;
    ActivityStatus status = 2;
    optional bool is_paused = 3;
    ActivityType activity_type = 4;   // ADD — discriminator; ROOT ⇒ this is the root
  }
  ```
- `ActivityStartCmd.activity_type` (field 1) **already exists** (`proto/module_state.proto:38-49`) — no request-shape change.

### Part 2 — controller
- **`mapProtoActivityType`** (`:41-64`): add `case ProtoActivityType.ROOT: return InternalActivityType.ROOT;` (the internal enum value `ROOT='root'` already exists, [[02-root-session-schema]]); the `_exhaustive` never-check narrows accordingly.
- **`handleActivityStart`** (`:316-393`): after `mapProtoActivityType`, **branch on ROOT**:
  - `activityType === InternalActivityType.ROOT` → resolve via **`const root = await this.activityEngine.ensureRoot(userId, cmd.clientTimestampMs);`** (idempotent by userId — `activity-engine.service.ts:73-118`) instead of `startActivity`. Then `session = root`.
  - else → `startActivity` as today (`:372-376`).
  - Keep the existing rate-limit (`:332-345`) and `client_activity_id` dedup record/lookup (`:347-356`, `:379-382`) for both paths.
  - Emit `subscriber.next({ sessionState: { moduleSessionId: session.id, status: ActivityStatus.ACTIVE, activityType: ROOT|child } })`. **Every** start emission now carries `activity_type` (map internal→proto; the root carries `ROOT`).
- **No connect frame:** leave `:154` exactly as today (`await this.activityEngine.ensureRoot(userId)`, result discarded). Emit nothing to the client on connect.
- **Reject root end/stop:** a1 **adds a thin delegate** `ActivityEngine.getRootId(userId: string): string | undefined` → `return this.activitySessionStore.getRootId(userId);` (the controller has no store dependency, so it cannot reach the store method directly; this delegate is the only mechanism a1 owns — it does **not** depend on a3's `getSession`). Then in `handleActivityEnd` (`:395-419`) and `handleActivityStop` (`:421-446`), after `resolveTargetSession` returns `resolved.sessionId`, reject when that session is the root **before** calling `endActivity`/`stopActivity`:
  ```ts
  if (resolved.sessionId === this.activityEngine.getRootId(userId)) {
    subscriber.next({ sessionError: { code: 'CANNOT_END_ROOT', message: 'Root session cannot be ended by the client', timestamp: Date.now() } });
    return;
  }
  ```
  `'CANNOT_END_ROOT'` is a new literal, matching the controller's existing literal-string error convention. Do **not** add pause/resume guards for the root — out of scope.
- Map every other `session:state` emission (reconnect RESUMED `:138-144`, ABANDONED `:131-136`, COMPLETED `:412-417`, INTERRUPTED `:437-442`, pause/resume) to also carry its `activity_type` so the discriminator is always present.

## Inlined contracts (self-contained — do not open other notes)
- **`activityEngine.ensureRoot(userId: string, clientTs?): Promise<ModuleSession>`** (`activity-engine.service.ts:73-118`) — returns the user's existing root (from the store) or creates one (`activityType=ROOT`, `rootSessionId=null`, `status=ACTIVE`) and registers it via `setRoot`. Idempotent by userId. Owner field is **`.id`** (uuid PK; no `sessionId` field on the entity).
- **`activityEngine.startActivity(userId, dto): Promise<ModuleSession>`** (`:120-162`) — stamps `rootSessionId = getRootId(userId)` (`:124,:134`). Do **not** use it for the root.
- **`activityEngine.getRootId(userId: string): string | undefined`** — a thin delegate **a1 adds** to `ActivityEngine`, returning `this.activitySessionStore.getRootId(userId)` (the store already exposes `getRootId`, used internally throughout `activity-engine.service.ts`; the controller cannot call the store directly). This is what `handleActivityEnd`/`handleActivityStop` compare `resolved.sessionId` against to reject a root end. Self-contained to a1 — **not** a3's `getSession`.
- **`mapProtoActivityType`** (`module-state.grpc.controller.ts:41-64`) — switch over `ProtoActivityType`; today throws on UNSPECIFIED/UNRECOGNIZED; add the `ROOT` arm.
- **`InternalActivityType`** (`src/realtime/enums/activity-type.enum.ts`) already has `ROOT = 'root'`.
- **`ActivityStatus`** (proto) `ACTIVE = 1`; import present (`:22`).
- **`StateResponse`** is a oneof of `session_state: StateEvent` and `session_error: StateErrorEvent`. Emission: `subscriber.next({ sessionState: {...} })` / `{ sessionError: {...} }`.

## Consumer implication (mobile-facing — note, do not edit mind_mobile here)
This is a **`proto/module_state.proto` change** (single source of truth) → consumers copy + regenerate (`mind_mobile`; `mind_mcp` carries no realtime proto). The mobile client follow-up (its own `/aif-plan`; handoff 12) must: send `activity:start { activity_type: ROOT }` to open the root, read `root.id` from that response, and identify it by `activity_type === ROOT`. It no longer expects an unsolicited connect frame and no longer reads `is_root`.

## Guards / gotchas
- The root must route through `ensureRoot`, never `startActivity` (the latter would give it a non-null `rootSessionId`).
- `ensureRoot` is idempotent by userId — two `activity:start ROOT` for one user return the same root; the `client_activity_id` dedup is a second, independent guard.
- No new migration — `activityType=root` already exists in the TS enum + Postgres enum type ([[02-root-session-schema]]); this task is purely proto + controller logic.

## Verify
- `activity:start { activity_type: ROOT }` → one `session:state` with `moduleSessionId = root.id`, `status = ACTIVE`, `activity_type = ROOT`.
- A second `activity:start ROOT` (same user) → same `root.id`, no duplicate root.
- `activity:start { activity_type: BREATH }` → child `session:state` with `activity_type = BREATH`, `rootSessionId = root.id`.
- Fresh connect with no command → **no** emission.
- `activity:end`/`activity:stop` targeting the root id → `CANNOT_END_ROOT`, root stays live.

## Anti-targets
The committed `module-state.grpc.controller.spec.ts` (commit `5221b38`) encodes the **withdrawn** connect-frame + `isRoot` design and must be reverted + re-targeted. That is a **committed-test change → its own task**: see the corrective test note [[37-test-root-as-activity-type]], which enumerates every revert by `file:line` and adds the ROOT-start / idempotency / reject-end targets. Do **not** invert anything in the frozen [[31-test-root-id-on-connect]].
