# Code Review: Rename `TelemetrySample` → `InstructionSample`

## Summary

Pure type-level rename across 3 files. No behavioral changes, no new logic, no runtime impact.

## Verification

| Check | Result |
|-------|--------|
| Zero remaining `TelemetrySample` references in `src/` | OK — grep confirms clean |
| Interface shape unchanged (`extends Record<string, unknown>`, `timestamp`, `data`) | OK |
| All callers of `StreamEngine.push()` pass compatible object literals | OK — `activity-engine.service.ts` (5 call sites) and `module-instruction-stream.grpc.controller.ts` (1 call site) pass `{ timestamp, data, ... }` inline without referencing the type name |
| `SessionBuffer.samples` type updated to `InstructionSample[]` | OK |
| Tests pass (15/15) | OK |

## Critical Issues

None.

## Warnings

None.

## Notes

- The callers in `activity-engine.service.ts` and `module-instruction-stream.grpc.controller.ts` were not touched because they use inline object literals — TypeScript infers structural compatibility without naming the type. This is correct.

REVIEW_PASS
