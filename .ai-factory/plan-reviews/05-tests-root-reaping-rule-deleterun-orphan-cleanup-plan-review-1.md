# Plan Review: Tests — root reaping rule + deleteRun orphan cleanup

**Plan:** `.ai-factory/plans/05-tests-root-reaping-rule-deleterun-orphan-cleanup.md`
**Spec note:** `.ai-factory/notes/19-test-root-reaping-deleterun.md`
**Files Reviewed:** 7 (plan, spec note, `session-watchdog.service.ts` + spec, `sessions.service.ts` + spec, `activity-type.enum.ts`, `realtime-config.ts`, `module-session.entity.ts`, `biometric-stream-engine.service.ts`)
**Risk Level:** 🟡 Medium

## Verification of plan claims against the codebase

Every concrete reference in the plan was checked and is accurate:

- `SessionWatchdogService` 4-arg ctor `(repo, activityEngine, activeStreamRegistry, configService)` — confirmed (`session-watchdog.service.ts:25-31`).
- `sweep()` body, stale query (`status In([ACTIVE, DISCONNECTED]) + lastActivityAt LessThan`), `hasLiveSubscriber` skip at line 71, `abandonStale` + `closeAll` loop at lines 82-83 — confirmed (`:56-91`).
- `SessionsService` 3-arg ctor `(moduleSessionRepo, bioSampleRepo, streamSampleRepo)` — confirmed (`sessions.service.ts:50-57`).
- `deleteRun`: `endedAt == null → ConflictException`, then single `moduleSessionRepo.delete({ id: sessionId })` at line 144, no sibling/root logic — confirmed (`:137-146`).
- `ActivityType` enum has only `BREATH`/`MEDITATION` — no `ROOT` — confirmed. The `'root' as any` / `rootSessionId … as any` compile-now approach is correct.
- `ModuleSession` entity has no `rootSessionId` column yet — confirmed.
- `RealtimeConfig.EMPTY_ROOT_TTL_MS = 'WS_EMPTY_ROOT_TTL_MS'` already declared — confirmed (`realtime-config.ts:14`).
- Bio flush updating `lastActivityAt` — confirmed (`biometric-stream-engine.service.ts:183-184`).
- Existing watchdog spec uses `jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)`, not fake timers — confirmed. The plan correctly reconciles this with the note's fake-timer suggestion (keep the file's `Date.now` style).
- Existing `sessions.service.spec.ts` `moduleSessionRepo` mock has `findOne/delete/createQueryBuilder`; adding `count` is the right delta — confirmed.

The mechanism pins (mock-visible `count(...)` + per-root `delete({ id })`, no bulk `createQueryBuilder().delete()`) are well-reasoned and consistent with the spec-07 `listRuns` carve-out (note 18). The RED/GREEN labelling by spec name and the escalation valve are correctly specified.

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — PASS. Tests stay within their owning modules (watchdog spec under `realtime/`, sessions spec under `sessions/`), consistent with the modular-monolith boundary rule. No cross-module internals are reached.
- **Rules (`RULES.md`)** — PASS. No non-null assertions (`!`) introduced; the plan uses explicit `as any` casts as the codebase already does. No sensitive-data logging (tests only). Logging set to "minimal".
- **Roadmap (`ROADMAP_TESTS.md`)** — WARN. The test roadmap file is effectively empty (only `# … / ## Milestones` headers, no entries). Milestone 05 and the referenced feature specs `08-janitor-empty-roots` / `15-deleterun-orphan-root-cleanup` are not enumerated there, so milestone linkage cannot be verified from the roadmap. Non-blocking, but the roadmap should list these milestones so the RED-until references resolve to a real backlog item.

## Critical Issues

None. No migrations, no production code, no security surface — this is a test-only milestone and the deletion semantics it guards (self-referential `ON DELETE CASCADE`) are correctly treated as the highest-blast-radius concern.

## Important Issues (should be resolved before authoring)

### 1. The spec-08 root-sweep **entrypoint** is not pinned — only the mechanism is

The plan pins *how* the feature must reap (mock-visible `count` + per-root `delete`/`abandonStale`) but leaves the *entrypoint* ambiguous. Task 2 says to drive "`sweep()` (or `(watchdog as any).<root-sweep-method>` if the feature exposes one)", and the note's L2 says to access "any new sweep method … via `(watchdog as any).<method>`".

This ambiguity has two concrete failure modes for the RED tests:

