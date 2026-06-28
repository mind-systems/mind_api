# Handoff — bio-timeline test↔feature reconciliation watcher

## 1. Frame
We are mid-refactor of the `mind_api` realtime subsystem — the **continuous bio timeline** (a root session per app-open + flat child activities overlaid on it), executed **TDD-first** through an orchestrator pipeline (plan → plan-review → implement → review). The chat that produced this is compacted; all durable knowledge lives in `.ai-factory/notes/*.md` and `.ai-factory/ROADMAP.md`. Rehydrate from those files — do not trust memory. **This handoff lives in a separate git worktree (`handoff-notes` branch at `/Users/max/projects/mind/mind_api_handoffs`) so it does not appear in the main working tree's diff.** Read it from there; do the actual work against the main worktree at `/Users/max/projects/mind/mind_api`.

## 2. Read-first map

### Must-read now (minimal rehydration set)
- `/Users/max/projects/mind/mind_api/.ai-factory/ROADMAP.md` — everything below `---STOP---`: the **TDD test phase** (5 test tasks) then 6 sequential feature phases (54–59). Two-tier format: each `- [ ]` line is the contract, its `Spec:` note holds the detail. THE entry doc.
- `.ai-factory/notes/16…22-*.md` — the test specs (16 lifecycle, 17 concurrency, 18 stats, 19 reaping+deleteRun, 21 bio-ingest; 20 & 22 were dropped — see §8).
- `.ai-factory/notes/02…15-*.md` — the feature specs the tests are written against.

### Read on demand
- `src/realtime/services/multi-session-lifecycle.spec.ts` — committed test from task 16.
- `src/realtime/concurrency-idempotency.spec.ts` — committed test from task 17.
- Feature source the specs cite: `src/realtime/services/activity-engine.service.ts`, `activity-session-store.service.ts`, `module-state.grpc.controller.ts`, `biometric-stream-engine.service.ts`, `stream-engine.service.ts`, `session-watchdog.service.ts`, `startup-recovery.service.ts`; `src/sessions/sessions.service.ts`; `src/stats/stats.worker.ts`; `src/realtime/constants/ws-error-codes.ts` & `realtime-config.ts`; `src/realtime/entities/module-session.entity.ts`; `proto/module_state.proto`.
- `.ai-factory/handoffs/02-mind-coach-ai-architecture.md` & `03-mind-coach-trading-parallel.md` — the downstream "why" (this refactor is the precondition for a `pre→event→post` coach timeline).

## 3. Current state

**Done (committed):**
- Test task 16 — `multi-session-lifecycle.spec.ts` (specs 03/04).
- Test task 17 — `concurrency-idempotency.spec.ts` (specs 05/06). HEAD = `db21ede "Tests: concurrent activities + idempotency dedup"`.
- All spec notes 02–22 authored and gap-pinned (a `/command-pin-gaps` pass closed compile-pins + forward-coupling; note 17 was later re-pinned during a rescue, see §6).

**In-flight:**
- Test task 18 (root excluded from stats) — the orchestrator is **planning** it now (milestone seq `04`). Uncommitted plan + plan-review-1 on disk in the main worktree.

**Remaining test tasks:** 18 (stats), 19 (reaping+deleteRun), 21 (bio ingest).
**Feature phases 54–59:** not started.

**Uncommitted working-tree state (main worktree):**
- `.ai-factory/plans/04-tests-root-excluded-from-stats-run-history.{md,json}` and `…-plan-review-1.md` — task-18 planning artifacts, live.

## 4. Next step
**Rehydrate, then WAIT for instructions** — do not act yet. Confirm you understand the mission below and ask any clarifying questions; the humans + the active session will answer.

**Standing mission (the reason you exist):** once the test tasks (18, 19, 21) are done — and as each feature phase (54–59) is implemented — **walk every feature spec and verify it conforms to the already-written tests.** Concretely, for each feature spec:
- annotate **which exact committed test cases it must turn GREEN**, and
- **which anti-target tests it must DELETE/invert** (e.g. the old singleton-guard tests, see §10),
- flag any feature that, as specced, would leave a committed test RED for the wrong reason.
Then decide whether **dedicated reconciliation tasks** are warranted after all phases (the user explicitly floated this as an open option). The mapping in §11 is your starting skeleton — validate and deepen it against the real specs/tests, do not take it on faith.

