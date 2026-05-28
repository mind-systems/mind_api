## Plan Review: Register `nfb_calibration.proto` in `src/main.ts` protoPath

**Plan File:** `24-register-nfb-calibration-proto-in-src-main-ts-protopath.md`
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** N/A — single-line edit in bootstrap wiring; no module/boundary impact.
- **RULES.md:** PASS — no `!` assertions, no logging, no gRPC controller params involved.
- **ROADMAP.md:** PASS — this is task 24 in the documented NFB calibration feature sequence (tasks 19–23 already plan-reviewed: proto authored, migration, entity, service, controller). Registering the proto in `protoPath` is the final wire-up step.

### Verified Assumptions

- `proto/nfb_calibration.proto` exists in the repo (confirmed via directory listing). ✅
- `src/main.ts` contains a `protoPath` array starting at line 60. ✅
- The last existing entry at line 70 is `module_biometric_stream.proto` (added by task 18). ✅
- Existing entries use the exact pattern `join(process.cwd(), 'proto', '<name>.proto'),` — the plan's new entry matches verbatim. ✅
- `package: 'mind'` is shared across all loaded protos, so the NFB calibration service must be defined under the `mind` package in `nfb_calibration.proto` for this registration to expose it. (Out of scope here — that's task 19's deliverable — but worth flagging as a precondition.)

### Critical Issues

None.

### Minor Notes

1. **Stale phase reference.** The task description says "Follow the same formatting and style as the surrounding `bci_devices.proto` entry added in Phase 16." `bci_devices.proto` was added as part of the BCI devices feature (tasks 1–9), not "Phase 16." Phase 16/17/18 added `module_biometric_stream.proto`. Cosmetic only — does not affect the edit.

2. **Line number drift risk.** The plan pins the insertion to "after the existing `module_biometric_stream.proto` entry at line 70." Hard line numbers can rot if `src/main.ts` is touched concurrently; the implementer should anchor on the `module_biometric_stream.proto` entry string, not the line number. Not a blocker.

3. **No restart/verification step.** The plan correctly skips tests (per Settings), but a `npm run build` is a 5-second sanity check that the protoPath compiles. Optional — gRPC proto loading errors surface at startup, not build time, so the build check would only catch syntax errors in `main.ts` (unlikely for a single array append).

### Positive Notes

- Plan correctly diagnoses the symptom (`UNIMPLEMENTED` at runtime with no startup error) and root cause (missing protoPath entry).
- Single, well-scoped task — no over-engineering.
- Includes a precondition check ("Verify the file `proto/nfb_calibration.proto` already exists before adding").
- Append-to-end placement preserves the existing ordering convention used by prior tasks.

PLAN_REVIEW_PASS
