# Plan Review: `closeAll(userId)` after a watchdog reap (M2)

**Plan:** `68-closeall-userid-after-a-watchdog-reap-m2-race-hardening-on-the-residual-reap.md`
**Files Reviewed:** 1 plan + 4 source/context files
**Risk Level:** 🟢 Low

## Verification of plan claims against the codebase

Every concrete claim in the plan was checked against the actual source — all are accurate:

- **`SessionWatchdogService.sweep()` structure** (`session-watchdog.service.ts:56-90`) — confirmed. The per-row loop, the `hasLiveSubscriber` skip at **line 71** (plan cites line 71 ✓), the `try/catch` around `abandonStale` at lines 78-86, and `reaped++` at line 83 all match the plan's description.
- **`ActiveStreamRegistry` already injected** — confirmed at `session-watchdog.service.ts:29` (`private readonly activeStreamRegistry: ActiveStreamRegistry`). No new DI wiring needed, as the plan states.
- **`closeAll` already exists** — confirmed at `active-stream-registry.service.ts:38-45`. Behavior matches the plan exactly: `streams.get(userId)` → early `return` if absent (the harmless no-op case), otherwise `subscriber.complete()` for each, then `streams.delete(userId)`.
- **No-subscriber no-op claim** — confirmed: `closeAll` returns immediately when `set` is undefined, so the common DB-orphan path is a true no-op.
- **`abandonStale` finalizes via the `ABANDONED` event** (`activity-engine.service.ts:196-248`) — confirmed; it pushes the `SESSION_EVENT/ABANDONED` marker and emits `SessionEvents.ABANDONED` before returning. Placing `closeAll` *after* `abandonStale` (plan's hard requirement) correctly lets the engines flush/finalize before streams are torn down.
- **Roadmap linkage** — the plan corresponds verbatim to the open milestone at `ROADMAP.md:245` (Phase 42, M2). Scope, dependency on M1, and the "P2 fixed by M1, not M2" framing are consistent with both the roadmap entry and the spec note `54-watchdog-liveness-proxy-risks.md` §Mitigations.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** No boundary violation. The change is confined to `RealtimeModule` internals; both `SessionWatchdogService` and `ActiveStreamRegistry` live in the same module and the dependency already exists. No cross-module import introduced. — OK
- **Rules (`RULES.md`):** No violations. The plan adds no non-null assertion (`!`), logs no PII, and respects "keep logs lean" (Settings: logging minimal; the plan adds no new log line, relying on the existing `reaping`/`swept` warns). — OK
- **Roadmap (`ROADMAP.md`):** Milestone linkage present and exact (line 245). This is a `fix`-class change and is correctly tracked. — OK
- **Skill-context:** `.ai-factory/skill-context/aif-review/SKILL.md` not present — no project-specific review overrides to apply. — OK (informational)

## Correctness / edge-case analysis

- **Ordering is correct.** `abandonStale` → `closeAll` ensures the `ABANDONED` event-driven flush happens before the straggler's stream is completed. Reversing them would close the stream before finalization; the plan explicitly forbids that.
- **`try`-block placement is correct.** Keeping `closeAll` inside the existing `try` means a (theoretical) throw is caught by the existing `catch` and does not abort the remaining rows. `subscriber.complete()` on an rxjs `Subscriber` is effectively non-throwing, so in practice this never fires — but the defensive placement is right and costs nothing.
- **`userId`-keyed close is the intended semantics.** `closeAll` operates on all of a user's streams (registry does not record stream type). Under the one-active-session-per-user model documented in the spec note (§M1), the straggler is reconnecting to the same session being reaped, so closing all of that user's streams is correct and is the explicitly-accepted decision from M1. No new concern introduced by M2.
- **No DB/proto/migration impact.** The change is purely in-memory stream lifecycle; the plan correctly states no schema/migration is required. Confirmed — `closeAll` touches only the in-memory `Map`.

## Minor observations (non-blocking, no action required)

- The plan offers a small placement choice ("before `reaped++` or immediately after it"). Either is functionally identical since both are inside the same `try` after `abandonStale` resolves. Recommend placing it **after** `reaped++` so the counter reflects a successful reap even in the (impossible-in-practice) event `closeAll` throws — purely cosmetic.
- No new log line is added, consistent with "logging: minimal." The existing per-reap `warn` (line 79) and the summary `warn` (line 89) already give enough observability; the connect-during-sweep race is rare enough that a dedicated log would mostly be noise. This is a reasonable choice, not a gap.

## Positive Notes

- The plan is tightly scoped to a single one-line call with explicit, well-reasoned guards, and every guard maps to a real property of the code (no-op safety, ordering, exception containment).
- Excellent traceability: the plan, the roadmap milestone, and the spec note agree on the precise failure mode (connect-during-sweep straggler getting `NO_SESSION` on an open stream that never closes) and the precise fix.
- Correctly distinguishes M1 (the actual P2 fix) from M2 (race cleanup), avoiding the common trap of over-claiming what this change does.

No missing steps, wrong assumptions, architectural mistakes, missing migrations, security issues, or incorrect file paths/API usage were found.

PLAN_REVIEW_PASS
