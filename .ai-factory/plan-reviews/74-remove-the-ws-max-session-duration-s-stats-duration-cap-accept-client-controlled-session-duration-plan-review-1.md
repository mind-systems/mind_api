# Plan Review — Remove `WS_MAX_SESSION_DURATION_S` stats duration cap

**Plan:** `74-remove-the-ws-max-session-duration-s-stats-duration-cap-accept-client-controlled-session-duration.md`
**Risk Level:** 🟢 Low

## Summary

The plan reverts the 4h `WS_MAX_SESSION_DURATION_S` cap added to `StatsService.finalise` during the Phase 47 review, accepting client-controlled duration as a documented property. Every claim was verified against the live source: all file paths, field names, constructor reads, the skip block, the two spec cases, the env/mock wiring, both doc tables, and both note-57 sections exist exactly as the plan describes. The plan is accurate, internally consistent, correctly scoped, and implementable as written. Two advisory refinements below — neither blocks implementation.

## Context Gates

- **Architecture** (`ARCHITECTURE.md` present): no boundary impact. Change is confined to the `StatsModule` chokepoint (`StatsService.finalise`); no module reaches into another's internals. **OK.**
- **Rules** (`RULES.md` present): the plan removes the skip-block log line, consistent with lean-logging and the plan's `Logging: minimal` setting. No non-null assertions, sensitive logging, or gRPC-decorator concerns touched. **OK.**
- **Roadmap** (`ROADMAP.md` present): the plan maps 1:1 to the open Phase 47 task at `ROADMAP.md:275` ("Remove the `WS_MAX_SESSION_DURATION_S` stats duration cap"). Linkage is explicit; the `Spec:` pointer to `.ai-factory/notes/59-remove-max-session-duration-cap.md` matches. The stated dependency (preceding Phase 47 `client_timestamp_ms` task) is satisfied — that task is `[x]` (`ROADMAP.md:273`). **OK.**

## Critical Issues

None.

## Advisory / Non-blocking

1. **Task 2 leaves an empty `describe` block.** The two cap cases the plan removes (`stats.service.spec.ts:115` and `:124`) are the *only* members of their enclosing block `describe('finalise — absurd duration skipped (client-timestamp abuse guard)', …)` (lines 114–139). Removing just the two `it` cases leaves an empty `describe` — harmless but it shows as an empty group in the test report. The implementer should also remove the whole enclosing `describe` block. (Implied by "remove the two cap cases," worth stating explicitly.)

2. **Task 3 prose edits in `stats.md` are implied but unnamed.** "Restore the Квалифицирующие сессии block to min-only form" reasonably covers them, but two concrete edits make it unambiguous:
   - Line 53: `(по умолчанию: 10 .. 14400)` → `(по умолчанию: 10)`.
   - Line 56: delete the trailing sentence "Сессии длиннее верхнего порога (4 часа) также игнорируются: …" (the upper-bound rationale), leaving only the min-filter explanation.
   The table-row removal (`stats.md:86`) and the formula change (`stats.md:52`) are already correctly specified.

## Verified Correct

- **Task 1** — `stats.service.ts`: field `maxSessionDurationS` (line 23), constructor read (lines 35–38), and the `durationSeconds > this.maxSessionDurationS` skip block incl. its log line (lines 57–62) all exist exactly as described. Min filter (lines 50–55) and streak/`todayUtc()` logic are independent and correctly left untouched.
- **Task 2** — all named spec hooks exist: `process.env.WS_MAX_SESSION_DURATION_S = '14400'` (line 73), the `delete` (line 81), the `maxDurationS = 14_400` param (line 86), and the `if (key === 'WS_MAX_SESSION_DURATION_S')` mock branch (line 96). No other `makeService(…, secondArg)` callers exist beyond the two cap tests, so dropping the param is safe.
- **Task 3** — `configuration.md:9` row and `stats.md:86` row both present; `stats.md:52` formula present. Docs are Russian — plan preserves the convention.
- **Task 4** — note 57's "Downstream stats consequence" section (lines 43–47) and the settled-decision cap bullet (line 72, "Any future milestone in this domain inherits the cap") both exist and are correctly identified for reversal/supersession by note 59.
- **No migration needed** — confirmed; `user_stats` schema is untouched. Plan's guard is correct.
- **No missed references** — repo-wide grep for `WS_MAX_SESSION_DURATION_S` / `maxSessionDurationS` / `maxDurationS` returns only the four files the plan edits, the spec notes (57/59), the plan itself, plus `ROADMAP.md` (the task entry — checked off, not edited, per normal workflow) and a historical `reviews/73-…` artifact (correctly left as-is). No `.env` wiring exists. Nothing actionable is missed.

## Positive Notes

- The rationale chain (vanity-stat-only blast radius, replay-doesn't-stop-inbound-inflation, silently-drops-legit-long-sessions) is sound and consistent with the existing client-clock trust model for biometrics/phase markers.
- Correctly preserves the load-bearing invariants: the `WS_MIN_SESSION_DURATION_S` min filter and the server-clocked streak logic stay untouched.
- Note 57 reversal is handled properly (supersede + cross-link to note 59) rather than silently deleted, keeping the decision history coherent.

The two advisory items are refinements an implementer would likely handle anyway; they do not block implementation. The plan is sound.

PLAN_REVIEW_PASS
