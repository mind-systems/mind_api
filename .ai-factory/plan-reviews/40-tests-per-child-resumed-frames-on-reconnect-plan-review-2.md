## Code Review Summary

**Files Reviewed:** 1 plan (`40-tests-per-child-resumed-frames-on-reconnect.md`), cross-checked against `src/realtime/module-state.grpc.controller.spec.ts`, `src/realtime/module-state.grpc.controller.ts`, `src/realtime/interfaces/activity-state.interface.ts`, `proto/generated/module_state.ts`, spec notes 44/45, `ROADMAP.md`, and plan-review-1.
**Risk Level:** 🟢 Low

This is a test-only plan (no production code, no migration, no proto change). It edits a single committed spec file to add a mandatory shared mock default plus new RED target cases for the per-child-RESUMED feature (spec 45). Round 2: **both critical issues from plan-review-1 are now resolved in the plan text**, and every line reference and API claim re-verifies against HEAD.

### Context Gates
- **Architecture** (`ARCHITECTURE.md`): OK. Additive test-only change inside the `realtime` module; no module boundary crossed, no new dependency, no `@InjectRepository` reach across modules. `listChildren` is reached only through the `ActivityEngine` delegate (feature 45), consistent with the engine owning the store — the mock default anticipates that correctly.
- **Rules** (`RULES.md`): OK. No non-null assertion introduced, no sensitive-data logging, no gRPC method-signature change. Fixtures set `isPaused` explicitly (guard against the proto `optional bool` foot-gun).
- **Roadmap** (`ROADMAP.md:149`): OK. Milestone "Tests: per-child RESUMED frames on reconnect" maps 1:1 to the plan. Governing feature spec `notes/45` and test spec `notes/44` are both present and consistent. The feature sibling (`ROADMAP.md:150`) confirms the controller will call `listChildren(userId)` in the resumed branch and preserve the zero-children fallback byte-for-byte — which the plan's Task 1 mock default and Task 4 "no inversion" claim correctly anticipate. Linkage complete.

### Critical Issues
None.

### Verification of plan-review-1 fixes
- **Issue #1 (single-live-child case must set `handleReconnect`)** — RESOLVED. Task 3 bullet 2 (plan `:35`) now states explicitly: the case **must** set `activityEngine.handleReconnect.mockResolvedValue(makeSession())`, with the correct rationale (the shared factory defaults `handleReconnect` to `null` at spec `:30`; the resumed branch — the only place `listChildren` is consulted — is entered only when `result !== null` at controller `:156`/`:168`; without the override the case stays RED forever and never turns GREEN). Confirmed accurate against `module-state.grpc.controller.spec.ts:30` and `module-state.grpc.controller.ts:154-183`.
- **Issue #2 (ABANDONED case needs the `clientSessionId` third arg)** — RESOLVED. Task 3 bullet 3 (plan `:36`) now instructs `controller.trackActivity(request$, user, 'client-session-id')`, citing the `if (!clientSessionId) return;` guard (controller `:158`) and matching the committed ABANDONED cases (spec `:320`, `:367`, which pass `'client-session-id'`). Verified correct — in a direct controller call the third positional arg populates the `@GrpcMetadataValue`-decorated `clientSessionId` parameter.

### Line-reference & API re-verification (all accurate against HEAD)
- `makeActivityEngine()` factory `:28-50` ✓; `handleReconnect` defaults to `mockResolvedValue(null)` at `:30` ✓; adding `listChildren: jest.fn().mockReturnValue([])` is purely additive.
- `describe('trackActivity — reconnect path')` starts `:156` ✓; `(a)` `:159-183` ✓ (asserts length 1, `getSession` undefined → `isPaused: false`); `(b)` `:189-214` ✓; `moduleSessionId` case `:216-234` ✓.
- Proto `ActivityType.BREATH = 1`, `MEDITATION = 2` (`module_state.ts:25-26`) ✓ — matches the plan's mapping assertions.
- `ActivityState` fields `{ sessionId, activityType, isPaused }` confirmed (`activity-state.interface.ts`), so `makeLiveChild`'s `{ sessionId, activityType, isPaused }` shape is exactly what the feature reads (`child.sessionId`/`child.isPaused`/`child.activityType`) — no cast needed, `isPaused` is a required boolean.
- String→proto mapping sound: feature runs `child.activityType` ('breath'/'meditation' = internal enum values) through `mapInternalActivityType` (`:75-92`) → proto `1`/`2`, which the assertions expect.
- ABANDONED-hoisting guard (`expect(activityEngine.listChildren).not.toHaveBeenCalled()`) is a valid regression trap — the abandoned branch (`:157-167`) returns before the resumed `else` where `listChildren` is consulted.

### Non-blocking Notes
- `toMatchObject({ isPaused: false })` works because emitted `values` entries are the raw in-memory literals passed to `subscriber.next` (never wire-serialized), so `false` is present — the plan's insistence on always setting `isPaused` explicitly in fixtures is still the right guard.
- Frame-count assertions are safe: after the per-child loop the setup calls `ensureRoot` (mocked, no emission) and subscribes to an empty `Subject`, so `values` holds exactly the per-child frames — the committed `(a)` case confirms this single-emission flow under the same `flushMicrotasks()` vantage.
- The optional ABANDONED reinforcement case is explicitly marked optional and, with the `clientSessionId` fix, now fires correctly — no longer a misfire.

### Positive Notes
- The mandatory shared mock default (Task 1) correctly preempts the loud `TypeError: listChildren is not a function` the feature would otherwise trigger across every reconnect-path test — the minimal, additive fix.
- "No inversion needed" is independently re-confirmed: the feature leaves the zero-children fallback byte-for-byte unchanged, so `(a)`/`(b)`/`moduleSessionId` (which never populate `listChildren`) legitimately stay GREEN on the `[]` default.
- Strong RED→GREEN discipline: the n=1 case distinguishes the new per-child loop from the zero-children fallback, and each new fixture pins `isPaused` and `handleReconnect` explicitly, relying on `beforeEach`'s fresh factory rather than cross-case bleed.
- Both plan-review-1 findings were folded into the plan text as concrete, grounded instructions rather than left to implementer inference.

PLAN_REVIEW_PASS
