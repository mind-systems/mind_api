# Plan Review: Drop the bio echo-match; store under the server-resolved root

**Plan:** `25-drop-the-bio-echo-match-store-under-the-server-resolved-root.md`
**Risk Level:** 🟢 Low

## Verification Against Codebase

Every concrete claim in the plan was checked against the actual source.

| Plan claim | Verified |
|---|---|
| File `src/realtime/module-biometric-stream.grpc.controller.ts` exists | ✓ |
| Step 6 block is at lines **124–131** | ✓ exact match (the `if (root.id !== batch.samples[0].sessionId)` block) |
| Steps 1–4 emit `'INVALID_ARGUMENT'` (empty / missing / inconsistent `sessionId`, missing `sampleType`) | ✓ lines 91–115 |
| Step 5 at `:117–122` — `ensureRoot(userId)` + `NO_ROOT_SESSION` guard | ✓ |
| Happy path `:133–150` — `pushBatch(root.id, mapped)` + ack `sessionId: root.id`, `droppedCount: result.totalDropped` | ✓ |
| `WsErrorCode` still referenced after removal (step 5 `NO_ROOT_SESSION`, line 120) — keep import line 21 | ✓ `NO_ROOT_SESSION` used at line 120; import is needed |
| After removal `SESSION_MISMATCH` no longer referenced in this file | ✓ only reference is line 127 inside the deleted block |
| No proto change, no migration | ✓ pure control-flow deletion, no schema/contract touched |
| Test file `module-biometric-stream.grpc.controller.spec.ts` already inverted, committed RED | ✓ confirmed below |

## Test Suite Cross-Check (Task 2)

The spec file matches the plan's description of the RED→GREEN transition precisely:

- `child-id echo is accepted and stored under root` (line 276) — sends `makeBatch('child-9')`, asserts `frame.ack` defined, `frame.error` **undefined**, `pushBatch('root-1', …)`. Currently RED because step 6 rejects `child-9` with `SESSION_MISMATCH`; turns GREEN on deletion. ✓
- `stale/arbitrary echo is accepted under root` (line 296) — same shape with `makeBatch('whatever')`. ✓
- Characterization cases that must stay GREEN are all present and independent of step 6: correct-root echo (line 255), `NO_ROOT_SESSION` (line 316), paused-root accept (line 333), batch-hygiene `INVALID_ARGUMENT` ×4 (lines 184–247), overflow `droppedCount` (line 353). ✓

The plan's escalation rule (regression in characterization cases = Class-B, stop and escalate) is sound — those cases do not touch the deleted code path, so a regression would signal something unexpected.

## Context Gates

- **Architecture (`mind_api/CLAUDE.md`):** No `.ai-factory/ARCHITECTURE.md` consulted, but project rules confirm: controllers are thin and delegate to services — this change removes controller logic only, consistent with that principle. Module boundaries untouched. **PASS**
- **Rules:** Logging guidance (`Logger`, not `console.*`) is respected — the change deletes a branch and touches no logging. Plan setting "Logging: minimal" is appropriate; the surviving `logger.warn` on drop (line 153) is unchanged. **PASS**
- **Roadmap:** Plan links to roadmap phase a2 and spec note `35-generalize-bio-ingest-ownership.md` / note 32. Linkage is explicit. **PASS (WARN — not independently re-verified)**: roadmap/note files were not opened during this review; linkage is taken from the plan header. Non-blocking.

## Security Assessment

Removing the echo-match is **not** a security regression. Ownership is resolved server-side end-to-end: `userId` comes from the JWT (`user.sub`, line 55), `root` from `ensureRoot(userId)` (line 118), and storage routes through `pushBatch(root.id, …)` (line 140). The client-supplied `sessionId` was only ever echoed back, never used to route storage — so a forged/child/stale `sessionId` could not and still cannot redirect another user's data. The deleted check guarded nothing, exactly as the Context section states. ✓

## Observations (non-blocking)

1. **Steps 2 & 3 now validate a field the handler ignores.** After this change the controller still rejects empty/inconsistent `sessionId` (lines 98–109) even though `sessionId` no longer influences routing. The plan deliberately preserves these as batch-hygiene characterization, and the tests pin them GREEN — this is intentional, not a defect. Worth being aware of for a future cleanup if `sessionId` is ever dropped from the wire contract, but correct to leave alone here.
2. **`WsErrorCode.SESSION_MISMATCH` constant remains defined** in `ws-error-codes.ts` and is still used (as a string literal `'SESSION_MISMATCH'`) by `module-instruction-stream.grpc.controller.ts:94`. The plan correctly does not remove the constant. No dead-code cleanup is needed or appropriate.
3. **Docs:** No doc under `docs/realtime/` references the bio `SESSION_MISMATCH` / echo-match behavior (grep returned nothing), so "Docs: no" is justified — no stale documentation is left behind.

## Conclusion

The plan is accurate, minimal, and self-consistent. File path, line ranges, retained imports, error codes, and the test transition all verify against the actual source. No missing steps, no wrong assumptions, no missing migration, no security issue. The two-task structure (delete the block, then confirm the pre-inverted suite goes GREEN) is the correct shape for this change.

PLAN_REVIEW_PASS
