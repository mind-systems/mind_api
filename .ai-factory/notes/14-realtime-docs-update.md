# Update realtime docs to the root/child model

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The realtime documentation describes the old single-session model where bio lives under the active activity. After the refactor it must describe the root timeline + overlapping child activities, the windowed time-join, lazy root creation, session_id addressing, idempotency, and stats exclusion.
- Docs in `docs/` are written in **Russian** — confirmed: `docs/realtime/overview.md:1` ("# Realtime — Обзор архитектуры") and `docs/stats/stats.md:1` ("# Статистика пользователя") are Russian ([[feedback_docs_language]]). Describe behavior, not code; no file trees; current state only.

## Details

### Files to revise (verified to exist; absolute paths)
- `/Users/max/projects/mind/mind_api/docs/realtime/overview.md` — root as the continuous bio timeline; children as overlapping intervals; one root + N concurrent children per user (drop "one session per user").
- `/Users/max/projects/mind/mind_api/docs/realtime/session-lifecycle.md` — root lifecycle vs child lifecycle; lazy root creation; per-session grace; children survive in-app navigation.
- `/Users/max/projects/mind/mind_api/docs/realtime/instruction-model.md` — instructions stay per-child; bio no longer under the activity.
- `/Users/max/projects/mind/mind_api/docs/realtime/biometric-stream.md` — bio binds to the root; `session_id` = root id; flush on root lifecycle; `NO_ROOT_SESSION` / `SESSION_MISMATCH` semantics.
- `/Users/max/projects/mind/mind_api/docs/realtime/database.md` — `module_sessions.rootSessionId` + `root` activityType; bio `moduleSessionId` → root; time-join is `(rootSessionId, ts ∈ [child.startedAt, child.endedAt])`.
- `/Users/max/projects/mind/mind_api/docs/realtime/protocol.md` — `session_id` on state commands; `client_activity_id` idempotency token; concurrent `activity:start`.
- `/Users/max/projects/mind/mind_api/docs/stats/stats.md` — root excluded from streak/duration.

> Sibling docs not in scope but present in the same dir: `configuration.md`, `biometric-aggregation.md` — review only if the refactor touches their content.

### Guards / gotchas
- Match neighboring docs' Russian and section style.
- No "See Also" footers / prev-next nav / file trees (global doc rules).
- Describe the implemented current state only — no migration narrative or "was changed" history (that lives in commits).

### Verify
- Each doc reflects the shipped behavior from notes [[02-root-session-schema]] through [[11-migration-backfill-roots]].

## Open Questions
- None.
