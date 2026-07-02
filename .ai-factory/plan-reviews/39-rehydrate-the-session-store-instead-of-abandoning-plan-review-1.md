## Plan Review: Rehydrate the session store instead of abandoning

**Plan:** `.ai-factory/plans/39-rehydrate-the-session-store-instead-of-abandoning.md`
**Files Reviewed:** 8 (plan, target service + spec, store, engine, entities, enums, module, RULES/ARCH/ROADMAP)
**Risk Level:** 🟢 Low

### Context Gates

- **Architecture (`ARCHITECTURE.md`)** — PASS. The change stays inside `RealtimeModule`, reuses exported providers (`ActivityEngine`, `ActivitySessionStore`) and the module's `TypeOrmModule.forFeature` repos. No module-boundary crossing, no `@InjectRepository` outside the owning module. No `synchronize` implication — no schema change.
- **Rules (`RULES.md`)** — PASS. The plan explicitly forbids the `!` operator (Task 2) and mandates lean, PII-free logging (Task 1). Consistent with the three project rules.
- **Roadmap (`ROADMAP.md`)** — PASS. Directly implements the milestone at ROADMAP line 115 ("Tests: rehydrate the session store on restart", spec notes `[[26-state-rehydration]]` / `[[29-test-state-rehydration]]`). Milestone linkage is present and exact.

### Verification of plan claims against the codebase

All load-bearing assumptions were confirmed:

- **Constructor shape** — spec constructs `new (StartupRecoveryService as any)(repo, streamSampleRepo, store, engine)` (spec lines 109-115). Task 1's 4-arg constructor matches exactly. No circular DI: `ActivityEngine` does not depend on `StartupRecoveryService`.
- **Module wiring** — `realtime.module.ts` already registers `SessionStreamSample` in `forFeature` (line 28) and provides `ActivityEngine`, `ActivitySessionStore`, `StartupRecoveryService`. The plan's "no module wiring changes" is correct.
- **Store API** — `setRoot(userId, id, state)`, `addChild(userId, id, state)`, `startGraceTimerForSession(sid, onExpiry)` all exist with the exact signatures the plan uses.
- **`ActivityState`** — the interface fields (`sessionId`, `activityType`, `activityRefId?`, `rootSessionId?`, `startedAt`, `lastActivityAt`, `isPaused`) match what Task 3 builds from each row.
- **Marker shape** — `StreamEngine.push` persists the full sample (`samples: [sample]`) for server markers via the immediate-save branch, so production `session_stream_samples` rows carry `{timestamp, serverMarker:true, data:{dataType:'session_event', event}}`. Reading `sample.timestamp` and `sample.data.event` (Task 2) is correct against real data, not just the mock. Pause/resume are pushed with `serverMarker:true`, so they are durably persisted even without a flush — the derive is sound.
- **Enum values** — `StreamSessionEvent.PAUSED === 'paused'`, `RESUMED === 'resumed'` confirmed in `constants/stream-data-types.ts`.
- **Abandon consistency** — `abandonActivity` guards on `status === DISCONNECTED` and reads store state via `getSession`. Task 3 marks rows `DISCONNECTED` and rebuilds the store first, so the grace-expiry abandon path will pass both guards. Order (rebuild → persist DISCONNECTED → arm grace) is safe given the ≥30s grace window.
- **Reconnect path** — `handleReconnect` cancels grace timers for root+children and resumes them, so a returning client cancels the rehydration timers cleanly; `startGraceTimerForSession` also self-cancels any prior timer. No duplicate-timer or double-abandon risk.
- **No migration** — `disconnectedAt` already exists on `ModuleSession`; the plan adds no columns/tables. Correctly requires no migration.

### Critical Issues

None.

### Minor Observations (non-blocking)

1. **Per-row closure capture (implementation caution).** The old service bulk-loaded orphan sessions across *all* users, and the rehydration query does the same (`status ∈ {ACTIVE, DISCONNECTED}`, no `userId` filter). The grace `onExpiry = () => abandonActivity(userId, sid)` must capture the *row's* `userId`/`sid` with block-scoped variables inside a `for...of`/`.forEach` loop — not a hoisted `let`. `ActivityEngine.handleTransportDisconnect` already models the correct `for...of` pattern to mirror. Worth an explicit note to the implementer since multiple users' sessions are armed in one pass.

2. **N+1 `streamSampleRepo.find` per child.** Task 2 issues one query per child to derive `isPaused`. This is a one-time bootstrap cost and acceptable, but if a crash left many in-flight children it could add up. Not a defect for a startup-recovery path; noting for awareness.

3. **No synthetic `DISCONNECTED` marker at rehydration.** `handleTransportDisconnect` emits a `disconnected` marker on the root; the plan deliberately does not (the real disconnect predates the crash). On a later reconnect, `handleReconnect` emits a `reconnected` marker on the root, which can leave an unpaired `reconnected` in the timeline for sessions that were `ACTIVE` at crash. This matches the plan's "minimal" intent and avoids fabricating markers; flagging only as a possible timeline-consumer edge, not a lifecycle bug.

### Positive Notes

- Tasks are dependency-ordered and pinned to exact spec line numbers, entity shapes, and enum values — very little left to guess.
- The plan correctly preserves the `no orphan sessions found` characterization test (early return, no store/save/abandon calls) while inverting the RED cases.
- Root-vs-child partitioning (`activityType === ROOT && rootSessionId === null`) is stricter than and consistent with how `ActivityEngine` discriminates roots.
- `isPaused` derived only for children (roots → `false`) matches `ensureRoot`/`startActivity`, which always set root `isPaused: false`.
- Grace-from-process-start and DISCONNECTED normalization (both crash and graceful shutdown → same state) are explicitly reasoned and align with the existing reconnect/abandon machinery.

PLAN_REVIEW_PASS
