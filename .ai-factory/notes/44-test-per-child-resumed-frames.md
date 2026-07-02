# Tests: per-child RESUMED frames on reconnect

**Date:** 2026-07-02
**Source:** conversation context (server feature request — reconnect fan-out)

Companion test task — TDD-first, lands **before** [[45-per-child-resumed-frames-on-reconnect]]. Edits the committed `module-state.grpc.controller.spec.ts` (owned by frozen `[x]` tasks) — a new task, never an edit to those frozen tasks.

## Grounded correction to the request framing
The request assumed the `(a)` RESUMED case (`toHaveLength(1)`) is an anti-target requiring inversion. **Verified against HEAD this is not the case**, because the feature note [[45-per-child-resumed-frames-on-reconnect]] pins a **narrower** design than "always enumerate root+children": the existing root-only fallback path (used when there are **zero** live children) is left **byte-for-byte unchanged** — it still emits exactly one frame driven by `result`/`getSession`, exactly as today. The new per-child loop only activates when `listChildren(userId)` is non-empty. Since every currently-committed reconnect-path case (`(a)`, `(b)`, and the `moduleSessionId` case below) mocks `handleReconnect` to resolve a session but never populates children, they all continue to exercise the **unchanged** fallback path — **no inversion needed**. The only required edit to existing code is a **shared mock default**, described below; it is additive and breaks nothing.

## Why this exists (the mandatory mock default)
`ActivityEngine.listChildren(userId): ActivityState[]` is a **new** method the feature adds (`activity-engine.service.ts`, inserted after `getRootId` at `:562-564`, before `listLiveSessions` at `:566`). The committed `makeActivityEngine()` factory (`module-state.grpc.controller.spec.ts:28-50`) has no `listChildren` field. Once the controller calls `this.activityEngine.listChildren(userId)` unconditionally inside the resumed-session branch, **every** reconnect-path test that reaches that branch will throw `TypeError: ... listChildren is not a function` at runtime unless the factory provides a default. This is a **loud** failure (uncaught throw), so per the silent-bug-first scope it doesn't need a dedicated red/green case — but the fix is mandatory to keep the suite runnable at all.

**Fix:** add `listChildren: jest.fn().mockReturnValue([]),` to `makeActivityEngine()` (`:28-50`, alongside the existing `getRootId: jest.fn()` and `listLiveSessions: jest.fn()...` entries). An empty array preserves the fallback path for every case that doesn't explicitly override it — this is what makes `(a)`, `(b)`, and the `moduleSessionId` case stay GREEN with **zero** changes to their bodies.

## Red/Green contract
- **Target (RED until [[45-per-child-resumed-frames-on-reconnect]]):** with `listChildren` returning ≥1 entries, the controller emits one `session:state` RESUMED frame **per entry**, each carrying that entry's own `sessionId`/`isPaused`/`activityType` — today the controller never calls `listChildren` at all (the method doesn't exist on `ActivityEngine`), so these cases fail by throwing/being unreachable until the feature lands.
- **Characterization (stay GREEN, unmodified):** `(a)` unpaused fallback (`:159-183`), `(b)` paused fallback (`:189-214`), `moduleSessionId` fallback (`:216-234`), fresh-connect no-frame (`:236-252`), subscribe-ordering (`:254-...`), subscriber-closed guard (`:275-...`), ABANDONED paths (`(b)` at `:313-338`ish, `(c)` at `:339-...`, `(d)` at `:358-...`), and the `activity:start ROOT` case (`:401-...`, different describe block, untouched). None of these populate `listChildren`, so all continue through the unchanged fallback/abandoned/start paths.

## Two-state observability
Vantage: capture `values: StateResponse[]` from `controller.trackActivity(request$, user).subscribe(...)`, `await flushMicrotasks()`, assert on `values`. `ActivityEngine.listChildren` is a direct mock call the test controls — RED today (method doesn't exist, throws or the mock has no return since the field is absent), GREEN once the feature adds the delegate and the controller's per-child loop.

## New target cases — add to `describe('trackActivity — reconnect path')`
```ts
function makeLiveChild(overrides?: Partial<{ sessionId: string; activityType: string; isPaused: boolean }>) {
  return { sessionId: 'child-1', activityType: 'breath', isPaused: false, ...overrides };
}
```
- **two live children → two RESUMED frames, one per child id** — `handleReconnect.mockResolvedValue(makeSession())` (any non-null, non-abandoned result — it only gates entry into the branch); `listChildren.mockReturnValue([makeLiveChild({ sessionId: 'child-1', activityType: 'breath' }), makeLiveChild({ sessionId: 'child-2', activityType: 'meditation', isPaused: true })])`; assert `values` has length 2, `values[0].sessionState` matches `{ moduleSessionId: 'child-1', status: RESUMED, isPaused: false, activityType: ProtoActivityType.BREATH }`, `values[1].sessionState` matches `{ moduleSessionId: 'child-2', status: RESUMED, isPaused: true, activityType: ProtoActivityType.MEDITATION }`.
- **single live child → exactly one RESUMED frame, via the new path** — `listChildren.mockReturnValue([makeLiveChild({ sessionId: 'child-1' })])`; assert `values` length 1, `moduleSessionId === 'child-1'`. (Distinct from `(a)`/`(b)`, which exercise the zero-children **fallback** path — this confirms the n=1 case correctly takes the new per-child loop rather than silently falling back.)
- **no live children → unchanged fallback frame** — this is exactly `(a)`/`(b)` as committed; no new case needed, just confirm (by inspection, not a new test) that they are unaffected.
- **ABANDONED path unaffected by children present** — optional reinforcement: `handleReconnect.mockResolvedValue({ abandoned: true })` with `listChildren.mockReturnValue([makeLiveChild()])` still emits exactly the ABANDONED frame, `listChildren` never called (the abandoned branch returns before reaching the resumed-session code). Guards against the new call being hoisted above the `'abandoned' in result` check.

## Anti-targets
**None.** Verified against HEAD: no committed case needs inversion under the pinned narrow design (root-only fallback is unchanged code). Only the mandatory `listChildren: jest.fn().mockReturnValue([])` mock-factory addition is required, and it is purely additive.

## Guards / gotchas
- `listChildren`'s mocked entries must include `isPaused` explicitly — `ActivityState.isPaused` is a required `boolean` field; a fixture omitting it would emit `isPaused: undefined` (proto `optional bool` silently drops it), which is a foot-gun distinct from the intentional `?? false` coalescing note 24 uses in the fallback path. Always set `isPaused` explicitly in new fixtures.
- Do **not** add a `listChildren` mock override to `(a)`/`(b)`/`moduleSessionId` — leaving them on the shared `[]` default is what proves the fallback path is untouched.
- The per-child loop has no `await` between `subscriber.next` calls (mirrors the feature note's guard) — no need to re-check `subscriber.closed` between frames in a test.
