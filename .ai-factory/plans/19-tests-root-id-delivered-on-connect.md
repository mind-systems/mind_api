# Plan: Tests — root id delivered on connect

## Context
Add RED-until-feature tests that guard the silent gap where `setup()` discards `ensureRoot`'s result (`module-state.grpc.controller.ts:154`), so a fresh-connect client never learns its root id; and invert/re-index the existing connect-path tests whose `values[]` length/index shifts once the controller emits one extra root frame on connect. All work is in one spec file — no production code, proto, or migration changes.

## Settings
- Testing: yes (this milestone *is* the test characterization)
- Logging: none
- Docs: no

## Constraints (must hold)
- **Single file:** every change lives in `src/realtime/module-state.grpc.controller.spec.ts`. Do NOT touch `module-state.grpc.controller.ts`, the proto, or the generated stub.
- **RED-committed, must compile:** the new target tests assert the not-yet-implemented behavior, so they FAIL now (`npx jest src/realtime/module-state.grpc.controller.spec.ts`) and turn GREEN only after feature note 34 lands. They must still **compile** today — `tsc` / `npm run build` must pass.
- **Proto field is a forward-reference, accessed by its RUNTIME (camelCase) name.** The generated `StateEvent` does not yet have the field, so reference it via cast `(frame.sessionState as any).isRoot === true` — never `frame.sessionState.isRoot` directly (would fail to compile = loud, not RED). **The property name is `isRoot`, NOT `is_root`.** ts-proto generates camelCase (the current stub has `moduleSessionId` / `isPaused`, confirmed in `proto/generated/module_state.ts:99,101`), and feature 34's emission writes the literal JS key `isRoot: true`. In a **unit** test the controller's Observable hands that JS object straight to the test subscriber — no gRPC wire serialization — so the runtime key stays `isRoot`. Asserting `(… as any).is_root` would read an always-`undefined` property and the test would stay RED *forever*, even after feature 34 lands. The `as any` cast solves only the compile-time concern; once cast to `any`, the assertion must use the runtime name `isRoot`.
  - *Upstream wording flag (non-blocking for this plan):* note 31 (§Test cases, §Proto coupling) says `is_root`; note 34 — the authoritative source on what is emitted — uses `isRoot`. Note 34 is correct. This plan uses `isRoot` throughout; note 31's wording should be corrected separately.
- **Distinction by field, never by ordering:** root vs child is decided by `isRoot`, not by position in `values[]`.
- **Root frame status is `ACTIVE`** (note 34 §81) — identical to a child `activity:start` frame. Never identify the root by status; only by `moduleSessionId` / `isRoot`. Do not add assertions that over-constrain the root frame's status.
- **Locate tests by their `it(...)` description, not by raw line number** — adding the new target tests shifts every line below them. The line numbers in this plan are anchors against the *current* file only.

## Tasks

### Phase 1: Add RED target tests (root id on connect)

- [x] **Task 1: Pin the mock root id and add the fresh-connect target test**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Inside the `describe('trackActivity — reconnect path', ...)` block, add a new test `it('should emit a session:state carrying the root id on a fresh connect (RED until feature 34)', ...)`. Setup: `activityEngine.handleReconnect.mockResolvedValue(null)` and `activityEngine.ensureRoot.mockResolvedValue(makeSession({ id: 'root-1' }))`. Drive `controller.trackActivity(request$, user)`, collect into `values: StateResponse[]`, `await flushMicrotasks()`. Assert `values` contains a `sessionState` frame with `moduleSessionId === 'root-1'` (e.g. `values.some(v => v.sessionState?.moduleSessionId === 'root-1')`). Today `values.length === 0` → RED. Use the existing `makeSession`/`flushMicrotasks` helpers; do not introduce new harness.

