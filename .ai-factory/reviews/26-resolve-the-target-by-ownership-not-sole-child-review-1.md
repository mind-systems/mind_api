# Code Review: Resolve the target by ownership, not sole-child

**Review #1** · branch `feature/root-session`
**Files changed (code):**
- `src/realtime/services/activity-engine.service.ts` — added `getSession` delegate
- `src/realtime/module-instruction-stream.grpc.controller.ts` — swapped resolution guard

## Summary

The change is small, faithful to the spec, and correct. The instruction-stream controller now resolves the push target by **ownership** (`getSession(userId, msg.sessionId)`) instead of the retired sole-active-child check, and rejects only a genuine miss with the new literal `'SESSION_NOT_FOUND'`. The engine gains a thin delegate to the store's existing child-or-root `getSession`. The dedicated spec passes (11/11), including the two concurrent-children, root-mark, unowned-rejection, and pause-pass-through cases.

## Correctness

- **Ownership is per-sample and user-scoped.** `getSession(userId, msg.sessionId)` delegates to `ActivitySessionStore.getSession` (`activity-session-store.service.ts:108-113`), which resolves `getChild(userId, sessionId) ?? (getRootId(userId) === sessionId ? getRoot(userId) : undefined)`. Both arms are keyed by `userId`, so a caller cannot push to another user's session id — the change is strictly **tighter** than the old sole-child check, not looser. No cross-tenant leak.
- **Concurrent children + root marks now work.** Two distinct child ids and a root id all resolve truthy and `push(msg.sessionId, …)` keys buffers independently — exactly the milestone goal. Verified by the green ownership-routing suite.
- **Pause pass-through preserved.** No `SESSION_PAUSED` branch was added; a paused-but-owned session still pushes and acks. Confirmed by the pause regression suite.
- **Removed guards leave no dangling references.** `getActiveSession`/`getSoleChild` remain on the engine and are still used elsewhere (`activity-engine.service.ts` and the spec mock); only the controller stopped calling `getActiveSession`. The retired codes `NO_SESSION`/`SESSION_MISMATCH` are no longer emitted by this controller — no test asserted them, so nothing inverts.
- **Hygiene, ack shape, buffer-cap warn, and INTERNAL_ERROR catch** are all untouched, as specified.
- No proto change, no migration — correct; the store is in-memory.

## Findings

### 1. [Minor] Prettier violation on the changed controller line — lint gate fails

`module-instruction-stream.grpc.controller.ts:78` exceeds the print width and fails `npm run lint` / `npm run format`:

```
78:60  error  Replace `userId,·msg.sessionId` with multi-line args  prettier/prettier
```

The single-line `const session = this.activityEngine.getSession(userId, msg.sessionId);` must be wrapped:

```ts
const session = this.activityEngine.getSession(
  userId,
  msg.sessionId,
);
```

`npm run lint` (eslint `--fix`) auto-corrects this, but as committed the code does not pass the formatter. Run `npm run lint` before committing. Not a runtime defect.

## Non-findings (verified, out of scope)

- `npx tsc --noEmit` reports 3 errors in `src/realtime/services/biometric-stream-engine.service.spec.ts` (lines 372/405/438, `BioSessionSample` → `BioSampleInternal` casts). That file is **not** part of this diff and the errors are pre-existing and unrelated to this milestone. Flagged only so the next agent doesn't attribute them to this change; they should be addressed separately.
- `SESSION_NOT_FOUND` is introduced as a literal not present in `WsErrorCode`. Consistent with the controller's existing literal-string convention (`INVALID_ARGUMENT`, `INTERNAL_ERROR`) — intentional per spec, not a defect.

## Verdict

Logic is correct and complete against the spec; the only actionable item is the cosmetic Prettier wrap, which the project's own lint task fixes automatically. No correctness, security, or runtime-breakage issues.

Fix the formatting (`npm run lint`) before committing.
