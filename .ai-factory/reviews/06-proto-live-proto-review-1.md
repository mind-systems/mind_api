# Code Review: proto/live.proto

**Files reviewed:** `proto/live.proto` (new), `.ai-factory/plans/06-proto-live-proto.md` (new)
**Cross-referenced:** `ActivityStartDto`, `ActivityEndDto`, `SessionStateDto`, `SessionErrorDto`, `ActivityType` enum, `SessionStatus` enum, `PresenceState` interface, `LiveSession` entity, `ActivityEngine` service, `LiveGateway`

**Risk level:** 🟢 Low

---

## Context gates

- **ARCHITECTURE.md** — `PASS`. Proto placed in `proto/`, consistent with all existing protos. No module boundary violations.
- **RULES.md** — `PASS`. No runtime code, no logging, no `!` operator usage.
- **ROADMAP.md** — `PASS`. File matches the roadmap's `proto/live.proto` entry.

## Previous review issues — verification

All three issues from the prior review have been addressed:

1. **`activityRefType` field restored** — `ActivityStartCmd` now has `optional string ref_type = 3` (line 53) with a clear comment explaining the data consistency motivation. Matches `ActivityStartDto.activityRefType` and `LiveSession.activityRefType`.

2. **Sentinel `*_UNSPECIFIED = 0` values added** — All three enums (`ActivityType`, `PresenceState`, `SessionStatus`) use `*_UNSPECIFIED = 0` with real values starting at 1. This prevents the silent-default-`ACTIVE` bug the previous review identified.

3. **`BREATH_SESSION` naming aligned** — Proto enum uses `BREATH_SESSION = 1`, matching `ActivityType.BREATH_SESSION = 'breath_session'` in TypeScript. No adapter translation ambiguity.

## Proto correctness

- `syntax = "proto3"`, `package mind` — matches all existing protos.
- Field numbers are sequential and non-overlapping within each message and `oneof`.
- `optional` keyword used correctly for presence-tracked fields (`ref_id`, `ref_type`, `is_paused`).
- `oneof` fields carry no `optional`/`repeated` modifiers (which would be invalid).
- Empty messages (`ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`) are idiomatic for payload-less commands.
- `SessionErrorEvent` is top-level (not nested), enabling future `import` from `telemetry.proto`.
- No imports needed — all types self-contained in one file.

## Mapping accuracy

| Proto message | Source file | Field parity |
|---|---|---|
| `ActivityStartCmd` | `ActivityStartDto` | `activity_type` ↔ `activityType`, `ref_id` ↔ `activityRefId`, `ref_type` ↔ `activityRefType` — full match |
| `ActivityEndCmd` | `ActivityEndDto` | Both empty — match |
| `SessionStateEvent` | Gateway `SESSION_STATE` emissions | `live_session_id` ↔ `liveSessionId`, `status` ↔ `status`, `is_paused` ↔ `isPaused` — full match |
| `SessionErrorEvent` | `SessionErrorDto` | `code` ↔ `code`, `message` ↔ `message`, `timestamp` (int64 millis) ↔ `timestamp` (number) — match |
| `PresenceCmd` | Gateway `PRESENCE_BACKGROUND`/`PRESENCE_FOREGROUND` | Single `state` enum replaces two separate WS events — cleaner design, semantically equivalent |

**Note on `SessionStateDto`:** The DTO defines `sessionId` and `timestamp` fields, but the gateway never uses the DTO class directly — it constructs inline objects with `liveSessionId` (not `sessionId`) and omits `timestamp`. The proto correctly follows the gateway's actual wire shape rather than the stale DTO definition. The DTO also lacks `isPaused`, which the gateway does emit. No action needed — the proto is the new contract.

## Style consistency

- Section banners (`// ---...`) match `auth.proto`, `breath_sessions.proto`, etc.
- Comment style (mapping notes, design rationale) consistent with existing protos.
- Service definition follows the same pattern as other `*Service` definitions.

## Issues found

None.

---

REVIEW_PASS