- [x] **Task 2: Add the `is_root` discriminator test** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Add `it('should distinguish the root frame from a child by isRoot === true (RED until feature 34)', ...)`. Same fresh-connect setup as Task 1 (`handleReconnect → null`, `ensureRoot → makeSession({ id: 'root-1' })`). After flush, locate the `root-1` frame and assert `(frame.sessionState as any).isRoot === true`. Add a companion assertion that a non-root frame's `isRoot` is falsy (e.g. drive an `activityStart` ACTIVE frame, or assert the property is falsy on a child frame in another path) to document that the discriminator is the field, not the ordering. Cast access only, runtime name `isRoot` — never `frame.sessionState.isRoot` (uncast).

- [x] **Task 3: Add the resumed-child-also-announces-root test** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Add `it('should announce the root id after the RESUMED frame on a resumed-child reconnect (RED until feature 34)', ...)`. Setup: `handleReconnect → makeSession({ id: 'resumed' })`, `ensureRoot → makeSession({ id: 'root-1' })`. After flush assert `values` is the two-frame sequence `[RESUMED(resumed), ROOT(root-1)]`: `values[0]?.sessionState` matches `{ status: ActivityStatus.RESUMED, moduleSessionId: 'resumed' }`, and a following frame carries `moduleSessionId === 'root-1'` with `(… as any).isRoot === true`. Root announce fires at controller `:154` *after* the reconnect block, so it is the **last** frame — assert the root frame **follows** RESUMED.

### Phase 2: Invert / re-index existing connect-path anti-targets

- [x] **Task 4: Invert the two null-connect "no emit" assertions** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Both currently assert `expect(values).toHaveLength(0)` on a `handleReconnect → null` path and will break once the root frame is emitted:
  - `it('should not emit any StateResponse during setup when handleReconnect returns null', ...)` (currently `:196-212`, asserts length 0 at `:209`).
  - `it('(c) should not emit any StateResponse when handleReconnect returns null and no clientSessionId is provided', ...)` (currently `:298-314`, length 0 at `:311`).
  Invert each to expect exactly **one** frame, the root id: pin `ensureRoot → makeSession({ id: 'root-1' })`, assert `values.toHaveLength(1)` and `values[0]?.sessionState?.moduleSessionId === 'root-1'` (with `(values[0]?.sessionState as any)?.isRoot === true`). Update each test's description to reflect "emits the root frame on connect". These stay RED until feature 34.

- [x] **Task 5: Re-index the RESUMED and ABANDONED two-frame paths** (depends on Task 4)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  - RESUMED test (currently `:152-174`): change `expect(values).toHaveLength(1)` (`:167`) to length **2** for `[RESUMED, ROOT]`; **keep** the `values[0]` RESUMED `toMatchObject` assertion (`:168-171`) unchanged; add an assertion that the trailing frame carries the root id (`ensureRoot` resolved id `root-1`) with `(… as any).isRoot === true`.
  - ABANDONED test `(b)` (currently `:273-295`): change `expect(values).toHaveLength(1)` (`:288`) to length **2** for `[ABANDONED, ROOT]`; **keep** the `values[0]` ABANDONED `toMatchObject` assertion unchanged; add an assertion that the trailing frame carries the root id (`ensureRoot` resolved id `root-1`) with `(… as any).isRoot === true`.
  Pin `ensureRoot` to a fixed id (`makeSession({ id: 'root-1' })`) in both. RED until feature 34.
  **Cross-epic note:** the RESUMED test `:152-174` is also an anti-target in note 28 (pause-state-integrity). This plan lands first and establishes the length-2 `[RESUMED, ROOT]` shape; note 28 must later layer its `isPaused` inversion on top of that shape. Do not otherwise touch the durability epic here.

