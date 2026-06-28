# Plan: Tests — multi-session lifecycle state machine

## Context
Write the silent-bug-first test contract for the session state machine **before** its feature tasks land: characterization tests that lock today's single-session flows (must survive the behavior-preserving refactor) and target tests that define the new per-user multi-session + lazy-root behavior (expected RED until those feature tasks land). Both feature specs live in **Phase 55 — Multi-session core**: `03-multi-session-store-engine` (store/engine refactor) and `04-lazy-root-creation` (`ensureRoot` + child linking). Phase 56 is unrelated (proto + concurrent activities), so every target block here closes when its **Phase 55** spec lands. Spec: `.ai-factory/notes/16-test-session-lifecycle-state-machine.md`.

## Settings
- Testing: yes (the deliverable IS the test files — Jest unit specs)
- Logging: minimal
- Docs: no

## Red/Green discipline (read before writing any test)
- **Characterization** tests assert behavior that is **unchanged** by Phase 55 (`03-multi-session-store-engine`, declared behavior-preserving). They must be **GREEN against the current code now**. A RED here after the refactor is a Class B silent regression → **escalate, never patch the test**.
- **Target** tests assert the **new** behavior (multi-session store, sessionId-keyed grace timers, `ensureRoot`, `rootSessionId` linking). They are **expected RED now** and turn GREEN when their **Phase 55** feature spec lands (`03-multi-session-store-engine` for the store/engine fan-out, `04-lazy-root-creation` for `ensureRoot`/linking). **Do not** `.skip`/`.todo`/`it.failing` them and **do not** implement the feature here — genuine red-for-the-right-reason is the done state. Running `npm test` will show these as failing until the feature tasks land; this is the intended TDD signal — reviewers must not "fix" them.
- **CI tolerance (confirm before committing):** because Jest's `testRegex` matches every `*.spec.ts`, the committed RED target blocks make the whole `npm test` suite red until Phase 55 lands. This is the intended red-first signal, not a defect. If a pre-commit hook or CI step gates on `npm test`, either land this test commit on the same branch as the Phase 55 work or gate CI on a path filter so the red suite is tolerated between commits. No change to the test design is requested.
- **Survive-the-refactor technique:** characterization flow tests call the engine **through thin local wrapper helpers** (e.g. `end(userId)`, `disconnect(userId)`), never the engine method directly. When Phase 55 threads an explicit `sessionId` through the signatures, only the helper bodies change (mechanical, loud, compile-checked) — the assertions do not. This keeps a behavioral red distinguishable from a signature change.
- **Compile-now technique for target tests:** new APIs that don't exist yet (`store.getChild/listChildren/addChild`, `engine.ensureRoot`, the per-user children map) are accessed via `(store as any).getChild(...)` / `(engine as any).ensureRoot(...)` so the file type-checks today and fails at **runtime** (undefined method / absent behavior) rather than blocking the whole suite from compiling. These `as any` casts are not covered by the RULES.md `!` ban and are fine. The same compile-now cast applies to the **Long-branch characterization fixture**: `ActivityStartDto.clientTimestampMs` and `endActivity(…, clientTimestampMs?: number)` are both typed `number`, so the Long-like `{ toNumber: () => ms }` object must be passed as `{ toNumber: () => ms } as any` to compile (runtime is fine — `coerceClientTs` detects `typeof === 'object' && typeof toNumber === 'function'`, activity-engine.service.ts:46–50).
- **Rule-clean assertions:** RULES.md forbids the non-null assertion `!` (the existing specs predate it and use `state!.sessionId`). Do not copy that pattern into the new file — assert `expect(state).toBeDefined()` and then access, or use a local guard, so the new spec stays rule-clean.

## Instantiation reference (mirror the existing specs)
- Construct `ActivitySessionStore` directly: `new ActivitySessionStore({ get: jest.fn().mockReturnValue(graceMs) } as any)` (see `activity-session-store.service.spec.ts`).
- Construct `ActivityEngine` directly with mocks: `makeRepo()` (`create/save/findOne/update` jest.fns), `makeEmitter()` (`{ emit: jest.fn() }`), `makeStreamEngine()` (`{ push: jest.fn() }`), and a real `ActivitySessionStore` (see `activity-engine.service.spec.ts`). Reuse the `makeSession(overrides)` factory shape.
- `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach` for all grace-timer assertions.
- Enums/events to assert against: `SessionStatus` (`active/disconnected/completed/abandoned/interrupted`), `SessionEvents.{COMPLETED,ABANDONED,INTERRUPTED}`, `StreamDataType.SESSION_EVENT` + `StreamSessionEvent.{STARTED,ENDED,ABANDONED,PAUSED,RESUMED,INTERRUPTED}`, `ActivityType` (`breath/meditation`; `root` does not exist in the enum yet — assert the literal string `'root'` for target tests).

