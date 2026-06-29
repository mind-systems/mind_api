# Plan Review: Bio ingest bound to root 2

**Plan:** `.ai-factory/plans/16-bio-ingest-bound-to-root-2.md`
**Files reviewed:** plan + 5 source/spec files (controller, controller spec, activity engine, engine, engine spec) + ws-error-codes + roadmap/rules/architecture
**Risk Level:** 🟡 Medium

## Verdict

The core technical direction is correct and matches the already-committed test spec. The mechanics of Task 1 (swap `getActiveSession` → `ensureRoot`, compare `root.id`, push with `root.id`, async `handleBatch`, `void` the fire-and-forget call) are accurate down to the error-code strings and the import path. The one real defect is in **Task 2**: it miscounts the test cases and, taken literally, deletes a unique positive-path test. There is also a narrow concurrency concern worth a note. Neither is a build-breaker, but Task 2 needs a correction before implementation.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — WARN→PASS. Modular monolith; entity ownership stays intact. The plan touches only `module-biometric-stream.grpc.controller.ts` inside the realtime module and calls `ActivityEngine` through its public `ensureRoot` (no cross-module entity injection). No boundary violation. ✅
- **Rules (`.ai-factory/RULES.md`)** — PASS. No non-null assertion is introduced; logs reference IDs only (`root.id`, `userId`) — no PII; logging stays minimal per the plan's Settings; the controller already pairs `@Payload()` with `@GrpcCurrentUser()`. ✅
- **Roadmap (`.ai-factory/ROADMAP.md`)** — PASS. This plan is the line-52 milestone "Bio ingest bound to root 2" (Phase 58). Linkage is explicit and correct. ✅ (See Important Issue #3 re: a wording divergence.)

## Critical Issues

None that break the build or the committed target tests.

## Important Issues

### 1. Task 2 miscounts the cases and would delete a uniquely-covered test (clarity + coverage)

The `describe('streamData — pause pass-through')` block (`module-biometric-stream.grpc.controller.spec.ts:155–263`) contains **five** `it` cases, not four:

1. `should call streamEngine.pushBatch when session is paused and sessionId matches` (156) — stubs `getActiveSession`, **sends a batch**, asserts ack → goes **RED** after the change.
2. `should respond with ack (not SESSION_PAUSED error) when session is paused` (180) — same → **RED**.
3. `should not emit an error frame for a paused session with a valid batch` (204) — same → **RED**.
4. `should still emit ready frame on connection even when session is paused` (228) — stubs `getActiveSession` but **never sends a batch**; only asserts the synchronous `ready` frame → stays **GREEN**.
5. `should register subscriber with activeStreamRegistry when user is valid` (252) — does **not** stub `getActiveSession`, sends no batch → stays **GREEN**.

Problems with the Task 2 instruction:
- It says delete "the **four** `it` cases that stub `activityEngine.getActiveSession` **and send a child sessionId**." Only **three** cases match "stub + send a batch," and they send a *matching* id (`'session-1'`), **not** a child id. (The child-id batch lives in the `bio bound to root` block, not here.) So the parenthetical mis-describes both the count and the payload.
- The headline instruction — "Delete the `describe(...)` block" — also removes cases 4 and 5, which stay GREEN and are **not** superseded by `describe('streamData — bio bound to root')`. In particular, case 5 is the **only** positive-path assertion that `activeStreamRegistry.register` is called for a valid user (the authentication block only asserts the *negative* path). Deleting it silently drops that coverage.

The build and the four bio-bound-to-root target tests would still go GREEN either way, so the pipeline won't catch this — but the plan as written leads to either confusion (no case matches "the four … child sessionId") or quiet coverage loss.

**Recommendation:** Reword Task 2 to delete only the **three** batch-sending pause cases (156–226). Preserve case 5 (`should register subscriber …`) — it is unique. Case 4 (`ready frame while paused`) is also still GREEN; either keep it (optionally drop its now-meaningless paused stub) or move it under a non-pause describe. Update the rationale's "four go false-RED" to "three."

### 2. Async fire-and-forget + `ensureRoot` check-then-act can create duplicate roots on a bio-only connection (concurrency)

`ensureRoot` is check-then-act: it reads the in-memory store synchronously (`getRoot`), and only on a miss does it `await this.repo.save(...)` before calling `setRoot`. Because `handleBatch` is now `async` and the `request.subscribe` next-handler fire-and-forgets it (`void`), several early batches can enter `ensureRoot` before the first `repo.save` resolves — each sees `getRoot() === undefined` and persists its own root row.

Scope is narrow: for a paired connection the root already exists because `module-state.grpc.controller.ts:154` calls `ensureRoot` on connect, so bio's calls are idempotent (no DB). The race only bites a **bio-only** connection — exactly the case the plan calls out as the reason for using `ensureRoot`. The empty-root janitor reaps *childless* roots later, so duplicates are not permanently leaked, but transiently you can get >1 root and bio split across them until reaping.

This is a pre-existing property of `ensureRoot`, not introduced by the plan — but the plan is the first caller to exercise it from a high-frequency, non-awaited path. **Recommendation:** add a one-line note acknowledging the race and the chosen mitigation (rely on the janitor, or memoize an in-flight `ensureRoot` promise per `userId`). Not a blocker.

### 3. Roadmap wording says `getRoot`; the plan correctly uses `ensureRoot` (informational)

ROADMAP line 52 reads "Resolve `activityEngine.getRoot(userId)`." `ActivityEngine` has **no** `getRoot` method (only `ensureRoot`, `getActiveSession`, `getSoleChild`, `listLiveSessions`; `getRoot` exists on the *store*). The committed spec mocks `ensureRoot`. The plan's use of `ensureRoot` is the correct choice and is consistent with both the API and the lazy-creation rationale for bio-only connections. No action needed — flagging only so the divergence from roadmap text isn't mistaken for an error.

## Verified Correct (no action needed)

- **Import path** `./constants/ws-error-codes` from the controller resolves correctly (`src/realtime/constants/ws-error-codes.ts`).
- **Error codes** match the committed spec assertions exactly: `NO_ROOT_SESSION`, `SESSION_MISMATCH` are present in `WsErrorCode`; steps 1–4 keep the literal `'INVALID_ARGUMENT'` (correct — `WsErrorCode` has no such key).
- **`root.id` vs `sessionId`** — accurate; `ModuleSession`/`ensureRoot` return `.id`, and the spec's `makeRoot` returns `{ id, … }`. Step 6 comparing `root.id !== batch.samples[0].sessionId` matches the "child id → SESSION_MISMATCH" target test.
- **Happy path** `pushBatch(root.id, mapped)` + ack `sessionId: root.id` matches `expect(streamEngine.pushBatch).toHaveBeenCalledWith('root-1', …)` and `frame.ack.sessionId === 'root-1'`.
- **"Engine needs no change"** — confirmed. `pushBatch` is keyed by an arbitrary id; the four `@OnEvent` handlers are already characterized for per-root flush on `ABANDONED`/`REVOKED` and harmless no-op on child `COMPLETED`/`INTERRUPTED` (`biometric-stream-engine.service.spec.ts:266–309`). Roots do reach `ABANDONED` (`abandonActivity` is invoked for the root id via `handleTransportDisconnect`); periodic `flushAll` also persists the root buffer every interval.
- **Async/`void` rationale** — sound. `await ensureRoot` sits inside the existing `try/catch`, so a DB rejection is caught and surfaces as the `INTERNAL_ERROR` frame; `void`-ing the call avoids a floating-promise lint error without changing subscribe wiring.

## Positive Notes

- The plan is unusually precise about the exact error-code strings, the `.id` vs `.sessionId` field name, and the async ripple to the `request.subscribe` handler — these are the spots that normally cause RED→GREEN churn, and they're all pinned correctly against the committed spec.
- Correctly recognizes that the engine requires zero changes and that child completion no longer flushing bio is intended (paired with the already-deployed tolerant analytics read), avoiding an unnecessary engine edit.
- Task 3's verification scope (build + the two relevant spec files) is well targeted.

Fix Important Issue #1 (reword Task 2 to delete the three batch-sending cases and preserve the registration test) and optionally add the concurrency note from #2; the rest is solid.
