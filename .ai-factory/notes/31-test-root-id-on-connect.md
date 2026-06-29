# Test plan — root id delivered on connect (T1, silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context (handoff 06-generic-session-data-flow, test philosophy)

Covers feature task [[34-deliver-root-id-on-connect]]. Committed **RED until** spec 34.

## Why this area (silent-failure filter)
The bug is silent: `setup()` calls `ensureRoot(userId)` and **discards** the result (`module-state.grpc.controller.ts:154`), so a fresh-connect client silently never learns its root id — no error, no crash, just a missing frame. The mobile client then cannot tag bio/root marks. That is the highest-value silent gap. The `is_root` proto field addition itself is a **loud**, additive change (proto/codegen) and is not separately unit-tested per the silent-bug-first scope — but the target *asserts* the discriminator value the emission sets (see §Proto coupling).

## Inlined `StateEvent` shape (self-contained)
Today (`proto/module_state.proto`): `message StateEvent { string module_session_id = 1; ActivityStatus status = 2; optional bool is_paused = 3; }`. Feature [[34-deliver-root-id-on-connect]] adds `optional bool is_root = 4;` and regenerates the stub (`isRoot?: boolean` on the generated TS type). Emission shape on the subscriber: `subscriber.next({ sessionState: { moduleSessionId, status, isPaused?, isRoot? } })`.

## Red/Green contract
- **Target (RED until [[34-deliver-root-id-on-connect]]):** on connect, after `ensureRoot` resolves, the controller emits one `session:state` carrying the **root id** (`ensureRoot`'s `.id`). Mock-visible at the subscriber: today nothing is emitted on a fresh connect → clean RED; after spec 34 the root frame appears → GREEN.
- **Characterization (stay GREEN):** the resumed-child RESUMED frame still carries the child id and `isPaused:false`; the subscriber-closed-mid-setup guard still emits nothing; the request observable is still subscribed only after `setup()` resolves.

## Two-state observability (validated at authoring)
- **Vantage:** push every `StateResponse` into a `values[]` array on a real subscriber driving `controller.trackActivity(request$, user)`, then `await flushMicrotasks()` (the existing `flushMicrotasks` helper drains the async `setup()`). The root emission lands in `values` exactly where the feature's `subscriber.next` physically fires (controller `:154`) — the mock sees it.
- **RED now:** fresh connect (`handleReconnect → null`) emits nothing → `values` has no root frame.
- **GREEN after:** `values` contains a `session:state` with `moduleSessionId === ensureRoot().id`.
- The mock already returns a root: `activityEngine` mock has `ensureRoot: jest.fn().mockResolvedValue(makeSession())` (`spec :31`). Pin the resolved id (e.g. `makeSession({ id: 'root-1' })`) so the target can assert `moduleSessionId === 'root-1'`.

## Instantiation
`ModuleStateGrpcController` with mocked `ActivityEngine` (`handleReconnect`, `ensureRoot`, `startActivity`, …), `RateLimiterService`, `ActiveStreamRegistry`, `ConfigService`, `EventEmitter2` — exactly the existing `spec` harness (`module-state.grpc.controller.spec.ts` beforeEach). Drive `trackActivity(request$, user[, clientSessionId])`, collect `values[]`, `await flushMicrotasks()`.

## Test cases
### Target (RED until 34)
- **fresh connect emits the root id** — `handleReconnect → null`, `ensureRoot → makeSession({id:'root-1'})`; after flush, `values` contains a `session:state` with `moduleSessionId === 'root-1'`. (Today `values.length === 0` → RED.)
- **root frame is distinguishable from a child by `is_root`** — assert the root frame carries `is_root === true`; a child/start frame's `is_root` is falsy. Distinction is by the field, **never** by frame ordering. Compile-now (L2): access via cast — `(frame.sessionState as any).is_root === true` — since the generated stub gains `isRoot` only when spec 34 regenerates; the cast keeps the test compiling and RED-for-feature-absent now, GREEN once spec 34 lands.
- **resumed-child reconnect also announces the root** — `handleReconnect → makeSession({id:'resumed'})`; after flush `values` is `[RESUMED(resumed), ROOT(root-1)]` — assert a root-id frame follows the RESUMED frame.

### Characterization (stay GREEN)
- subscriber closed before `ensureRoot` resolves → still no emission (guard at controller `:153`).
- request$ subscribed only after `setup()` resolves.
- RESUMED frame still `{ status: RESUMED, isPaused:false, moduleSessionId: <child> }` as `values[0]`.

## Proto coupling (keep the target compile-clean)
The discriminator `is_root` is an **additive proto change** owned by spec 34 (`StateEvent.is_root = 4`, locked). The generated stub gains `isRoot` only when spec 34 regenerates, so a RED-committed test that referenced `frame.sessionState.isRoot` directly would fail to **compile** (loud), not fail RED. Keep it compile-now (L2): assert the **delivery** via the existing `moduleSessionId` field, and assert the **discriminator** via a cast — `(frame.sessionState as any).is_root === true`. Both compile against today's generated `StateEvent`, are RED while the emission is absent, and flip GREEN when spec 34 lands. This mirrors how the durability notes treat proto/enum additions as forward-references rather than coupling the RED test to a not-yet-generated symbol. The proto field addition itself is loud/additive and is not separately unit-tested.

## Anti-targets (committed connect-path tests — INVERT, by file:line)
Spec 34 adds **one** connect emission, shifting `values[]` length/index in `src/realtime/module-state.grpc.controller.spec.ts`. These currently-GREEN cases must be inverted to expect the extra root frame:
- **`:196-212`** "should not emit any StateResponse during setup when handleReconnect returns null" — asserts `values.toHaveLength(0)` → **INVERT** to length 1, the frame being the root id. (This is also the primary positive target above.)
- **`:298-314`** "(c) … null and no clientSessionId" — `values.toHaveLength(0)` → **INVERT** to length 1 (root frame).
- **`:152-174`** RESUMED test — `:167 expect(values).toHaveLength(1)` → **INVERT** to length 2 (`[RESUMED, ROOT]`); the `values[0]` RESUMED assertion (`:168`) stays.
- **`:273-295`** "(b) … ABANDONED with clientSessionId" — `:288 expect(values).toHaveLength(1)` → **INVERT** to length 2 (`[ABANDONED, ROOT]`); the `values[0]` ABANDONED assertion stays.
- **`:316-351`** "(d) stream stays open after abandoned emit" — re-index: `:336` length 1→2 (`[ABANDONED, ROOT]`), `:346` length 2→3, and the ACTIVE start frame moves from `values[1]` (`:347-348`) to `values[2]`. **INVERT/re-index**.

**Keep GREEN (do NOT touch):** `:176-194` (asserts `values[0]` only, no length); `:214-233` (subscribe ordering); `:235-270` (subscriber closed → length 0, guard prevents the root frame).

**Cross-epic collision — `:152-174`:** this case is **also** an anti-target in the durability test note [[28-test-pause-state-integrity]] (which inverts its hardcoded `isPaused: false` assertion at `:169-171`). The generic epic is above `---STOP---` and lands **first** (this note inverts the `:167` length 1→2). Whichever epic lands second reconciles against the first's already-applied change — here, note 28 must layer its `isPaused` inversion on top of the length-2 `[RESUMED, ROOT]` shape this note establishes. Do not otherwise touch the durability epic.

## Findings
- The root announce is emitted at controller `:154`, **after** the reconnect-result block, so on resume/abandon paths it is the **last** frame, not the first — the anti-target re-indexing above accounts for that ordering. If spec 34 instead emits before the reconnect block (not recommended), re-pin the ordering here first.
