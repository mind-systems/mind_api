# Handoff — generic session-data-flow epic (roadmap-editor brief)

> **Audience:** a fresh **roadmap-editor agent** for `mind_api` (`/Users/max/projects/mind/mind_api`). The previous editor ran out of budget mid-design. This note carries the full settled design + the exact tasks to author. **Your job:** write the roadmap tasks (feature + TDD test, two-tier — a contract line per task plus a self-contained spec note) for the "generic session-data-flow" epic below. **You do NOT implement code** — roadmap lines + spec notes only. The human will review your output.

## 1. The vision (what we're enabling)
Concurrent activities on one continuous bio timeline. Example: the user starts a **meditation** (child session M); mid-way they start a **breathing module** (child session B) that brings them to a target state and finishes; the meditation keeps running. M and B have **different session ids**, run **in parallel**, and both are recorded against the **same root bio timeline** (each slices its own `[startedAt, endedAt)` window of the shared root bio). That is the flexibility the product wants.

**Crucial framing — half of concurrency already shipped.** The **command / lifecycle** side of concurrent activities is DONE & committed (note `06-state-controller-concurrent-idempotency`: `session_id`-addressed `end/stop/pause/resume`, a child ends independently while siblings continue, `AMBIGUOUS_SESSION` when ambiguous). What is missing — and what THIS epic delivers — is the **data-ingestion** side (instruction/phase streams for concurrent children) plus making the **root client-addressable**.

## 2. The model (settled — do not re-litigate)
- **One root session per user.** `ActivityEngine.ensureRoot(userId)` is idempotent by `userId` — KEEP it. (Two devices on one account share the root; that bio commingling is accepted — we do NOT support two roots per account.)
- **A root IS a normal module session** — the row with `activityType='root'` and `rootSessionId=null`, the "app is open" container. Children are sessions with a real `activityType` (`breath`/`meditation`) and `rootSessionId = root.id`. The root/child split is **two fields**, never a special code path.
- **The root must be client-addressable.** Today the server creates it (`ensureRoot`) and the client never learns its id → the client cannot tag root-level data. Fix = deliver the root id to the client on connect.
- **Generic ingestion = validate OWNERSHIP, not "the single active session".** Both ingest controllers currently hard-reject any `session_id` that isn't the one active session — that is the anti-pattern to remove. The client tags each datum with the appropriate owned session id; the server stores it after checking the session belongs to the user and is live.
- **The "floor" of generic (intrinsic — keep, do not try to erase):** bio binds to the **root** (it is connection-level — one heart stream spanning activities); children link to the root via `rootSessionId`; a child carries `activityType` (its module), the root carries the sentinel `activityType='root'`. "Generic" = uniform addressing + ownership validation ON TOP of this thin hierarchy.

## 3. Current state — the anti-patterns to fix (ground every claim against source)
- **Root not delivered on connect:** `src/realtime/module-state.grpc.controller.ts:153` does `await this.activityEngine.ensureRoot(userId)` and **discards** the result. Every `session:state` the client gets carries a **child** id (from `activity:start`). The root id reaches the client only on reconnect-when-no-child (`~:466,:501`).
- **Bio ingest is single-session:** `src/realtime/module-biometric-stream.grpc.controller.ts` — Step 5 resolves `root = ensureRoot(userId)`; Step 6 (`~:127`) rejects `root.id !== batch.samples[0].sessionId` with `SESSION_MISMATCH`; happy path pushes with `root.id`. So the client must echo a root id it cannot learn (this is the mobile blocker).
- **Instruction ingest is single-CHILD:** `src/realtime/module-instruction-stream.grpc.controller.ts` — `getActiveSession(userId)` (`:78`, `NO_SESSION` if none) → `session.sessionId !== msg.sessionId → SESSION_MISMATCH` (`:94`) → `streamEngine.push(msg.sessionId, …)` (`:102`). It accepts ONLY the single active child: it cannot take phases for two concurrent activities, and it rejects a root-tagged mark.
- **Session store API** (`src/realtime/services/activity-session-store.service.ts`): `Map<userId, {rootSessionId, children: Map<sessionId, ActivityState>}>`; methods `getRoot/getRootId`, `getChild`, `getSoleChild`, `listLiveSessions(userId)`, `getSession(userId, sid)`. Use `getSession`/`listLiveSessions` for ownership checks.
- **Error codes** (literal strings in the controllers): `SESSION_MISMATCH`, `NO_SESSION`, `NO_ROOT_SESSION`, `AMBIGUOUS_SESSION`.
- **Proto:** `proto/module_state.proto` — `StateEvent` carries `module_session_id` + `is_paused`; `ActivityType` has NO `root` value (root is server-internal today). Read this before specifying F1's surfacing.

## 4. The tasks to write — a NEW epic, TDD-first
Author a new epic (propose heading **`## Session data flow — generic ownership-addressed ingestion`**) with a TDD **test phase ABOVE its feature phases** (mirror the durability epic exactly: a no-number `## Test coverage — …` section, then numbered `## Phase NN` feature phases). Two-tier per task: a roadmap contract line (~400–700 chars, naming files/types/guards, ending `Spec: …`) **plus a self-contained spec note** (scan `.ai-factory/notes/` for the next free numbers — likely `31+`). Three feature tasks, each with a test task.

