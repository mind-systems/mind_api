# Handoff — bio-timeline review + web/mobile consumer rollout

## 1. Frame
The `mind_api` continuous-bio-timeline refactor (root session + flat child activities) is almost fully implemented and committed on branch `feature/root-session`; the chat is compacted but all durable knowledge is in `.ai-factory/` files — rehydrate from them, do not trust memory. **This handoff lives in a separate git worktree (`handoff-notes` branch at `/Users/max/projects/mind/mind_api_handoffs`, branched off `feature/root-session` HEAD so it carries the current committed state) so it does NOT appear in the `feature/root-session` diff.** Read it from there; do the actual work against the main worktree at `/Users/max/projects/mind/mind_api`.

## 2. Read-first map

### Must-read now (minimal rehydration set)
- `/Users/max/projects/mind/mind_api/.ai-factory/ROADMAP.md` — THE entry doc. The `## Continuous bio timeline` epic (below `---STOP---`) + the `## Test coverage` block. Every `- [ ]`/`- [x]` is a task; its `Spec:` note holds detail. Read the checkbox states to see what's done vs left.
- `/Users/max/projects/mind/mind_api/.ai-factory/handoffs/04-bio-timeline-test-feature-reconciliation.md` — the PRIOR handoff. Carries the settled domain-model spine (§8), hard rules (§9), and the cross-cutting invariants checklist (§10) that the now-committed feature code implements. Still the best single context dump.
- `.ai-factory/notes/12-mcp-proto-regen.md`, `13-mobile-proto-regen-behavior.md` — the consumer-rollout specs (your downstream mission). Note 12 = mind_mcp (no-op). Note 13 = mind_mobile.

### Read on demand
- Feature notes `02`–`11`, `15` — the implemented spec for each feature task; each was made **self-contained** (carries an "Inlined contracts" / "Upstream contracts" block) so it reads standalone.
- Test notes `16`–`19`, `21` — the committed TDD specs the features turned green.
- `.ai-factory/notes/14-realtime-docs-update.md` — the docs task (note 14), still open.
- Feature source (now committed): `src/realtime/services/{activity-engine,activity-session-store,session-watchdog,biometric-stream-engine,stream-engine,startup-recovery}.service.ts`, `src/realtime/{module-state,module-biometric-stream}.grpc.controller.ts`, `src/sessions/sessions.service.ts`, `src/stats/stats.service.ts`+`stats.worker.ts`, `src/realtime/constants/{ws-error-codes,realtime-config}.ts`, `src/realtime/entities/module-session.entity.ts`, `proto/module_state.proto`.

## 3. Current state

**Done & committed (`feature/root-session`, HEAD `f55427f`):**
- All 5 TDD test tasks: 16/17/18/19/21 — `[x]`.
- Feature phase 54 schema (note 02) — `[x]`.
- Phase 55: store/engine (03), lazy root (04) — `[x]`.
- Phase 56: proto session_id+client_activity_id (05), state-controller concurrency/idempotency (06) — `[x]`.
- Phase 57: stats exclusion (07), janitor (08), deleteRun cleanup (15) — `[x]`.
- Phase 58: tolerant bio read (09), bio ingest to root (10) — `[x]`.
- Recent commits: `f55427f` bio ingest, `70668e1` tolerant read, `52feea6` deleteRun, `015c5f4` janitor, `601504a` stats exclusion, `060ed52` state controller. Note-reconciliation/self-containment work committed as `762af5d` "Roadmap update".

**In-flight (orchestrator is planning it now):**
- **Migration: backfill synthetic roots 1:1 + repoint bio (note 11, milestone seq `17`)** — the LAST feature-implementation task. Plan + plan-review-1/2 on disk, `notes/11` modified (uncommitted in the main tree). Not yet implemented.

**Remaining (not started):**
- Migration (11) — finishing planning → implement.
- **Update realtime docs to root/child model (note 14, phase 59)** — `docs/realtime/*` + `docs/stats/stats.md`, Russian. Open.

