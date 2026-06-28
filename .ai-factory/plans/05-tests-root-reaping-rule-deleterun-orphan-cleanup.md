# Plan: Tests — root reaping rule + deleteRun orphan cleanup

## Context
TDD test milestone for the highest-blast-radius silent area: the reap predicate gating a self-referential `ON DELETE CASCADE`. Add **target** tests (RED until specs 08 + 15 land) asserting reap iff a root has no children (bio no longer protects), never reaps a root with a practice, and `deleteRun` deletes the root only after its last child — plus characterization tests that the existing non-root stale sweep and watchdog query construction are undisturbed. No feature code is written here. Spec: `.ai-factory/notes/19-test-root-reaping-deleterun.md`.

## Settings
- Testing: yes (this milestone *is* the tests — extend existing Jest specs, write no production code)
- Logging: minimal
- Docs: no

## Pinned cross-spec decisions (must be recorded in the note's Findings and escalated BEFORE authoring target cases)

These close the two RED→GREEN-contract gaps the plan review flagged. They are agreements the **test** and the **feature** must share; if spec 08 / 15 cannot honor them, the test author re-pins here first.

- **P1 — spec 08 root-sweep entrypoint (resolves review Issue 1).** Spec 08 exposes root reaping as a **separate public method `sweepEmptyRoots()`** on `SessionWatchdogService`, scheduled by the cron alongside `sweep()` — it does **not** fold root discovery into the existing `sweep()` body. Rationale: (a) the target tests drive a stable public surface — `(watchdog as any).sweepEmptyRoots()` (cast for compile-now since the method does not exist yet, per L2) — never a guessed private name, so a missing feature is RED-for-feature-absent, not a `TypeError` harness artifact; (b) leaving `sweep()` untouched keeps the existing query-construction characterization block green (see P2). If spec 08 instead must extend `sweep()`, re-pin both the entrypoint and P2 here before writing.
- **P2 — protect the existing watchdog query-construction chars (resolves review Issue 2).** The block `session-watchdog.service.spec.ts:52-110` ("sweep — query construction and empty result") asserts `expect(repo.find).toHaveBeenCalledTimes(1)` and that an empty result calls nothing. Add this block to the protected-characterization set: it must stay GREEN. P1 guarantees this — because root discovery lives in a separate `sweepEmptyRoots()` the `sweep()`-only chars never invoke, the `toHaveBeenCalledTimes(1)` assertion is unaffected. A RED there after spec 08 = the feature wrongly folded a second query into `sweep()` → escalate, do not patch.
- **P3 — spec 08 reap mechanism (mock-observable).** `sweepEmptyRoots()` determines childless-ness via a **mock-visible count** — `moduleSessionRepo.count({ where: { rootSessionId: root.id } })` returning a stubbed number — and reaps **per-root** via `moduleSessionRepo.delete({ id: root.id })` and/or `activityEngine.abandonStale(root.userId, root.id)`. NOT a single bulk `createQueryBuilder().delete()…execute()` (a mocked QB ignores the WHERE — the spec-07 `listRuns` trap, note 18 — and hides which root was targeted). Carve-out: if spec 08 insists on a bulk delete, the "≥1 child → not reaped" data-loss-guard case drops to a **builder-contract assertion** (assert the delete WHERE carries the childless + TTL predicate).
- **P4 — spec 15 deleteRun mechanism (mock-observable).** `deleteRun` counts remaining siblings via `moduleSessionRepo.count({ where: { rootSessionId } })` **after** deleting the target child; both deletes are discrete `moduleSessionRepo.delete({ id })` calls (extending `sessions.service.ts:144`), not a bulk delete — so the "one delete vs two, child-then-root order" outcome stays observable.

## Key constraints (read before writing — from the spec note)

