# Plan Review 2: 09 — Lazy root creation + child linking

**Plan:** `.ai-factory/plans/09-lazy-root-creation-child-linking.md`
**Scope reviewed:** ActivityEngine, ActivitySessionStore, ModuleSession entity, ModuleStateGrpcController, migrations, committed target/characterization tests (`multi-session-lifecycle.spec.ts`, block `target — ensureRoot / linking`, lines 701–854).
**Risk Level:** 🟢 Low — the two blocking issues from review-1 are resolved; all assumptions re-verified against current code.

---

## Resolution of review-1 findings

Both review-1 issues are now closed in the plan text:

1. **Critical (review-1 #1) — do not call `ensureRoot` inside `startActivity`.** Resolved. Task 2 now explicitly forbids calling `ensureRoot` from `startActivity` and links via a read-only `this.activitySessionStore.getRootId(userId)` lookup (`null` when no root, zero DB access). This keeps the protected characterization tests `start→end` / `start→stop` GREEN — they seed no root, `getRootId` returns `null`, and they make no `rootSessionId` assertion. Verified against the store: `getRootId` returns `bucket?.rootSessionId ?? null` with no repo access (`activity-session-store.service.ts:79–81`). ✅

2. **Important (review-1 #2) — assign `rootSessionId` onto the entity, not only the `create({…})` arg.** Resolved. Task 2 now states "assign it onto the created entity instance after create: `session.rootSessionId = rootId;`" and explains the mocked-`repo.create` reason. Verified against the target test: `repo.create.mockReturnValue(childRow)` and the assertion reads `repo.save.mock.calls[0][0].rootSessionId` (`spec.ts:782–789`). Mutating the returned `childRow` is the only way the saved object carries the id. ✅

---

## Verified assumptions (correct)

- `getRootId` is read-only, no DB access — confirmed (`activity-session-store.service.ts:79`).
- Store API surface (`setRoot/getRoot/getRootId/removeRoot/addChild/getChild/getSession/getSoleChild/listChildren`) matches the plan's "Current state" list. ✅
- `endActivity(userId, clientTimestampMs?, sessionId?)` — `sessionId` is the 3rd positional (`activity-engine.service.ts:110–114`). ✅
- No-arg command paths (`endActivity/stopActivity/pauseActivity/unpauseActivity`) resolve via `getSoleChild` (children-only, root excluded), so they already never address the root (`getSoleChild`, lines 132–136; engine lines 116, 315, 377, 414). The only gap is an explicit root-addressed `sessionId`, exactly what Task 3 guards. ✅
- `coerceClientTs(...)` helper exists (lines 39–55), usable by `ensureRoot`'s create branch as the plan describes. ✅
- **Task 1 idempotent branch.** Re-verified against test `should create exactly one root … reuse it on repeat`. First call: `getRoot` undefined → create branch saves `rootRow`, calls `setRoot`. Second call: `getRoot` now returns the stored state → synthesized return with `id = getRootId(userId)`, zero `repo.create`/`repo.save`. Test asserts `repo.save.mock.calls.length` unchanged and `second.id === first.id` — both satisfied. ✅
- **Task 1 no stream push / no SessionEvents** — correct; the root has no instruction stream, and the third target test asserts exactly one `SessionEvents.COMPLETED` (the child), so an accidental root event would break it. ✅
- **Task 3 never-end-root test.** `endActivity('user-1')` no-arg with root + one child in store → `getSoleChild` returns the child (root excluded), child ends, root stays ACTIVE, single COMPLETED emit. Matches `spec.ts:797–853`. The guard added in Task 3 is purely additive for the explicit-root case and does not perturb this no-arg path. ✅
- **Task 4 insertion point.** Confirmed against `module-state.grpc.controller.ts`: the `handleReconnect` result block ends at line 137, `connectedAt = Date.now()` is line 139, `request.subscribe(...)` is line 141. Inserting `if (subscriber.closed) return; await this.activityEngine.ensureRoot(userId);` between them is exact and correct. A reconnect-within-grace already resumed the root in `handleReconnect` (lines 491–514), so `ensureRoot` hits its zero-write idempotent branch — no duplicate. ✅
- **Migrations.** No new migration scheduled, and none is needed — `1782658908789-AddRootActivityType.ts` and `1782658936664-AddRootSessionLink.ts` already exist. ✅
- **`getActiveSession` / new `activity:start` not blocked by root** — `getActiveSession` uses `getSoleChild` (children-only, line 451), so a materialized root does not block subsequent starts. ✅

---

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md` present):** No boundary violations. All changes stay within the `realtime` module (engine + store + controller); no cross-module internals are imported. WARN: none.
- **Rules (`.ai-factory/RULES.md` present):** No conflicts. The plan adds no non-null assertions, logs only IDs/outcomes (`logger.log` on root creation, `logger.warn` on root-skip guard) — consistent with "Keep logs lean" and "never log sensitive data". The `ensureRoot` call site is in the existing stream setup, not a `@GrpcCurrentUser()` method param, so the `@Payload()` rule is unaffected. WARN: none.
- **Roadmap (`.ai-factory/ROADMAP.md` present):** This is a test-driven milestone (Phase 55, spec 04) turning committed RED tests GREEN; linkage is implicit in the test block naming. No missing roadmap linkage to flag.
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** absent — no project-specific review overrides to apply.

---

## Critical Issues

None.

---

## Positive Notes

- The plan is unusually precise about *why* each mutation is needed (mocked `repo.create` semantics, the `save`-argument assertion, the create-vs-idempotent branch DB-access contract), which directly maps each instruction to a specific test assertion.
- Correctly scopes root materialization to the controller only and keeps `startActivity` read-only, avoiding the characterization-test regression that review-1 caught.
- Task 3's per-method contract choice (null-return for `end`/`stop`, throw for `pause`/`unpause`) matches each method's existing return contract, so the guard is behavior-preserving for the no-arg paths.

PLAN_REVIEW_PASS
