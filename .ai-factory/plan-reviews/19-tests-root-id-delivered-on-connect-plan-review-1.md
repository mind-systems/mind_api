# Plan Review — Tests: root id delivered on connect (plan 19)

**Plan reviewed:** `.ai-factory/plans/19-tests-root-id-delivered-on-connect.md`
**Target file:** `src/realtime/module-state.grpc.controller.spec.ts`
**Feature under test:** note 34 (`34-deliver-root-id-on-connect.md`); test spec note 31.
**Risk Level:** 🔴 High

## Summary

The plan is unusually careful: every `file:line` anchor it cites is accurate against the
current spec/controller, the RED-now/compile-now strategy (forward-reference proto field via
`as any` cast) is sound, the ordering assumptions match note 34, and the single-file scope and
cross-epic coordination with note 28 are correctly captured.

However, there are **two issues that defeat the plan's core promise** — that the target/inverted
tests flip from RED to GREEN the moment feature 34 lands. As written, they would **not** flip green.
Both must be fixed before implementation.

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): test-only change, single spec file, no module
  boundary or dependency impact. No issues.
- **Rules** (`.ai-factory/RULES.md`): "NEVER use non-null assertion `!`" is primarily a production
  rule, and the existing spec already uses `!` (e.g. `values[0].sessionState!`). New code in the
  plan uses optional chaining (`values[0]?.sessionState?.…`) — good. **WARN:** keep new assertions
  on `?.` and avoid introducing fresh `!` to stay aligned. Non-blocking.
- **Roadmap**: this is the test half (note 31) of the generic session-data-flow epic; linkage to
  notes 31/34 is explicit. No issue.

## Critical Issues

### 1. 🔴 The `is_root` discriminator assertion reads the wrong property name — tests stay RED forever

The plan (Constraints, Tasks 2/3/4/5/6) repeatedly instructs:

> Assert the discriminator via cast `(frame.sessionState as any).is_root === true`

This is wrong. ts-proto generates **camelCase** field names. Confirmed in the current generated
stub (`proto/generated/module_state.ts`): `moduleSessionId`, `isPaused` — not `module_session_id`,
not `is_paused`. So feature 34's `optional bool is_root = 4` becomes **`isRoot`** on the generated
TS type, and note 34's emission code literally writes the camelCase key:

```ts
// note 34, Part 2 — the actual runtime object the subscriber receives
subscriber.next({
  sessionState: { moduleSessionId: root.id, status: ActivityStatus.ACTIVE, isRoot: true },
});
```

In a **unit test** the controller's Observable emits this JS object directly to the test
subscriber — there is no gRPC wire serialization, so the object keeps its camelCase key `isRoot`.
Therefore `(frame.sessionState as any).is_root` reads a property that never exists → always
`undefined` → `undefined === true` is `false`. Every target/inverted test that depends on the
discriminator (Tasks 2, 3, 4, 5, 6) would remain **RED even after feature 34 lands**, breaking the
entire RED→GREEN handoff this milestone exists to provide.

The cast `(frame.sessionState as any)` correctly solves the *compile-time* concern (the typed
`StateEvent` has no `isRoot` yet). But once cast to `any`, the assertion must use the **runtime
property name**, which is camelCase.

**Fix:** replace every `(frame.sessionState as any).is_root` with
`(frame.sessionState as any).isRoot`. Apply to the Constraints block and Tasks 2, 3, 4, 5, 6.

> Note: this error originates upstream in note 31 (§Test cases, §Proto coupling, which also say
> `is_root`). Note 34 — the authoritative source on what gets emitted — uses `isRoot`. The notes
> contradict each other; note 34 is correct. Flag the note 31 wording too, but the plan is the
> actionable artifact and must use `isRoot`.

### 2. 🔴 Anti-target enumeration is incomplete — the whole command-routing block also shifts

