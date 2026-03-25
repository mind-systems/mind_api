# Review: proto/telemetry.proto

## Files reviewed
- `proto/telemetry.proto` (new file, 71 lines)
- `.ai-factory/plans/07-proto-telemetry-proto.md` (plan file, no code impact)

## Cross-reference: roadmap spec vs implementation

Roadmap line:
> `StreamTelemetry(stream TelemetryData) → stream TelemetryAck`; TelemetryData: session_id, timestamp: int64, module_id, instruction_type, data: google.protobuf.Struct; TelemetryAck: session_id, received_count, dropped_count, max_samples_per_second, timestamp; error: reuse SessionErrorEvent from live.proto

**All fields and types match.** The return type is `stream TelemetryResponse` (a oneof wrapper around `TelemetryAck` + `SessionErrorEvent`) rather than bare `stream TelemetryAck`. This is correct — the "error: reuse SessionErrorEvent" clause requires a response envelope, and the wrapper follows the exact same pattern as `LiveResponse` in `live.proto`.

## Checklist

| Check | Status | Notes |
|-------|--------|-------|
| proto3 syntax + `package mind` | OK | Matches all other protos |
| Field numbering | OK | Sequential from 1, no gaps, no collisions |
| Field types | OK | `int64` for timestamps/counts, `int32` for rate limit, `string` for IDs — consistent with rest of the project |
| `import "google/protobuf/struct.proto"` | OK | Standard well-known type, available with any protoc installation |
| `import "live.proto"` | OK | First cross-proto import in the project; works correctly since both files are in `proto/` (protoc `-I proto/`). `live.proto` line 85 already documents this use: "This message is top-level so telemetry.proto can import it later" |
| `SessionErrorEvent` reuse | OK | Imported from `live.proto`, used inside `TelemetryResponse.oneof event` — matches the roadmap's "error: reuse SessionErrorEvent" |
| Naming conventions | OK | snake_case fields, PascalCase messages, matches all other proto files |
| Comment style | OK | Section separators and doc comments match `live.proto` style |
| Service definition | OK | Single bidi-streaming RPC, auth via metadata/interceptor |
| No UNSPECIFIED sentinel needed | OK | No new enums defined in this file |
| Trailing newline | OK | File ends with newline after closing `}` |

## No issues found

- No missing fields relative to the roadmap spec
- No type mismatches
- No naming inconsistencies
- No broken imports (live.proto already anticipates this import in its comments)
- No security concerns (auth is via interceptor metadata, not message fields)

REVIEW_PASS
