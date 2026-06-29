# Code Review: Bio ingest bound to root 2

**Plan:** `.ai-factory/plans/16-bio-ingest-bound-to-root-2.md`
**Changed source/spec files reviewed in full:**
- `src/realtime/module-biometric-stream.grpc.controller.ts` (read in full)
- `src/realtime/module-biometric-stream.grpc.controller.spec.ts` (read in full)
- Cross-checked: `services/activity-engine.service.ts` (`ensureRoot`), `services/biometric-stream-engine.service.ts` (`pushBatch`), `constants/ws-error-codes.ts`, `eslint.config.mjs`, `tsconfig*.json`

**Risk Level:** 🟢 Low — one lint-gate failure, no runtime/correctness defects.

## Verdict

The implementation matches the plan and the committed test spec exactly. `npm run build` is clean and all 36 tests in the two relevant suites pass. There is **one actionable finding**: the test refactor deleted the only consumers of a helper but left the helper in place, which fails `npm run lint` (a documented part of the dev workflow). One informational note on a pre-accepted concurrency property.

## Findings

### 1. (Minor — breaks `npm run lint`) Orphaned `makePausedSession` helper after deleting the pause tests

Task 2 deleted the three batch-sending pause cases that were the only callers of `makePausedSession` (`module-biometric-stream.grpc.controller.spec.ts:22-28`), but the helper itself was not removed. The project's ESLint config (`eslint.config.mjs`) applies `tseslint.configs.recommendedTypeChecked`, so `@typescript-eslint/no-unused-vars` is an **error**. Verified empirically:

```
src/realtime/module-biometric-stream.grpc.controller.spec.ts
  22:10  error  'makePausedSession' is defined but never used   @typescript-eslint/no-unused-vars
  23:3   error  Unsafe return of a value of type `any`          @typescript-eslint/no-unsafe-return
✖ 5 problems (2 errors, 3 warnings)
```

- `npm run build` passes (tsconfig has no `noUnusedLocals`, and `nest build` excludes `*.spec.ts`), and `npx jest` passes — so the plan's Task 3 verification (build + jest only) does **not** catch this. But CLAUDE.md lists `npm run lint` as part of the workflow, and `eslint --fix` will **not** auto-remove an unused function declaration, so the error persists through `npm run lint`.
- **Fix:** delete the `makePausedSession` function (`:22-28`).
- While there, the now-dead `getActiveSession: jest.fn()...` mock (`:44`) and the stale `getActiveSession` comment (`:266`) are leftover from the old path. The mock is an object property, so it is **not** flagged by lint (harmless), but removing it is a clean follow-on since the controller no longer calls `getActiveSession`. Optional.

### 2. (Informational — pre-accepted) Duplicate-root race on a bio-only connection

`handleBatch` is now async and fire-and-forgotten (`void this.handleBatch(...)`), and `ensureRoot` is check-then-act (sync `getRoot`, then `await repo.save` on a miss). Several early batches on a bio-only connection can each miss and persist a duplicate root. This was raised in plan-review #2, accepted, and documented in the plan's Task 1 concurrency note with the empty-root-janitor as the mitigation. No code change expected in this task — flagging only for traceability. Paired connections are unaffected (the state stream already created the root, so bio's calls are idempotent).

## Verified correct (no action needed)

- **Step 5/6 rewrite** — `await this.activityEngine.ensureRoot(userId)`; `if (!root)` → `WsErrorCode.NO_ROOT_SESSION`; `root.id !== batch.samples[0].sessionId` → `WsErrorCode.SESSION_MISMATCH`. Matches spec assertions (`NO_ROOT_SESSION`, `SESSION_MISMATCH`, child-id → mismatch).
- **`root.id` is always defined** — `ensureRoot` returns a `ModuleSession` with `id` set on both the cached-root branch (`rootId` from `getRootId`) and the freshly-saved branch (`saved.id`). The `if (!root)` guard is harmless defensive code; the spec forces `undefined` to exercise the `NO_ROOT_SESSION` path.
- **Happy path** — `pushBatch(root.id, mapped)`, ack `sessionId: root.id`, dropped-sample warning references `root.id`. Consumes `result.totalReceived` / `result.totalDropped` / `result.droppedCount`, which exactly match the `pushBatch` return shape in `biometric-stream-engine.service.ts`.
- **Steps 1–4 unchanged** — still emit the literal `'INVALID_ARGUMENT'` (correct; `WsErrorCode` has no such key). Characterization smoke tests stay GREEN.
- **Async ripple** — `void this.handleBatch(...)` avoids the floating-promise lint warning without changing subscribe wiring; `await ensureRoot` sits inside the existing `try/catch`, so a DB rejection surfaces as the `INTERNAL_ERROR` frame.
- **Engine untouched** — `pushBatch` is id-agnostic; the four `@OnEvent` flush handlers and per-root buffering are unchanged. Engine characterization suite stays GREEN.
- **Test refactor** — the unique `register subscriber` positive-path case and the `ready frame` case were preserved (relocated under `describe('streamData — connection')`), exactly as the plan required after plan-review #1.
- **Build + tests** — `npm run build` clean; `npx jest` on both relevant suites: **36 passed, 36 total**.

## Summary

Functionally correct and faithful to the plan/spec. Resolve finding #1 (delete the orphaned `makePausedSession` helper) so `npm run lint` passes; finding #2 is informational only.
