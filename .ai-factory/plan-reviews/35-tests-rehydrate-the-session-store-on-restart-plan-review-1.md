# Plan Review: Tests — rehydrate the session store on restart

**Plan:** `.ai-factory/plans/35-tests-rehydrate-the-session-store-on-restart.md`
**Scope:** `mind_api` — single test file rewrite (`startup-recovery.service.spec.ts`), TDD committed-RED
**Risk Level:** 🟢 Low

## Verdict

The plan is accurate, well-grounded, and internally consistent. Every "ground-truth fact" was verified against source and holds. Notably, the plan **corrects two stale claims from its own source notes** — a sign of careful grounding:

- Sample shape: pins the real `{ timestamp, data: { dataType: 'session_event', event } }` (verified at `activity-engine.service.ts:268-274` + `session-buffer.interface.ts`), rejecting note 29's simplified `{ event, timestamp }` (note 29:51).
- Line numbers: `startGraceTimerForSession` at `:140` (note 29 said `:162`) and `abandonActivity` at `:316` (note 29 said `:275`) — the plan's numbers match source.

## Fact verification (all CONFIRMED)

| Claim | Source | Status |
|---|---|---|
| Current ctor `(repo)` only, `:11-14` | `startup-recovery.service.ts:11-14` | ✅ |
| `setRoot(userId, sessionId, state?)` `:65` | `activity-session-store.service.ts:65` | ✅ |
| `addChild(userId, sessionId, state)` `:92` | `:92` | ✅ |
| `getRootId(userId)` `:79` | `:79` | ✅ |
| `startGraceTimerForSession(sessionId, onExpiry)` `:140`, now-relative via `graceMs` | `:140-150` | ✅ |
| `abandonActivity(userId, sessionId?)` `:316` (marker + `SessionEvents.ABANDONED`) | `activity-engine.service.ts:316,338-348` | ✅ |
| `ActivityState` shape incl. `rootSessionId?`, `isPaused` | `interfaces/activity-state.interface.ts` | ✅ |
| Persisted sample shape + pause markers `paused`/`resumed`, `dataType='session_event'` | `constants/stream-data-types.ts:1-13`, push site `:268-274` | ✅ |
| `streamSampleRepo` = `Repository<SessionStreamSample>`, `find({ where: { moduleSessionId } })`, `samples` jsonb | `entities/session-stream-sample.entity.ts:10,16,19` | ✅ |
| `SessionStatus` enum values | `enums/session-status.enum.ts` | ✅ (see note below) |
| Root/child link via `rootSessionId` (`null` on root, `= root.id` on child) | `activity-engine.service.ts:133,175-177` (`ensureRoot`/`startActivity`) | ✅ |
| `ModuleSession` has `disconnectedAt`, `lastActivityAt`, `rootSessionId` columns | `entities/module-session.entity.ts:26,42,48` | ✅ |
| Anti-target `spec:29-53`, characterization `:55-61` | current spec file | ✅ |

RED intent verified against today's service for each target case: `store.*`/`engine.*` mocks are never invoked by the current bulk-abandon `onApplicationBootstrap`, and today's `repo.save` writes `ABANDONED`/`endedAt` (not `DISCONNECTED`/`disconnectedAt`). So Tasks 2–4 target cases genuinely fail now and the empty-set case (`:55-61`) genuinely stays GREEN. The `new (…as any)(4 args)` cast is correct — the single-arg ctor ignores extras, so the extra deps sit unused until note 26 widens the ctor.

## Context Gates

- **Architecture (WARN → none):** `.ai-factory/ARCHITECTURE.md` present. Test-only change within the `realtime` module's own spec; no module-boundary or DI-graph impact. No violation.
- **Rules (`.ai-factory/RULES.md`):** No `!` non-null assertions, no sensitive-data logging, no gRPC decorator concerns in a unit spec. The plan's "no `as any` on the `isPaused` value" instruction (Task 3) aligns with the project's aversion to type-escape hatches. No violation.
- **Roadmap:** Milestone maps to `ROADMAP.md:115` ("Tests: rehydrate the session store on restart", spec note 29) — status `[ ]`, correctly the current test surface. Feature note 26 (`ROADMAP.md:143`) is still open, consistent with the plan's RED-until-26 framing. Linkage present. ✅

## Findings (non-blocking)

### 1. Root row builder should mirror production's `activityType: ROOT` (Low)
`makeSession` (Task 1) is extended to override `rootSessionId`/`id`/`lastActivityAt` but keeps `activityType: ActivityType.BREATH` for all rows. In production a root row is **both** `rootSessionId === null` **and** `activityType === ActivityType.ROOT` (`activity-engine.service.ts:128,133`). Note 26's rebuild says "for each root row `setRoot`; for each child row `addChild`, linking via `rootSessionId`" — the most likely discriminator is `rootSessionId == null`, which the plan already handles. But if the eventual implementation keys the root off `activityType === ROOT` instead, a root row built as `BREATH` would be misclassified and the target case could stay RED after note 26 lands.
**Recommendation:** have the root builder set `activityType: ActivityType.ROOT` (and `rootSessionId: null`) so the fixture is faithful to production and robust to either discriminator. `ActivityType.ROOT` exists (`enums/activity-type.enum.ts:4`).

### 2. Guard the `onExpiry` capture in Task 4 (Low)
Task 4 captures the `onExpiry` callback from the spy and invokes it. Today the spy is never called, so `store.startGraceTimerForSession.mock.calls[0][1]` is `undefined` and invoking it throws a `TypeError` rather than surfacing the intended assertion. The test still fails (RED, as desired), but the message is noisy.
**Recommendation:** assert `expect(store.startGraceTimerForSession).toHaveBeenCalledWith(expect.any(String), expect.any(Function))` **before** destructuring/invoking the callback, so the RED failure reads cleanly.

### 3. Minor: enum enumeration is partial (informational)
Ground-truth line 19 lists `SessionStatus` as `ACTIVE, DISCONNECTED, ABANDONED`; the enum also has `COMPLETED`, `INTERRUPTED`, `RESUMED` (`enums/session-status.enum.ts`). The plan correctly flags the `RESUMED='resumed'` status vs. the `'resumed'` stream marker collision (the load-bearing distinction). No action needed — the omitted values are irrelevant to these cases.

## Positive Notes

- Correctly re-derives the sample shape from source instead of trusting note 29's simplification, and calls this out explicitly (line 17) — this is the single highest-risk assumption in the milestone and it's nailed.
- Correctly scopes unit vs. manual: the "no duplicate root on reconnect" guard and DB restart round-trip are deferred to the manual checklist (they need the real `ensureRoot`/store round-trip), matching note 29:22 and note 26:44.
- Anti-target inversion (`:29-53`) and characterization retention (`:55-61`) exactly match note 29's enumerated targets.
- Grace-source assertion (`startGraceTimerForSession` vs. hand-rolled `setTimeout(lastActivityAt+grace−now)`) preserves the "from process start" contract — the correct behavioral pin, and the store's `startGraceTimerForSession` is indeed now-relative (`:145`).
- Single-file, single-commit scope with a clear commit message; RED/GREEN expectations spelled out for the implementer.

The two Low findings are hardening suggestions, not defects — the plan is safe to implement as written.

PLAN_REVIEW_PASS
