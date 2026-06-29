# Code Review: Drop the bio echo-match; store under the server-resolved root

**Plan:** `25-drop-the-bio-echo-match-store-under-the-server-resolved-root.md`
**Scope reviewed:** `git diff HEAD` + `git status` (full)
**Verdict:** 🟢 No findings — clean

## Changes reviewed

Code change (one file):
- `src/realtime/module-biometric-stream.grpc.controller.ts` — deleted the 8-line "Step 6" echo-match block (`if (root.id !== batch.samples[0].sessionId) { emitError(SESSION_MISMATCH, …); return; }`) from `handleBatch`. Nothing else changed.

Non-code changes:
- `.ai-factory/ROADMAP.md` — phase a2 task flipped `[ ]` → `[x]`.
- New artifacts under `.ai-factory/` (plan, plan-review, `.json` sidecar). Not application code.

## Correctness

- **Diff matches the plan exactly.** Only Step 6 was removed; Steps 1–5, the happy path, the ack shape, the drop-warn, and the catch block are byte-for-byte unchanged. No method renamed, no DI/ctor change, no engine/flush touched.
- **Read the file in full (162 lines).** Control flow after removal is sound: hygiene guards (1–4) → `ensureRoot` + `NO_ROOT_SESSION` guard (5) → map → `pushBatch(root.id, mapped)` → ack `sessionId: root.id`. The deleted branch sat strictly between the `NO_ROOT_SESSION` guard and the happy path; removing it changes no other branch's reachability.
- **No dangling references.** `WsErrorCode` is still imported and used at line 120 (`NO_ROOT_SESSION`), so the import is correctly retained — no unused-import lint break. `SESSION_MISMATCH`'s only reference in this file was inside the deleted block; the constant itself remains defined in `ws-error-codes.ts` and is still consumed by `module-instruction-stream.grpc.controller.ts`, so no dead-code cleanup is owed here.
- **`batch.samples[0]` access is safe.** Step 1 (`samples.length === 0`) returns early, so the deleted block's array index was guarded — and the remaining happy path only uses `.map`, which is index-safe regardless. No new null/undefined exposure.

## Runtime risk assessment

- **No migration / no proto change** — pure control-flow deletion; nothing touches schema, the wire contract, or generated stubs. Confirmed against the plan and the diff.
- **No type mismatch** — the suite is run through `ts-jest`; it compiled and executed without TS errors.
- **No race condition introduced** — deletion only; async ordering (`await ensureRoot`) is unchanged.
- **Storage routing unchanged** — bio still buffers per-root via `pushBatch(root.id, …)`; the engine/flush mechanics and pause-does-not-block-bio behavior are untouched.

## Security

Removing the echo-match is **not** a regression. Ownership is resolved entirely server-side: `userId` derives from the JWT (`user.sub`, line 55), `root` from `ensureRoot(userId)` (line 118), and storage routes through `pushBatch(root.id, …)` (line 131). The client-supplied `sessionId` was only ever compared and echoed — it never influenced storage routing. A forged/child/stale `sessionId` could not redirect another user's data before, and still cannot. The deleted check guarded nothing real, consistent with the spec's stated trade-off (bio owner is server-authoritative).

## Observation (non-blocking, intentional)

Steps 2–3 still validate the `sessionId` field (empty / inconsistent) even though `sessionId` no longer influences routing after this change. This is deliberate batch-hygiene retained by the plan and pinned GREEN by the test suite — correct to leave as-is. A future contract cleanup could drop `sessionId` from the wire entirely, but that is out of scope here.

## Test verification

Ran `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts`:

```
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

- The two inverted targets now pass: `child-id echo is accepted and stored under root` and `stale/arbitrary echo is accepted under root` (both assert `frame.error` undefined, `frame.ack.sessionId === 'root-1'`, and `pushBatch('root-1', …)`).
- Characterization cases stay GREEN: correct-root echo, `NO_ROOT_SESSION`, paused-root accept, the four `INVALID_ARGUMENT` hygiene cases, and overflow `droppedCount`. No Class-B regression.

## Conclusion

The implementation is a minimal, correct, surgical deletion that fulfills the plan and turns the pre-inverted suite GREEN with no collateral. No bugs, no security issues, no missing migration, no type or runtime hazard.

REVIEW_PASS
