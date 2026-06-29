# Code Review (Round 2): Bio ingest bound to root 2

**Plan:** `.ai-factory/plans/16-bio-ingest-bound-to-root-2.md`
**Prior review:** `.ai-factory/reviews/16-bio-ingest-bound-to-root-2-review-1.md`
**Changed source/spec files reviewed in full:**
- `src/realtime/module-biometric-stream.grpc.controller.ts`
- `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
- Cross-checked: `services/activity-engine.service.ts` (`ensureRoot`), `services/biometric-stream-engine.service.ts` (`pushBatch`), `constants/ws-error-codes.ts`, `eslint.config.mjs`, `tsconfig*.json`

**Risk Level:** 🟢 Low — no findings.

## Scope note

This milestone's plan touches exactly two files: the bio-stream gRPC controller and its spec. The other entries in `git status` (migration, `module-state` controller, `activity-engine`, `session-watchdog`, `sessions` util/spec, etc.) are staged work from prior milestones on the `feature/root-session` branch and are out of scope for this plan; they are not reviewed here.

## Round-1 finding resolution

Review-1's single actionable finding (orphaned `makePausedSession` helper failing `npm run lint`) is **resolved**:
- `makePausedSession` (`:22-28`) deleted.
- The now-dead `getActiveSession: jest.fn()` mock and its stale comment in `makeActivityEngine` were also removed (good cleanup — the controller no longer calls `getActiveSession`).
- Verified: `npx eslint` on both files now reports **0 errors** (3 remaining are pre-existing `@typescript-eslint/no-unsafe-argument` **warnings** on the `as any` constructor casts in `beforeEach` — unchanged characterization, acceptable).

## Verification

- **Lint:** `npx eslint` on controller + spec → 0 errors, 3 pre-existing warnings.
- **Tests:** `npx jest` on `module-biometric-stream.grpc.controller.spec.ts` + `biometric-stream-engine.service.spec.ts` → **36 passed, 36 total**.
- **Build:** `npm run build` confirmed clean in round 1; the controller is byte-identical this round (only the spec changed, and specs are excluded from `nest build`).

## Verified correct (unchanged from round 1, re-confirmed)

- **Step 5/6 rewrite** — `await this.activityEngine.ensureRoot(userId)`; `if (!root)` → `WsErrorCode.NO_ROOT_SESSION`; `root.id !== batch.samples[0].sessionId` → `WsErrorCode.SESSION_MISMATCH`. Matches the committed target assertions.
- **`root.id` always defined** — `ensureRoot` returns a `ModuleSession` with `id` set on both the cached-root and freshly-saved branches; the `if (!root)` guard is harmless defensive code that the spec exercises via a forced `undefined`.
- **Happy path** — `pushBatch(root.id, mapped)`, ack `sessionId: root.id`, dropped-sample log references `root.id`; consumes `result.totalReceived/totalDropped/droppedCount`, matching the `pushBatch` return shape.
- **Steps 1–4 unchanged** — still emit literal `'INVALID_ARGUMENT'`; characterization smoke tests stay GREEN.
- **Async ripple** — `void this.handleBatch(...)` clears the floating-promise lint; `await ensureRoot` inside the existing `try/catch` surfaces a DB rejection as `INTERNAL_ERROR`.
- **Engine untouched** — `pushBatch` is id-agnostic; per-root buffering and the four `@OnEvent` flush handlers are unchanged.
- **Test refactor** — the unique `register subscriber` positive-path case and the `ready frame` case are preserved under `describe('streamData — connection')`; all remaining spec helpers (`makeUser`, `makeStreamEngine`, `makeActivityEngine`, `makeRoot`, `makeBatch`, `firstNonReadyFrame`, `makeActiveStreamRegistry`) are still referenced — no new dead code.

## Informational (pre-accepted, no action)

The duplicate-root race on a bio-only connection (async fire-and-forget `handleBatch` + check-then-act `ensureRoot`) remains a known, accepted property documented in the plan's Task 1 concurrency note, mitigated by the empty-root janitor. Not introduced or worsened by this change.

The implementation is correct, faithful to the plan and committed spec, and passes lint, build, and tests.

REVIEW_PASS