**Uncommitted working-tree state (main tree):**
- `M .ai-factory/notes/11-migration-backfill-roots.md`
- `?? .ai-factory/plans/17-migration-backfill-synthetic-roots-1-1-repoint-bio.{md,json}`
- `?? .ai-factory/plan-reviews/17-…-plan-review-1.md`, `…-plan-review-2.md`

## 4. Next step
**Rehydrate, then WAIT — do not act until ALL `mind_api` tasks are `[x]`** (migration note 11 and docs note 14 are still open; the orchestrator is running them). Confirm you understand the two-part standing mission below and hold for the human's go.

**Standing mission (why this agent exists), in order:**
1. **Once every roadmap task is done — code-review the whole feature branch.** Review `feature/root-session` vs `dev` (NOT master — master is far behind; use `git diff dev..HEAD`). The PRIOR review this session covered only the *test* files; the **feature production code (phases 54–58 + the migration) has not been reviewed yet**. Focus the review on the cross-cutting invariants in §10 (did the implementation honor them everywhere), the self-referential `ON DELETE CASCADE` reap/migration blast radius, and the bio root-binding correctness.
2. **Then hand off tasks to the dependent projects — `mind_web` and `mind_mobile`** (the consumer rollout). See §7/§11 for what each consumer must do. `mind_mcp` is a **no-op** (note 12 — carries no realtime proto). Each consumer gets its own `/aif-plan` *inside its own repo*, not here.

## 5. Working discipline
- **Never commit without explicit user permission.** Roadmap-only commits use the literal message `Roadmap update`; code commits = short noun phrase, sentence case, no `feat:`/`fix:` prefix, no body for single-concern.
- **Confirm-before-execute** on decisions; show the plan and hold. Product forks the code can't settle → raise as a blocking question, never fabricate.
- **Orchestrator-driven** for implementation: each milestone runs plan → plan-review (`PLAN_REVIEW_PASS`) → implement → review (`REVIEW_PASS`), with a `.json` sidecar per milestone tracking `step`. You are the supervisor/reviewer, not the implementer.
- All `.ai-factory/` files in **English**; `docs/` in **Russian**.
- Never write to memory unless the user uses an explicit trigger phrase ("remember this" / "запомни").

## 6. Error log (this session's mistakes + exact fixes — don't repeat)
- **Recurring root cause across ALL test-milestone failures: "two-state observability."** A spec/test routed an assertion through an indirection the unit mock cannot observe → the "target" case is permanently RED or vacuously GREEN. Instances fixed: (a) stats-skip asserted a `StatsWorker.finalise` spy, but the guard lives inside `StatsService.finalise` → had to drive the real service and assert `repo.manager.transaction` not called; (b) `listRuns` SQL `andWhere` invisible to a mocked QB → builder-contract assertion; (c) janitor reap via bulk QB delete / raw `repo.query('SELECT 1…')` invisible to the mock → use `repo.count`/per-row `repo.delete({id})`; (d) deleteRun `manager.transaction` wrapper — the committed mock has no `manager` → dropped the transaction (also matches house style, see §9). The rule was folded into the ROADMAP test-phase intro as the **"Two-state observability"** check.
- **Task 05 (reaping) review failed 3 rounds** on a single missing line — the TTL query-contract test pinned `lastActivityAt` but not the **root scope** (`activityType='root'`), leaving a symmetric silent-cascade hole (a sweep missing the filter reaps childless non-root practice sessions). Eventually force-fixed by hand: added `expect(callArg?.where?.activityType).toBe('root')`, committed `81b755a`. **Trap:** the orchestrator failed to apply this one-line fix twice when routed through an augmented review-2 — because the review said "convert X to Y" while the code already had Y; the implementer read it as done. Lesson: when routing a fix through a review, phrase it as "case at `:NNN` is MISSING line Z — add Z," not "convert X to Y." That milestone's sidecar still reads `review_failed:3` (stale — the task is `[x]` and committed).
- **Note-reconciliation pass (commit `762af5d`) caught feature-spec gaps the test phase would have tripped on:** note 06 never enumerated the anti-target tests to delete/invert; note 10 still said `getRoot` while the committed tests use `ensureRoot`; note 08 raw `repo.query`; note 15 `manager.transaction`. All corrected, and each feature note given a `## Test reconciliation (committed tests)` block (which committed cases it greens + which to delete).
- **A cosmetic edit to an already-shipped migration** (`RenameToModuleSessionNotes`) was flagged — SQL was byte-identical, no DB risk, but the lesson stands: **never touch a shipped migration, even for formatting.**

