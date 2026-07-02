# Plan: Emit a RESUMED session:state per live child on reconnect

## Context
On reconnect the controller emits only a single `session:state` RESUMED frame (whichever child `handleReconnect` returned last), silently dropping all other live children; this milestone emits one RESUMED frame per live child so the mobile client can reconcile every concurrently-started child. Spec: `.ai-factory/notes/45-per-child-resumed-frames-on-reconnect.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Engine delegate

- [x] **Task 1: Add `ActivityEngine.listChildren` delegate**
  Files: `src/realtime/services/activity-engine.service.ts`
  Insert a new public method between `getRootId` (`:562-564`) and `listLiveSessions` (`:566-570`):
  ```ts
  listChildren(userId: string): ActivityState[] {
    return this.activitySessionStore.listChildren(userId);
  }
  ```
  Mirror the exact one-line-forward pattern of `getSession`/`getSoleChild`/`getRootId`. Do **not** reuse or modify `listLiveSessions` (it conflates root + children). `ActivityState` is already imported in this file; `activitySessionStore.listChildren(userId): ActivityState[]` already exists (`activity-session-store.service.ts:116-121`, excludes root). No signature/loop change to `handleReconnect`.

### Phase 2: Controller fan-out

- [x] **Task 2: Emit one RESUMED frame per live child in the reconnect branch** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In the resumed-session `else` branch (`:168-182`), branch on `this.activityEngine.listChildren(userId)`:
  - **Non-empty** → loop over children, emitting one `session:state` per child: `moduleSessionId: child.sessionId`, `status: ActivityStatus.RESUMED`, `isPaused: child.isPaused` (read straight off the `ActivityState`, no per-child `getSession`), `activityType: mapInternalActivityType(child.activityType)` (same internal type, no cast). Log once: `` `Sessions resumed on reconnect: userId=${userId} count=${children.length}` ``.
  - **Empty** → keep today's root-only fallback (`:169-181`) **byte-for-byte unchanged** — still `result.id` / `getSession(userId, result.id)?.isPaused ?? false` / existing single-session log line.
  Do **not** add `await` inside the per-child loop (`subscriber.next` is synchronous; the existing `if (subscriber.closed) return;` at `:154` is sufficient). Do **not** touch the ABANDONED branch (`:157-167`), the outer `if (result !== null)` guard, or any code after `:183`. No root frame is emitted when children exist (preserves the already-narrow HEAD behavior). No proto change, no migration.
