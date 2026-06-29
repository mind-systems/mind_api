# Handoff — durability + generic-data-flow epics (design & orchestrator supervision)

## 1. Frame
We are supervising the orchestrator-driven, TDD-first evolution of the `mind_api` realtime subsystem: the **continuous-bio-timeline** refactor is fully committed, and this session **designed two follow-on epics** (a *generic session-data-flow* epic, queued next; a *realtime durability* epic, parked) and handed the consumer rollout to `mind_mobile`. The chat is compacted but all knowledge is durable in `.ai-factory/notes/*` + `.ai-factory/ROADMAP.md` — rehydrate from the files, don't trust memory. **The two new epics are fully specced but UNCOMMITTED and NOT yet implemented.**

## 2. Read-first map

### Must-read now (minimal rehydration set)
- `.ai-factory/ROADMAP.md` — THE entry doc. Structure (top→bottom): done bio-timeline epic + its test phase (all `[x]`); then the **generic session-data-flow epic** (`## Test coverage — generic …` + `## Phase a1/a2/a3`) — this sits **ABOVE `---STOP---`** = the orchestrator's next active work; then `---STOP---`; then the **durability epic** (`## Test coverage — durability` + `## Phase 60–63`) **BELOW `---STOP---`** = parked. (`---STOP---` = barrier: the orchestrator processes ABOVE it, parks BELOW.)
- `.ai-factory/handoffs/04-bio-timeline-test-feature-reconciliation.md` — the prior session's deep context (the bio-timeline model, invariants, the test phase). Still the best dump for the shipped layer.
- `.ai-factory/handoffs/06-generic-session-data-flow.md` — the editor brief that produced the generic epic: the full design rationale, the three feature tasks, the anti-patterns. Read this to understand the generic epic without re-deriving it.

### Read on demand
- Generic epic notes: `31`–`33` (tests T1/T2/T3), `34` (deliver root.id via `is_root`), `35` (bio ownership), `36` (instruction ownership). Each self-contained.
- Durability epic notes: `27`–`30` (tests), `23` (connection markers), `24` (pause integrity), `25` (immediate marker persistence — repurposed from "persist column"), `26` (rehydrate). Each self-contained.
- `mind_mobile/.ai-factory/handoffs/12-mobile-root-child-rollout.md` — the consumer brief (forward-dated; see §3).
- `mind_api/.ai-factory/notes/13-mobile-proto-regen-behavior.md` — the command-side mobile spec.
- Source the epics touch: `src/realtime/module-state.grpc.controller.ts`, `module-biometric-stream.grpc.controller.ts`, `module-instruction-stream.grpc.controller.ts`, `services/{activity-engine,activity-session-store,stream-engine,session-watchdog,startup-recovery}.service.ts`, `constants/stream-data-types.ts`, `proto/module_state.proto`.

## 3. Current state

**Done & committed (`feature/root-session`, HEAD `d072d1f`):**
- Entire bio-timeline epic — Phases 54–59 + the test phase (notes 16–21) — all `[x]`. Orchestrator-committed (`060ed52`…`d072d1f`).
- Test task "root reaping rule + deleteRun" — I hand-fixed the missing root-scoping assertion and committed `81b755a "Tests: root reaping rule + deleteRun orphan cleanup"`.
- Feature-note reconciliation (notes 02–15: `## Test reconciliation` sections, gap fixes, self-containment) — committed `762af5d "Roadmap update"`.