- If the test drives the **public `sweep()`** but spec 08 implements root reaping as a *separate* method that `sweep()` never calls, the target cases stay **permanently RED** (never flip GREEN when the feature lands).
- If the test calls a **guessed private method name** (`(watchdog as any).reapEmptyRoots()`) and spec 08 names it differently, the call is `undefined()` → `TypeError` → **RED for the wrong reason** (a harness artifact, not "feature absent"), which Task 4 is explicitly supposed to rule out.

For the RED→GREEN contract to hold, the test and the feature must agree on the entrypoint *before* the test is written. Recommendation: pin one of these in the note's **Findings** and escalate to spec 08 now (the plan's mechanism-pin process already exists for exactly this — extend it to the entrypoint):

- **Preferred:** the cron path invokes the root sweep through the public `sweep()` (or a stable public method like `sweepEmptyRoots()`), and the tests drive that public surface — no guessed private name. This also matches how the watchdog actually runs in prod (`onApplicationBootstrap` only schedules `sweep()`).

### 2. The existing **query-construction characterization tests** are not in the "keep GREEN" set and may conflict with Task 1's `repo.find` branching

Task 1 makes `repo.find` a `mockImplementation` that branches on the `where` clause because "`repo.find` is shared by the existing stale-sweep query and the new root-sweep query" — i.e. it assumes the root sweep also calls `repo.find`. But the existing characterization block "sweep — query construction and empty result" (`session-watchdog.service.spec.ts:52-110`) asserts:

- `expect(repo.find).toHaveBeenCalledTimes(1)` (line 61), and
- on empty result, `abandonStale`/`hasLiveSubscriber`/`closeAll` are never called (lines 104-110).

If spec 08 folds root discovery into the same `sweep()` invocation using a second `repo.find`, **`toHaveBeenCalledTimes(1)` becomes `2` and these existing chars go RED** — a characterization regression. Yet the plan's "must stay GREEN" list (Task 2's last bullet, Task 3's last bullet) names only the *non-root stale-reaping loop*, not these query-construction tests.

This couples directly to Issue 1: a clean resolution is to require spec 08 to discover roots via a path that does **not** add a `repo.find` call observable to the `sweep()`-only chars (e.g. a separate method invoked separately by the cron, or root discovery via `repo.count`/a distinct query the existing chars don't pin). The plan should:

- Explicitly add the `session-watchdog.service.spec.ts:52-110` block to the protected-characterization set, and
- Record in Findings which discovery shape spec 08 will use so it provably keeps those chars GREEN.

## Minor Issues

### 3. `rootSessionId` fixture typing in `sessions.service.spec.ts`

`makeSession`'s overrides parameter is typed `Partial<ModuleSession>`, and `rootSessionId` is not on the entity yet, so `makeSession({ rootSessionId: 'root-id' })` will not type-check. Task 3 says "extend `makeSession` usage to set `rootSessionId`" — make this explicit: pass the field via a cast (`makeSession({ ... } as any)` or `rootSessionId: 'root-id' as any` inside an `as any` override) consistent with the L2 compile-now rule. The same applies to the watchdog `makeRoot()` helper (`rootSessionId: null as any`, `activityType: 'root' as any`), which the plan already states.

### 4. (Confirmation, not a defect) "count siblings AFTER deleting the child" is observable

The Task 3 case asserting the sibling `count` runs *after* the child `delete` is verifiable with pure mocks via jest invocation order (`delete.mock.invocationCallOrder` vs `count.mock.invocationCallOrder`). The plan's outcome-only framing ("one delete vs two, child-then-root order") is sound — no transaction internals required. No change needed; flagged only to confirm the assertion is achievable as written.

## Positive Notes

- Strong grounding: every line number and API reference resolves correctly against current source — rare and valuable in a pre-feature TDD plan.
- The bulk-delete-vs-per-row mock-observability reasoning (and the spec-07 `listRuns` precedent) is correctly carried forward; the carve-out for "if spec 08 insists on a bulk delete, drop to a builder-contract assertion" is the right safety hatch.
- The reap-rule re-derivation matrix ({live|disconnected} × {0|≥1 child} × {0|bio}) and the "bio no longer protects" correction are explicitly called out, with the `lastActivityAt`-refreshed-by-bio-flush interaction tied to a real code site.
- Correctly keeps the `Date.now` mock style of the existing spec instead of importing the note's fake-timer suggestion verbatim.

## Recommendation

Resolve Issues 1 and 2 (pin the spec-08 root-sweep entrypoint and explicitly protect the existing query-construction characterization tests) in the note's **Findings** and escalate to spec 08 before the target cases are authored — this is the difference between tests that flip GREEN when the feature lands and tests that are RED for the wrong reason. Issue 3 is a quick typing fix. Once Issue 1/2 are pinned, the plan is ready to implement.
