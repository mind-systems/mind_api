# Review: live.proto — remove `ref_type` from ActivityStartCmd

## Changes reviewed
- `proto/live.proto` — removed `optional string ref_type = 3;` from `ActivityStartCmd`, added `reserved 3;`, cleaned up comment block

## Checklist

| Check | Result |
|-------|--------|
| Proto syntax valid | OK — `reserved 3;` is correct proto3 syntax |
| Field number reserved | OK — prevents accidental reuse by future fields |
| Comment cleanup | OK — removed ref_type explanation, kept ref_id comment |
| No consumer breakage | OK — gRPC is contract-only; no generated stubs or gRPC controller exist in the codebase |
| WebSocket path unaffected | OK — `ActivityStartDto.activityRefType` and all TS code remain untouched; the WS path doesn't read from proto |
| No other proto files reference `ref_type` | OK — confirmed via grep; `telemetry.proto` imports only `SessionErrorEvent` |
| Reserved field name | Minor — protobuf best practice is to also reserve the field name (`reserved 3; reserved "ref_type";`) to prevent a future field from reusing the same name and causing JSON-encoding collisions. Not a bug — field number reservation alone is sufficient to prevent wire-format conflicts — but worth adding for completeness |

## Verdict
The change is correct and safe. One optional improvement noted above (reserving the field name alongside the number).

REVIEW_PASS
