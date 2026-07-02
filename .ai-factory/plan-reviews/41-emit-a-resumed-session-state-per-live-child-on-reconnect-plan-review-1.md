## Plan Review: Emit a RESUMED session:state per live child on reconnect

**Plan:** `.ai-factory/plans/41-emit-a-resumed-session-state-per-live-child-on-reconnect.md`
**Spec note:** `.ai-factory/notes/45-per-child-resumed-frames-on-reconnect.md`
**Files Reviewed:** 2 targets (`activity-engine.service.ts`, `module-state.grpc.controller.ts`) + 3 supporting sources
**Risk Level:** 🟢 Low

### Context Gates

- **Architecture (`ARCHITECTURE.md`) — OK.** The design respects the modular-monolith / "entities belong to their module" rule: the controller reaches the store **only** through a new `ActivityEngine.listChildren` delegate, never by injecting `ActivitySessionStore` directly (the controller ctor has no store dep — verified at `module-state.grpc.controller.ts:106-112`). Consistent with the existing `getSession`/`getSoleChild`/`getRootId` forwards.
- **Rules (`RULES.md`) — OK.**
  - No non-null assertion (`!`): the new code reads `child.isPaused` / `child.activityType` off a required-field interface — no force-unwrap.
  - No sensitive data in logs: the new log line emits `userId` + `count` only (IDs/outcomes), matching the existing reconnect log and note-24 convention.
  - Lean logs: exactly one log line per reconnect (`count=...`), not per-frame.
  - `@Payload()`/`@GrpcCurrentUser()` rule: no controller method signature is touched.
- **Roadmap (`ROADMAP.md`) — OK / linked.** This feature is the `[ ]` line 150 under "Reconnect fan-out — per-child RESUMED frames"; its `Spec:` note is present and consistent. Its committed test companion, task 44 (line 149, **already `[x]`**), has already added the `listChildren: jest.fn().mockReturnValue([])` default to `makeActivityEngine()` — so the TDD-first dependency the note calls out (Cross-interactions §) is **satisfied at HEAD**, not a forward risk.

### Verified Assumptions (all correct against HEAD)

- Engine insertion point: `getRootId` is at `activity-engine.service.ts:562-564`, `listLiveSessions` at `:566-570` — the new one-line delegate slots cleanly between them, mirroring the surrounding forwards.
- `activitySessionStore.listChildren(userId): ActivityState[]` exists at `activity-session-store.service.ts:116-120` and explicitly excludes root ("Returns all children").
- `ActivityState` (`interfaces/activity-state.interface.ts`) carries `sessionId`, `activityType` (internal `ActivityType`), and a **required** `isPaused: boolean` — so `child.sessionId` / `child.isPaused` / `mapInternalActivityType(child.activityType)` are all valid with no cast and no round-trip.
- `ActivityState` is already imported in the engine file (`:7`).
- Controller resumed-session `else` branch is exactly `:168-182`; ABANDONED branch `:157-167`; `subscriber.closed` guard at `:154`; `mapInternalActivityType` at `:75-92` — every line reference in the plan is accurate.
- `handleReconnect`'s return type and resume loop (`:604-640`) are correctly left untouched; the delegate is purely additive.

### Correctness / Edge-case Analysis

- **Guard consistency.** The controller reaches the `else` branch only when `result !== null`. The plan re-derives the children list at controller time via `listChildren`. This is consistent with the engine: any child whose DB row was missing during resume is removed from the store (`removeSessionFromStore` in `resumeActivity`), so it will not appear in `listChildren` — no phantom frame is emitted. Conversely, when a surviving child exists but happened not to be the last-iterated one (so `result` is the root), the new loop still emits frames for every live child — this is the intended fix, and it degrades gracefully rather than regressing.
- **No `await` in the per-child loop** is the right call: `subscriber.next` is synchronous, there is no yield point between frames, and the single `if (subscriber.closed) return;` at `:154` remains sufficient. Adding an `await` would (needlessly) reopen a mid-loop close window.
- **Root-frame suppression when children exist** is faithful to HEAD: today's `soleChildResult ?? rootResult` never announces the root when any child is live, so "preserve root frame emission" is honored by leaving the no-children fallback byte-for-byte identical rather than inventing an always-announce-root contract (which would also contradict the note-34 "no unsolicited root frame" decision).

### Critical Issues

None.

### Minor Notes (non-blocking)

- The plan/note correctly assert "no proto change, no migration." Confirmed: `StateEvent` already carries `module_session_id` / `status` / `is_paused` / `activity_type`, and the store is in-memory — nothing schema-bound is touched.
- Behavioral overlap to keep in mind (already covered by task 44's targets, not a plan defect): the new path activates at **1** live child too (not just ≥2), routing the single-child case through the loop instead of the `result`-based fallback. The note's Verify section and the roadmap test targets both call this out explicitly, so it is intended and covered.

### Positive Notes

- Exceptionally tightly grounded: every line number, type, and helper signature in the plan was verifiable against HEAD with no drift.
- Minimal, additive diff that stays inside the established module boundary (engine owns the store; controller delegates).
- The zero-children fallback is preserved verbatim, minimizing regression surface and keeping existing characterization tests green.
- Reads `isPaused` directly off the `ActivityState` (no per-child `getSession` round-trip) — simpler and correct, since `listChildren` entries already carry the field.

PLAN_REVIEW_PASS
