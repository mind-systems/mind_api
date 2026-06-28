# Proto: session_id addressing + start idempotency token

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- To address a specific child among several concurrent ones, state commands must carry `session_id`. To deduplicate retried `activity:start` (network retry / double tap) now that the "one session per user" singleton guard is gone, `ActivityStartCmd` needs a client idempotency token.
- This task is **proto-only + regen** — additive optional fields. The server ignores the new fields until [[06-state-controller-concurrent-idempotency]] consumes them. Ships safely; old clients keep working.

## Details

### Current state — `proto/module_state.proto` (verified line numbers)
- `ActivityStartCmd` (lines 38-45): `ActivityType activity_type = 1;` · `optional string ref_id = 2;` · `reserved 3;` · `optional int64 client_timestamp_ms = 4;` — current max field = **4** (3 is reserved).
- `ActivityEndCmd` (lines 48-52): `optional int64 client_timestamp_ms = 1;` — current max field = **1**.
- `ActivityStopCmd {}` (line 55), `ActivityPauseCmd {}` (line 57), `ActivityResumeCmd {}` (line 59) — all empty, current max field = **0**.

### Change (exact field numbers)
- `ActivityStartCmd`: add `optional string client_activity_id = 5;` (idempotency token). Next free after `client_timestamp_ms = 4` is **5** (field 3 is `reserved` — never reuse).
- `ActivityEndCmd`: add `optional string session_id = 2;` (next free after `client_timestamp_ms = 1`).
- `ActivityStopCmd`: add `optional string session_id = 1;`
- `ActivityPauseCmd`: add `optional string session_id = 1;`
- `ActivityResumeCmd`: add `optional string session_id = 1;`
- Regenerate ts-proto stubs by running **`npm run proto:gen`** (`package.json:27`). Output goes to `proto/generated/module_state.ts` (the script's `--ts_proto_out=./proto/generated`). Generated field names are camelCase: `clientActivityId`, `sessionId`.

### Guards / gotchas
- Preserve existing field numbers; only append. `ActivityStartCmd` field 3 is `reserved` — do not reuse it; next free is 5.
- All new fields are `optional` (proto3) → additive. ts-proto emits them as `field?: string`, so `module-state.grpc.controller.ts` compiles unchanged and silently ignores them until [[06-state-controller-concurrent-idempotency]].
- `mind_api/proto/` is the single source of truth. Consumers (`mind_mcp`, `mind_mobile`) copy + regen separately in [[12-mcp-proto-regen]] / [[13-mobile-proto-regen-behavior]] — do **not** touch consumer proto here.
- No server logic in this task — `module-state.grpc.controller.ts` keeps ignoring the new fields until [[06-state-controller-concurrent-idempotency]].

### Verify
- `npm run proto:gen` succeeds; `npm run build` (`package.json:9`, `nest build`) green with the regenerated stubs unused.

## Open Questions
- None.

## Test reconciliation (committed tests)

### GREEN list — proto fields the committed tests access via cast
`src/realtime/concurrency-idempotency.spec.ts` accesses these not-yet-existing fields via `(cmd as any)` so it compiles before regen. Spec 05 must make each a real proto field (ts-proto camelCase shown):
- `activityStart()` sets `(cmd as any).clientActivityId` (spec:148) → `ActivityStartCmd.client_activity_id = 5` (`clientActivityId`). ✓ note line 19.
- `activityEnd()` sets `(cmd as any).sessionId` (spec:162) → `ActivityEndCmd.session_id = 2` (`sessionId`). ✓ note line 20.
- `activityStop()` sets `(cmd as any).sessionId` (spec:173) → `ActivityStopCmd.session_id = 1`. ✓ note line 21.
- `activityPause()` sets `(cmd as any).sessionId` (spec:181) → `ActivityPauseCmd.session_id = 1`. ✓ note line 22.
- `activityResume()` sets `(cmd as any).sessionId` (spec:189) → `ActivityResumeCmd.session_id = 1`. ✓ note line 23.

All five field numbers/names and the `reserved 3` skip match the note. The spec is compile-stable across this change because every new field is accessed via cast.

### Anti-targets
None. This task is proto-only/additive; no committed test asserts the OLD proto shape, and `(cmd as any)` casts compile both before and after regen.

### Gaps
None. Note 05 fully honors the field contract the committed tests pin.
