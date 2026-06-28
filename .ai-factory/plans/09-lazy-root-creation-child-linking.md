# Plan: Lazy root creation + child linking

## Context
Materialize a lazy `root` `ModuleSession` per state-stream connection (idempotent `ActivityEngine.ensureRoot`), link every newly started child to it via `rootSessionId`, and ensure user commands (`end`/`stop`/`pause`/`resume`) can never terminate the root.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Notes for the implementer
- Spec: `.ai-factory/notes/04-lazy-root-creation.md`. The note describes pre-refactor code; the actual code has already moved past it. Trust the current code, summarized below.
- Committed target tests live in `src/realtime/services/multi-session-lifecycle.spec.ts`, block `target — ensureRoot / linking` (lines 701-854). They are RED until this milestone lands. Do **not** edit them — make them GREEN.
- Current state (already in place from Phases 54-55):
  - `ActivityType.ROOT = 'root'` exists (`src/realtime/enums/activity-type.enum.ts`).
  - `ModuleSession.rootSessionId: string | null` column exists (`src/realtime/entities/module-session.entity.ts`).
  - `ActivityState.rootSessionId?: string | null` exists (`src/realtime/interfaces/activity-state.interface.ts`).
  - Store (`src/realtime/services/activity-session-store.service.ts`) exposes: `setRoot(userId, sessionId, state?)`, `getRoot(userId)`, `getRootId(userId)`, `removeRoot`, `addChild(userId, sessionId, state)`, `getChild`, `getSession(userId, sessionId)` (child-or-root), `getSoleChild` (children-only), `listChildren` (children-only).
  - `ActivityEngine.endActivity(userId, clientTimestampMs?, sessionId?)` — `sessionId` is the **3rd** positional (the note's "2nd positional" is stale). No-arg command paths already resolve via `getSoleChild` (children-only), so they already never touch the root; the only gap is an **explicit** `sessionId` that addresses the root.
  - `private coerceClientTs(...)` helper already exists on the engine (lines 39-55).

## Tasks

### Phase 1: Engine — root lifecycle + linking

- [x] **Task 1: Add idempotent `ensureRoot` to ActivityEngine**
  Files: `src/realtime/services/activity-engine.service.ts`
  Add `async ensureRoot(userId: string, clientTimestampMs?: number | { toNumber?: () => number } | string): Promise<ModuleSession>`.
  - Idempotent branch — if `this.activitySessionStore.getRoot(userId)` returns a state, return WITHOUT any DB access (the committed test mocks neither `findOne` nor a second `save`): synthesize and return a `ModuleSession`-shaped object from the stored root state + `getRootId(userId)` (e.g. `{ id: rootId, userId, activityType: ActivityType.ROOT, activityRefId: undefined, rootSessionId: null, status: SessionStatus.ACTIVE, startedAt: rootState.startedAt, lastActivityAt: rootState.lastActivityAt } as ModuleSession`). This branch must issue ZERO `repo.create` and ZERO `repo.save` (test asserts the 2nd `ensureRoot` call adds no `save` and returns the same `id`).
  - Create branch — otherwise build a row via `this.repo.create({ userId, activityType: ActivityType.ROOT, activityRefId: undefined, status: SessionStatus.ACTIVE, startedAt: this.coerceClientTs(clientTimestampMs) ?? now, lastActivityAt: now, rootSessionId: null })`, `await this.repo.save(...)`, then `this.activitySessionStore.setRoot(userId, saved.id, { sessionId: saved.id, activityType: ActivityType.ROOT, startedAt: saved.startedAt, lastActivityAt: saved.lastActivityAt, isPaused: false, rootSessionId: null })`. Return `saved`.
  - Do **NOT** call `this.streamEngine.push(...)` and do **NOT** emit any `SessionEvents` — the root has no instruction/SESSION_EVENT stream of its own (unlike `startActivity`).
  - One `this.logger.log` on actual creation only (skip logging on the idempotent reuse path).

- [x] **Task 2: Link new children to the root in `startActivity`**
  Files: `src/realtime/services/activity-engine.service.ts`
  Do **NOT** call `ensureRoot` from inside `startActivity` — that would run the create branch (a DB write + consuming a mocked `save`) and break the protected characterization tests `start→end` / `start→stop`, which seed no root and queue exactly one `save`. Root materialization is the controller's job (Task 4), which always runs on connect before any `activity:start` reaches the engine. Instead, link via a **read-only** store lookup:
  - At the top of `startActivity`, `const rootId = this.activitySessionStore.getRootId(userId);` — returns `null` when no root exists, with no DB access.
  - Add `rootSessionId: rootId` to the `this.repo.create({...})` object **and** assign it onto the created entity instance after create: `session.rootSessionId = rootId;`. The assignment is required because the target test mocks `repo.create` to return a fixed `childRow` (with `rootSessionId: null`) and asserts on the object passed to `save` — the field in the `create({...})` argument alone never reaches the saved object.
  - Add `rootSessionId: rootId` to the in-memory `ActivityState` literal (built fresh, not mocked, so the literal is sufficient here).
  - Keep storing the child via `this.activitySessionStore.addChild(userId, saved.id, state)` (already in place).
  This makes the persisted child row and the stored state both carry `rootSessionId === <root id>` when a root is present (target test `should set a newly started child rootSessionId to the active root id` pre-seeds the root via `setRoot`, so `getRootId` returns `'root-session-1'`), while leaving the no-root characterization tests untouched (`rootId` is `null`; those tests don't assert on `rootSessionId`).

- [x] **Task 3: Guard user commands from terminating the root** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  After each method resolves its target `sid`/`state`, add a root-skip guard so an **explicit** `sessionId` addressing the root is rejected (the no-arg paths already use `getSoleChild` and are safe). The root may only transition via `onDisconnect`/`abandonActivity`/`resumeActivity` (grace lifecycle) — never via these:
  - `endActivity` and `stopActivity`: if the resolved session is the root (`sid === this.activitySessionStore.getRootId(userId)` or `state.activityType === ActivityType.ROOT`), `logger.warn` and `return null` (matches the existing null-return contract).
  - `pauseActivity` and `unpauseActivity`: same root check → `throw new Error(WsErrorCode.NO_ACTIVE_SESSION)` (matches their existing throw contract).
  Do **not** add this guard to `onDisconnect`, `abandonActivity`, `abandonStale`, `resumeActivity`, `handleReconnect`, or `handleTransportDisconnect` — those intentionally drive the root through `disconnected → abandoned` on grace and resume it on reconnect.

### Phase 2: Controller — call site

- [x] **Task 4: Materialize the root on stream connect** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In `trackActivity` → `setup()`, after the `handleReconnect` result block and before `request.subscribe(...)` (around the `connectedAt = Date.now();` line), call `await this.activityEngine.ensureRoot(userId);` guarded by `if (subscriber.closed) return;`. One root per app/state-stream connection: a fresh connect creates it; a reconnect within grace already resumed the existing root in `handleReconnect`, so `ensureRoot` hits its idempotent zero-write branch and mints no duplicate.
