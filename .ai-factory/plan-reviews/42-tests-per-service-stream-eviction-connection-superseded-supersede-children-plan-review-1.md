# Plan Review — Tests: per-service stream eviction, CONNECTION_SUPERSEDED + supersede-children

**Plan:** `42-tests-per-service-stream-eviction-connection-superseded-supersede-children.md`
**Governing specs:** `notes/46-test-per-service-stream-eviction.md` (authoritative bodies) → `notes/47-per-service-stream-eviction.md` (feature under TDD)
**Files Reviewed:** plan + note 46 + note 47 + the three target specs + `activity-session-store.service.ts`, `module-state.grpc.controller.ts`, `activity-engine.service.ts`, `session.events.ts`, `stream-data-types.ts`, `session-status.enum.ts`
**Risk Level:** 🟡 Medium

## Context Gates
- **Architecture (`ARCHITECTURE.md`):** present. This is a test-only task in `src/realtime/` — no module-boundary impact. No violations. — OK
- **Rules (`RULES.md`):** present. No convention conflicts (deliverable is `.spec.ts` edits only; no migration, no proto, no logging surface). — OK
- **Roadmap (`ROADMAP.md`):** linked. Plan maps cleanly to `ROADMAP.md:156` (the TDD test task), which precedes its feature line `:157` (note 47) and the docs line `:158` (note 48). The two-tier contract (characterization GREEN, targets RED until note 47) is faithfully carried. — OK
- **Governing-spec tree:** plan → note 46 → note 47 all consistent on the pinned design (single slot per `(userId, service)`, `onEvict` pre-complete hook, `deregister→wasEvicted`, `supersedeChildren` two-loop sync-clear, `INTERRUPTED`+`endedAt`). — OK

## Verified Correct (grounded against HEAD)
- `ActivitySessionStore` exposes `setRoot`, `addChild`, `listChildren`, `getRootId`, `getRoot`, `removeChild` (`activity-session-store.service.ts:65,92,116,79,75,122`) — the multi-session seeding API Part C relies on exists and is public.
- `SessionEvents.INTERRUPTED` (`events/session.events.ts:4`) and `StreamSessionEvent.INTERRUPTED` (`constants/stream-data-types.ts:10`) both exist — the reused-status premise (no new enum/migration) holds.
- Controller register/deregister are 2-arg today (`module-state.grpc.controller.ts:145,244`) — the RED-until-feature premise is accurate.
- The controller spec's `makeActiveStreamRegistry()` (`:60-66`) and `makeActivityEngine()` (`:28-51`) factories exist and are the right insertion points for the B1 defaults.
- The activity-engine spec uses a **real** `ActivitySessionStore` instance (`:31-37,61`) with mocked `repo`/`emitter`/`streamEngine` — matches note 46's Part C vantage exactly.
- The A3 "distinct-service" trap is real and correctly enumerated: same-`userId` multi-register cases at spec `:32-38,114-138,178-196,212-229` would collapse under eviction if a uniform literal were pasted.

## Critical Issues

### 1. Two existing `register` 2-arg assertions are never updated → suite goes RED after the feature lands (not GREEN)
Note §B1 and plan Task 4/5 enumerate only the **three `deregister`** assertion sites (`:776`, `:869`, `:881`) plus the **new** B4 register target. They miss **two existing `register` assertions** that assert the current 2-arg shape:

- `module-state.grpc.controller.spec.ts:141-152` — `'should call activeStreamRegistry.register(user.sub, subscriber) when user is present'` → `toHaveBeenCalledWith(user.sub, expect.any(Subscriber))`.
- `module-state.grpc.controller.spec.ts:736-752` — `'should still register the subscriber with activeStreamRegistry before setup runs'` → same 2-arg `toHaveBeenCalledWith`.

Once note 47 lands, the STATE controller calls `register(userId, StreamService.STATE, subscriber, onEvict)` (4 args). Jest's `toHaveBeenCalledWith` requires an **exact** argument match, so both assertions will **fail** after the feature — the opposite of the TDD contract (characterizations must stay GREEN through the feature; these two silently become RED-forever). This is precisely the "mechanical arg insertion is not uniform" class the note flags for Part A, but Part B's audit stopped at the `deregister` sites.

