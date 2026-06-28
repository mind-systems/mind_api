## Plan Review: deleteRun — clean up the root orphaned by a deleted practice

**Plan:** `14-deleterun-clean-up-the-root-orphaned-by-a-deleted-practice.md`
**Files Reviewed:** plan + `sessions.service.ts`, `sessions.service.spec.ts`, `module-session.entity.ts`, `bio-session-sample.entity.ts`, migrations, `session-watchdog.service.ts`
**Risk Level:** 🟢 Low

### Verification against the codebase

Every load-bearing assumption in the plan was checked and holds:

- **`rootSessionId` column exists** — `ModuleSession.rootSessionId: string | null` (entity `:26-27`), `@Index(['rootSessionId'])` present. The `count({ where: { rootSessionId } })` query is supported.
- **Self-referencing FK is `ON DELETE CASCADE`** — migration `1782658936664-AddRootSessionLink.ts:10-11`: `FK_module_sessions_rootSessionId FOREIGN KEY ("rootSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE`. Confirmed.
- **Root deletion removes its bio** — `bio_session_samples.moduleSessionId → module_sessions(id) ON DELETE CASCADE` (`1779990145496-AddBioSessionSamplesTable.ts:13`). Deleting the root row removes the bio rows pointing at it. Confirmed. (See observation 1 on the plan's wording.)
- **Child deletion removes its instructions** — `session_stream_samples.moduleSessionId → module_sessions(id) ON DELETE CASCADE` (InitialSchema `:293`). The child's stream samples cascade away on the discrete child delete.
- **No-transaction constraint is real** — the outer `beforeEach` mock (`spec:30-34`) and the orphan-cleanup mock (`spec:146-151`) are plain repos with no `manager`. A `moduleSessionRepo.manager.transaction(...)` wrapper would throw and turn the orphan cases RED. The plan correctly forbids it.
- **Backstop exists** — `SessionWatchdog.sweepEmptyRoots()` (`session-watchdog.service.ts:102`) sweeps childless roots past TTL, covering the non-atomic partial-failure case the plan cites.
- **Roadmap linkage** — matches Phase 57 task `.ai-factory/ROADMAP.md:47` and spec `notes/15-deleterun-orphan-root-cleanup.md`.

### Cross-check against the committed tests

The plan's algorithm produces the exact observable sequence each committed test asserts:

- `should delete the root after its last child is deleted` — `count→0` ⇒ two deletes, `{id: child}` then `{id: ROOT_ID}`. ✅
- `should keep the root when a sibling child remains` — `count→1` ⇒ one delete; `count` called with `{ where: { rootSessionId: ROOT_ID } }`; root never touched. ✅
- `should count siblings after deleting the child` — child `delete` invocation order precedes `count`. ✅
- `legacy session with rootSessionId null` (must stay GREEN) — `rootId == null` early-return ⇒ exactly one delete, `count` never called. ✅
- Existing owned/foreign/missing/live cases — ownership + active-guard preserved verbatim; the default mock has no `count`, but those paths never reach it (`makeSession` leaves `rootSessionId` undefined, and `== null` early-returns before the count). ✅

The use of `== null` (not `=== null`) is correct and necessary: it catches both the `null` legacy rows and the `undefined` `rootSessionId` on the default-mock sessions, keeping the four pre-existing `deleteRun` cases GREEN without a `count` mock.

### Context Gates

- **Architecture (ARCHITECTURE.md):** PASS — change stays inside `SessionsService` using the already-injected `moduleSessionRepo`; no cross-module entity injection, no new dependency. Relies on DB-level cascade rather than service-level deletes of bio/stream, consistent with the existing `deleteRun` design (the spec explicitly asserts bio/stream repos are never called).
- **Rules (RULES.md):** PASS — no rule violations identified; logging stays via the existing `Logger` instance, single-concern change.
- **Roadmap (ROADMAP.md):** PASS (with WARN below) — directly implements the open Phase 57 item at `:47`.

### Critical Issues

None. The plan is implementable as written and will turn the three RED target cases GREEN while keeping the characterization cases GREEN.

### Non-blocking observations

1. **Imprecise cascade wording (WARN, doc only).** Task 1 step 4 says *"the self-referencing FK `ON DELETE CASCADE` removes the root's `bio_session_samples` automatically."* The bio rows are actually removed by the **`bio_session_samples → module_sessions` FK**, not the self-referencing `rootSessionId` FK (which would cascade *child* rows, and there are none left at that point). The end result — root deletion drops its bio — is correct; only the explanatory attribution is off. Consider correcting the comment to avoid misleading a future reader, but it does not affect the implementation.

2. **Roadmap says "Transactional"; plan is deliberately non-atomic (WARN).** ROADMAP `:47` describes this task as "Transactional." The plan intentionally drops atomicity because the committed test mock has no `manager`, and justifies it via the `SessionWatchdog` backstop. This is a sound, well-documented trade-off and the committed tests encode the non-transactional shape — so the plan is right to follow the tests over the roadmap phrasing. Noting only so the divergence is intentional and visible.

3. **Minor line-reference drift (info).** The plan cites `deleteRun` as `:137-147`; the method body is actually `:138-147` (signature at `:138`, body `:139-147`). The anchor references for the ownership check (`:139`), active-guard (`:140-144`), and success log (`:146`) are all accurate. Inconsequential.

### Positive Notes

- Strong, test-anchored specification: the plan ties every step to a concrete committed assertion (delete count, call order, `count` argument shape), leaving no room for an implementer to drift.
- Correctly identifies and forbids the transaction-wrapper trap that would silently break the mock-based suite, and explains *why*.
- Ordering rationale (delete child → count siblings → conditionally delete root) is precise and matches the "deleted child not counted" invariant.
- Preserves the existing ownership and active-session guards verbatim, avoiding regressions in the four characterization cases.

The plan is solid.

PLAN_REVIEW_PASS
