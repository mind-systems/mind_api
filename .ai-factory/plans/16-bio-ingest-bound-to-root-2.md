# Plan: Bio ingest bound to root 2

## Context
Rebind biometric batch ingestion from the single active child session to the user's root session: the ingest controller resolves the root via `activityEngine.ensureRoot(userId)`, validates `batch.session_id === root.id`, and pushes/acks with `root.id` so the engine buffers per-root and flushes on root lifecycle. Pairs with the already-deployed tolerant analytics read so new root-bound bio is immediately visible.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rebind ingest to the root session

- [x] **Task 1: Resolve root via `ensureRoot` and rewrite steps 5–6 + happy path**
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  Make `handleBatch` `async` (it awaits `ensureRoot`). Import `WsErrorCode` from `./constants/ws-error-codes`. Keep Steps 1–4 (empty batch / missing sessionId / inconsistent sessionId / missing sampleType) exactly as-is, still emitting the literal `'INVALID_ARGUMENT'`.
  - **Step 5 — root resolution (replaces `getActiveSession`):** `const root = await this.activityEngine.ensureRoot(userId);` Then guard the unexpected null case: `if (!root) { emitError(WsErrorCode.NO_ROOT_SESSION, 'No root session'); return; }`. (`ensureRoot` lazily creates a root for a bio-only connection — it almost never yields nothing; `NO_ROOT_SESSION` is reserved for that unexpected case. The empty-root janitor reaps a never-used root later.)
  - **Step 6 — id match (keep `SESSION_MISMATCH`):** compare against `root.id`, NOT `session.sessionId`: `if (root.id !== batch.samples[0].sessionId) { emitError(WsErrorCode.SESSION_MISMATCH, 'Session ID does not match root session'); return; }`. Note `ModuleSession` has no `sessionId` field — its owner id is `.id`.
  - **Happy path:** push with the root id — `this.streamEngine.pushBatch(root.id, mapped)` (replace the old `batchSessionId`). The ack `sessionId` must also be `root.id`. The dropped-sample warning log should reference `root.id`.
  Engine (`biometric-stream-engine.service.ts`) needs no change — `pushBatch` is keyed by an arbitrary id, so passing `root.id` makes the buffer per-root automatically; the four `@OnEvent` flush handlers fire on root `ABANDONED`/`REVOKED` and harmlessly no-op on child `COMPLETED`/`INTERRUPTED` (children own no buffer).
  Because `handleBatch` is now async, the `request.subscribe` next-handler at `:66-67` fire-and-forgets it — `void`-ing the returned promise is acceptable; do not change the subscribe wiring otherwise. The `await ensureRoot` sits inside the existing `try/catch`, so a DB rejection on root creation is caught and surfaces as the `INTERNAL_ERROR` frame.
  **Concurrency note (no code change required):** `ensureRoot` is check-then-act (sync `getRoot` read, then `await repo.save` on a miss). Because `handleBatch` is now async and non-awaited, several early batches on a **bio-only** connection (no paired state stream that already created the root) can each see `getRoot() === undefined` and persist a duplicate root before the first save resolves. This is a pre-existing property of `ensureRoot`, not introduced here; the chosen mitigation is to rely on the empty-root janitor reaping childless roots. Do not add memoization in this task — just be aware bio may transiently split across >1 root on a bio-only connection until reaping. For a paired connection the root already exists (`module-state.grpc.controller.ts` calls `ensureRoot` on connect), so bio's calls are idempotent.

- [x] **Task 2: Retire the three batch-sending pause pass-through tests** (depends on Task 1)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  Inside `describe('streamData — pause pass-through')` (`:155-263`) there are **five** `it` cases. Only the **three** that stub `getActiveSession` AND push a batch go false-RED after Task 1 (they assert an ack from the now-dead `getActiveSession` path) — delete exactly these three:
  - `:156` `should call streamEngine.pushBatch when session is paused and sessionId matches`
  - `:180` `should respond with ack (not SESSION_PAUSED error) when session is paused`
  - `:204` `should not emit an error frame for a paused session with a valid batch`
  Their pause invariant is already re-expressed against a live root in `describe('streamData — bio bound to root')` (the "accept a batch for a paused root" case), so they are superseded — delete, do not invert.
  **Preserve the other two cases** (they stay GREEN and are NOT superseded):
  - `:252` `should register subscriber with activeStreamRegistry when user is valid` — the **only** positive-path assertion that `activeStreamRegistry.register` is called for a valid user (the auth block only covers the negative path). Must be kept. Move it out of the now-misnamed `pause pass-through` describe (e.g. into the connection/registry describe) so it survives the block edit; optionally drop the empty `pause pass-through` describe wrapper if the remaining cases are relocated.
  - `:228` `should still emit ready frame on connection even when session is paused` — asserts only the synchronous `ready` frame; stays GREEN. Keep it; optionally drop its now-meaningless paused `getActiveSession` stub.
  Do **not** modify the `describe('streamData — bio bound to root')` target cases (resolve root → `pushBatch(root.id, …)`; child id → `SESSION_MISMATCH`; `ensureRoot→undefined` → `NO_ROOT_SESSION`; paused root accepted) — Task 1 flips them RED→GREEN as written.

- [x] **Task 3: Build + targeted test verification** (depends on Task 2)
  Files: (no source changes)
  Run `npm run build` to confirm the async change and `WsErrorCode` import compile. Run `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts` and `npx jest src/realtime/services/biometric-stream-engine.service.spec.ts` to confirm the four bio-bound-to-root target cases are GREEN and the engine root-lifecycle-flush characterization tests stay GREEN. If anything is RED, fix in Task 1/2 rather than altering the committed assertions.