**In-flight / specced but UNCOMMITTED (this session's design output):**
- **Generic session-data-flow epic** — ROADMAP `## Phase a1/a2/a3` + notes `31`–`36`. **Queued next** (above `---STOP---`). Unblocks mobile.
- **Durability epic** — ROADMAP `## Phase 60–63` + notes `23`–`30`. **Parked** (below `---STOP---`).
- Neither epic's code is implemented; both are RED-test-first specs awaiting the orchestrator.

**Uncommitted working-tree state (`mind_api`, confirm with `git status`):**
- `M .ai-factory/ROADMAP.md` (both new epics' roadmap sections).
- `?? .ai-factory/notes/23`–`36` (all durability + generic epic notes).
- `?? .ai-factory/handoffs/05-bio-timeline-review-and-consumer-rollout.md` (a review/rollout handoff I authored), `?? …/06-generic-session-data-flow.md` (the editor brief).
- **Separate repo:** `mind_mobile/.ai-factory/handoffs/12-mobile-root-child-rollout.md` — untracked.

## 4. Next step
**Decide & act on the generic epic.** It is specced and queued (above `---STOP---`); F1 (Phase a1) delivers `root.id` to the client and unblocks the mobile rollout. Concretely: (1) get the user's permission to **commit the two epics' specs** (ROADMAP + notes 23–36; message `Roadmap update`) — they're currently uncommitted; (2) let the orchestrator run the generic epic (a1 → a2 → a3, TDD: test tasks 31/32/33 then feature 34/35/36); (3) when a1/a2/a3 actually land & merge, the mobile handoff (`mind_mobile/12`, currently **forward-dated**) becomes real and the mobile agent starts. The durability epic stays parked below `---STOP---` until the user pulls it up. **Continue the supervisory role:** rescue/review orchestrator milestones, design follow-ons, keep consumer handoffs synced.

## 5. Working discipline
- **Orchestrator-driven; we supervise.** Each milestone runs plan → plan-review (`PLAN_REVIEW_PASS`) → implement → review (`REVIEW_PASS`), `.json` sidecar tracks `step`. The orchestrator runs in the **background** and commits its own work — HEAD moves under you; re-`git log`/`git status` before acting.
- **Roadmap/spec editing is delegated to editor agents** (via the Agent tool / SendMessage to resume them). They write ROADMAP + notes only, never implement code, never commit. The **user reviews** every editor output ("проверим") — and so do we (verify load-bearing claims against source).
- **Never commit without explicit user permission.** Roadmap/spec-only commits = literal `Roadmap update`; code commits = short noun phrase, sentence case, no `feat:`/`fix:` prefix, no body for single-concern.
- **Confirm-before-execute** on every product/design fork; never fabricate a contract — read it from `proto/` or the named note. Surface decisions, don't pre-decide.

## 6. Error log (mistakes this session + exact corrections — don't repeat)
- **"`isPaused` lives only in memory → pause isn't tracked, lost on restart."** WRONG — `pauseActivity`/`unpauseActivity` push durable `PAUSED`/`RESUMED` markers to `session_stream_samples` (`activity-engine.service.ts:478,519`); the graphs read those. The in-memory flag is a separate live cache. User caught it. Correction → decision B (derive pause from the marker, no column).
- **"Drop the bio echo — the client never needs `root.id`."** WRONG — the client needs `root.id` to tag root-level marks AND (two-devices) can't rely on server-resolve. Reversed to **deliver `root.id` on connect**.
- **"Making pause persistence flush synchronously changes the client API (an `await`)."** WRONG — the client never waits for server ack; persistence is server-internal. The `is_root` design + immediate-marker write add no client blocking.
- **Routed the task-05 root-scoping fix through an augmented review-2 twice → implementer didn't apply it** — because the review said "convert X to Y" while the code already had Y, so it read as done. Lesson: phrase a routed fix as "**case at `:NNN` is MISSING line Z — add Z**," never "convert X→Y." Eventually hand-fixed.
- **Created the handoff worktree off `master`** (stale snapshot) — recreated off `feature/root-session`; later dissolved it and moved the note into the main tree.
- **Special-cased "pause" for crash-durability** — user generalized: ALL discrete `SESSION_EVENT` markers want immediate persistence; only continuous streams batch. note 25 repurposed accordingly.

## 7. Orientation (traps)
- **`---STOP---` is a barrier, not a divider of done/undone.** Orchestrator processes tasks ABOVE it, parks tasks BELOW. The generic epic was placed ABOVE deliberately (it's next); durability BELOW (parked). Per user instruction, new active tasks go **above** the stop.
- **Generic-epic phases are `a1/a2/a3`** (per user) — do NOT renumber the existing numeric phases (54–63).
- **Two "05" handoffs existed transiently** — `05-mobile-root-child-rollout.md` (moved to `mind_mobile/12`) and `05-bio-timeline-review-and-consumer-rollout.md` (stayed in `mind_api`). Only the latter remains in `mind_api`.
- **Cross-epic anti-target collision:** `module-state.grpc.controller.spec.ts:152-174` is an anti-target in BOTH the generic T1 (note 31 — adds a connect frame → length 1→2 `[RESUMED, ROOT]`) AND durability note 28 (hardcoded `isPaused:false`). Generic lands first; durability layers on top. Cross-referenced in notes 31 & 28.
- **`getRoot` vs `ensureRoot`:** the bio path uses `ensureRoot(userId): Promise<ModuleSession|undefined>` (creates-or-returns). Note 21's body once said `getRoot` (stale, fixed). Don't reintroduce `getRoot`.
- **`StreamDataType` already encodes discrete-vs-continuous:** `SESSION_EVENT` (markers) vs `BREATH_PHASE` (instructions). The immediate-vs-batched split branches on `sample.data?.dataType === SESSION_EVENT` (continuous samples carry NO `dataType`).

## 8. Domain model spine (settled — do not re-litigate)
- **One root per user.** `ensureRoot(userId)` idempotent by `userId` — KEEP. Two devices on one account share the root (commingling accepted; we do NOT support two roots/account). → notes 04, 34.
- **A root IS a normal module session** (`activityType='root'`, `rootSessionId=null`) — now **client-addressable** (delivered on connect via `StateEvent.is_root=4`). The root/child split is two fields, never a code branch. → note 34.
- **Generic ownership-addressed ingestion:** bio + instruction controllers must validate the session is **owned & live**, not "equals the single active session." → notes 35, 36.
- **The "floor" of generic (intrinsic, keep):** bio binds to the root (connection-level); a child links via `rootSessionId` and carries a real `activityType`; the root carries the sentinel `activityType='root'`. → note 35.
- **Pause is NOT a column.** Pause state = the durable `PAUSED`/`RESUMED` marker; rehydrate derives it from the last marker. Discrete `SESSION_EVENT` markers persist **immediately**; continuous `BREATH_PHASE`/bio batch. → notes 24, 25, 26.
- **Spec notes are self-contained** — the implementing agent reads ONLY its own note + current code, never a `[[link]]`. Contract duplication across notes is REQUIRED, not a defect. → established this session.
- **House style: no service-level DB transactions** (only migrations use them). Don't add `manager.transaction` to a service; the committed test mocks (plain repos) reflect this. → note 15.
- **The vision (why):** concurrent activities — start meditation (child M), mid-way start a breathing module (child B) that finishes while M continues; M and B have different `session_id`s, run in parallel, both record on the **one** root bio timeline (each slices its `[startedAt,endedAt)` window).

## 9. Hard rules
- Never commit without explicit permission; messages per §5.
- `mind_api/proto/` is the single source of truth — the generic epic's `is_root=4` is a real (additive) proto change; consumers (`mind_mobile`) copy + regenerate. Change order: proto → mind_api → consumers.
- All `.ai-factory/` files in English; `docs/` in Russian.
- Migrations only via CLI; never edit a shipped migration (even formatting).
- Never write to memory unless the user uses an explicit trigger phrase.
- TDD test-authoring discipline (folded into ROADMAP test-phase intros): **two-state observability** — every target asserts at a mock-visible vantage that is RED now and GREEN after, given where the change lands; **anti-targets** (committed tests pinning OLD behavior) must be enumerated by `file:line` and inverted/deleted.

## 10. Cross-cutting contracts / invariants checklist
- **`StateEvent.is_root = 4`** (proto, **locked**): on connect the server emits a `session:state` with `module_session_id=root.id`, `is_root=true`; child frames `is_root` falsy. Distinguish the root by the **field, never frame order** (reconnect order is `[RESUMED(child), ROOT]` — the resumed-child block runs before `ensureRoot` at controller `:153`).
- **Generic ingestion:** bio resolves the root from `userId` and is tolerant of the echo (F2 drops the `SESSION_MISMATCH` check); instruction resolves `getSession(userId, session_id)` and accepts any **owned live** session (F3) — rejects only unowned/dead.
- **`ActivityEngine` has NO public `getSession`** — only `getActiveSession/getSoleChild/listLiveSessions`; the store has `getSession`. F3 must add an engine delegate.
- **`StreamEngine.push` is buffered** (periodic `flushAll`); the immediate-marker task branches inside `push` on `dataType` — `SESSION_EVENT` → one-row immediate `sampleRepo.save` (fire-and-forget, `push` stays sync, no client change); `BREATH_PHASE` → buffer as today. No rename (keeps committed `push(...)` assertions).
- **Error codes** (literal strings): `AMBIGUOUS_SESSION`, `NO_ROOT_SESSION`, `SESSION_MISMATCH`, `NO_SESSION`.
- **Bio model:** binds to root; tolerant read `In([sessionId, rootSessionId])`, per-sample window `[startedAt, endedAt)`.
- **`ensureRoot(userId): Promise<ModuleSession|undefined>`** — idempotent (zero `repo.create/save` when root exists).

## 11. Per-unit map with watch-points
**Generic epic (queued, above `---STOP---`):**
- a1/note 34 (deliver root.id) — adds `is_root=4` + regen + emit root on connect. Watch: emission-shift breaks 5 committed `module-state.grpc.controller.spec.ts` cases (`:196-212,:298-314,:152-174,:273-295,:316-351`) — anti-targets to INVERT; `:152-174` collides with durability note 28 (generic first).
- a2/note 35 (bio ownership) — drop Step 6 echo check; store under server-resolved root. Watch: `BioSample.session_id` becomes server-ignored (no cross-check) — accepted.
- a3/note 36 (instruction ownership) — `getActiveSession`→`getSession(userId, session_id)` ownership check. Watch: needs a NEW `ActivityEngine.getSession` delegate; anti-targets in `module-instruction-stream.grpc.controller.spec.ts:42-46,:114,:136,:159` (mock exposes only `getActiveSession`) → INVERT.
- T1/T2/T3 (notes 31/32/33) — RED-until tests. Watch: T1 accesses `is_root` via compile-now cast `(frame.sessionState as any).is_root` (field absent on the stub until a1 regenerates).

**Durability epic (parked, below `---STOP---`):**
- Phase 60/note 25 — immediate `SESSION_EVENT` persistence (foundational). Watch: branch on `data?.dataType`; committed `stream-engine.service.spec.ts` `makeSample` uses string `data` (no `dataType`) → batch cases stay GREEN.
- Phase 61/note 23 — DISCONNECTED/RECONNECTED markers once on the root + `endedAt=disconnectedAt`. Watch: emit at the connection-level handler, not per-child (spam).
- Phase 62/note 24 — stop self-mutating pause + report actual `isPaused` via the engine (controller has no store dep). Watch: read from in-memory `ActivityState`, not the entity; anti-target `module-state.grpc.controller.spec.ts:152-174` (collides with generic — see above).
- Phase 63/note 26 — rehydrate store on boot; derive `isPaused` from the last marker. Watch: new ctor `StartupRecoveryService(repo, streamSampleRepo, activitySessionStore, activityEngine)`; grace armed from process-start; anti-target `startup-recovery.service.spec.ts:29-53`.

**Consumer:**
- `mind_mobile/12` handoff — forward-dated to the post-generic contract (is_root on connect, bio→root.id, N concurrent phase streams, root-level marks). Watch: it says "done & committed" but the generic epic must actually land first; the gate is a1/a2/a3 merged.
