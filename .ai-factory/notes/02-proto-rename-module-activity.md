# Proto Rename — Module Activity & Instruction Services

**Date:** 2026-03-28
**Source:** conversation context (mind_mobile architecture refactor session)

## Key Findings

- `live.proto` service and message names are misleading — "Live" says nothing about what is being tracked. The correct domain term is "module activity".
- `telemetry.proto` carries a term from aviation/aerospace that has no meaning here. The correct term is "instruction" — what the module is showing the user at any given moment.
- Proto rename is a breaking change that must originate in `mind_api/proto/` before any consumer (mobile, mcp) can follow.
- These renames are motivated by a parallel Dart-side refactor on mobile (Phase 7 of mind_mobile roadmap) that introduces `ModuleStateChannel` and `ModuleInstructionStream` as the new class names.

## Details

### Why "Live" is wrong

The original names (`LiveService`, `LiveSession`, `LiveRequest`, `LiveResponse`) came from Socket.io era thinking — "live" meant "happening right now over a socket". With gRPC bidi streams, every stream is "live". The word adds no information.

The actual purpose of the service: **track the lifecycle of a user's activity inside a module** (breath, yoga, work, meditation). The server needs to know when an activity starts, pauses, resumes, and ends so it can correlate biometric data, compute session stats, and trigger recommendations.

### Why "Telemetry" is wrong

"Telemetry" is a systems-engineering term for remote measurement of physical phenomena (spacecraft, aircraft). Here it means: **what instruction is the module currently showing the user** — inhale for 4s, hold for 2s, exhale for 6s. This is closer to a "log of displayed instructions" than "telemetry". The correct term is `Instruction`.

### Proposed renames

#### live.proto

| Current | Proposed | Reason |
|---|---|---|
| `LiveService` | `ModuleStateService` | tracks module state, not "live" anything |
| `LiveSession` (rpc) | `TrackModuleActivity` | describes what the rpc does |
| `LiveRequest` | `ActivityCommand` | client sends commands to the service |
| `LiveResponse` | `ActivityEvent` | server emits events back |
| `SessionStateEvent` | `ModuleStateEvent` | state of the module, not a "session" |
| `SessionErrorEvent` | `ActivityErrorEvent` | scoped to activity, shared with telemetry |
| `SessionStatus` | `ActivityStatus` | status of the activity |

**Unchanged — already correct:**
- `ActivityType`, `ActivityStartCmd`, `ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`, `PresenceCmd`, `PresenceState`

#### telemetry.proto

| Current | Proposed | Reason |
|---|---|---|
| `TelemetryService` | `InstructionService` | instructions shown to user, not telemetry |
| `StreamTelemetry` (rpc) | `StreamInstructions` | streams instruction samples |
| `TelemetryData` | `InstructionSample` | one sample = one instruction event |
| `TelemetryAck` | `InstructionAck` | server ack for received samples |
| `TelemetryResponse` | `InstructionResponse` | response envelope |

**Unchanged — already correct:**
- `module_id`, `instruction_type`, `data` (Struct payload) — these fields already use the right vocabulary

### What stays the same

- Both services remain **bidirectional gRPC streams** — no structural change
- `ActivityStartCmd` carries `ActivityType` and optional `ref_id` — unchanged
- `InstructionSample` (ex-`TelemetryData`) keeps `module_id` + `instruction_type` + `Struct data` for schema flexibility
- `InstructionAck` keeps `max_samples_per_second` rate-limit hint

### Relationship to mobile Phase 7

Mobile Phase 7 refactors Dart classes in parallel:

| Mobile class (new) | Consumes proto |
|---|---|
| `ModuleStateChannel` | `ModuleStateService.TrackModuleActivity` |
| `ModuleInstructionStream` | `InstructionService.StreamInstructions` |
| `BreathModuleStateChannel` | wraps `ModuleStateChannel`, knows `ActivityType.breath` |
| `BreathModuleInstructionStream` | wraps `ModuleInstructionStream`, emits phase samples |

Mobile Phase 7 can proceed with old proto names in the interim — proto rename is a separate coordinated change.

### Change order

Per project convention (`mind_api/proto/` is the single source of truth):

1. Rename in `mind_api/proto/` — `live.proto`, `telemetry.proto`
2. Implement server-side name changes in `mind_api/src/realtime/`
3. Copy updated `.proto` files to `mind_mobile/proto/` and `mind_mcp/proto/`
4. Regenerate stubs in each consumer (`scripts/gen_proto.sh`)
5. Update consumers to use new names

## Open Questions

- `InstructionService` — the name is decided but worth confirming with the team that "instruction" resonates in the context of work/focus modules (not just breath). For breath it's obviously inhale/hold/exhale. For a work module it would be "stand up", "take a break" — still instructions, still fits.
- Should `SessionErrorEvent` → `ActivityErrorEvent` be a shared message in a separate `common.proto`, or stay in `live.proto` and imported by `telemetry.proto` as it is now?