- [x] **Task 6: Re-index the "stream stays open after abandoned emit" test** (depends on Task 5)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test `(d)` (currently `:316-351`). The connect emits `[ABANDONED, ROOT]` before the `activityStart`, so every count and index shifts by one:
  - `expect(values).toHaveLength(1)` (`:336`) → length **2**; keep the `values[0]` ABANDONED status assertion.
  - After `activityStart`, `expect(values).toHaveLength(2)` (`:346`) → length **3**.
  - The ACTIVE start frame moves from `values[1]` to `values[2]`: update `:347-348` (`values[1]` → `values[2]`) for both the `status === ACTIVE` and `moduleSessionId === 'new-session'` assertions.
  Pin `ensureRoot → makeSession({ id: 'root-1' })`; optionally assert the root frame at `values[1]`. RED until feature 34.

- [x] **Task 7: Drain the leading root frame in the command-routing harness** (depends on Task 6)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  The `describe('trackActivity — command routing', ...)` block (~spec `:639`–`:1080`) builds every stream via `setupRoutingStream()` (`:623`), which connects with the **default** `handleReconnect → null` and default `ensureRoot → makeSession()` (id `session-1`). After feature 34 lands, that connect emits a leading root frame, so every routing test's `values[0]` assertion (happy-path ActivityStart `moduleSessionId === 'new-session'` at `:713`, plus the RATE_LIMIT / INVALID_ACTIVITY_TYPE / ActivityEnd / ActivityStop / Pause / Resume / INVALID_COMMAND / INTERNAL_ERROR cases, and the `toHaveLength(2)` at `:1073`) would silently go RED — a latent break, since these are *not* targets of this milestone. Fix at the single harness seam: in `setupRoutingStream()`, after the `await flushMicrotasks()` that completes setup, drain the connect-phase frame(s) so command-routing indices stay stable — `values.length = 0;` before returning. This is RED→GREEN-neutral: today `values` is already empty (no connect emit), so the reset is a no-op; after feature 34 it drops the root frame and the routing tests keep their existing `values[0]` semantics. Add a one-line comment explaining why. **Do NOT** add the drain to `setupConnectedStream()` (`:436`) — those tests (stream-teardown block) assert only `activeStreamRegistry`/`handleTransportDisconnect`/`evict` call order, never `values` content, so they are unaffected; leave that helper as-is.

- [x] **Task 8: Confirm the do-not-touch cases remain unchanged and compile/run** (depends on Task 7)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Verify these are left exactly as-is — they do not assert `values` length, or the closed-subscriber guard fires before `ensureRoot`, so they stay GREEN: `it('should include the resumed session id as moduleSessionId ...')` (`:176-194`, asserts `values[0]` only — survives because the RESUMED frame is still `values[0]`), `it('should subscribe to the request observable after handleReconnect resolves', ...)` (`:214-233`), and `it('should not emit RESUMED when subscriber.closed is already true ...', ...)` (`:235-270`, length 0 — the `if (subscriber.closed) return;` guard at controller **`:126`**, right after the reconnect await, returns before `ensureRoot` at `:154` is ever reached).
  Then: run `npm run build` (must compile — cast-based `isRoot` access only, optional chaining throughout, no fresh `!`) and `npx jest src/realtime/module-state.grpc.controller.spec.ts`. Expected now (feature absent): the target/inverted tests (Tasks 1-6) are **RED**, every do-not-touch and characterization test is **GREEN**, the routing block stays GREEN (drain is a no-op today). **Verify the flush depth holds for the post-34 GREEN path:** feature 34 adds a second sequential `await` (`ensureRoot`) before the root emit, and the existing `flushMicrotasks(times = 3)` (`:74`) must still drain past it. Three flushes cover two sequential awaits, so the default should suffice — confirm by reasoning through the await chain (`handleReconnect` → `ensureRoot` → `subscriber.next`); the plan forbids changing the helper, so if 3 proves insufficient, flag it for feature note 34 rather than editing the helper here.

## Commit Plan
- **Commit 1** (after tasks 1-3): "Add RED tests for root id delivered on connect"
- **Commit 2** (after tasks 4-8): "Invert connect-path tests for extra root frame on connect"