## 7. Orientation (traps)
- **Milestone seq № ≠ note №.** Orchestrator numbers milestones 01,02,03,… (now up to ~17 for the migration). Note files are 01–21. Artifact filenames use the milestone seq; `Spec:` links use the note №. Don't conflate.
- **root vs child.** A `ModuleSession` with `activityType='root'` (`rootSessionId=null`) is the bio container; a child practice points at it via `rootSessionId`. `'root'` is **server-internal — NOT in the proto `ActivityType` enum.**
- **Consumer split:** `mind_mcp` = no-op (note 12, no realtime proto). `mind_mobile` = real work (note 13: copy updated `proto/module_state.proto`, regenerate stubs, send `session_id`/`client_activity_id`, handle concurrent activities + per-session lifecycle). `mind_web` = the React dashboard reads **historical** session/bio data — it must understand the root/child model, the windowed bio read (a child slices `[startedAt,endedAt)` of the shared root timeline), and that roots are excluded from stats/run-history. Web has no spec note yet — drafting that scope is part of the rollout.

## 8. Domain model spine (settled — do not re-litigate)
- Bio binds to the **root** session, not the activity; children are time-windows on the shared timeline. → notes 09, 10.
- **Two-level only:** `rootSessionId`, no `parentSessionId`. → note 02.
- Migration is **1:1** (one synthetic root per existing session), repoints bio to the root, FK `ON DELETE CASCADE`. → note 11 (in flight).
- Root is reaped **iff it has no children** (bio alone does NOT protect it; the cascade removes orphaned bio). → note 08.
- **Spec notes are self-contained** — the implementing agent reads ONLY its own note + current code, never level-2 `[[links]]`. Contract duplication across notes is **required, not a defect**. → established this session; all feature notes carry inlined-contract blocks.
- **No DB/integration tests** — the windowed read (09) and migration (11) are verified **manually** against a prod snapshot restored onto dev (test tasks 20 & 22 were deliberately dropped).

## 9. Hard rules
- Never commit without explicit permission; messages as in §5.
- `mind_api/proto/` is the single source of truth for all `.proto`; consumers copy + regenerate (never symlink). Change order: proto → mind_api → consumers.
- Migrations only via CLI (`npx typeorm migration:create …`) — never hand-craft timestamps; never edit a shipped migration.
- Logging only via NestJS `Logger`.
- **Don't bend architecture to a test mock.** House style: services do bare `repo.delete()/save()` with **no `manager.transaction`** (transactions appear only in migrations). The committed test mocks reflect that — match it.

