# Plan: Proto: `session_id` in commands + `client_activity_id` idempotency token

## Context
Make `module_state.proto` state commands address a specific child via `session_id` and give `activity:start` a client idempotency token — additive optional fields the server ignores until the next phase. Spec: `.ai-factory/notes/05-proto-session-id-idempotency.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract + regen

- [x] **Task 1: Append optional addressing/idempotency fields to `module_state.proto` commands**
  Files: `proto/module_state.proto`
  Edit the five command messages (`proto/` is the single source of truth — only this repo's proto, do NOT touch `mind_mcp`/`mind_mobile` proto). Append only, preserve all existing field numbers, keep `reserved 3` in `ActivityStartCmd` (never reuse it):
  - `ActivityStartCmd` (lines 38-45): add `optional string client_activity_id = 5;` after `client_timestamp_ms = 4;` (next free after 4 is 5; 3 is reserved). Add a short comment noting it is the client idempotency token for deduping retried `activity:start`.
  - `ActivityEndCmd` (lines 48-52): add `optional string session_id = 2;` after `client_timestamp_ms = 1;`.
  - `ActivityStopCmd` (line 55): change `{}` to a body with `optional string session_id = 1;`.
  - `ActivityPauseCmd` (line 57): add `optional string session_id = 1;`.
  - `ActivityResumeCmd` (line 59): add `optional string session_id = 1;`.
  Add a brief comment on each `session_id` field that it addresses a specific child session among concurrent ones.

- [x] **Task 2: Regenerate ts-proto stubs** (depends on Task 1)
  Files: `proto/generated/module_state.ts`
  Run `npm run proto:gen` (defined at `package.json:27`; outputs to `proto/generated`). Confirm the regenerated `proto/generated/module_state.ts` exposes the new fields in camelCase: `ActivityStartCmd.clientActivityId?: string`, `ActivityEndCmd.sessionId?: string`, and `sessionId?: string` on `ActivityStopCmd`/`ActivityPauseCmd`/`ActivityResumeCmd`. Do not hand-edit generated output.

- [x] **Task 3: Verify build is green with unused stubs** (depends on Task 2)
  Files: (no edits)
  Run `npm run build` (`nest build`, `package.json:9`) and confirm it compiles. The new fields are `optional` so `src/realtime/module-state.grpc.controller.ts` continues to compile and silently ignore them — no server logic changes in this task. Do not modify the controller; that happens in the next phase (note 06).