## Tasks

### Phase 1: Store-level state machine

- [x] **Task 1: Scaffold the dedicated spec file + shared fixtures**
  Files: `mind_api/src/realtime/services/multi-session-lifecycle.spec.ts`
  Create one cohesive spec file with a top-of-file comment block summarizing the Red/Green contract above (characterization = GREEN now / regression-if-red; target = expected RED until Phase 55/56, do not skip or patch). Add the shared fixtures copied from the existing specs: `makeStore(graceMs?)`, `makeRepo()`, `makeEmitter()`, `makeStreamEngine()`, `makeSession(overrides)`, and `makeState(overrides)`. Add the thin wrapper helpers used by characterization flows (`start`, `end`, `stop`, `disconnect`, `reconnect`, `pause`, `unpause`, `abandonStale`) that today forward to the current single-arg engine signatures — these are the single point Phase 55 will update. **Critical:** the `disconnect` wrapper must forward to `handleTransportDisconnect` (which calls `onDisconnect` **and** starts the grace timer), **not** `onDisconnect` alone (which never schedules a timer) — otherwise the disconnect→grace→abandon and disconnect→reconnect-in-grace flows have no timer to advance or cancel. The `reconnect` wrapper forwards to `handleReconnect` (cancels the timer + resumes). Set up `useFakeTimers`/`useRealTimers`.

- [x] **Task 2: Characterization — single-session store semantics** (depends on Task 1)
  Files: `mind_api/src/realtime/services/multi-session-lifecycle.spec.ts`
  Under a `describe('characterization — store [GREEN now, must survive Phase 55]')` block, assert the existing single-slot contract that must be preserved for existing callers: `set`/`get`/`has`/`delete` round-trip for one userId; grace timer fires the `onExpiry` callback exactly once after `graceMs` and not before (`graceMs - 1`); `hasPendingGraceTimer` flips true→false across fire/cancel; **timer teardown leaves no leak** — after expiry and after `cancelGraceTimer` the internal timer entry is gone (`hasPendingGraceTimer` false). These mirror `activity-session-store.service.spec.ts` but are restated here as the cross-refactor baseline.

- [x] **Task 3: Target — multi-session store** (depends on Task 1)
  Files: `mind_api/src/realtime/services/multi-session-lifecycle.spec.ts`
  Under a `describe('target — multi-session store [RED until Phase 55]')` block, access the future API via `(store as any)`. The method names asserted here (`addChild`/`getChild`/`listChildren`, and `setRoot` in Task 5) do not exist yet, so the access is RED regardless of exact naming — but be aware these become the de-facto API the spec-03 implementer must match (or the tests get re-touched when turning green), which is the intended TDD direction:
  - should store and retrieve **multiple children under one userId** (`addChild`/`getChild`/`listChildren` for two distinct `sessionId`s return both, independently).
  - should key grace timers by **sessionId, not userId**: start a grace timer for `session-A` and `session-B` under the same user; advancing time expires each independently (assert one callback can fire while the other stays pending) — proves the timer map is `Map<sessionId, …>`, not `Map<userId, …>`.
  - **sole-child resolution accessor returns the single child** — the future convenience method that resolves the one live child out of the per-user children map (what `getActiveSession`/the controller still rely on through Phase 55). This is RED today: it tests the *new* resolution accessor over the children map, not today's `get/set/delete` (which are already covered as characterization in Task 2). Name it so the red/green classification is unambiguous and a reviewer does not mistake it for a mis-filed characterization test.

### Phase 2: Engine lifecycle + root linking