### F1 — Deliver the root session id to the client on connect
- In the state stream `setup()`, when `ensureRoot(userId)` resolves, **surface the root id to the client** (today discarded at `module-state.grpc.controller.ts:153`). One root per userId.
- **OPEN SUB-DECISION you must spec AND flag for the human — how the client distinguishes the root from a child session:state.** Options: (a) reuse `session:state` carrying the root id + a distinguishing field/flag; (b) a dedicated `root_session_id` field on the connect/state event. **If the chosen surfacing needs a new proto field, that is a mobile-facing contract change — call it out explicitly** (it would mean a `proto/module_state.proto` change + consumer regen). Ground the concrete options against the actual `StateEvent`/proto before writing; do not invent a shape.
- This unblocks the mobile bio rollout (`mind_mobile/.ai-factory/handoffs/12-mobile-root-child-rollout.md`).

### F2 — Generalize bio ingest to ownership
- Bio always binds to the root (resolved from `userId`, Step 5). With F1 delivering root.id, Step 6 becomes satisfiable — **decide and spec**: keep Step 6 as an ownership/consistency check, OR simplify to "store under the server-resolved root, ignore the client echo." Either way bio works; bio→root binding is unchanged. Minor task.

### F3 — Generalize instruction ingest from single-child to any owned live session (the meaty one)
- Replace `getActiveSession(userId) + (session.sessionId !== msg.sessionId → SESSION_MISMATCH)` with: resolve the target via `getSession(userId, msg.sessionId)` (or membership in `listLiveSessions(userId)`); reject only when the session is **not owned / not live** (a real ownership error — NOT "not the single active one"); then `streamEngine.push(msg.sessionId, …)` as today.
- This is what enables **N concurrent activities' phase streams** (the core vision) and **root-level client marks** (the client pushes a mark tagged with the now-known root id — itself a valid owned session).
- **Anti-targets (do this):** the committed instruction-stream tests almost certainly pin the OLD single-session `SESSION_MISMATCH`/`NO_SESSION` behavior. Read `src/realtime/module-instruction-stream.grpc.controller.spec.ts`, enumerate those cases by file:line, and mark them DELETE/INVERT in F3's test note.

### Test tasks (silent-bug-first, committed RED until their feature; one per feature)
- **T1 (guards F1):** the connect path surfaces the root id — mock-visible: the emitted `session:state`/field carries the root's id and is distinguishable from a child. RED until F1.
- **T2 (guards F2):** bio ingest accepts the user's root and stores under the root regardless of the client echo (ownership, not single-session). RED until F2.
- **T3 (guards F3):** instruction ingest accepts phases for **two concurrent children** AND a root-tagged mark; **rejects** a session id NOT owned by the user; + invert the enumerated single-session anti-targets. RED until F3.

## 5. Test philosophy (apply it; keep the roadmap intro to ~4–6 lines)
TDD, silent-bug-first. **Target** tests define new behavior, committed RED until the feature lands (no `.skip`, no implementing the feature in the test). **Characterization** tests lock current behavior that must survive — a RED there after a behavior-preserving change is a Class-B regression → escalate. Scope = behavior that fails **silently** (wrong routing/ownership/storage with no error/exception/4xx); loud failures (proto/DI/compile) are skipped. **Two-state observability:** every target asserts at a **mock-visible** vantage that is RED now and GREEN after the feature, given where the change physically lands — never off a field/path the mock can't see. **Anti-targets:** committed tests asserting the OLD single-session behavior must be enumerated by file:line and inverted/deleted (the trap that bit prior epics).

## 6. Placement & ordering
- New epic below `---STOP---`. **Mobile is blocked on F1**, so prioritize it: propose placing this epic (or at least F1) **before** the durability epic (Phases 60–63). Coherent renumbering of unstarted phases is fine.
- The **durability epic (Phases 60–63, notes 23/24/25/26/30) is unaffected** — do not touch it (note 23's root-keyed markers are already consistent with root-as-addressable).

## 7. Self-containment (mandatory)
The implementing agent reads ONLY its own spec note + current code — never another note. Inline every signature/shape/error-code/line-ref the note's code actually touches; verify each against source. `[[links]]` are breadcrumbs only; the note must implement with links unfollowed.

## 8. Hard rules
- English; **do not commit**; do NOT implement code (roadmap + spec notes only).
- `mind_api/proto/` is the single source of truth — if F1's surfacing needs a proto field, that is a real contract change to flag (consumers copy + regenerate; mobile-facing).
- Don't touch shipped bio-timeline notes (`02`–`15`) or the durability epic except to renumber phases coherently. Never hand-craft migration timestamps (none expected here).

## 9. Report back
List: the epic + each task (feature + test) with its note path; **F1's surfacing sub-decision and whether it implies a proto change**; F2's keep-vs-relax choice; **F3's anti-targets by file:line**; the placement/ordering you chose. The human will review.