- **RED/GREEN contract.** Target cases are expected to FAIL now and turn GREEN only when their feature lands — do NOT `.skip`/`.todo`/`it.failing` them and do NOT implement the feature. Label each `[RED until spec 08-janitor-empty-roots]` or `[RED until spec 15-deleterun-orphan-root-cleanup]` (spec name, never phase number). Characterization cases must stay GREEN; a RED there after a behavior-preserving feature = genuine regression → escalate, never patch.
- **Compile-now (L2).** `rootSessionId` and `ActivityType.ROOT` do not exist yet (added in spec 02), and `sweepEmptyRoots()` does not exist yet (spec 08). Build root/child fixtures with `activityType: 'root' as any` and `rootSessionId: <id> as any` (or `null as any`); call the new method via `(watchdog as any).sweepEmptyRoots()`.
- **Two-state observability (L1).** Assert the *outcome* of the reap predicate (was THIS root deleted/abandoned, yes or no) — not the SQL/predicate expression. The outcome is only observable because P3/P4 pin the feature to mock-visible `count` + per-root `delete`/`abandonStale`.
- **Behavior re-derivation.** Before writing, re-derive every root state — {live | disconnected} × {0 children | ≥1 child} × {0 bio | bio} — and assert exactly which are reaped under the corrected rule (**no children**, bio no longer protects). Any state the spec leaves ambiguous → the note's **Findings**, escalated before the feature task.
- **Time/threshold.** Stay consistent with the existing watchdog spec: mock `Date.now()` to `FIXED_NOW` and stub the TTL through the injected config (`configService.get` returns `WS_EMPTY_ROOT_TTL_MS`), not via a literal in the test.

## Tasks

### Phase 0: Pin and escalate before authoring

- [x] **Task 1: Record the pinned decisions (P1–P4) in the spec note's Findings and escalate to spec 08 / 15**
  Files: `.ai-factory/notes/19-test-root-reaping-deleterun.md`
  Write P1–P4 into the note's **Findings** section as the agreed contract, flagging P1 (separate public `sweepEmptyRoots()` entrypoint) and P2 (protected query-construction chars) for spec 08 and P4 for spec 15 to honor when implemented. This must happen before the target cases are authored — it is what makes them flip GREEN when the feature lands instead of staying RED for the wrong reason.

### Phase 1: Janitor — root reaping rule (extend `session-watchdog.service.spec.ts`)

- [x] **Task 2: Extend the watchdog spec harness for the root sweep** (depends on Task 1)
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Extend the existing mock setup without breaking the current characterization cases (including the protected `:52-110` query-construction block — P2):
  - Add `count: jest.fn()` and `delete: jest.fn().mockResolvedValue({ affected: 1 })` to the `repo` mock.
  - Make `configService.get` return a configured `WS_EMPTY_ROOT_TTL_MS` (branch on the key, mirroring the existing `WS_SESSION_MAX_IDLE_MS` test at lines 79-102) while keeping the existing `SESSION_MAX_IDLE_MS`/`SESSION_SWEEP_INTERVAL_MS` defaults intact.
  - Add a `makeRoot()` fixture helper: `activityType: 'root' as any`, `rootSessionId: null as any`, `status` disconnected/active, a `lastActivityAt` past/under the TTL as the case needs, and a distinct `userId`/`id`.
  - Because P1 puts root discovery in a separate `sweepEmptyRoots()`, no `repo.find` branching is needed: each root case stubs `repo.find` to return its root fixtures and `repo.count` to return that root's child count; the `sweep()` cases keep stubbing `repo.find` for stale practice rows as today. Keep the two method's mock setups in their own `describe`/`beforeEach`.

- [x] **Task 3: Add janitor reap-rule cases** (depends on Task 2)
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Add a `describe` block driving `(watchdog as any).sweepEmptyRoots()` (per P1) with these cases:
  - `[RED until spec 08-janitor-empty-roots]` should reap a childless root past TTL **even if it has bio** — the corrected rule. Stub `repo.count` → `0`; assert the per-root `repo.delete({ id: root.id })` / `abandonStale(root.userId, root.id)` outcome fired for that root.
  - `[RED until spec 08-janitor-empty-roots]` should NOT reap a root with ≥1 child, regardless of bio or age (data-loss guard). Stub `repo.count` → `1`; assert no delete/abandon reached that root. (Carve-out per P3: if spec 08 uses a bulk delete, assert the delete WHERE carries the childless + TTL predicate instead.)
  - `[RED until spec 08-janitor-empty-roots]` should NOT reap a childless root with a **live subscriber** (reuse the existing `hasLiveSubscriber` skip at `session-watchdog.service.ts:71`).
  - `[RED until spec 08-janitor-empty-roots]` should NOT reap a childless root whose `lastActivityAt` is still **fresh** (bio flush refreshes it — `biometric-stream-engine.service.ts:183-184`); drive via a fresh `lastActivityAt` under the TTL threshold.
  - `[characterization — must stay GREEN]` should leave non-root stale-session reaping unchanged — drive the existing `sweep()` and assert its `abandonStale` + `closeAll` loop (`session-watchdog.service.ts:82-83`) still reaps a stale non-root practice session, and that `sweepEmptyRoots()` does not perturb it.
  - Do NOT modify the protected `:52-110` query-construction block (P2); leave it asserting `repo.find` called once on the `sweep()` path.

