## Plan Review Summary

**Plan:** `.ai-factory/plans/19-author-proto-nfb-calibration-proto-and-regenerate-stubs.md`
**Scope reviewed:** authoring of `proto/nfb_calibration.proto` + `npm run proto:gen`. No service / migration / entity / controller work is in scope (those are deferred to later Phase 20 tasks).
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — PASS. This milestone authors a contract file only; no module-boundary or layering concerns apply.
- **RULES.md** — PASS. No code paths touched, so the `!`-operator / sensitive-log / `@Payload()` rules are inapplicable to this milestone.
- **ROADMAP.md** — PASS. Plan corresponds to the first checkbox under Phase 20 ("Author `proto/nfb_calibration.proto` and regenerate stubs") and the per-field spec matches the roadmap entry verbatim.
- **Cross-source consistency with `mind_mobile/.ai-factory/notes/30-nfb-calibration-history.md`** — PASS. Field numbers, names, types, units, RPC names, request/response shapes, and the "no `user_id` in requests" convention all match note 30 (§Proto and §API table).

### Findings

#### 1. WARN — Task 2 verification step contradicts `.gitignore`

Task 2 says:

> "commit any incidental whitespace/import-order changes alongside the new file so the working tree is clean"

But `proto/generated/` is git-ignored (root `.gitignore` contains `/proto/generated`, and `proto/README.md` line 39 explicitly states: *"Output goes to `proto/generated/`, which is excluded from version control."*). There is nothing to commit under `proto/generated/`; the only file the implementer will stage from this milestone is the new `proto/nfb_calibration.proto`. Without correction, an implementer may try `git add -f proto/generated/nfb_calibration.ts`, which would break the established convention used for every prior proto (`bci_devices.ts`, `sync.ts`, `module_biometric_stream.ts`, …) — none of those are tracked in git.

**Suggested rewording:**

> Verify after the run:
> - `proto/generated/nfb_calibration.ts` exists and exports the four messages and the NestJS service stubs for `NfbCalibrationService`.
> - Other generated files are still present (the generator rewrites all of them — expected; `proto/generated/` is git-ignored, so none of the regenerated TS files appear in `git status`).
> - The only tracked file that this milestone adds is `proto/nfb_calibration.proto`.

#### 2. WARN — "Mirror the comment from `BciDevice.created_at`" is ambiguous

Field 3 (`calibrated_at`) and field 13 (`created_at`) instruct the implementer to mirror a per-field comment from `BciDevice`, but `bci_devices.proto` has no per-field comments — only the message-level comment block above `message BciDevice { ... }` stating "created_at / updated_at are ISO-8601 strings to match the project convention used in SyncEventDto (proto/sync.proto)". The intent is clearly "use the same ISO-8601 convention and reference SyncEventDto"; the implementer should put that as either an inline `//` after the field or as part of the message-level header. Not blocking, but worth clarifying so the result is consistent with existing protos.

#### 3. INFO — `ts-proto` output description is slightly imprecise

Task 2 says the file should export "the `NfbCalibrationService` controller decorator constants used by `@GrpcMethod`". With `nestJs=true, outputServices=grpc-js`, `ts-proto` actually emits: typed interfaces for each message, the controller-decorator helper (`<ServiceName>ControllerMethods`), a `<ServiceName>Controller` interface, a `<ServiceName>Client` interface, and a `<SERVICE_NAME>_SERVICE_NAME` string constant. `@GrpcMethod('NfbCalibrationService', 'record' | 'list')` uses string literals — the controller decorator from ts-proto is rarely used in this codebase (`BciDevicesGrpcController` uses raw `@GrpcMethod` strings). The verification can simply read: *"`proto/generated/nfb_calibration.ts` exists and exports the four message interfaces plus a NestJS service stub for `NfbCalibrationService`, matching the shape of `proto/generated/bci_devices.ts`"*. Non-blocking.

### Positive Notes

- Field numbers (1–13 for the record, 1–11 for the request) are explicitly enumerated in the same order as note 30 §Proto — leaves no ambiguity on the wire format.
- The plan correctly skips `import "google/protobuf/empty.proto"` (no Empty payloads), matching note 30's signatures (`Record` returns the saved record; `List` returns a typed response message).
- The plan correctly documents that `fail_reason` uses proto3's default empty-string semantics and is normalized to NULL server-side — aligned with the roadmap Phase 20 service spec ("`failReason: req.failReason || null`").
- Constraint "No `user_id` anywhere in request messages — identity is read from the JWT interceptor" matches the established `BciDevicesService` pattern and is the right call.
- Phase isolation is clean: this milestone authors only the contract, leaving migration / entity / service / controller / `main.ts` registration for downstream Phase 20 tasks (which are already pre-listed in `ROADMAP.md`). No leakage of those concerns into this plan.

### Verdict

The plan is functionally correct and the per-field spec is internally consistent and matches the upstream design note. The only concrete inaccuracy is the post-gen verification step (`/proto/generated` is git-ignored, so the "commit incidental changes" instruction is misleading). That is a low-impact wording issue, not a correctness problem with the proto contract.

PLAN_REVIEW_PASS
