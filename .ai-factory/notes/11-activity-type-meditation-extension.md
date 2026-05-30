# Extend ActivityType enum with MEDITATION

**Date:** 2026-05-30
**Source:** conversation context

## Key Findings

- The mobile app is gaining a **meditation module** that records biometrics during a session. To tag those module-sessions correctly (not as `breath`), the realtime `ActivityType` enum must gain a `MEDITATION` member.
- `ModuleStateService` (the activity-lifecycle bidi stream) is **activity-agnostic** — it already accepts whatever `ActivityType` the client sends in `ActivityStartCmd.activity_type`. No lifecycle logic changes are needed; only the enum gains a value.
- **No DB migration required.** Activity type is persisted as a varchar/string column; adding an enum member does not alter the schema. (Confirm against the actual entity column before implementing — see Open Questions.)
- Meditation sessions use **only `start` + `end`** of the lifecycle (no pause/resume semantics driven by the client, no instruction samples). The server side needs no special-casing — meditation flows through the same `start → end` path as breath.

## Details

### Proto change — single source of truth

`proto/module_state.proto`, `ActivityType` enum (currently):

```proto
// Maps to ActivityType enum in src/realtime/enums/activity-type.enum.ts.
enum ActivityType {
  ACTIVITY_TYPE_UNSPECIFIED = 0;
  BREATH = 1;
}
```

Add:

```proto
  MEDITATION = 2;
```

The existing comment already states: *"the enum is the extension point for future activity types"* — this is the intended use.

### TypeScript enum sync

`src/realtime/enums/activity-type.enum.ts` must be updated in lockstep with the proto (the proto comment points at this file as the mapping target). Add the `MEDITATION` member with the matching wire value (`2`).

### Lifecycle behavior

- `ModuleStateGrpcController` / `TrackActivity` stream: no change. It maps `ActivityStartCmd.activity_type` straight through.
- Meditation client sends `activity_start` (with `activity_type = MEDITATION`, `ref_id` = the chosen pose id) and later `activity_end`. Biometric samples flow on the separate `ModuleBiometricStreamService`, gated by the same module-session — already handled generically.
- No instruction samples for meditation (no phases), so `ModuleInstructionStreamService` is simply unused for these sessions.

### Persistence

- The module-session entity stores the activity type. Adding an enum value is backward-compatible as long as the column is a string and there is no DB-level enum/check constraint.

### Downstream (separate, not this note's scope)

Per proto-ownership rules, after this lands in `mind_api`:
1. `mind_mobile` copies the updated `module_state.proto` into `mind_mobile/proto/` and runs `scripts/gen_proto.sh`.
2. `mind_mobile` adds `meditation` to its hand-written `lib/Core/Grpc/ActivityType.dart` enum and maps it to `proto.ActivityType.MEDITATION` in `ModuleStateChannel._mapActivityType`.

### Related prior context

- `mind_mobile/.ai-factory/notes/01-live-session-architecture-refactor.md` — designed `ModuleStateChannel` as activity-agnostic and explicitly anticipated future modules (yoga, meditation) getting their own `*ModuleStateChannel` adapters that own the `ActivityType`.

## Open Questions

- Confirm the module-session entity stores `activityType` as a string/varchar (no Postgres enum type, no check constraint). If it is a Postgres enum, a migration to add the `MEDITATION` value is required.
- Does any analytics/aggregation query filter on `BREATH` explicitly in a way that would silently exclude meditation sessions? If so, those queries need to account for the new type.
