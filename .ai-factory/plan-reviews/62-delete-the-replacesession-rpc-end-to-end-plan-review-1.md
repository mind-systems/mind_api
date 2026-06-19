# Plan Review: Delete the `ReplaceSession` RPC end-to-end

**Plan:** `62-delete-the-replacesession-rpc-end-to-end.md`
**Risk Level:** 🟢 Low

## Summary

The plan is accurate, well-scoped, and matches the codebase as it actually exists. Every file path, line-number reference, and API assumption was verified against the source. The change is a clean removal of the redundant PUT path with one regression test added. No migration is needed (no schema touch), and the analysis of the `timeOfDay`-nulling bug is correct.

## Verification Performed

All line references in the plan were checked against the live files and are correct:

- **Task 1 — proto:** `rpc ReplaceSession(...)` is at `proto/breath_sessions.proto:200`; the `message ReplaceSessionRequest` block (lines 114–120) plus its leading PUT-semantics comment (lines 111–113) fall within the stated `111–120` range. ✅
- **Task 2 — controller:** `replaceSession` handler is at `breath-sessions.grpc.controller.ts:170–194`; the `ReplaceSessionRequest` import is at line 19. The class `implements BreathSessionServiceController`, so the post-regen interface drives compilation as the plan states. ✅
- **Task 3 — service:** `replace()` is at `breath-sessions.service.ts:366–409`; the `ReplaceBreathSessionDto` import is at line 17. `update()` (line 322) uses `Object.assign(session, updateDto)` and never touches omitted fields — the plan's "bug gone by construction" claim is correct. ✅
- **Task 4 — DTO:** `ReplaceBreathSessionDto` is at `dto/breath-session.dto.ts:83–99`. ✅
- **Task 5 — spec:** the `describe('replace', ...)` block is at `breath-sessions.service.spec.ts:127–165`. `TimeOfDay.MORNING = 'morning'` exists in `enums/time-of-day.enum.ts`, so the plan's instruction to reference the enum member (not hardcode) is sound. The `makeSession` helper accepts a `timeOfDay` override, so the regression test is buildable as described. ✅
- **Toolchain:** `npm run proto:gen` is defined in `package.json`; `protoc` is on PATH and `node_modules/.bin/protoc-gen-ts_proto` is present — regeneration will work in this environment. ✅
- **No stray references:** `grep` across `src`/`test` shows the only `ReplaceSession`/`replace()`/`ReplaceBreathSessionDto` occurrences are exactly the ones the four edit tasks target (controller, service, DTO, spec). No REST controller, e2e test, or other caller depends on the removed path. ✅

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): No boundary violation. The change stays entirely inside `BreathSessionsModule`; entity ownership and module boundaries are respected. ✅
- **Rules** (`.ai-factory/RULES.md`): No conflict. The deletions introduce no non-null assertions and touch no logging; the `@Payload()` + `@GrpcCurrentUser()` rule is unaffected (no gRPC signatures change). ✅
- **Roadmap** (`.ai-factory/ROADMAP.md`): Directly linked — this plan implements Phase 40 ("Remove ReplaceSession (PUT); PATCH-only breath-session edits", line 217–221). Milestone linkage is explicit. ✅

## Findings

### WARN — Cross-project proto propagation not mentioned (non-blocking)
Per the monorepo rule, `mind_api/proto/` is the single source of truth and consumers (`mind_mcp`, `mind_mobile`) copy proto files. This plan only updates `mind_api`. I confirmed neither `mind_mcp` nor `mind_mobile` references `ReplaceSession`/`replaceSession` in code, so removal breaks nothing downstream — but their local proto copies will still carry the dead `ReplaceSession` definition until someone re-copies. This is out of scope for a `mind_api`-scoped plan and does not block it; flagging only so the drift is a conscious choice rather than an oversight. No action required for this plan to be correct.

### Note — Task 4 import cleanup will find nothing to remove (informational)
Task 4 instructs dropping any `class-validator`/`class-transformer` imports that become unused "only after this deletion (verify nothing else in the file uses them)." Verified: every imported validator/transformer (`IsString`, `IsNotEmpty`, `IsArray`, `ValidateNested`, `IsEnum`, `IsOptional`, `IsBoolean`, `Type`, etc.) is still used by `CreateBreathSessionDto` / `UpdateBreathSessionDto` / `BatchQueryDto` and others in the same file. So after deleting `ReplaceBreathSessionDto`, no import becomes unused — the implementer should remove **nothing** from the import block. The plan's cautious "verify before removing" wording already prevents over-deletion; this note just confirms the expected outcome.

### Note — RPC removal is a breaking wire change (acceptable per roadmap context)
Deleting the `ReplaceSession` RPC from the service definition is a backward-incompatible gRPC contract change. The roadmap context (Phase 39 note: "lockstep deploy, no prod, confirmed safe") establishes this is acceptable for this project. No field-tag reuse risk since the whole message is removed. Informational only.

## Positive Notes

- The regression test in Task 5 is the right design: it proves the fix by construction (`update()` preserves omitted fields) rather than re-testing the deleted path, and it correctly references the `TimeOfDay` enum member instead of a raw string.
- The plan correctly forbids hand-editing the generated `proto/generated/breath_sessions.ts` and routes the change through `npm run proto:gen`.
- The verification task (Task 6) includes the exact grep that confirms zero residual references, matching what I ran independently.
- Commit split (removal vs. test) is clean and follows single-concern commit hygiene.
- No migration is correctly identified — the `timeOfDay` column and its data are untouched; only the code path that nulled them is removed.

PLAN_REVIEW_PASS
