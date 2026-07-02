# Plan: Tests: per-child RESUMED frames on reconnect

## Context
Companion TDD-first test task that lands before the per-child-RESUMED feature: it adds the mandatory `listChildren` mock default to the shared engine factory and new RED target cases proving reconnect emits one RESUMED `session:state` frame per live child, while leaving every committed reconnect-path characterization case untouched.

## Settings
- Testing: yes (this milestone *is* the tests)
- Logging: minimal
- Docs: no

## Notes for the implementer
- Sole file to edit: `src/realtime/module-state.grpc.controller.spec.ts` (the spec lives directly under `src/realtime/`, one level below `src/`; roadmap line references to `:28-50`, `:159-214`, etc. use the same file). Do **not** touch controller/service source — this task must be RED until the feature ships.
- Proto enum: the spec imports `ActivityType` from `../../proto/generated/module_state`; `ActivityType.BREATH = 1`, `ActivityType.MEDITATION = 2`. Fixtures carry the string `activityType` ('breath'/'meditation') off `ActivityState`; assert the mapped proto enum on the emitted frame.
- `makeActivityEngine()` is at `:28-50`; new reconnect cases go inside `describe('trackActivity — reconnect path')` (starts `:156`).
- Follow the spec's guards exactly: always set `isPaused` explicitly in child fixtures; never add a `listChildren` override to `(a)`/`(b)`/the `moduleSessionId` case — leaving them on the shared `[]` default is what proves the fallback path is untouched.

## Tasks

### Phase 1: Mock default

- [x] **Task 1: Add the mandatory `listChildren` default to `makeActivityEngine()`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  In the `makeActivityEngine()` factory (`:28-50`), add `listChildren: jest.fn().mockReturnValue([]),` alongside the existing `getRootId`/`listLiveSessions` entries. Empty array preserves the root-only fallback path for every case that does not override it, keeping `(a)`/`(b)`/`moduleSessionId`/fresh-connect/subscribe-ordering/ABANDONED cases GREEN with zero body changes. This is additive only — do not modify any existing mock field.

### Phase 2: New target cases (RED until the feature)

- [x] **Task 2: Add the `makeLiveChild` fixture helper** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Inside `describe('trackActivity — reconnect path')`, add the helper from the spec: `makeLiveChild(overrides?)` returning `{ sessionId: 'child-1', activityType: 'breath', isPaused: false, ...overrides }`. `isPaused` must always be present (required boolean on `ActivityState`; omitting it makes the proto `optional bool` silently drop, a foot-gun).

- [x] **Task 3: Add the per-child RESUMED target cases** (depends on Task 2)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Following the committed reconnect-path vantage (subscribe to `controller.trackActivity(request$, user)`, collect frames into `values: StateResponse[]`, `await flushMicrotasks()`, assert on `values`), add:
  - **two live children → two RESUMED frames** — `handleReconnect.mockResolvedValue(makeSession())` (any non-null, non-abandoned result gates entry into the resumed branch); `activityEngine.listChildren.mockReturnValue([makeLiveChild({ sessionId: 'child-1', activityType: 'breath' }), makeLiveChild({ sessionId: 'child-2', activityType: 'meditation', isPaused: true })])`. Assert `values` length 2; `values[0].sessionState` matches `{ moduleSessionId: 'child-1', status: ActivityStatus.RESUMED, isPaused: false, activityType: ActivityType.BREATH }`; `values[1].sessionState` matches `{ moduleSessionId: 'child-2', status: ActivityStatus.RESUMED, isPaused: true, activityType: ActivityType.MEDITATION }`.
  - **single live child → exactly one RESUMED frame via the new path** — this case **must** set `activityEngine.handleReconnect.mockResolvedValue(makeSession())` (the shared factory defaults `handleReconnect` to `null`, and the resumed branch — the only place `listChildren` is consulted — is entered only when `result !== null`; without this override zero frames emit and the case stays RED forever, never GREEN). Then `listChildren.mockReturnValue([makeLiveChild({ sessionId: 'child-1' })])`. Assert `values` length 1 and `values[0].sessionState.moduleSessionId === 'child-1'`. This distinguishes n=1 (new per-child loop) from the zero-children fallback exercised by `(a)`/`(b)`. (Each `it` gets a fresh factory via `beforeEach`, so the two-children override does not carry over — set it explicitly here.)
  - **(optional reinforcement) ABANDONED unaffected by children present** — `handleReconnect.mockResolvedValue({ abandoned: true } as any)` with `listChildren.mockReturnValue([makeLiveChild()])`; subscribe **with a `clientSessionId`** — `controller.trackActivity(request$, user, 'client-session-id')` — because the abandoned branch guards `if (!clientSessionId) return;` before emitting (the committed ABANDONED cases pass this third arg; omitting it emits zero frames and the assertion misfires). Assert exactly the ABANDONED frame is emitted and `activityEngine.listChildren` was never called (`expect(activityEngine.listChildren).not.toHaveBeenCalled()`), guarding against the new call being hoisted above the `'abandoned' in result` check.
  These cases are RED today (controller never calls `listChildren`) and go GREEN when the feature (spec 45) lands.

- [x] **Task 4: Confirm characterization cases stay untouched** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  By inspection (not a new test), verify `(a)` (`:159-183`), `(b)` (`:189-214`), the `moduleSessionId` case (`:216-234`), fresh-connect, subscribe-ordering, subscriber-closed guard, and all ABANDONED paths retain their original bodies and none add a `listChildren` override — they must keep exercising the unchanged root-only fallback on the shared `[]` default. No inversion of `(a)` is required (verified against HEAD).

## Verification
- Run the single suite: `npx jest src/realtime/module-state.grpc.controller.spec.ts`.
- Expected state before the feature: the new per-child target cases are RED (fail); every pre-existing case stays GREEN. Do not alter production code to make them pass — that is the follow-up feature task's job.
