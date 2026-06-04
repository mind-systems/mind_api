# Plan Review: Update `breath_sessions.proto` — cursor + section contract

**Plan:** `56-update-breath-sessions-proto-cursor-section-contract.md`
**Risk Level:** 🟢 Low — plan is accurate and implementable as written.

## Verification Against Codebase

Confirmed the following claims in the plan are correct:

- **Line numbers are accurate.** `BreathSessionWithStarredDto` ends at line 69 (Task 1 insertion point ✓). `ListSessionsRequest` is at lines 130–133 and `ListSessionsResponse` at 136–141 (Task 2 ✓).
- **`proto:gen` script is correct.** `package.json` defines `proto:gen` → `protoc … --ts_proto_out=./proto/generated …` and `proto/generated/breath_sessions.ts` exists. ts-proto (`nestJs=true`) will generate the `SessionSection` enum, `SessionListItem`, and the rewritten request/response as described (Task 3 ✓).
- **Codegen scope is correct.** The proto types are consumed only by `breath-sessions.grpc.controller.ts` (`listSessions`, lines 70–84 reference `result.data/total/page/pageSize`). The service returns a separate DTO, not the proto type, so deferring controller fixes to the next milestone is sound.
- **The "expected TS errors" guard is valid.** The controller body at lines 79–84 builds `{ data, total, page, pageSize }` and reads `request.page` — these will indeed fail to compile after regeneration, exactly as the guard states. The next ROADMAP milestone (line 187) explicitly rewrites them.
- **Enum zero-value convention matches the file.** `STARRED=0` mirrors the existing `StepType.INHALE=0` / `TimeOfDay.MORNING=0` pattern — no `*_UNSPECIFIED` sentinel is the established convention here. No finding.
- **No migration required.** This is a proto/codegen-only milestone; no entity or schema change. Correct — no migration needed.

## Context Gates

- **ARCHITECTURE.md** — No boundary violations. Proto ownership rule (`mind_api/proto/` is single source of truth) is respected; only `mind_api` proto is touched.
- **RULES.md** — No conflicts. Rules concern `!` non-null assertions, sensitive logging, and `@Payload()` decorator usage — none apply to a proto-only change.
- **ROADMAP.md** — Strong alignment. The plan is a faithful expansion of the milestone at ROADMAP line 185 (Phase 33). Tag-1 reuse, the `SessionSection` enum, `SessionListItem`, and the `{ items, next_cursor }` response all match the roadmap text and reference note 41. **WARN:** no skill-context for `aif-review` exists (`.ai-factory/skill-context/` is empty), so no project-specific review overrides applied.

## Minor Issues (non-blocking)

1. **Wrong controller filename in the Task 3 guard.** The guard names `breath-sessions.controller.ts`; the actual file is `src/breath-sessions/breath-sessions.grpc.controller.ts`. This appears only in an informational guard note (not an action step), so it does not affect execution — but worth correcting for clarity. The ROADMAP (line 187) already uses the correct path.

2. **Internal contradiction on the leading doc comment.** Task 2 instructs "Keep the existing leading doc comment on `ListSessionsRequest` (optional auth behaviour) intact," but the provided proto block supplies a *replacement* comment (`// ListSessions — cursor-based pagination. …`). The replacement does preserve the optional-auth semantics, so intent is satisfied either way — but the instruction and the code block disagree. Recommend the implementer just use the new comment block as written and treat "intact" as "preserve the optional-auth meaning."

3. **`.spec.ts` also references removed fields.** `breath-sessions.service.spec.ts` (lines 221–340) reads `result.data/total`. The plan only calls out controller/service TS errors as expected. Since `Testing: no` and the next milestone (ROADMAP line 187) rewrites that spec block, this is acceptable — noting it so the implementer is not surprised by spec-file type errors too.

4. **Consider `reserved` for removed/repurposed tags (style only).** Tag 1 of the request and tag 2 of the response change type (`page`→`cursor`, `total`→`next_cursor`). The plan correctly notes this is wire-incompatible but safe under lockstep deploy with no prod. The proto-idiomatic safety net would be a `reserved` declaration for the dropped field numbers/names, but given the confirmed lockstep/no-prod context this is optional and not required for this milestone.

## Positive Notes

- Excellent grounding: every structural claim (line numbers, codegen command, downstream consumers, deferral rationale) checks out against the actual files.
- The intentional-duplication-across-sections design and the tag-1-reuse safety justification are explicitly documented in-plan, matching note 41 / the roadmap.
- Correctly scoped to a single concern (contract + codegen) with the service/controller rewrite cleanly deferred — a clean, low-risk milestone boundary.

The plan is solid. The items above are minor clarity nits that do not block implementation.

PLAN_REVIEW_PASS
