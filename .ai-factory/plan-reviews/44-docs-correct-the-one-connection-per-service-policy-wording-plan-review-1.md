## Code Review Summary

**Files Reviewed:** 1 plan (`44-docs-correct-the-one-connection-per-service-policy-wording.md`); grounded against 4 source files + `docs/realtime/overview.md`
**Risk Level:** 🟢 Low

This is a docs-only correction plan for `docs/realtime/overview.md`. No code, migrations, or schema changes. I verified every grounding claim against the shipped implementation and confirmed the target line numbers.

### Context Gates

- **Roadmap (WARN → OK):** Plan heading matches ROADMAP.md line 158 — *"Docs: correct the one-connection-per-service policy wording"*. The contract line names spec note `notes/48-docs-correct-eviction-policy.md` and states the same intent (per-service keying, `CONNECTION_SUPERSEDED` frame, children-end/root-persists takeover). Linkage is present and consistent. No missing linkage.
- **Architecture (OK):** Docs-only edit; touches no module boundaries. `.ai-factory/ARCHITECTURE.md` present, not affected.
- **Rules (OK):** `.ai-factory/RULES.md` present. No convention conflict — the plan enforces Russian, behavior-not-code, current-state-only wording, consistent with the surrounding doc.
- **Skill-context (N/A):** `.ai-factory/skill-context/aif-review/SKILL.md` does not exist — no project overrides to apply.

### Grounding Verification (all claims confirmed)

- `active-stream-registry.service.ts` — structure is `Map<string, Map<StreamService, Subscriber>>` (one slot per service). ✅ `register` evicts the prior subscriber via `existing.complete()` **after** firing the optional `onEvict` hook (lines 25-29). ✅ `deregister` returns `wasEvicted` (line 46, 52). ✅ `closeAll(userId)` completes every service subscriber for the user (lines 59-64). ✅
- `module-state.grpc.controller.ts` — STATE stream's `onEvict` pushes `sessionError { code: 'CONNECTION_SUPERSEDED' }` before the graceful close (lines 150-158). ✅ Teardown branches on `wasEvicted`: eviction → `supersedeChildren(userId)`, genuine drop → `handleTransportDisconnect(userId)` (lines 257-286). ✅
- `activity-engine.service.ts` — `supersedeChildren` ends every child (`SessionStatus.INTERRUPTED`, `endedAt` set) and leaves the root untouched (lines 694-722). ✅
- **STATE-only takeover claim (Task 2, bullet 4):** confirmed. Only `module-state.grpc.controller.ts` passes an `onEvict` callback; `module-biometric-stream` (line 58), `module-instruction-stream` (line 56), and `sync-stream` (line 50) register with no hook, and only the state controller references `wasEvicted`/`supersedeChildren`/`CONNECTION_SUPERSEDED`. The other three services' eviction is a bare `complete()` with no warning frame and no session-lifecycle effect — exactly as the plan states. ✅
- **Task 3 cross-reference claim:** grep of `docs/realtime/` for the policy phrasing and supersede/perехват terms returns only `overview.md`. No companion doc edit is needed — the plan's Task 3 assertion holds. ✅

### Line-number Accuracy

- Task 1 target: `ActiveStreamRegistry` bullet is line 34. ✅
- Task 2 target: policy section header line 36, body line 38 (plan says "lines 36-38"). ✅

### Critical Issues

None.

### Minor Notes (non-blocking)

- Grounding line ranges are approximate pointers, off by a few lines from the current source (`onEvict` block is actually 150-158 vs. stated 150-156; teardown 257-286 vs. 257-283; `supersedeChildren` 694-722 vs. 694-715). All still land inside the referenced constructs — harmless, and the implementing agent is instructed to re-verify against the code anyway.
- The constraint "do not name `INTERRUPTED` unless `overview.md` already names statuses of that kind" is well-posed: `overview.md` does name lifecycle states (`disconnected` line 7, `abandoned` line 13), but the plan still directs the writer to describe behavior ("дочерние сессии завершаются") rather than the constant. This is the safe, conservative choice and consistent with the rest of the file — no action required.

### Positive Notes

- Grounding section pins every behavioral claim to a specific file and construct, and the "correction not rewrite" / behavior-not-code constraints are stated explicitly and repeatedly — this tightly bounds the edit surface.
- The four-point breakdown in Task 2 precisely mirrors the shipped mechanism, including the load-bearing distinction between takeover (children ended, root inherited) and a genuine drop (unchanged disconnect + grace path) — the exact nuance that made the pre-feature wording wrong.
- Scope is fenced to two sections with an explicit "leave every other section untouched" guard plus a dedicated verification task (Task 3), including the cross-reference grep.

PLAN_REVIEW_PASS