## 5. Working discipline
- **Orchestrator-driven.** Each milestone runs plan → plan-review (must emit `PLAN_REVIEW_PASS`) → implement → review (`REVIEW_PASS`). Artifacts in `.ai-factory/{plans,plan-reviews,reviews,patches}/`, one `.json` sidecar per milestone tracking `step`.
- **Never commit without explicit user permission.** Roadmap-only commits use the message `Roadmap update`; code commits = short noun phrase, sentence case, no `feat:`/`fix:` prefix.
- **Confirm-before-execute** on decisions. Product forks the code can't settle are raised as `## Blocking decisions` / `## Decisions (locked)` at the top of a note and resolved by the user — never fabricated.
- When pinning/repairing a **test** spec, re-validate two things (these caused the only failures so far): (a) each case's TARGET-vs-CHARACTERIZATION classification, and (b) that each TARGET case is genuinely RED *today* for the right reason.

## 6. Error log
- **Task 17 plan failed all 3 plan-review rounds** (never got `PLAN_REVIEW_PASS`; sidecar `plan_review_failed:2`). Rescued via `milestone-rescue` at **spec+plan depth**: rewrote `notes/17-test-concurrency-idempotency.md`, folded two findings into the plan, deleted the 3 plan-reviews, set sidecar `step:"planned"`. It then re-planned + implemented successfully (now committed).
  - **Root cause:** note 17 carried a WRONG red/green taxonomy — it declared "all target, no characterization." In reality **4 of 5 idempotency cases are CHARACTERIZATION**: today there is no dedup map, so a repeat `client_activity_id` already starts a fresh session — those cases pin behavior spec 06 must *preserve*, not introduce. Fix = split TARGET vs CHARACTERIZATION (mirroring note 16).
  - **Feeding trap:** a "target" case can be GREEN-today because of a default mock. The controller keeps no session state — it delegates to `activityEngine.getActiveSession(userId)`, whose mock defaults to `undefined`, so the singleton guard never fires and concurrent-start cases pass today *unless* you wire `getActiveSession.mockReturnValue(makeActivityState({sessionId:'session-1'}))`.
- **Our `/command-pin-gaps` pass missed the taxonomy error** — it closed compile-pins and forward-coupling but did not re-validate classification. Lesson folded into §5.
- **Gate ratchet (systemic, watch for it):** the plan-review/code-review gate withholds PASS over *non-blocking* refinements and surfaces fresh nits each round. Task 16 took 3+3 rounds though sound; task 17 plan never converged for the same reason. If a future milestone fails again with only 🟢/non-blocking findings, that's **gate-tuning, not a spec defect** — don't keep editing the spec.

## 7. Orientation (traps)
- **Milestone seq № ≠ note №.** The orchestrator numbers milestones 01,02,03,04… (01 rename-proto, 02 test-lifecycle, 03 test-concurrency, 04 test-stats…). Note files are 02–22. Artifact filenames use the milestone seq; `Spec:` links use the note №. Don't conflate.
- **"spec NN"** in a note means the note file `.ai-factory/notes/NN-…`, **not** a phase number. Label red/green by spec-note name, never by phase number (a 56-vs-55 label mismatch cost a round).
- **root vs child.** A `ModuleSession` with `activityType='root'` (`rootSessionId=null`) is the bio container; a child practice points at it via `rootSessionId`.

## 8. Domain model spine (settled — do not re-litigate)
- Bio binds to the **root** session, not the activity; children are time-windows on the shared timeline. → notes 09, 10; ROADMAP epic.
- **Two-level only:** `rootSessionId`, **no** `parentSessionId`. → note 02.
- Migration is **1:1** (one synthetic root per existing session), repoints bio to the root, FK `ON DELETE CASCADE`; synthetic-root status `completed` for closed children / mirror for in-flight. → note 11.
- Root is reaped **iff it has no children** (bio alone does NOT protect it; the cascade removes orphaned bio). → note 08.
- **No DB/integration tests.** The windowed read (note 09) and migration (note 11) are verified **manually** against a prod snapshot restored onto dev — test tasks 20 & 22 were dropped on purpose. → ROADMAP test-phase intro.
- **Consumer tasks dropped** from this roadmap (mind_mcp carries no realtime proto → no-op; mind_mobile gets its own `/aif-plan` later). Notes 12/13 kept only as handoff reference. Docs (note 14) stays.

## 9. Hard rules
- Never commit without explicit permission.
- All `.ai-factory/` files in English; `docs/` in Russian.
- Never write to memory unless the user uses an explicit trigger phrase ("remember this" / "запомни" etc.).
- `mind_api/proto/` is the single source of truth for all `.proto`. Migrations only via CLI (`npx typeorm migration:create …`) — never hand-craft timestamps.
- Logging only via NestJS `Logger`.

