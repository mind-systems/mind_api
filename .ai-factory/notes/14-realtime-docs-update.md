# Update realtime docs to the root/child model

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The realtime documentation describes the old single-session model where bio lives under the active activity. After the refactor it must describe the root timeline + overlapping child activities, the windowed time-join, lazy root creation, session_id addressing, idempotency, and stats exclusion.
- Docs in `docs/` are written in **Russian** ([[feedback_docs_language]]); describe behavior, not code; no file trees; current state only.

## Details

### Files to revise — `mind_api/docs/realtime/`
- `overview.md` — root as the continuous bio timeline; children as overlapping intervals; one root + N concurrent children per user (drop "one session per user").
- `session-lifecycle.md` — root lifecycle vs child lifecycle; lazy root creation; per-session grace; children survive in-app navigation.
- `instruction-model.md` — instructions stay per-child; bio no longer under the activity.
- `biometric-stream.md` — bio binds to the root; `session_id` = root id; flush on root lifecycle; `NO_ROOT_SESSION` / `SESSION_MISMATCH` semantics.
- `database.md` — `module_sessions.rootSessionId` + `root` activityType; bio `moduleSessionId` → root; time-join is `(rootSessionId, ts ∈ [child.startedAt, child.endedAt])`.
- `protocol.md` — `session_id` on state commands; `client_activity_id` idempotency token; concurrent `activity:start`.
- `stats/stats.md` — root excluded from streak/duration.

### Guards / gotchas
- Match neighboring docs' Russian and section style.
- No "See Also" footers / prev-next nav / file trees (global doc rules).
- Describe the implemented current state only — no migration narrative or "was changed" history (that lives in commits).

### Verify
- Each doc reflects the shipped behavior from notes [[02-root-session-schema]] through [[11-migration-backfill-roots]].

## Open Questions
- None.
