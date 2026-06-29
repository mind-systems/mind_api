# Plan: Update realtime docs to root/child model

## Context
The realtime docs (`docs/realtime/*`) and `docs/stats/stats.md` still describe the old one-session-per-user model where bio data lives under the active activity. This milestone rewrites them to the shipped continuous-bio-timeline model: a lazy **root** session as the bio timeline, overlapping **child** activities that slice it by time window, `session_id`-addressed commands, `client_activity_id` idempotency, and root exclusion from stats.

## Settings
- Testing: no
- Logging: minimal
- Docs: yes

## Conventions (apply to every task)
- **Language: Russian.** All edited docs are in Russian — match neighboring tone and section style.
- **Behavior, not code.** Describe what the system does, not method signatures, field tables copied from code, or class lists.
- **Current state only.** No migration narrative, no "было/стало", no "раньше bio жил под активностью". History lives in commits.
- **Remove forbidden sections.** Delete every `## See Also` footer and any prev/next nav. Do **not** add file trees (the existing ASCII session/scale diagrams in `instruction-model.md` are conceptual illustrations, not file trees — they may stay if rewritten to the new model, but prefer prose).
- **Grounded terminology (verified in code):**
  - Root activity type is `root` (server-internal; not in proto `ActivityType`).
  - `module_sessions.rootSessionId` is nullable; root rows have `rootSessionId = null`, children point at their root. FK → `module_sessions(id)` `ON DELETE CASCADE`.
  - Bio time-join: `bio WHERE rootSessionId = R AND ts ∈ [child.startedAt, child.endedAt]`; analytics resolves bio owner as `In([sessionId, session.rootSessionId])`.
  - Bio ingest errors: `NO_ROOT_SESSION` (no root for user), `SESSION_MISMATCH` (batch `session_id` ≠ root id). The old `NO_SESSION` for bio is gone.
  - State command routing: `session_id` selects the child; fallback to the sole child; more than one child with no `session_id` → `AMBIGUOUS_SESSION`.
  - Idempotency token: `client_activity_id` on `activity:start`, short-window `(userId, client_activity_id) → sessionId` dedup.
  - Empty-root janitor TTL key: `WS_EMPTY_ROOT_TTL_MS`; a root is reaped only when it has **zero children** (bio alone does not protect it).

## Tasks

### Phase 1: Core model docs

- [x] **Task 1: Rewrite overview to root timeline + overlapping children**
  Files: `docs/realtime/overview.md`
  Replace the "one connection / one session per user" framing with the two-level model: the **root** session is the continuous "app is open" bio timeline, created lazily on the first meaningful event of a state-stream connection; **child** sessions (breath, meditation) are flat, overlapping intervals overlaid on that timeline and no longer own bio. State the new invariant: one root + N concurrent children per user (drop "одна сессия на пользователя"). Keep the transport-vs-session split and the layer descriptions, but adjust in-memory state wording to reflect the per-user `{ rootSessionId, children: Map<sessionId, …> }` structure and per-`sessionId` grace timers (describe behavior, not the literal type). Remove the `## See Also` footer.

- [x] **Task 2: Rewrite session-lifecycle for root vs child lifecycles** (depends on Task 1)
  Files: `docs/realtime/session-lifecycle.md`
  Distinguish **root lifecycle** from **child lifecycle**: lazy root creation on connect (idempotent — reconnect resumes the existing root, never duplicates); the root goes `disconnected`→`abandoned` on grace like a child but is never closed via `activity:end`; empty roots are reaped later by the janitor. Children are created by `activity:start`, carry `rootSessionId`, and have independent per-`sessionId` grace timers so concurrent activities and in-app navigation don't cross-cancel. Note that the singleton "повторный activity:start возвращает текущую сессию" guard is gone — a repeat is now deduped by `client_activity_id`, while a genuinely new `activity:start` opens a second concurrent child. Keep states table, reconnect, pause-in-memory, stop/end, and server-restart recovery, updated so recovery abandons both roots and children.

- [x] **Task 3: Update instruction-model — instructions stay per-child, bio off the activity** (depends on Task 2)
  Files: `docs/realtime/instruction-model.md`
  Keep the core idea (instruction stream is the log of what the app told the user) and keep instructions bound to the **child** session (`session_id` = child id, `session_stream_samples` per child). Remove the claim that bio is joined to the activity by `moduleSessionId`; instead state that bio lives on the root and is correlated to a child by the time window `[child.startedAt, child.endedAt]`. Rewrite or replace the ASCII "two timescales" / `ModuleSession` container diagrams as prose describing the windowed time-join across the root timeline. Remove the `## See Also` footer.

### Phase 2: Bio + schema + protocol docs

