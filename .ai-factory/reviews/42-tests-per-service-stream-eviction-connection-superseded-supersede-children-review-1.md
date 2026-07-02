# Code Review — Tests: per-service stream eviction, CONNECTION_SUPERSEDED + supersede-children

**Task:** `42-tests-per-service-stream-eviction-connection-superseded-supersede-children`
**Scope reviewed:** the code changes only — the three edited spec files:
- `src/realtime/services/active-stream-registry.service.spec.ts`
- `src/realtime/module-state.grpc.controller.spec.ts`
- `src/realtime/services/activity-engine.service.spec.ts`

(The staged `.ai-factory/**` `.md`/`.json` artifacts are planning docs, not runtime code — excluded.)

**Nature of the change:** TDD-first test task. New/rewritten targets are intentionally **compile-RED** until the feature (note 47) lands — `StreamService`, the 4-arg `register`, boolean `deregister`, and `ActivityEngine.supersedeChildren` do not exist yet. The correctness question for a test task is therefore not "does it pass today" (it must not) but "will it compile and assert the right thing against a **correct** implementation of note 47, and do the characterizations stay GREEN through the feature." I verified each new/changed assertion against the pinned design and against the real symbols already in the tree.

## Verified against HEAD

- **Enums/constants all exist and match the asserted literals:** `ActivityType.ROOT/BREATH/MEDITATION` (`enums/activity-type.enum.ts`), `SessionStatus.INTERRUPTED` (`enums/session-status.enum.ts:6`), `SessionEvents.INTERRUPTED` (`events/session.events.ts:4`), `StreamDataType.SESSION_EVENT` + `StreamSessionEvent.INTERRUPTED` (`constants/stream-data-types.ts:2,10`). All are imported in the engine spec (`:1-12`).
- **Store API the Part C tests drive is real and public:** `setRoot`, `getRoot`, `getRootId`, `addChild`, `listChildren` (`activity-session-store.service.ts:65,75,79,92,116`). `getRoot` returns the stored reference, so `expect(getRoot('user-1')).toBe(rootState)` is a valid identity assertion.
- **Root survives child clearing:** `removeChild → pruneIfEmpty` only deletes the bucket when `rootSessionId === null && children.size === 0` (`:122-128,165-169`). With `root-1` set, clearing both children leaves the bucket intact, so `getRootId`/`getRoot` stay populated — the "root untouched" assertions hold.
- **Asserted marker/emit shape matches the real INTERRUPTED path:** `pushSessionEventMarker` emits `push(sessionId, { data: { dataType: SESSION_EVENT, event } })` (`activity-engine.service.ts:45-52`) and `stopActivity` emits `emit(SessionEvents.INTERRUPTED, { sessionId: saved.id, userId, ... })` (`:456,465-472`). The Part C `objectContaining` assertions mirror this exactly, with the correct mock names (`streamEngine.push`, `emitter.emit`) — the plan-review WARN about `eventEmitter` vs `emitter` and the bare-event shape is correctly resolved in the code.
- **Controller `beforeEach` re-creates every mock via factories (`:99-113`),** so B3's `deregister.mockReturnValue(true)` override cannot leak into sibling tests.
- **Both plan-review-1 blockers are fixed in the code:**
  - *Issue 1 (register 2-arg sweep):* both existing `register` assertions — `:148-153` and `:753-756` — are updated to the 4-arg STATE shape (`user.sub, StreamService.STATE, expect.any(Subscriber), expect.any(Function)`), so they will stay GREEN after the feature instead of going RED-forever.
  - *Issue 2 (missing `repo.save` stub):* the race-safety test adds `repo.save.mockImplementation((s) => Promise.resolve(s))` (`activity-engine.service.spec.ts` supersedeChildren block), preventing the `saved.id` TypeError that would have failed it against a correct implementation.
- **Race-safety discriminator is genuinely load-bearing:** `repo.findOne` is stubbed to a manually-controlled pending promise, and the store-clear is asserted *before* it resolves. A naive `for (child) await stopActivity(...)` fails this because `stopActivity` reads the DB (`findOne` at `:442`) before any store mutation — so even the single-child seed catches the non-two-loop implementation. Correct.

## Findings

No correctness, security, or runtime-behavior defects found in the test code. The suite is internally consistent, imports resolve to real symbols (except the deliberately-not-yet-existing `StreamService`/`supersedeChildren`, which are the RED contract), the eviction/`onEvict`/`wasEvicted` and supersede-children assertions match note 47's pinned design, and the same-`userId` distinct-service rewrites correctly avoid the silent-collapse trap.

## Non-blocking observations (not defects)

1. **Stale test title at `module-state.grpc.controller.spec.ts:150`.** The case is still named `'should call activeStreamRegistry.register(user.sub, subscriber) when user is present'` while its body now asserts the 4-arg shape (`StreamService.STATE`, `expect.any(Function)`). Cosmetic only — the assertion is correct; the title just describes the old signature. Optional to rename for clarity.
2. **Whole-file compile-RED until note 47 lands is expected.** Running `npm test` on this commit alone fails all three files (unresolved `../constants/stream-service` import, 2-arg `register`/`deregister` signatures, absent `supersedeChildren`). This is the intended TDD-first state per `ROADMAP.md:156-157`, not a regression — flagged only so it is not mistaken for a broken commit.

REVIEW_PASS
