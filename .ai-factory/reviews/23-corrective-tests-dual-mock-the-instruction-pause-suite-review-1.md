# Code Review: Corrective tests — dual-mock the instruction pause suite

**Plan:** `23-corrective-tests-dual-mock-the-instruction-pause-suite.md`
**Scope of changes:** `src/realtime/module-instruction-stream.grpc.controller.spec.ts` (test-only), plus AI-factory artifacts (ROADMAP checkbox, plan, plan-review, sidecar JSON).
**Risk Level:** 🟢 Low — characterization test edit, no production code touched.

## What changed

In `describe('streamData — pause pass-through')`, the three cases that push a `breath_phase` sample (`:113`, `:135`, `:159`) each had their single seed:

```ts
activityEngine.getActiveSession.mockReturnValue(makePausedSession({ sessionId }));
```

replaced by a shared fixture wired to both resolvers:

```ts
const paused = makePausedSession({ sessionId });
activityEngine.getActiveSession.mockReturnValue(paused);
activityEngine.getSession.mockReturnValue(paused); // a3 resolver, keyed by (userId, sessionId)
```

No behavioral assertions were altered. The factory, the ready-frame case (`:183`/`:185`), and the ownership target cases (`:247-`) were left untouched — matching the plan's "do not touch" fencing exactly.

## Correctness analysis

- **GREEN under the current controller.** `module-instruction-stream.grpc.controller.ts:78` resolves via `getActiveSession(userId)`. The dual seed returns the paused fixture whose `sessionId === 'session-1' === msg.sessionId`, so the `!session` (`:80`) and `session.sessionId !== msg.sessionId` (`:91`) guards both pass, `streamEngine.push` is called (`:102`), and an `ack` is emitted (`:109`). The extra `getSession` stub is never called today — harmless, no side effects.
- **GREEN after the a3 swap.** When the controller switches to `getSession(userId, msg.sessionId)`, the newly added stub returns the same paused fixture with matching `sessionId`, so the same push/ack path holds. The invariant "pause never blocks ingest" survives both resolver mechanisms — exactly the two-state guarantee a characterization fix requires.
- **`mockReturnValue` vs `mockImplementation`.** Each case uses a single `sessionId` and the fixture's `sessionId` matches `msg.sessionId`, so the unconditional `mockReturnValue` is sufficient and would still pass any future `session.sessionId !== msg.sessionId` echo guard. Note 38 (`:34`) explicitly sanctions this simpler form.
- **No type issues.** `makePausedSession` returns `as any`; both mocks accept it. No `!` non-null assertions introduced (RULES.md compliant). No logging, no migrations, no security surface.

## Test verification

Ran `npx jest src/realtime/module-instruction-stream.grpc.controller.spec.ts`:

- **8 passed** — including all three edited pause cases, the untouched ready-frame case, batch hygiene, and authentication.
- **3 failed** — exclusively the `streamData — ownership routing (target, RED until note 36)` cases (`:247-`). These are intentionally RED until the a3 controller swap lands (note 36) and are explicitly out of scope per Task 2. Their failure is expected, not a regression.

The characterization suite stays GREEN; no pause pass-through case regressed.

## Findings

None. The change is minimal, correctly scoped, faithful to the plan and note 38, and verified against both the current and post-a3 resolver behavior.

REVIEW_PASS
