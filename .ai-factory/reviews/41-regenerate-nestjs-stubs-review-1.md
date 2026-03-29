# Review: 41 — Regenerate NestJS stubs

## Scope

Milestone 41 re-ran `npm run proto:gen` (ts-proto codegen) to regenerate `proto/generated/*.ts` from the updated `.proto` sources, then verified the output is free of removed Presence symbols.

## Tracked changes

| File | Status |
|------|--------|
| `.ai-factory/plans/41-regenerate-nestjs-stubs.md` | new (staged) |
| `proto/generated/*.ts` | regenerated on disk (gitignored, not tracked) |

## Checks

### 1. Presence symbols removed from generated output

`proto/generated/module_state.ts` contains zero occurrences of `PresenceCmd`, `PresenceState`, or a `presence` field in `SessionRequest`. Verified by grep — count is 0.

The proto source (`proto/module_state.proto`) was already cleaned in commit `e9ee81d` (milestone 40). Codegen output matches.

### 2. Source code already clean

No source file under `src/` references `PresenceCmd`, `PresenceState`, or `presenceCmd` / `presenceState`. The gRPC controller (`src/realtime/module-state.grpc.controller.ts`) imports only activity-related types from the generated stubs. The realtime module no longer registers a `PresenceService` provider (removed in milestone 40).

### 3. Generated stubs consistent with proto source

`proto/generated/module_state.ts` exports:
- Enums: `ActivityType`, `SessionStatus`
- Messages: `ActivityStartCmd`, `ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`, `SessionStateEvent`, `SessionErrorEvent`
- Wrappers: `SessionRequest` (oneof: activityStart/activityEnd/activityStop/activityPause/activityResume), `SessionResponse` (oneof: sessionState/sessionError)
- Service: `ModuleStateService` with `TrackActivity` bidi stream

All match `proto/module_state.proto` exactly.

### 4. Generated files are gitignored

`proto/generated` is listed in `.gitignore`. The regenerated stubs will not be committed — they are build artifacts produced by `npm run proto:gen`. This is correct behavior; the `.proto` source is what gets committed.

## Issues

None.

REVIEW_PASS
