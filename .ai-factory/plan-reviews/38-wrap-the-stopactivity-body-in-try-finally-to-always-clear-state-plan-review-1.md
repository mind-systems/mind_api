# Plan Review: Wrap the `stopActivity` body in `try/finally` to always clear state

**Plan:** `38-wrap-the-stopactivity-body-in-try-finally-to-always-clear-state.md`
**Files Reviewed:** 1 plan, 2 source files (`activity-engine.service.ts`, `module-state.grpc.controller.ts`)
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): WARN — not consulted in depth; the change is a localized in-method refactor with no boundary or dependency-graph impact. The Modular Monolith rules (no cross-module internals, entities owned by their module) are untouched.
- **Rules** (`.ai-factory/RULES.md` present): PASS — no rule conflicts. The change introduces no non-null assertions, no new logging (so no sensitive-data or log-leanness concern), and does not touch gRPC `@Payload()`/`@GrpcCurrentUser()` parameter wiring.
- **Roadmap** (`.ai-factory/ROADMAP.md` present): WARN — the plan body contains no explicit milestone linkage. This is a `fix`-class hardening change; consider noting the corresponding roadmap item for traceability. Non-blocking.
- **Skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): absent — no project-specific review overrides to apply.

## Verification Against Codebase

The plan's assumptions were checked against the actual source:

- **Line references are accurate.** `stopActivity` spans lines 197–246. The two early-guard branches (`if (!state)` warn + return at 199–204; `findOne` not-found delete + return at 208–214) exist exactly as described. The `repo.save` is at 218, the `activitySessionStore.delete(userId)` is at 228, and `return saved` is at 245. The `try` boundary the plan proposes (`session.status = SessionStatus.INTERRUPTED` at 216 through `return saved`) is correct.
- **Caller `handleSessionRevoked` is correctly characterized** (`module-state.grpc.controller.ts:182–198`). It resolves `sessionId` via `getActiveSession(...)` *before* calling `stopActivity` (line 184–185), wraps the call in try/catch, and emits `SessionEvents.REVOKED` from its own catch when `sessionId !== null` (line 193–194). `closeAll` runs unconditionally afterward (line 197). The plan's claim that this path is unaffected by the change holds — `stopActivity` still throws the same error, only now the in-memory entry is cleared first.
- **Second caller is also safe.** `handleActivityStop` (`module-state.grpc.controller.ts:316–331`) calls `stopActivity` and is itself invoked from `routeCommand`, which wraps dispatch in try/catch (line 205–225). A propagated `repo.save` error continues to surface there; the only behavior change is the now-cleared store entry — which is exactly the intended fix.
- **No test breakage.** `activity-engine.service.spec.ts` contains no `stopActivity`/`INTERRUPTED` assertions, and `module-state.grpc.controller.spec.ts` mocks `stopActivity` wholesale. The `Testing: no` setting is consistent — happy-path behavior is byte-for-byte identical, so existing suites remain green.

## Correctness Notes

- **Ordering inside `try` is preserved.** Because `repo.save` (218) precedes the stream push (220–226) and the `SessionEvents.INTERRUPTED` emit (236–243), a save failure short-circuits both before they run — so the `finally` will not emit a contradictory INTERRUPTED event on a failed finalize. This matches the plan's stated intent.
- **`finally` no-op on the not-found branch is harmless.** The plan correctly leaves the `findOne` not-found branch's explicit `delete` + `return` in place. Since that branch returns before entering the proposed `try`, the `finally` never runs for it — and even if it did, deleting an absent key is a no-op (`Map.delete`). No double-delete concern.
- **Intentional REVOKED-stats omission is sound.** A failed finalize produces no terminal DB row (`repo.save` rejected), so there is nothing to aggregate. The plan explicitly documents this as by-design, which is the right call.

## Critical Issues

None.

## Suggestions (Non-blocking)

- Consider a one-line `logger.error`/`logger.warn` inside the proposed `try`'s implicit failure path is *not* needed here — the caller (`handleSessionRevoked`) already logs the failure, and `handleActivityStop` surfaces via `routeCommand`'s catch. Adding logging in `stopActivity` would duplicate and violate the "keep logs lean" rule. The plan's `Logging: minimal` (effectively none added) is correct — keep it that way.

## Positive Notes

- Minimal, surgical change with a precisely scoped `try` boundary that deliberately excludes the early guards.
- Plan demonstrates real codebase verification: caller behavior, error propagation, and the deliberate stats omission are all reasoned through rather than assumed.
- The phantom-session-on-fast-reconnect failure mode is correctly addressed at the right layer (in-memory store cleanup), without over-engineering (no transaction wrapping, no compensating event).

PLAN_REVIEW_PASS