The plan (and note 31's anti-target list) enumerates only the **five reconnect-path** tests inside
`describe('trackActivity — reconnect path')`. But feature 34 emits the root frame after
`ensureRoot` resolves on **every** connect that reaches `:154` — including a plain
`handleReconnect → null` fresh connect.

The `describe('trackActivity — command routing')` block (spec lines ~616–1080) sets up its streams
via `setupRoutingStream()`, which uses the **default** `handleReconnect → null` and the default
`ensureRoot → makeSession()` (id `session-1`). So after feature 34, **every** routing test receives
a leading root frame at `values[0]` *before* the command is even sent:

- e.g. happy-path ActivityStart asserts `values[0]?.sessionState?.moduleSessionId === 'new-session'`
  (spec :713) — after feature 34 `values[0]` is the root frame (`session-1`, ACTIVE, `isRoot:true`)
  and the ACTIVE command response is at `values[1]`. Test breaks.
- the RATE_LIMIT / INVALID_ACTIVITY_TYPE / ActivityEnd / ActivityStop / Pause / Resume /
  INVALID_COMMAND / INTERNAL_ERROR cases all assert `values[0]` and shift by one (~25–30 tests).
- "continue routing after INTERNAL_ERROR" asserts `values).toHaveLength(2)` (spec :1073) → becomes 3.

These are currently GREEN and **stay GREEN today** (feature absent), so the plan's *immediate*
acceptance (RED targets, GREEN do-not-touch, compiles) is technically met. But they go **RED the
moment feature 34 lands**, directly contradicting the plan's stated contract ("turn GREEN only
after feature note 34 lands") and note 34 §82/§90's claim that *all* anti-targets are enumerated and
inverted in note 31. This is a latent break, not a clean handoff.

**Fix options (pick one, document it):**
- **Preferred — single harness change:** in `setupRoutingStream()` (and confirm
  `setupConnectedStream()`), after the `await flushMicrotasks()` that completes setup, drain the
  leading root frame so routing-test indices stay stable — e.g. clear it from `values`
  (`values.length = 0`) or filter out the `isRoot` frame. One change covers the whole block. Still
  single-file; modifies an existing helper rather than adding a new harness.
- Or explicitly re-index each routing test (noisier, ~30 edits).
- At minimum, the plan must **acknowledge** the command-routing block as an anti-target and assign
  the work, rather than leaving it as a surprise RED for feature 34.

Note: the `trackActivity — stream teardown` block also uses `setupConnectedStream()` and flows
through `ensureRoot`, but those tests assert only registry/order calls, not `values` content — so
they are unaffected. The `setup error` block rejects before `:154` and is also unaffected. The gap
is specifically the command-routing block.

## Minor Issues / Nits

- **🟡 `flushMicrotasks` depth.** Feature 34 adds a second sequential `await` (`ensureRoot`) before
  the root emit. The existing helper drains 3 microtasks and today passes with a single pre-emit
  await. Three flushes should still cover two sequential awaits, but the implementer should confirm
  the inverted/target tests actually reach GREEN under `flushMicrotasks(3)` when feature 34 lands
  (the plan forbids changing the helper — if 3 is insufficient this constraint conflicts). Verify,
  don't assume.
- **🟢 Line-cite nit (Task 7).** The closed-subscriber test (`:235-270`) stays length 0 because the
  subscriber is closed *before* `handleReconnect` resolves, so the earliest guard that fires is the
  `if (subscriber.closed) return;` at controller **`:126`** (right after the reconnect await), not
  `:153`. The plan/note cite `:153`. The conclusion (stays GREEN) is correct; only the cited line is
  slightly off. Trivial.
- **🟢 Root frame status is `ACTIVE`** (note 34 §81), identical to a child `activity:start` frame.
  The plan correctly never identifies the root by status — only by `moduleSessionId` / `isRoot`.
  Good; just make sure no added assertion accidentally over-constrains the root frame's status.

## Positive Notes

- Every `file:line` anchor (controller `:153/:154`, spec `:152/:167/:196/:209/:273/:288/:298/:311/
  :316/:336/:346/:347`) verified accurate against the current files.
- The forward-reference strategy (assert delivery via the existing `moduleSessionId`, assert the
  discriminator via an `as any` cast to keep the RED test compiling) is exactly right — only the
  property name is wrong (Issue 1).
- Ordering assumptions (`[RESUMED, ROOT]`, `[ABANDONED, ROOT]`, root frame is last on reconnect
  paths) match note 34 §53 precisely.
- Cross-epic coordination with note 28 (the `:152-174` RESUMED test also being a pause-integrity
  anti-target) is explicitly captured.
- Single-file scope, no production/proto/migration changes, commit split — all clean.

## Verdict

Do not implement as written. Fix Issue 1 (camelCase `isRoot`) — without it the milestone produces
permanently-RED tests — and resolve Issue 2 (enumerate/handle the command-routing anti-targets, or
drain the root frame in the shared helper) before proceeding.
