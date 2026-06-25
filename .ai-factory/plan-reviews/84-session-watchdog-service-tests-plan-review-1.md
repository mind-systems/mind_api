## Plan Review: Session Watchdog Service Tests (#84)

**Files Reviewed:** 1 plan + target service + reference spec + supporting source
**Risk Level:** 🟢 Low

### Context Gates
- **Architecture (`.ai-factory/ARCHITECTURE.md`):** No boundary concerns. Plan adds a `.spec.ts` only, colocated with the service it tests under `src/realtime/services/` — consistent with the existing `startup-recovery.service.spec.ts` placement. WARN: none.
- **Rules (`.ai-factory/RULES.md`):** No explicit convention violations detected. Plan-only test work; no logging/migration/proto rules triggered.
- **Roadmap (`.ai-factory/ROADMAP_TESTS.md`):** This is test-coverage work; a dedicated test roadmap exists. WARN (non-blocking): the plan does not reference a ROADMAP_TESTS milestone/linkage. Optional to add for traceability.

### Verification Against Source

Every assumption in the plan was checked against `src/realtime/services/session-watchdog.service.ts` and collaborators:

- **Constructor signature** — matches exactly: `(repo, activityEngine, activeStreamRegistry, configService)`. The "construct directly, plain-mock" approach mirrors `startup-recovery.service.spec.ts`. ✓
- **Config keys & defaults** — `RealtimeConfig.SESSION_MAX_IDLE_MS` = `WS_SESSION_MAX_IDLE_MS` (default `600_000`) and `SESSION_SWEEP_INTERVAL_MS` = `WS_SESSION_SWEEP_INTERVAL_MS` (default `60_000`) confirmed in `constants/realtime-config.ts`. The `get: jest.fn((_key, def) => def)` trick is correct because the service passes the default as the 2nd arg. ✓
- **`abandonStale(userId, sessionId)`** — confirmed signature in `activity-engine.service.ts:229`, returns `Promise<void>`. Plan's mock is correct. ✓
- **`activeStreamRegistry.hasLiveSubscriber(userId): boolean`** and **`closeAll(userId): void`** — confirmed in `active-stream-registry.service.ts:34,38`. Plan correctly notes `closeAll` is synchronous (do not `mockResolvedValue`). ✓
- **`SessionStatus.ACTIVE='active'`, `DISCONNECTED='disconnected'`** — confirmed; the `In(['active','disconnected'])` assertion uses the right literal values. ✓
- **`sweep()` is public** and reads `row.id`, `row.userId`, `row.lastActivityAt.getTime()` — confirmed. The `Date.now()` spy makes both the `threshold` and the per-row `idleMs` deterministic. ✓
- **Order of operations** — `hasLiveSubscriber` is checked before reaping; `closeAll` runs after `await abandonStale` inside the same `try`. This validates Task 2 ("check before reap", "closeAll after abandonStale") and Task 4 ("closeAll not called when abandonStale rejected"). ✓
- **Lifecycle** — `onApplicationBootstrap` calls `setInterval(cb, sweepIntervalMs)`; `onApplicationShutdown` calls `clearInterval` only when `sweepTimer !== undefined`. Task 5's four cases (start, clear, no-clear-without-bootstrap, interval-callback-invokes-sweep) all map to real branches. ✓

### Minor Notes (non-blocking, for the implementer)
- **FindOperator equality:** asserting `repo.find` was called with `In([...])` / `LessThan(threshold)` relies on Jest deep-equality over TypeORM `FindOperator` instances. This works (`toEqual` compares `_type`/`_value`, and `Date` values compare by time), but the implementer should build the expected `LessThan(new Date(fixedNow - idleMs))` from the *same* mocked `Date.now` value rather than calling the real clock, or the Date values will differ. The plan already prescribes the `Date.now` spy, so this is just a reminder to thread the same constant into the expectation.
- **`error: unknown` typing** — the service catches `err: unknown` and logs; no assertion on log content is required by the plan (logging set to "minimal"), which is appropriate.

### Critical Issues
None. No missing steps, no wrong codebase assumptions, no incorrect file paths or API usage, no migration needs (test-only change), no security surface touched.

### Positive Notes
- Plan correctly identifies the synchronous nature of `closeAll` — a common mocking trap it explicitly warns against.
- Test cases comprehensively cover the four behavioral concerns: query construction, reaping, live-subscriber skip, per-row error isolation, and timer lifecycle — including the subtle "resolve, not reject, when every row fails" case.
- Setup notes are concrete and reference an existing, valid pattern (`startup-recovery.service.spec.ts`), reducing implementer guesswork.

PLAN_REVIEW_PASS