### Phase 2: deleteRun orphan cleanup (extend `sessions.service.spec.ts`)

- [x] **Task 4: Add deleteRun orphan-cleanup cases** (depends on Task 3)
  Files: `src/sessions/sessions.service.spec.ts`
  Extend the existing `SessionsService.deleteRun` suite (3-arg ctor `SessionsService(moduleSessionRepo, bioSampleRepo, streamSampleRepo)`):
  - Add `count: jest.fn()` to the `moduleSessionRepo` mock. `makeSession`'s overrides are typed `Partial<ModuleSession>` and `rootSessionId` is not on the entity yet, so set it via a cast — `makeSession({ ... } as any)` or `rootSessionId: 'root-id' as any` inside an `as any` override (review Issue 3, L2 compile-now).
  Cases:
  - `[RED until spec 15-deleterun-orphan-root-cleanup]` should delete the root after its last child is deleted. Child has `rootSessionId: 'root-id' as any`, `endedAt != null`; stub `repo.count({ where: { rootSessionId: 'root-id' } })` → `0`; assert **two** `repo.delete` calls fire in order — child (`{ id: child.id }`) then root (`{ id: 'root-id' }`).
  - `[RED until spec 15-deleterun-orphan-root-cleanup]` should keep the root when a sibling remains. Stub `repo.count` → `1`; assert **only one** `repo.delete` fires (the child); no root delete (shared bio preserved).
  - `[RED until spec 15-deleterun-orphan-root-cleanup]` should count siblings **after** deleting the child (the deleted child is not counted). Assert via jest invocation order — `delete.mock.invocationCallOrder` precedes `count.mock.invocationCallOrder` — that the count drives the keep-vs-delete-root branch on the post-delete sibling set.
  - `[characterization — must stay GREEN]` should behave as today for a legacy session with `rootSessionId: null as any` — only the single `repo.delete({ id: sessionId })` fires, no root delete (`sessions.service.ts:137-146`).
  - Assert atomicity *intent* only via the observable outcome (both deletes through the same repo, child-then-root order) — do NOT assert transaction internals (note Gotchas).

### Phase 3: Verify the TDD signal

- [x] **Task 5: Run both specs, confirm RED/GREEN, record Findings** (depends on Task 4)
  Files: `src/realtime/services/session-watchdog.service.spec.ts`, `src/sessions/sessions.service.spec.ts`, `.ai-factory/notes/19-test-root-reaping-deleterun.md`
  Run `npx jest src/realtime/services/session-watchdog.service.spec.ts src/sessions/sessions.service.spec.ts`. Confirm: every characterization case is GREEN (including the protected `:52-110` block — P2), and every target case is RED **for the right reason** — the feature does not exist yet (no `sweepEmptyRoots()`, no per-root count/delete, single delete only), not a compile error or wrong-mock artifact. Append any ambiguous root states or mechanism mismatches discovered during authoring to the note's **Findings**, escalating to spec 08 / spec 15 before those feature tasks are implemented.

## Notes
- Roadmap linkage (review WARN, non-blocking): the test roadmap does not yet enumerate milestone 05 or the feature specs `08-janitor-empty-roots` / `15-deleterun-orphan-root-cleanup`. Out of scope for test authoring; flag to the roadmap owner so the RED-until references resolve to a backlog item.