- [x] **Task 4: Characterization — engine lifecycle flows** (depends on Task 1)
  Files: `mind_api/src/realtime/services/multi-session-lifecycle.spec.ts`
  Under `describe('characterization — engine [GREEN now, must survive Phase 55]')`, drive each flow through the Task 1 wrapper helpers and assert DB status transitions + emitted events + `streamEngine.push` payloads:
  - **start→end**: addressed child becomes `completed` with `endedAt` set, store entry cleared, `SessionEvents.COMPLETED` emitted with `{sessionId, userId, activityType}`, `push` carries `StreamSessionEvent.ENDED`.
  - **start→stop**: `interrupted` + `endedAt`, `SessionEvents.INTERRUPTED`, `push` `INTERRUPTED`.
  - **disconnect→grace→abandon**: the `disconnect` wrapper (→ `handleTransportDisconnect`) sets `disconnected` via `repo.update`, keeps the store entry, **and starts the grace timer**; advancing fake timers past `graceMs` runs `abandonActivity` → `abandoned` + `endedAt`, `SessionEvents.ABANDONED`, `push` `ABANDONED`. (Calling `onDisconnect` directly would schedule no timer — there'd be nothing to advance.)
  - **disconnect→reconnect-in-grace→resume**: reconnect before the timer fires cancels the grace timer and resumes to `active`, clears `disconnectedAt`; assert the grace callback never runs (no ABANDONED emit).
  - **pause/resume (unpause)**: `isPaused` toggles, `push` emits `PAUSED`/`RESUMED`, `MODULE_SESSION_PAUSED`/`MODULE_SESSION_UNPAUSED` emitted.
  - **abandon no-ops when already resumed** (guard that exists today): with the DB row at `ACTIVE`, `abandonActivity` does not save and does not emit, but clears the store entry.
  - **`coerceClientTs` Long branch**: pass an object `{ toNumber: () => <ms> }` as the client timestamp to `start`/`end` and assert it is honored exactly as the numeric path (covers the ts-proto int64 `.toNumber()` branch); also assert `lastActivityAt` stays server-clocked, never the client value. **Fixture gotcha:** `endActivity` only honors the client end timestamp when `clientEnd >= session.startedAt` (activity-engine.service.ts:128–132), else it falls back to server `now()`. For the **end**-path Long test, choose a Long whose `ms ≥ session.startedAt` — otherwise the assertion passes via the server-now fallback and proves nothing about the Long branch. (`startActivity` has no such guard, so its Long branch is clean.)

- [x] **Task 5: Target — multi-session disconnect/reconnect fan-out** (depends on Task 1)
  Files: `mind_api/src/realtime/services/multi-session-lifecycle.spec.ts`
  Under `describe('target — engine multi-session [RED until Phase 55]')`, seed a user with a root + two live children in the store (via the future `(store as any).addChild`/`setRoot`), then:
  - **transport disconnect moves EVERY live session to `disconnected`** — assert `repo.update` (or save) is called for the root and both children, each starting its **own** per-session grace timer (assert two/three pending timers keyed by sessionId).
  - **reconnect in grace resumes EVERY `disconnected` session** of the user (root + all children back to `active`, each grace timer cancelled), not just one.
  This is the highest-value silent case from the spec (partial reconnect / mis-keyed grace). Expected RED — the current engine resolves a single session by userId.

- [x] **Task 6: Target — ensureRoot idempotency + child linking** (depends on Task 1)
  Files: `mind_api/src/realtime/services/multi-session-lifecycle.spec.ts`
  Under `describe('target — ensureRoot / linking [RED until Phase 55 — lazy-root-creation / spec 04]')`, access via `(engine as any).ensureRoot`:
  - should create **exactly one** root per connection (`activityType === 'root'`, `rootSessionId === null`, `status === 'active'`) and **reuse it on repeat** — a second `ensureRoot` call (and a reconnect) returns the same root id, no duplicate `repo.save` of a root row.
  - should set a newly started child's **`rootSessionId` to the active root's id** — assert on the persisted child row and the stored `ActivityState` metadata via `(row as any).rootSessionId` / `(state as any).rootSessionId` (neither the `ModuleSession` entity nor `ActivityState` carries the column/field today, so the cast is required to compile; the assertion still fails at runtime → correct RED — do not widen the entity type or reach for `!`).
  - should **never end the root via `activity:end`** — calling the end path for a user with a root + child ends only the addressed child; the root row stays `active` and emits no COMPLETED.

- [x] **Task 7: Findings pass — adversarial gap escalation** (depends on Tasks 3, 5, 6)
  Files: `mind_api/.ai-factory/notes/16-test-session-lifecycle-state-machine.md`
  While writing the target tests, diff the new per-session model against each place the current code assumes one-session-per-user (grace timer, `onDisconnect`, `resumeActivity`, `handleReconnect`, `handleSessionRevoked`, watchdog `abandonStale`). For every case the feature specs (`03-multi-session-store-engine` / `04-lazy-root-creation`) do **not** answer (e.g. "disconnect must move ALL live sessions, each with its own grace timer", "reconnect resumes ALL disconnected", "revoke stops every child + root"), record it under the note's **Findings** section and flag the owning feature task so the gap is closed before that task is implemented. Do not edit the feature specs' behavior here — only record findings.

## Commit Plan
- **Commit 1** (after Tasks 1–4): "Add characterization tests for single-session lifecycle state machine"
- **Commit 2** (after Tasks 5–7): "Add target tests for multi-session fan-out and lazy root linking"