## 10. Cross-cutting contracts / invariants checklist (now implemented — verify the review honors them)
- **Store shape:** `Map<userId, {rootSessionId, children: Map<sessionId, ActivityState>}>`; grace timers keyed by `sessionId`.
- **Store API:** `addChild / getChild / listChildren / setRoot / getSoleChild / getRoot / listLiveSessions`; `set/get/has/delete` are sole-child compat shims (children-only, exclude root).
- **Engine signatures:** `sessionId` as an **optional 2nd positional** with `getSoleChild(userId)?.sessionId` fallback (children-only) on `end/stop/pause/unpause/resume/abandon`; `onDisconnect` keeps it required (always per-session via the fan-out).
- **`ensureRoot(userId): Promise<ModuleSession|undefined>`** — idempotent (zero `repo.create/save` when the root already exists); creates `{activityType:'root', rootSessionId:null}`.
- **Error codes** (`ws-error-codes.ts`, SCREAMING_SNAKE, value===key): `AMBIGUOUS_SESSION`, `NO_ROOT_SESSION`.
- **Config:** `WS_IDEMPOTENCY_WINDOW_MS=10_000`, `WS_EMPTY_ROOT_TTL_MS=600_000`.
- **Proto (`module_state.proto`):** `client_activity_id=5` on `ActivityStartCmd`; optional `session_id` on End/Stop/Pause/Resume. ROOT is **not** in the proto enum.
- **Schema:** `module_sessions.rootSessionId` uuid nullable, self-ref FK `ON DELETE CASCADE`; `ActivityType.ROOT='root'` in TS + DB enum.
- **Janitor reap query:** `repo.find({ where: { activityType:'root', lastActivityAt: LessThan(threshold) } })`, childless via `repo.count({where:{rootSessionId}})===0`, reap per-row `repo.delete({id})` — no bulk QB delete (mock-observability).
- **Bio:** ingest binds to the root; flush fires on **root** lifecycle (ABANDONED/REVOKED); child completion is a no-op for bio.
- **Analytics read:** `moduleSessionId In([sessionId, rootSessionId])`; per-sample window `[startedAt, endedAt)` (half-open).
- **Revoke:** `handleSessionRevoked` stops ALL children + the root, then `closeAll(userId)`.

## 11. Per-unit map for the two forward phases

**Code review (phase 1 of the mission) — review these committed units against §10:**
- `activity-session-store.service.ts` — verify the new `Map<userId,{rootSessionId,children}>` shape + sole-child shims; watch: `getSoleChild`/`get` must exclude the root slot.
- `activity-engine.service.ts` — `ensureRoot` idempotency; optional-`sessionId` fallback resolving children-only (never the root); root never ended via `activity:end`.
- `module-state.grpc.controller.ts` — singleton guard removed; `session_id` routing + `AMBIGUOUS_SESSION`; idempotency map; `handleSessionRevoked` stops all+root. Confirm the anti-target spec tests (`module-state.grpc.controller.spec.ts:652-675, :760-771, and the 4 routing chars`) were deleted/inverted, not left RED.
- `session-watchdog.service.ts` — `sweepEmptyRoots()` is a SEPARATE method, single `setInterval` calling both sweeps; root-scoped query; never reaps a root with children.
- `sessions.service.ts` — `deleteRun` (child→count→conditional root delete, non-transactional, janitor backstop); `listRuns` `activityType != root`; tolerant bio read `In([sessionId, rootSessionId])` + window.
- `stats.service.ts`/`stats.worker.ts` — root early-return inside `finalise`; bio flush on shared ABANDONED untouched.
- `module-biometric-stream.grpc.controller.ts` — resolves `ensureRoot`, compares `root.id` (NOT `session.sessionId`), emits `NO_ROOT_SESSION`; pause does not block bio.
- **Migration (note 11)** — highest blast radius: 1:1 synthetic roots, `UPDATE bio_session_samples SET moduleSessionId = root.id`, transactional/batched/idempotent, cascade-aware `down()`. Verify manually on a prod snapshot.

**Consumer rollout (phase 2) — hand off per repo:**
- `mind_mobile` (note 13) → its own repo, its own `/aif-plan`: copy `proto/module_state.proto`, regenerate Dart stubs, send `session_id`/`client_activity_id`, support concurrent activities + per-session lifecycle, keep DTO/Drift shapes in sync with any changed API response.
- `mind_web` (no note yet) → draft the scope, then its own `/aif-plan` in `mind_web`: render the root/child timeline, the windowed bio slice per child, roots absent from stats/run-history. The dashboard is read-only over historical data — main risk is mis-rendering a child's bio window vs the whole root timeline.
- `mind_mcp` → **no-op** (note 12). Don't open a task.

**Self-check for the reviewer:** for each unit above, can you point to the §10 invariant it must satisfy and confirm the committed code does? If the migration (11) or docs (14) are still open when you start, you are early — WAIT.
