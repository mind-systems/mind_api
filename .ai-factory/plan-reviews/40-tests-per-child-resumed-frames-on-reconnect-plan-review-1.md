## Code Review Summary

**Files Reviewed:** 1 plan (`40-tests-per-child-resumed-frames-on-reconnect.md`), cross-checked against `src/realtime/module-state.grpc.controller.spec.ts`, `src/realtime/module-state.grpc.controller.ts`, `proto/generated/module_state.ts`, and spec notes 44/45.
**Risk Level:** 🟡 Medium

This is a test-only plan (no production code, no migration, no proto change). It is well-grounded overall — line references are accurate, the mock-default rationale is correct, and the "no inversion needed" claim is verified against HEAD. Two of the new target cases, however, are under-specified in a way that would make them **never go GREEN** (or fail) even after the feature ships, defeating the RED→GREEN contract.

### Context Gates
- **Architecture** (`ARCHITECTURE.md`): OK. Test-only change to an existing spec file inside the `realtime` module; no module boundary crossed, no new dependency introduced.
- **Rules** (`RULES.md`): OK. The plan introduces no non-null assertion (`!`), no sensitive-data logging, and touches no gRPC method signatures. (The existing `capturedSubscriber!` in the committed spec is pre-existing test code, out of scope.)
- **Roadmap** (`ROADMAP.md:149`): OK — milestone "Tests: per-child RESUMED frames on reconnect" matches the plan 1:1. Governing feature spec `notes/45` and test spec `notes/44` both present and consistent with the plan. The feature sibling (`ROADMAP.md:150`) confirms the controller will call `listChildren(userId)` unconditionally in the resumed branch, which the mock default (Task 1) correctly anticipates. Linkage is complete.

### Critical Issues

**1. Task 3, "single live child" case — missing `handleReconnect` override; the case stays RED forever, never GREEN.**
The plan's second bullet specifies only `listChildren.mockReturnValue([makeLiveChild({ sessionId: 'child-1' })])` and omits any `handleReconnect` setup. The shared factory defaults `handleReconnect: jest.fn().mockResolvedValue(null)` (`module-state.grpc.controller.spec.ts:30`). The controller only enters the resumed branch — the *only* place `listChildren` is consulted — under `if (result !== null)` … `else` (`module-state.grpc.controller.ts:156,168`). With `result === null`, the branch is skipped entirely, `listChildren` is never called, and **zero** frames are emitted. `expect(values).toHaveLength(1)` therefore fails both before the feature (RED, as intended) and *after* it lands (still RED) — so the case can never turn GREEN and would be flagged as a permanently-failing test.
*Fix:* this case must explicitly set `activityEngine.handleReconnect.mockResolvedValue(makeSession())` (exactly as the "two live children" bullet does). Add this to the plan text so the implementer does not rely on inference — each `it` gets a fresh `beforeEach` factory, so the two-children override does not carry over.

**2. Task 3, optional "ABANDONED unaffected" case — missing `clientSessionId` argument; asserts a frame that is never emitted.**
The plan says: `handleReconnect.mockResolvedValue({ abandoned: true })` … "assert exactly the ABANDONED frame is emitted." But the abandoned branch guards with `if (!clientSessionId) return;` (`module-state.grpc.controller.ts:158`) *before* emitting. The committed `(b)` ABANDONED case gets its frame only because it calls `controller.trackActivity(request$, user, 'client-session-id')` (spec `:320`). The plan's optional case omits the third `clientSessionId` argument, so the branch returns early, emits **no** frame, and `values` has length 0 — the "exactly the ABANDONED frame is emitted" assertion fails.
*Fix:* pass a `clientSessionId` (e.g. `controller.trackActivity(request$, user, 'client-session-id')`) in this case, mirroring the committed ABANDONED cases. The `expect(activityEngine.listChildren).not.toHaveBeenCalled()` half is correct regardless. (This case is explicitly optional, so it does not block, but as written it would misfire.)

### Non-blocking Notes
- **String→proto mapping is sound (no issue).** The `makeLiveChild` fixture carries string `activityType: 'breath'`/`'meditation'`, while assertions use `ActivityType.BREATH (1)`/`MEDITATION (2)`. Verified this is correct: the feature reads `child.activityType` and runs it through `mapInternalActivityType` (`module-state.grpc.controller.ts:75`), which maps the internal enum string values (`BREATH='breath'`, `MEDITATION='meditation'`) to proto `1`/`2`. `ActivityState.activityType` and `mapInternalActivityType`'s input are the same internal type, so no cast is needed and the emitted frame carries the proto enum the assertions expect.
- **`toMatchObject({ isPaused: false })` works in-memory (no issue).** Although proto `optional bool` drops `false` on wire encoding, the emitted `values` entries are the raw in-memory literals passed to `subscriber.next` (never serialized), so `isPaused: false` is present and matches. The plan's insistence on always setting `isPaused` explicitly in fixtures is nonetheless the right guard.
- **Line references all accurate** against HEAD: `makeActivityEngine()` `:28-50`, reconnect describe `:156`, `(a)` `:159-183`, `(b)` `:189-214`, `moduleSessionId` `:216-234`. Task 1's additive mock default and Task 4's by-inspection characterization check are correct and need no change.

### Positive Notes
- Correctly identifies and preempts the loud `TypeError: listChildren is not a function` that the feature would otherwise trigger across every reconnect-path test — the mandatory mock default (Task 1) is the right, minimal fix.
- The "no inversion needed" analysis is independently confirmed: the feature's narrow design leaves the zero-children fallback byte-for-byte unchanged, so the committed `(a)`/`(b)`/`moduleSessionId` cases (which never populate `listChildren`) legitimately stay GREEN on the `[]` default.
- Good foot-gun guard: requiring explicit `isPaused` on every child fixture, and forbidding a `listChildren` override on the fallback cases to prove that path is untouched.
- The optional ABANDONED-hoisting guard (`listChildren` never called before the `'abandoned' in result` check) is a genuinely valuable regression trap for the feature implementation.

Address issue #1 (and ideally #2) before implementation — both are one-line additions to the plan text, but without them the target cases do not demonstrate the RED→GREEN transition the milestone is meant to guard.
