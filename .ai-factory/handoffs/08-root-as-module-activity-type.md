# Handoff — root as a `root`-typed module session (roadmap-editor brief)

> **Audience:** a fresh **roadmap-editor agent** for `mind_api` (`/Users/max/projects/mind/mind_api`). **Your job:** roll a confirmed architecture change into the roadmap — by **editing the OPEN feature tasks** of the generic epic and **adding NEW corrective test tasks**. You write ROADMAP contract lines + spec notes only. **You do NOT implement code. You do NOT commit.** The human reviews your output.

## 0. The hard workflow rule (read first — it shapes everything)
**Completed (`[x]`) tasks and their committed work are immutable. You may only (a) edit OPEN `[ ]` tasks, or (b) author NEW tasks.** If an already-written (committed) test must change, that change is a **NEW test task in a test phase** — never an edit to the completed task that produced it. Modifying the committed *source/spec file* is allowed **only as the deliverable of a new task**; you, the editor, only describe that task — you do not touch code/specs yourself.

Concretely here: the generic **test** tasks T1/T2/T3 (`notes/31,32,33`, roadmap `## Test coverage — generic …`, all `[x]`) are **frozen**. The generic **feature** tasks a1/a2/a3 (`notes/34,35,36`, `## Phase a1/a2/a3`, all `[ ]`) are **open and yours to rewrite**. The durability tasks (`notes/23-30`, `## Phase 60-63` + `## Test coverage — durability`, all `[ ]`, parked below the second `---STOP---`) are open.

## 1. The decision (settled — do not re-litigate)
The root session becomes **a normal module session of type `root`**, started by the client through the **same `activity:start` command** as any child. The app is "the `root` module." This replaces the previously-specced "server emits an unsolicited `is_root` frame on connect."

