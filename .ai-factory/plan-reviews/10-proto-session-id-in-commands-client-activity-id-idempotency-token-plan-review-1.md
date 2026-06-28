# Plan Review: Proto `session_id` in commands + `client_activity_id` idempotency token

**Plan:** `.ai-factory/plans/10-proto-session-id-in-commands-client-activity-id-idempotency-token.md`
**Risk Level:** 🟢 Low

## Scope Verified

This is a proto-only, additive change (3 tasks: edit proto → regen stubs → verify build). I verified every concrete claim in the plan against the codebase.

### Codebase assumptions — all correct
- **`proto/module_state.proto` line numbers match exactly.** `ActivityStartCmd` (38-45) with `activity_type=1`, `ref_id=2`, `reserved 3`, `client_timestamp_ms=4`; `ActivityEndCmd` (48-52) with `client_timestamp_ms=1`; `ActivityStopCmd {}` (55), `ActivityPauseCmd {}` (57), `ActivityResumeCmd {}` (59) — all confirmed.
- **Field-number plan is correct.** Next free in `ActivityStartCmd` after `=4` is `=5` (field 3 stays `reserved`, never reused); `ActivityEndCmd` next free is `=2`; the three empty messages start at `=1`. All match proto3 append-only discipline.
- **`npm run proto:gen` exists at `package.json:27`** and emits to `./proto/generated` (`--ts_proto_out=./proto/generated`) — confirmed. `proto/generated/module_state.ts` already exists and exports `ActivityStartCmd`/`ActivityStopCmd`/`ActivityPauseCmd` interfaces.
- **`npm run build` = `nest build` at `package.json:9`** — confirmed.
- **`protoc` is installed** (`/usr/local/bin/protoc`), and 13 other generated stubs exist — the toolchain demonstrably works, so regen is low-risk.
- **camelCase expectation is right.** ts-proto emits `client_activity_id` → `clientActivityId`, `session_id` → `sessionId`.

### Test compatibility — confirmed compile-stable
The committed `src/realtime/concurrency-idempotency.spec.ts` sets the new fields via `(cmd as any).clientActivityId` (line 149), `.sessionId` (lines 163, 174, 182, 191). These casts compile both before and after regen, so making the fields real does not break the spec. The plan's "Testing: no" is acceptable because `nest build` (via `tsconfig.build.json`) excludes spec files; the build check in Task 3 is the correct gate.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md` present):** No boundary violation. The plan respects proto single-source-of-truth (`mind_api/proto/`) and explicitly forbids touching `mind_mcp`/`mind_mobile` proto, matching the monorepo's proto-ownership rule. **PASS.**
- **Rules (`.ai-factory/RULES.md` present):** No proto/field-numbering rules conflict. **PASS.**
- **Roadmap (`.ai-factory/ROADMAP.md` present):** Plan maps 1:1 to the **Phase 56** first task ("Proto: `session_id` in commands + `client_activity_id` idempotency token"), including the exact field set, `reserved 3` preservation, `client_activity_id = 5`, regen into `proto/generated`, and the "do not touch consumer proto" constraint. Linkage is explicit. **PASS.**

## Critical Issues
None.

## Minor Notes (non-blocking)
- **Stub diff hygiene (informational):** Running `proto:gen` regenerates `./proto/*.proto` into `proto/generated` for *all* protos, not just `module_state.ts`. If ts-proto version/formatting has drifted since the last regen, unrelated generated files may show diffs. Not a defect — just review the commit so only `module_state.ts` changes are included, or note any incidental regen churn.
- **Downstream handoff is correctly out of scope.** Consumer proto regen (`mind_mcp` note 12, `mind_mobile` note 13) and the server-logic consumption (note 06) are explicitly deferred. The plan's "server silently ignores new optional fields" claim holds — `module-state.grpc.controller.ts` needs no change to compile.

## Positive Notes
- Field numbers, `reserved 3` handling, and append-only discipline are spelled out precisely — leaves no room for the implementer to renumber or reuse a reserved tag.
- Each task lists exact files and the verification command with line references.
- Correctly forbids hand-editing generated output and forbids touching consumer proto repos.

PLAN_REVIEW_PASS