- [x] **Task 4: Rewrite biometric-stream — bio bound to the root** (depends on Task 3)
  Files: `docs/realtime/biometric-stream.md`
  State that bio binds to the **root** session: `session_id` in each batch must equal the root id (obtained server-side, not a child id), samples are buffered per-root and persisted with the root's id. Replace acceptance rules: a batch is accepted while the root is live; reject with `NO_ROOT_SESSION` when the user has no root and `SESSION_MISMATCH` when the batch `session_id` is not the root id (e.g. a child id) — drop the old `NO_SESSION`/active-child gating. Flush triggers fire on **root** lifecycle (`abandoned`, `revoked`) plus the periodic timer and shutdown; child completion no longer carries bio. Keep batch consistency rules, pause semantics, backpressure/ack. Update the "связь с инструкционным потоком" section: one root + N children, bio read by `rootSessionId` and sliced per child by time window.

- [x] **Task 5: Rewrite database doc for rootSessionId + windowed join** (depends on Task 4)
  Files: `docs/realtime/database.md`
  In `module_sessions`: add the `root` value to `activityType` (mark it server-internal, not exposed in proto) and document the nullable `rootSessionId` column (root rows null; children reference their root; FK `ON DELETE CASCADE`; indexed). In `bio_session_samples`: state that `moduleSessionId` now points at the **root** session, not the activity, and describe the time-join as `(rootSessionId, ts ∈ [child.startedAt, child.endedAt])` rather than `(moduleSessionId, timestamp)` against the child. Keep `session_stream_samples` bound to the child. Update `user_stats` only if needed for consistency (root never produces a qualifying session — detail lives in stats.md).

- [x] **Task 6: Update protocol doc — session_id routing + idempotency** (depends on Task 5)
  Files: `docs/realtime/protocol.md`
  Document the optional `session_id` on `activity:end/stop/pause/resume` (selects the target child; fallback to the sole child; `AMBIGUOUS_SESSION` when multiple children and no `session_id`) and the optional `client_activity_id` on `activity:start` (short-window idempotency so a retried start returns the same child instead of opening a duplicate; a new token opens a concurrent child). Note that `session:state` carries the child's `moduleSessionId`, and that bio uses the root id (cross-reference biometric-stream for `NO_ROOT_SESSION`/`SESSION_MISMATCH` without a See-Also footer). Remove the `## See Also` footer.

### Phase 3: Stats + consistency pass

- [x] **Task 7: Update stats doc — root excluded from stats** (depends on Task 6)
  Files: `docs/stats/stats.md`
  State that root sessions are excluded from all statistics: a root abandoned on grace emits the abandonment event but is skipped by the stats worker, so it never affects `totalSessions`, `totalDurationSeconds`, streak, or complexity, and never appears in run history. Keep the qualifying-session threshold, streak rules, smoothing formula, and config. Adjust the internal-architecture description to mention the root early-return (behavior, not code).

- [x] **Task 8: Cross-doc consistency pass** (depends on Tasks 1-7)
  Files: `docs/realtime/overview.md`, `docs/realtime/session-lifecycle.md`, `docs/realtime/instruction-model.md`, `docs/realtime/biometric-stream.md`, `docs/realtime/database.md`, `docs/realtime/protocol.md`, `docs/stats/stats.md`
  Final sweep across all seven files: verify terminology is consistent (root vs child, `rootSessionId`, windowed time-join, error codes, `client_activity_id`), no residual single-session wording ("одна сессия на пользователя", bio under the activity, `(moduleSessionId, timestamp)` join against the child), every `## See Also` footer removed, no prev/next nav, no new file trees, and all prose in Russian. Confirm `configuration.md` and `biometric-aggregation.md` (out of scope) aren't contradicted — touch only if a direct contradiction with the new model exists.
  **Exhaustive per-file claim audit (not just touched sections):** ground-truth EVERY behavioral assertion in each file against the real code path, including stale carry-over sentences the rewrite did not visit. Two known traps to verify, not assume: (a) the server does NOT filter/block instruction samples (`breath_phase`) during pause — `module-instruction-stream.grpc.controller.ts` has no `isPaused`/phase filter; pause acceptance is client-owned and the server only stamps `paused`/`resumed` markers (must agree with biometric-stream.md, no contradiction). (b) The "N concurrent children" model is a bio-timeline property — the instruction stream resolves its target via the sole active child (`getSoleChild`, undefined when >1); do not imply instructions route among several overlapping children by `session_id`.

## Commit Plan
- **Commit 1** (after tasks 1-3): "Update realtime core docs to root/child timeline model"
- **Commit 2** (after tasks 4-6): "Rewrite realtime bio, database, and protocol docs for root sessions"
- **Commit 3** (after tasks 7-8): "Exclude root from stats docs and reconcile realtime docs"
