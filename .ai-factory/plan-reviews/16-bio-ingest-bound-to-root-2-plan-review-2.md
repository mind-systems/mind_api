# Plan Review #2: Bio ingest bound to root 2

**Plan:** `.ai-factory/plans/16-bio-ingest-bound-to-root-2.md`
**Files reviewed:** plan + controller, controller spec, activity engine, ws-error-codes, ROADMAP/RULES/ARCHITECTURE
**Risk Level:** 🟢 Low

## Verdict

The plan is solid and ready to implement. Both substantive issues raised in review #1 have been
fully and correctly addressed:

- **Review #1 Issue #1 (Task 2 miscount / coverage loss)** — Fixed. Task 2 now states there are
  **five** `it` cases, deletes exactly the **three** batch-sending pause cases (`:156`, `:180`,
  `:204`), explicitly preserves `:252` (`should register subscriber …` — the unique positive-path
  registration assertion) and `:228` (`ready frame while paused`), and instructs moving `:252` out of
  the soon-to-be-misnamed describe so it survives the block edit. Every cited line number matches the
  committed spec exactly.
- **Review #1 Issue #2 (async fire-and-forget + check-then-act `ensureRoot` race)** — Fixed. Task 1
  now carries an explicit "Concurrency note" acknowledging that early batches on a **bio-only**
  connection can transiently split across >1 root, that this is a pre-existing property of
  `ensureRoot`, and that the chosen mitigation is the empty-root janitor (no memoization in this task).
- **Review #1 Issue #3 (roadmap `getRoot` wording)** — Informational only; the plan correctly uses
  `ensureRoot`, consistent with the API and the committed spec mock.

## Re-verification against the codebase

- **Spec line numbers** — `module-biometric-stream.grpc.controller.spec.ts` confirms the
  `describe('streamData — pause pass-through')` block at `:155–263` holds exactly five cases at the
  cited lines. The three to delete (`:156/:180/:204`) all stub `getActiveSession` and push a batch
  (asserting an ack via the now-dead path) → correctly go RED. `:228` sends no batch (asserts only the
  synchronous `ready` frame) and `:252` sends no batch → both stay GREEN. ✅
- **Target cases unchanged** — `describe('streamData — bio bound to root')` (`:341–418`) already stubs
  `ensureRoot` and asserts `pushBatch('root-1', …)`, child id → `SESSION_MISMATCH`,
  `ensureRoot→undefined` → `NO_ROOT_SESSION`, and paused-root accepted. Task 1 as written flips these
  RED→GREEN without touching them. ✅
- **`ensureRoot` API** — Returns a `ModuleSession` with `.id` (no `sessionId` field); the mock
  `makeRoot` returns `{ id: 'root-1', … }`. Step 6's `root.id !== batch.samples[0].sessionId` and the
  happy-path `pushBatch(root.id, …)` / ack `sessionId: root.id` are all consistent. ✅
- **Error codes** — `WsErrorCode.NO_ROOT_SESSION === 'NO_ROOT_SESSION'` and
  `WsErrorCode.SESSION_MISMATCH === 'SESSION_MISMATCH'` (uppercase) match the spec's literal-string
  assertions. Steps 1–4 keep literal `'INVALID_ARGUMENT'` — correct, as `WsErrorCode` has no such key. ✅
- **Async ripple** — `handleBatch` becomes async; the `request.subscribe` next-handler at `:66-67`
  fire-and-forgets it. `void`-ing the call inside the existing `try/catch` is sound: a `repo.save`
  rejection during root creation is caught and surfaces as the `INTERNAL_ERROR` frame. The
  Promise-based `firstNonReadyFrame` test helper awaits the microtask, so no hang. ✅
- **Engine needs no change** — `pushBatch` is keyed by an arbitrary id; the `@OnEvent` flush handlers
  fire on root `ABANDONED`/`REVOKED` and no-op on child `COMPLETED`/`INTERRUPTED`. ✅

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — PASS. Change is confined to one realtime-module
  controller calling `ActivityEngine` through its public `ensureRoot`; no cross-module entity
  injection, no boundary violation.
- **Rules (`.ai-factory/RULES.md`)** — PASS. No non-null assertion introduced; logs reference IDs only
  (`root.id`, `userId`); logging stays minimal per Settings.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — PASS. Maps to line-52 milestone "Bio ingest bound to root
  2". The roadmap text says `getRoot(userId)`; the plan uses `ensureRoot`, which is the correct method
  (`ActivityEngine` has no `getRoot`) and matches the committed spec — a roadmap wording divergence,
  not a plan error.

## Minor Note (non-blocking)

- **Potential unused `makePausedSession` helper.** After deleting the three pause cases, only `:228`
  still uses `makePausedSession` (via its paused `getActiveSession` stub). Task 2 offers to
  *optionally* "drop its now-meaningless paused `getActiveSession` stub" — if the implementer takes
  that option, `makePausedSession` becomes an unused top-level function in the spec. This won't break
  jest (ts-jest/swc doesn't enforce unused) and `npm run build` typically excludes spec files, so it's
  cosmetic at most. Cleanest path: if dropping `:228`'s stub, also remove the now-orphaned
  `makePausedSession` helper; otherwise keep the stub and the helper stays referenced. No action
  required beyond awareness.

## Positive Notes

- The plan pins every churn-prone detail against the committed spec: exact error-code strings, `.id`
  vs `.sessionId`, the async ripple to the `request.subscribe` handler, and the precise set of tests to
  delete vs preserve (with line numbers and rationale for each).
- Correctly recognizes the engine requires zero changes and that child completion no longer flushing
  bio is intended (paired with the deployed tolerant analytics read).
- Task 3's verification scope (build + the two relevant spec files) is well targeted.

PLAN_REVIEW_PASS
