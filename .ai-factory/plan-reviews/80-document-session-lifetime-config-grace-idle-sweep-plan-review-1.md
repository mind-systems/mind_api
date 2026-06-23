# Plan Review: Document session-lifetime config (grace / idle / sweep)

**Plan:** `80-document-session-lifetime-config-grace-idle-sweep.md`
**Scope:** Documentation only — add two env vars + a keep-alive note to `docs/realtime/configuration.md`
**Risk Level:** 🟢 Low

## Verification against codebase

Every factual claim in the plan was checked against source:

| Claim | Source of truth | Result |
|-------|-----------------|--------|
| `WS_RECONNECT_GRACE_MS` default `30000` | `src/realtime/services/activity-session-store.service.ts:5,14-16` (`DEFAULT_GRACE_MS = 30_000`, key `'WS_RECONNECT_GRACE_MS'`); `.env`, `.env.dev`, `.env.prod` all set `30000` | ✅ Correct |
| `WS_SESSION_MAX_IDLE_MS` default `600000` | `src/realtime/services/session-watchdog.service.ts:32-35` (fallback `600_000`); `realtime-config.ts:12` maps key → `'WS_SESSION_MAX_IDLE_MS'` | ✅ Correct |
| `WS_SESSION_SWEEP_INTERVAL_MS` default `60000` | `session-watchdog.service.ts:36-39` (fallback `60_000`); `realtime-config.ts:13` | ✅ Correct |
| `hasLiveSubscriber` guard keeps session alive | `session-watchdog.service.ts:71-76` — `if (this.activeStreamRegistry.hasLiveSubscriber(row.userId)) { ... continue; }` | ✅ Correct |
| Reap condition = status ACTIVE/DISCONNECTED **and** `lastActivityAt < threshold`, unless live subscriber | `session-watchdog.service.ts:56-76` | ✅ Accurately described |
| Doc is Russian, table-style, `WS_RECONNECT_GRACE_MS` already present | `docs/realtime/configuration.md:5-7` | ✅ Confirmed — the new rows fit the existing table |
| Env var names ≠ `RealtimeConfig` keys | `realtime-config.ts` — keys are `SESSION_MAX_IDLE_MS`; *values* are the `WS_`-prefixed strings | ✅ Constraint is correct; plan documents the right (`WS_`) names |

The line references in the plan resolve correctly once the directory is supplied (`src/realtime/services/`); the line numbers `32-39` and `71` are exact.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md` present):** No boundary impact — documentation-only change, no module dependency or layering effect. **PASS.**
- **Rules (`.ai-factory/RULES.md` present):** Plan honors the project convention that `docs/` is written in Russian (CLAUDE.md / auto-memory `feedback_docs_language.md`) and explicitly requires Russian descriptions. No "no code change" rule is at risk. **PASS.**
- **Roadmap (`.ai-factory/ROADMAP.md` present):** `WARN` (non-blocking) — the plan carries no explicit roadmap milestone linkage. Acceptable for a pure-docs task, but worth a one-line reference if this maps to a tracked milestone.

## Findings

### Critical Issues
None.

### Minor / Non-blocking

1. **`WARN` — Imprecise file paths in Constraints.** The plan cites `session-watchdog.service.ts:32-39` and `activity-session-store.service.ts` without the `src/realtime/services/` prefix. Line numbers are accurate, so this won't mislead the implementer, but the full path would remove a lookup step.

2. **`WARN` — Existing `## See Also` section already links `session-lifecycle.md`.** Task 2 asks for an inline prose link to `[Жизненный цикл сессии](session-lifecycle.md)`; the doc already lists that link under `## See Also` (`configuration.md:26`). This is fine (inline contextual link + footer link can coexist), just be aware it's not net-new — avoid implying the link is missing.

3. **Editorial claim is sound but opinionated.** Task 2's framing that grace is "mostly moot" because keep-alive holds the stream connected is consistent with the code (a live subscriber bypasses the watchdog entirely, and the grace timer governs a different path — transport disconnect in `activity-engine.service.ts:456`). No correction needed; just keep the wording descriptive rather than prescriptive.

## Positive Notes

- Defaults, env-var names, and the guard mechanism were all pinned to exact code locations before planning — no fantasy values.
- Correctly distinguishes the env-var string (`WS_SESSION_MAX_IDLE_MS`) from the `RealtimeConfig` constant key (`SESSION_MAX_IDLE_MS`), a subtle trap the plan calls out explicitly.
- Scope discipline is strong: a clear "no code/behavior change" constraint, an explicit list of files not to touch, and a Verify step asserting nothing under `src/` changed.
- No migration is required, and none is proposed — correct for a docs-only change.
- Russian-language requirement matches established project convention.

## Conclusion

The plan is accurate, well-scoped, and safe to execute. All defaults and code references check out; the only notes are non-blocking polish items. No missing steps, no wrong assumptions, no architectural or security concerns.

PLAN_REVIEW_PASS
