## Plan Review Summary

**Plan:** Per-service last-connect-wins stream eviction + CONNECTION_SUPERSEDED + supersede-children takeover
**Files Reviewed (against codebase at HEAD):** plan + spec note 47 + 6 source files + 2 frozen spec files + roadmap/rules
**Risk Level:** 🟢 Low

### Context Gates

- **Roadmap alignment (`.ai-factory/ROADMAP.md:158`):** ✓ The plan maps 1:1 to the open milestone line under "Single-session engine — last-connect-wins stream eviction". The companion test task (line 157) is already `[x]`, matching the plan's "companion tests already landed" claim. Spec note reference (`notes/47-per-service-stream-eviction.md`) is correct and present. No WARN/ERROR.
- **Governing spec (`notes/47`):** ✓ The plan reproduces the spec's pinned signatures, code blocks, and ordering guarantees verbatim. No divergence found.
- **Rules (`.ai-factory/RULES.md`):** ✓ No non-null `!` introduced; logs are lean (count + `userId` only, no PII — `userId` is the project's standard log identifier). `new Logger(ClassName.name)` pattern preserved. `@Payload()`/`@GrpcCurrentUser()` untouched.
- **Architecture:** ✓ All changes are internal to the `src/realtime` module (registry, engine, 4 controllers, 1 new constant). No cross-module boundary crossing, no new dependency.
- **Migration/proto:** ✓ Correctly claims none needed. `supersedeChildren` reuses the existing `SessionStatus.INTERRUPTED` (`enums/session-status.enum.ts`) and `StreamSessionEvent.INTERRUPTED` (`constants/stream-data-types.ts:10`); `CONNECTION_SUPERSEDED` rides the existing `StateErrorEvent` shape as a plain literal (same precedent as `'CANNOT_END_ROOT'`, verified at `module-state.grpc.controller.ts:471,511`).

### Critical Issues

None. Every assumption the plan makes was verified against the code:

- **Registry redesign (Task 2)** exactly matches the already-landed frozen test `active-stream-registry.service.spec.ts` (4-arg `register`, `onEvict`-before-`complete()`, `WeakSet`-backed `wasEvicted` from `deregister`, per-service slots, `closeAll`/`onModuleDestroy` not marking evicted). The prescribed implementation will turn those RED tests GREEN.
- **`supersedeChildren` (Task 3)** — every referenced API exists and is used correctly: `activitySessionStore.listChildren` / `removeChild` (`activity-session-store.service.ts:116,122`), `repo.findOne`/`save`, `pushSessionEventMarker`, and the `SessionEvents.INTERRUPTED` payload shape mirrored from `activity-engine.service.ts:465`. The two-loop / clear-store-before-await ordering is correctly motivated and matches the frozen `activity-engine.service.spec.ts` race-safety target.
- **State controller wiring (Task 4)** matches frozen `module-state.grpc.controller.spec.ts` targets (`supersedeChildren` on `wasEvicted`, `handleTransportDisconnect` on genuine drop, `onEvict` pushing `CONNECTION_SUPERSEDED`, teardown order deregister → branch → evict). The `supersedeChildren` mock is already present in the spec (`:40`).
- **Data/sync controllers (Task 5)** — all four register/deregister call sites confirmed; the adjacent `syncStreamService.deregister(userId, pushFn)` (`sync-stream.grpc.controller.ts:153`) is correctly flagged as a different service to leave untouched.
- **Race analysis** — `register` at `module-state.grpc.controller.ts:145` runs synchronously before `setup()` (`:230`), so the synchronous store-clear in `supersedeChildren` provably precedes the new device's `handleReconnect` `listChildren` read. The eviction-only takeover path (device A still registered) implies device A's children are `ACTIVE` with no pending grace timers, so not cancelling grace timers in `supersedeChildren` is safe — confirmed by tracing `handleTransportDisconnect`/`handleReconnect`.
- No missed caller: grep confirms the only production register/deregister sites are the 4 controllers the plan targets; `hasLiveSubscriber`/`closeAll`/`size`/`onModuleDestroy` keep their signatures, so `session-watchdog.service.ts` needs no change.

### Non-blocking Observations (informational only — do not block implementation)

- **Minor line-number drift** vs. the current file (the implementer reads files in full, so this is cosmetic): state controller `deregister` is at `:244` and the teardown block spans `:243–261` (plan/spec say `:243` / `:226–244`); `closeAll` call is at `:280` (spec §2 says `:263`). The surrounding code is byte-identical to what the plan quotes, so the anchors are unambiguous.
- The spec's `supersedeChildren` overwrites a found DB row's status to `INTERRUPTED` unconditionally; this is safe because a child present in the store implies an `ACTIVE` DB row (any terminal transition removes it from the store first). No action needed — noted only for the implementer's awareness.

### Positive Notes

- The plan defers all hard reasoning to a spec that pins signatures, code blocks, and ordering — and the spec is faithful to the code. This is a low-risk, high-fidelity plan.
- Atomicity gate is correctly justified: shipping eviction without the takeover branch would abandon sessions the product decision says to take over — a real intermediate regression, so the single-commit constraint is sound.
- Task dependencies (1→2, 1→3, 2+3→4, 2→5) are correct and complete.
- The `existing !== subscriber` self-eviction guard, the "no `onEvict` on data streams", and the "`closeAll`/`onModuleDestroy` must not mark evicted" invariants are all called out explicitly and match the frozen tests.

PLAN_REVIEW_PASS