**Fix:** add these two sites to Task 4's mechanical-update list. Update `:141`'s assertion to the 4-arg STATE shape (`user.sub, StreamService.STATE, expect.any(Subscriber), expect.any(Function)`) — it then overlaps B4, so consider folding it into B4 or narrowing it to `expect.any(Function)` for the callback; update `:748`'s to the same 4-arg shape. Either way both must move off the 2-arg form.

### 2. The PRIMARY race-safety target throws on `await pending` because `repo.save` is never stubbed
Plan Task 6 delegates the exact body to note §Part C and says "follow verbatim." The note's race-safety snippet (note 46 `:149-162`) stubs only `repo.findOne`; it does **not** stub `repo.save`. After `resolveFindOne(makeSession({ id: 'child-1' }))`, `supersedeChildren` continues into note 47's `:205-206`:

```ts
const saved = await this.repo.save(session);   // repo.save is jest.fn() → resolves undefined
this.pushSessionEventMarker(saved.id, ...);    // undefined.id → TypeError
```

`repo.save` (the spec's `makeRepo()`, `activity-engine.service.spec.ts:14-21`) returns `undefined` by default, so `saved` is `undefined` and `saved.id` throws — the async chain rejects, and the unguarded `await pending` re-throws, failing the test **even against a correct implementation**. This will read as a genuine RED and cost a debugging round.

**Fix:** add `repo.save.mockImplementation((s) => Promise.resolve(s));` to the race-safety case (exactly as note 46's second target already does at `:173`). Task 6's PRIMARY TARGET description should call this out explicitly rather than relying on the verbatim snippet, which omits it.

## Minor Issues / Warnings

- **WARN — dead grep pointer (Task 6 / note §Part C target).** Both the plan and note tell the implementer to "grep `SessionEvents.INTERRUPTED` in this file for the exact `toHaveBeenCalledWith` shape to mirror." There are **zero** `INTERRUPTED` occurrences and **no `stopActivity` tests** in `activity-engine.service.spec.ts` (verified). The shape to mirror actually lives in the `ABANDONED` tests — `emitter.emit(SessionEvents.ABANDONED, expect.objectContaining({ sessionId, userId }))` and `streamEngine.push(sessionId, { data: expect.objectContaining({ dataType: StreamDataType.SESSION_EVENT, event: StreamSessionEvent.ABANDONED }) })` (`:345-352,396-409,444-457`). Point the implementer there; the current pointer resolves to nothing.

- **WARN — mock variable name and `push` shape.** Plan/note phrase the Part C assertions as "`eventEmitter.emit`" and "`streamEngine.push` … called with `StreamSessionEvent.INTERRUPTED` for each child id." In this spec the emitter mock is named **`emitter`** (not `eventEmitter`), and `streamEngine.push` takes `(sessionId, { data: { dataType, event } })` — not a bare event value. Cosmetic, but worth mirroring the ABANDONED shape precisely to avoid a wrong-shape assertion.

- **NOTE — `StreamService` import must be added to all three specs.** All three files will need `import { StreamService } from '.../constants/stream-service'` (path `../constants/stream-service` from `services/`, `./constants/stream-service` from the realtime root). The file does not exist until note 47, so this is a legitimate compile-level RED — but the plan should state that the import line is part of each edit so the implementer doesn't treat the unresolved import as an accident.

## Positive Notes
- The A3 distinct-service trap is the highest-risk part of the mechanical work and the plan handles it exactly right — each collapsing case is named with its specific `STATE`/`INSTRUCTION`/`BIO` assignment and the "passes for the wrong reason" rationale.
- Task dependencies and the 3-commit split are coherent and match the phase boundaries.
- The race-safety PRIMARY TARGET is correctly identified as the load-bearing case and correctly framed to fail a naive single-`for…await` implementation — the design intent survives into the test.
- `endedAt`-not-`disconnectedAt` is pinned with a sound rationale consistent across plan, note 46, and note 47 §6.
- Idempotent-reregister (A2) and the A6 leakage guards are correctly reasoned against the real `register`/`deregister`/`closeAll`/`onModuleDestroy` semantics.

## Verdict
Two concrete defects would each cost a round: an incomplete `register`-assertion sweep that turns two characterizations permanently RED after the feature (Issue 1), and a missing `repo.save` stub that fails the primary race-safety target against a correct implementation (Issue 2). Both are precise and mechanical to fix. Address them (and fold in the three warnings) before handing off.