**Discriminator = the `activityType` enum value `root`, NOT a boolean.** Drop `is_root` entirely (a single source of truth: the session's type). Rationale the human locked: a boolean is a second source of truth over the type, and would force `false` on every child frame; `activity_type` is already sent on every `activity:start`, so the root just sends one more enum value — zero redundancy.

### Settled points
- **Client-started, idempotent by `userId`.** `activity:start { activity_type: ROOT }` → server upserts the user's root (the existing `ActivityEngine.ensureRoot(userId)` under the hood: exists → return it, absent → create) → responds `session:state { module_session_id: root.id, activity_type: ROOT, status: ACTIVE }`. Children unchanged: `activity:start { activity_type: BREATH }` → new child with `rootSessionId = root.id`.
- **No unsolicited connect frame.** The server no longer emits a root `session:state` on bare connect. The client learns `root.id` as the **response to its own `activity:start { ROOT }`**. (The defensive `ensureRoot` on a child `activity:start` stays — note 04 — so a child-first client still gets a root; but the id is delivered via the ROOT-start response.)
- **Root end is implicit.** The root ends only by grace (transport drop → grace → `abandoned`) or by the janitor (childless + idle past `WS_EMPTY_ROOT_TTL_MS` + no live subscriber). `activity:end` / `activity:stop` targeting the root id → **rejected**. The transport-drop path already covers "app closed", so no explicit root-end command.
- **Name stays `root`** (continuity with the entity, the Postgres enum, and notes 01-22). Do not rename to `app`.
- **Ownership (a2/a3) is unaffected in logic** — the root is simply an owned live session like any child; bio binds to the server-resolved root; instruction ingest accepts any owned live session. Only the *discriminator + who-starts-the-root* changes.

## 2. Proto shape (the feature task a1 implements this; you spec it in note 34)
`proto/module_state.proto`, regenerate ts-proto stubs into `proto/generated` (the note-05 regen step):
```proto
enum ActivityType {
  // existing values keep their numbers; append:
  ROOT = <next free number>;      // reverses note 02's "root is server-internal" — now client-addressable
}

message ActivityStartCmd {
  ActivityType activity_type = 1;   // ALREADY EXISTS — children use it; root sends ROOT. No new request field.
  // activity_ref_id, client_activity_id — unchanged
}

message StateEvent {
  string module_session_id = 1;
  ActivityStatus status = 2;
  optional bool is_paused = 3;
  ActivityType activity_type = 4;   // ADD (field 4, previously reserved for the dropped is_root) — discriminator on every frame
}
```
- **Drop the planned `optional bool is_root = 4`** entirely — it never ships. `activity_type` on `StateEvent` is the discriminator the client reads (`activity_type === ROOT` ⇒ this frame is the root; otherwise a child).
- Verify field 4 is free on `StateEvent` and pick the next free `ActivityType` number against the actual proto before writing. Additive, proto3-compatible.
- Mobile-facing: `mind_api/proto/` is the single source of truth; consumers (`mind_mobile`) copy + regenerate. (The mobile handoff is updated separately by the human — do not edit `mind_mobile` from here.)

## 3. What to author

### 3a. EDIT note 34 + its roadmap line (a1, OPEN) — the big rewrite
Retitle from "Deliver the root session id to the client on connect" → **"Client-started root via `activity:start { activity_type: ROOT }` + `activity_type` discriminator."** New scope:
- Proto change of §2 (ROOT enum value, `StateEvent.activity_type`, drop `is_root`), regen.
- In `module-state.grpc.controller.ts`: route `activity:start` with `activity_type === ROOT` to upsert-the-root (`ensureRoot(userId)`), respond with a `session:state` carrying `module_session_id = root.id`, `activity_type = ROOT`, `status = ACTIVE`. Children's `activity:start` path unchanged except every emitted `session:state` now also carries its `activity_type`.
- **Remove the connect-time root emission** that the old note 34 specified (the `ensureRoot` result is no longer surfaced on bare connect — it returns to being created defensively, id delivered via the ROOT-start response).
- `activity:end` / `activity:stop` with `session_id` = the root id → reject (literal error, e.g. `'CANNOT_END_ROOT'`; pick/justify the code against the controller's existing literal-string convention).
- Ground every line/signature against `module-state.grpc.controller.ts` + `activity-engine.service.ts` (`ensureRoot` at `:73`). Self-contained — inline the shapes.

### 3b. EDIT note 35 + line (a2, OPEN) — minor
Bio ownership logic is unchanged (store under the server-resolved root regardless of echo; drop the `SESSION_MISMATCH` echo check). Only update the **"how the client learns `root.id`"** references: it now comes from the `activity:start { ROOT }` response (`activity_type === ROOT`), not a connect frame.

### 3c. EDIT note 36 + line (a3, OPEN) — minor
Instruction ownership logic unchanged (`getSession(userId, sessionId)`, accept any owned live session — child or root, `SESSION_NOT_FOUND` on a miss; add the `ActivityEngine.getSession` delegate). Just align prose: the root is "an owned live session started via `activity:start { ROOT }`." Keep the existing anti-target list (`:42-46,:114,:136,:159`) — but see §3d: the actual test fix moves into a new corrective test task, so reframe note 36's anti-target section as "handled by the corrective test task," not "invert in note 33."

### 3d. ADD a NEW corrective test phase + task(s), placed **just before `## Phase a1`** (below the first `---STOP---`)
TDD-first relative to the rewritten a1/a2/a3. Because T1/T3's committed specs assert the **old** contract and their tasks are frozen, a new task re-establishes the correct RED tests. Propose `## Test coverage — root-as-activity-type (TDD, silent-bug-first)` with one task per spec file (or one combined task — your call, but enumerate both):

- **Corrective test — module-state (supersedes T1's now-wrong assertions).** In `module-state.grpc.controller.spec.ts`, the committed T1 changes assert an unsolicited root frame + `isRoot` on connect (commit `5221b38`): RESUMED case `:151-180` → `[RESUMED, ROOT]` len 2 + `isRoot`; "fresh connect emits root frame" `:201-…` len 1; `(b)` abandoned → `[ABANDONED, ROOT]`; `(c)` len 1; the three `isRoot` target cases; the `setupRoutingStream`/`:1043` `values.length = 0` drains. **All of these encode the dropped design.** The corrective task must: revert the connect emissions (fresh connect → **no** frame; RESUMED → `[RESUMED]` len 1; abandoned → `[ABANDONED]` len 1), drop every `isRoot` assertion, drop the now-unneeded connect-frame drains, and add **new targets** (RED until rewritten a1): `activity:start { activity_type: ROOT }` → one `session:state` with `activity_type === ROOT` + `root.id`; idempotent (second ROOT start, same userId → same root id, no duplicate); child frames carry their own `activity_type` (≠ ROOT); `activity:end`/`activity:stop` on the root id → rejected. Enumerate the reverts by `file:line` against the **current committed** spec.
- **Corrective test — instruction pause-suite (the T3 gap).** T3 (`e15674a`) added `getSession` to the mock factory but left the 3 pause-pass-through cases (`module-instruction-stream.grpc.controller.spec.ts:113,:135,:159`) seeding only `getActiveSession`. When a3 swaps the controller `getActiveSession → getSession`, those three lose their stub (`getSession` defaults `undefined`) → `SESSION_NOT_FOUND`, no ack → false-RED. Corrective task: make each of the 3 cases **dual-mock** — seed both `getActiveSession` **and** `getSession` with the paused session, so they stay GREEN across the swap (the invariant "pause never blocks ingest" holds under both resolution mechanisms). This is characterization that must stay GREEN, not a RED target.

### 3e. RECONCILE note 28 (durability test, OPEN) — the collision **dissolves**
Note 28's anti-target section currently layers its pause-`isPaused` inversion on top of T1's `[RESUMED, ROOT]` len-2 connect shape (a cross-epic collision). With the connect root frame **removed** (§3d), `module-state.grpc.controller.spec.ts:151-180` returns to `[RESUMED]` len 1. Update note 28: the collision is gone; its inversion is simply "the reconnect RESUMED frame at `values[0]` reports the actual `isPaused`" on the len-1 shape — no ROOT frame to reconcile against. Also record that `ActivityEngine.getSession` (note 24's pause-surfacing mechanism) is provided by a3/note 36 and that the emission must coalesce `?? false` so the existing resumed-unpaused case stays GREEN. (Note 24 is the matching feature note — update its anti-target ref the same way: post-corrective-test shape, len 1, no `isRoot`.)

## 4. Placement & ordering
- New corrective test phase + the rewritten a1/a2/a3 stay **below the first `---STOP---`** (parked) — the human pulls them up. Do **not** move anything above the first STOP (that's the frozen committed generic test phase).
- Order in the parked region: `## Test coverage — root-as-activity-type` → `## Phase a1` → `a2` → `a3`. Durability stays below the **second** `---STOP---`.
- Do not renumber the existing committed numeric phases (54-63). Generic phases stay `a1/a2/a3`.

## 5. Self-containment (mandatory)
The implementing agent reads ONLY its own spec note + current code — never another note. Inline every signature/shape/error-code/line-ref each note's code touches; verify each against source (`module-state.grpc.controller.ts`, `module-instruction-stream.grpc.controller.ts`, `module-biometric-stream.grpc.controller.ts`, `activity-engine.service.ts`, `activity-session-store.service.ts`, `proto/module_state.proto`, the two committed spec files). `[[links]]` are breadcrumbs only.

## 6. Hard rules
- English; **do not commit**; do NOT implement code (ROADMAP lines + spec notes only).
- `mind_api/proto/` is the single source of truth — the `ActivityType += ROOT` and `StateEvent.activity_type` are real additive proto changes to flag for consumer regen (mobile-facing).
- Do not touch frozen `[x]` tasks/notes (01-22, 31/32/33) or their roadmap lines. Never hand-craft migration timestamps (none expected — purely additive proto + controller logic, no schema change: the `root` activityType enum value already exists in TS + Postgres).
- Two-state observability + anti-target discipline apply to the corrective test task: every target asserts at a mock-visible vantage RED-now/GREEN-after; every reverted committed assertion is named by `file:line`.

## 7. Report back
List: each edited open note (34/35/36) with its new scope; the new corrective test phase + task(s) with note path(s) and the enumerated `file:line` reverts; note 28/24 reconciliation; the proto field numbers you chose; the root-end rejection code you chose. The human reviews.
