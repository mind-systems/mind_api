## Plan Review Summary

**Files Covered:** 3
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no issues. This is a pure interface rename within the `realtime` module; no cross-module boundaries or dependency rules are affected.
- **RULES.md:** WARN — no violations. No non-null assertions, no sensitive data logging, no new log statements introduced.
- **ROADMAP.md:** OK — this plan implements the single remaining unchecked task in Phase 13 ("Finish 'Telemetry' → 'Instruction' Rename").

### Verification

All line numbers in the plan match the current codebase exactly:

| File | Plan says | Actual |
|------|-----------|--------|
| `session-buffer.interface.ts` line 1 | `TelemetrySample` declaration | ✅ confirmed |
| `session-buffer.interface.ts` line 8 | `samples: TelemetrySample[]` | ✅ confirmed |
| `stream-engine.service.ts` line 15 | `TelemetrySample` import | ✅ confirmed |
| `stream-engine.service.ts` line 82 | `push(…, sample: TelemetrySample)` | ✅ confirmed |
| `stream-engine.service.spec.ts` line 3 | `TelemetrySample` import | ✅ confirmed |
| `stream-engine.service.spec.ts` line 33 | `makeSample(…): TelemetrySample` | ✅ confirmed |

A full-text search for `TelemetrySample` across `src/realtime/` confirms these are the **only** consumer sites — no usages were missed. The gRPC controller (`module-instruction-stream.grpc.controller.ts`) calls `StreamEngine.push()` but does not reference the `TelemetrySample` type directly, so it requires no changes.

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- Correct and complete consumer enumeration — grep confirms zero missed references.
- Explicit "keep the shape and `extends Record<string, unknown>` unchanged" instruction prevents accidental interface changes.
- Clean, minimal scope — three files, one rename, no behavioral changes.

PLAN_REVIEW_PASS