## 10. Cross-cutting contracts / invariants checklist
The committed tests PIN these; every feature spec must honor them exactly or a committed test stays RED for the wrong reason:
- **Store shape:** `Map<userId, {rootSessionId, children: Map<sessionId, ActivityState>}>`; grace timers keyed by `sessionId`.
- **New store API:** `addChild / getChild / listChildren / setRoot / getSoleChild / getRoot / listLiveSessions`; `startGraceTimerForSession / cancelGraceTimerForSession / hasPendingGraceTimerForSession`.
- **Engine signatures — `sessionId` as the 2nd positional arg:** `endActivity(userId, sessionId, clientTimestampMs?)`, `stopActivity(userId, sessionId)`, `pauseActivity(userId, sessionId)`, `unpauseActivity(userId, sessionId)`, `resumeActivity(userId, sessionId)`; abandon/onDisconnect per `sessionId` (today all are `userId`-only).
- **`ensureRoot(userId)`** → `ModuleSession{ activityType:'root', rootSessionId:null }`, idempotent.
- **Error codes** (`ws-error-codes.ts`, SCREAMING_SNAKE, value===key): `AMBIGUOUS_SESSION`, `NO_ROOT_SESSION`.
- **Config:** `WS_IDEMPOTENCY_WINDOW_MS=10_000`, `WS_EMPTY_ROOT_TTL_MS=600_000`.
- **Proto (`module_state.proto`):** `client_activity_id=5` on `ActivityStartCmd`; optional `session_id` on End/Stop/Pause/Resume. ROOT is **not** added to the proto `ActivityType` enum.
- **Schema:** `module_sessions.rootSessionId` uuid nullable, self-ref FK `ON DELETE CASCADE`; `ActivityType.ROOT='root'` in TS enum + DB enum.
- **Revoke:** `handleSessionRevoked` stops ALL children + the root, then `closeAll(userId)`.
- **Bio ingest** binds to the root; flush fires on **root** lifecycle; child completion is a no-op for bio.
- **Analytics read:** `moduleSessionId In([sessionId, rootSessionId])`; per-sample window defaults to `[startedAt, endedAt)` (half-open: include from, exclude to).
- **Anti-target:** when spec 06 lands it must **DELETE/invert** `module-state.grpc.controller.spec.ts:652-675` (the old singleton-guard tests) — their post-06 RED is intended, not a regression.

## 11. Per-unit map with watch-points (the reconciliation skeleton — validate it)
**Test tasks (committed):**
- 16 `multi-session-lifecycle.spec.ts` → turns GREEN via specs **03+04**. Watch: characterization must assert OUTCOMES, not the userId-keyed grace-timer internals (that was the task-16 Medium finding).
- 17 `concurrency-idempotency.spec.ts` → GREEN via spec **06** (+05 proto). Watch: spec 06 must delete the anti-target guard tests; after-window case advances `10_001` ms (off-by-one boundary).
**Test tasks (pending):**
- 18 stats exclusion → GREEN via spec **07**. Watch: the guard must skip stats only, NOT the bio-flush handler on the shared `ABANDONED` event.
- 19 reaping + deleteRun → GREEN via specs **08+15**. Watch: the reap predicate gates a self-referential CASCADE delete — never reap a root with children.
- 21 bio ingest → GREEN via spec **10**. Watch: `pushBatch(root.id, …)`; flush on root lifecycle; child-completion no-op.
**Feature phases (pending) → which committed tests each must flip:**
- 54 (note 02) schema → no tests (loud-fail area).
- 55 (notes 03,04) multi-session store/engine + lazy root → flips **test 16** targets GREEN.
- 56 (notes 05,06) proto + controller concurrency/idempotency → flips **test 17** targets GREEN; **deletes** the anti-target guard tests.
- 57 (notes 07,08,15) stats exclusion + janitor + deleteRun → flips **tests 18 & 19** GREEN.
- 58 (notes 09,10,11) tolerant read + bio→root + migration → flips **test 21** GREEN; 09/11 manually verified (no auto test).
- 59 (note 14) docs.

**Self-check for the reconciliation pass:** for each feature phase, can you name the exact `describe/it` cases that flip GREEN and the exact tests to delete? If a feature spec doesn't already say so, that gap is the work — propose carrying it into the spec, or a dedicated post-phase reconciliation task.
