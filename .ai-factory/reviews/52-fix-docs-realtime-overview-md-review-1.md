## Code Review: Fix `docs/realtime/overview.md`

**Plan file:** `.ai-factory/plans/52-fix-docs-realtime-overview-md.md`
**Changed files:** 3 (1 doc fix + 2 plan/review artifacts)
**Risk Level:** Low

### Changes Summary

| File | Change |
|---|---|
| `docs/realtime/overview.md` | `ModuleInstructionGrpcController` → `ModuleInstructionStreamGrpcController` on line 11 |
| `.ai-factory/plans/52-fix-docs-realtime-overview-md.md` | New plan file |
| `.ai-factory/plan-reviews/52-fix-docs-realtime-overview-md-plan-review-1.md` | New plan review file |

### Verification

The renamed reference was verified against the codebase:

- `ModuleInstructionStreamGrpcController` exists at `src/realtime/module-instruction-stream.grpc.controller.ts:24` — name is correct.
- No remaining references to the stale name `ModuleInstructionGrpcController` in the diff.

### Critical Issues

None.

### Minor Issues

None.

### Notes

Doc-only change — no runtime, migration, or type-safety concerns.

REVIEW_PASS
