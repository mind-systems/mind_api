# Plan: Resolve the target by ownership, not sole-child

## Context
Generalize instruction-stream ingest from the retired single-active-child semantics to an ownership check, so N concurrent phase streams and root-level marks are all accepted as long as `sessionId` is a live session owned by the user. No proto change, no engine routing change, no migration.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Engine ownership lookup

- [x] **Task 1: Add `getSession` delegate to `ActivityEngine`**
  Files: `src/realtime/services/activity-engine.service.ts`
  Add a thin public method that delegates to the store's existing `getSession` (which already resolves child-or-root at `activity-session-store.service.ts:108-113`). Place it next to the existing `getActiveSession`/`getSoleChild`/`getRootId`/`listLiveSessions` accessors (around `:533-549`):
  ```ts
  getSession(userId: string, sessionId: string): ActivityState | undefined {
    return this.activitySessionStore.getSession(userId, sessionId);
  }
  ```
  Do **not** remove or alter `getActiveSession`/`getSoleChild` — they are still used elsewhere in this service and by the corrective test mock.

### Phase 2: Controller ownership guard

- [x] **Task 2: Swap single-session resolution for ownership check in the instruction controller** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`
  In the `streamData` per-sample `next` handler (`:64-140`):
  - **Keep** the missing-sessionId hygiene guard (`:67-76`) emitting `'INVALID_ARGUMENT'` — unchanged.
  - **Remove** the `getActiveSession(userId)` + `NO_SESSION` guard (`:78-89`) and the `session.sessionId !== msg.sessionId → SESSION_MISMATCH` guard (`:91-100`). Both encode the retired single-session semantics.
  - **Add** the ownership lookup in their place:
    ```ts
    const session = this.activityEngine.getSession(userId, msg.sessionId);
    if (!session) {
      subscriber.next({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'No live session with this id for this user',
          timestamp: Date.now(),
        },
      });
      return;
    }
    ```
    Emit the literal string `'SESSION_NOT_FOUND'` (the controller emits literal error codes today — keep that convention). Do **not** reuse `'NO_SESSION'`/`'SESSION_MISMATCH'`.
  - **Keep unchanged**: the `streamEngine.push(msg.sessionId, …)` call (`:102-107`) — push already keys the buffer by the supplied `sessionId`, so concurrent children and root marks buffer independently with no engine change; the ack shape (`:109-117`); the buffer-cap `logger.warn` (`:119-123`); and the `INTERNAL_ERROR` catch (`:124-136`).
  - Do **not** add any `SESSION_PAUSED` / buffer-cap / pause branch — pause must remain pass-through (a paused-but-owned session still pushes and acks). Only swap the resolution guard.
  - Leave the controller constructor (`:32-36`) and all other code untouched.

## Notes
- The controller spec (`module-instruction-stream.grpc.controller.spec.ts`) already exposes both `getActiveSession` and `getSession` on its mock (added by an earlier committed test task); the pause pass-through suite's dual-method seeding is handled by a separate, dedicated test task — out of scope here. Do not edit test files in this milestone.
- Single logical change → single commit at the end: "Resolve instruction ingest target by ownership instead of sole active child".
