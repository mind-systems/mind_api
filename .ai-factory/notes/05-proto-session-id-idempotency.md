# Proto: session_id addressing + start idempotency token

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- To address a specific child among several concurrent ones, state commands must carry `session_id`. To deduplicate retried `activity:start` (network retry / double tap) now that the "one session per user" singleton guard is gone, `ActivityStartCmd` needs a client idempotency token.
- This task is **proto-only + regen** — additive optional fields. The server ignores the new fields until [[06-state-controller-concurrent-idempotency]] consumes them. Ships safely; old clients keep working.

## Details

### Current state — `proto/module_state.proto`
- `ActivityStartCmd { ActivityType activity_type = 1; optional string ref_id = 2; reserved 3; optional int64 client_timestamp_ms = 4; }`
- `ActivityEndCmd { optional int64 client_timestamp_ms = 1; }`
- `ActivityStopCmd {}`, `ActivityPauseCmd {}`, `ActivityResumeCmd {}`

### Change
- `ActivityStartCmd`: add `optional string client_activity_id = 5;` (idempotency token).
- `ActivityEndCmd`: add `optional string session_id = 2;`
- `ActivityStopCmd`: add `optional string session_id = 1;`
- `ActivityPauseCmd`: add `optional string session_id = 1;`
- `ActivityResumeCmd`: add `optional string session_id = 1;`
- Regenerate ts-proto stubs into `proto/generated/module_state.ts` (the project's proto:gen npm script).

### Guards / gotchas
- Preserve existing field numbers; only append. `ActivityStartCmd` field 3 is `reserved` — do not reuse it; next free is 5.
- `mind_api/proto/` is the single source of truth. Consumers (`mind_mcp`, `mind_mobile`) copy + regen separately in [[12-mcp-proto-regen]] / [[13-mobile-proto-regen-behavior]] — do **not** touch consumer proto here.
- No server logic in this task — `module-state.grpc.controller.ts` keeps ignoring the new fields until [[06-state-controller-concurrent-idempotency]].

### Verify
- `proto:gen` succeeds; `npm run build` green with the regenerated stubs unused.

## Open Questions
- None.
