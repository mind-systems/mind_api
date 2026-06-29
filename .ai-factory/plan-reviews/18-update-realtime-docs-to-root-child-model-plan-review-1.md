# Plan Review: Update realtime docs to root/child model

**Plan:** `.ai-factory/plans/18-update-realtime-docs-to-root-child-model.md`
**Scope:** Documentation-only (7 files under `docs/realtime/` + `docs/stats/stats.md`)
**Risk Level:** 🟢 Low

## Summary

This is a docs-only milestone with no code, schema, or migration changes. I verified every claim in the
"Grounded terminology" block against the actual implementation. The plan is unusually well-grounded — all
the load-bearing technical assertions check out. File paths are correct, task dependencies are sequenced
sensibly, and the commit plan is coherent. Two minor accuracy notes below; neither blocks implementation.

## Verification of grounded terminology (all confirmed in code)

| Claim | Verified against | Result |
|---|---|---|
| Root activity type `root`, server-internal, not in proto | `enums/activity-type.enum.ts` has `ROOT='root'`; `proto/module_state.proto` enum has only `BREATH`/`MEDITATION` | ✅ |
| `rootSessionId` nullable, root rows null, children point at root, FK `ON DELETE CASCADE`, indexed | `entities/module-session.entity.ts` (nullable col + `@Index`); migration `1782658936664-AddRootSessionLink.ts` (FK `REFERENCES module_sessions(id) ON DELETE CASCADE` + index) | ✅ |
| Analytics bio owner resolved as `In([sessionId, rootSessionId])`; windowed join `[child.startedAt, child.endedAt]` | `sessions.service.ts:175-176` (`[session.id, session.rootSessionId]`), `:199-200` (from/to bounds) | ✅ |
| Bio errors `NO_ROOT_SESSION` / `SESSION_MISMATCH`; old `NO_SESSION` gone for bio | `module-biometric-stream.grpc.controller.ts:120,126`; `NO_SESSION` survives only in the instruction-stream controller — so "gone for bio" is precise | ✅ |
| State routing: explicit `session_id` → sole child → `AMBIGUOUS_SESSION` on multiple | `module-state.grpc.controller.ts:282-313` (`resolveTargetSession`) | ✅ |
| `client_activity_id` idempotency, `(userId, client_activity_id) → sessionId` short-window dedup | `module-state.grpc.controller.ts:336-380`; `services/activity-idempotency.store.ts` | ✅ |
| Empty-root janitor TTL key `WS_EMPTY_ROOT_TTL_MS` | `constants/realtime-config.ts:14`; `services/session-watchdog.service.ts:43` | ✅ |
| `session:state` carries the child's `moduleSessionId`; bio acks with root id | `module-state.grpc.controller.ts` (`moduleSessionId: session.id`); bio controller acks `sessionId: root.id` | ✅ |
| No outstanding migrations needed | Root link + backfill migrations already merged (`git log`: `AddRootSessionLink`, `BackfillRootSessions`, "backfill synthetic roots 1:1 + repoint bio") | ✅ |

All 8 target files exist; working tree is clean apart from the plan files themselves.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** present; docs-only change, no boundary/dependency impact. No issues.
- **Rules (`.ai-factory/RULES.md`):** present; no doc-language/structure rules that conflict with the plan. No issues.
- **Roadmap (`.ai-factory/ROADMAP.md`):** present. This is a `docs` milestone — roadmap linkage is optional for docs work; no missing-linkage concern. WARN (informational only).
- **skill-context (`aif-review/SKILL.md`):** not present — no project-specific review overrides to apply.

## Findings

### Minor — non-blocking

1. **WARN — Task 7 attributes the root-exclusion early-return to the wrong layer.**
   The plan says root sessions are "skipped by the stats worker" and to "mention the root early-return"
   in the internal-architecture description. The early-return is actually in `StatsService.finalise()`
   (`src/stats/stats.service.ts:41` → `if (event.activityType === ActivityType.ROOT) return;`), **not**
   in `StatsWorker`. The worker (`stats.worker.ts`) forwards *all* events — including the root's
   `ABANDONED` event — to `finalise()`, where the root is dropped. The described *behavior* (root emits
   its abandonment event but never affects `totalSessions`/streak/etc.) is correct; only the layer
   attribution is off. Since the convention is "behavior, not code," this is easy to honor — just don't
   pin the skip to the "worker." Suggest wording like "the stats finaliser early-returns on root sessions."

2. **WARN — `configuration.md` retains a `## See Also` footer but is out of scope.**
   The global convention (plan line 15) says "Delete every `## See Also` footer," but Task 8 lists only the
   7 in-scope files and explicitly treats `configuration.md` as out of scope ("touch only if a direct
   contradiction exists"). `configuration.md` currently has a See-Also footer that will therefore survive
   this milestone. This is an intentional scope boundary, not a bug — flagging so the implementer doesn't
   "fix" it (and break the no-out-of-scope-edits intent) or, conversely, leave the global rule looking
   half-applied. Recommend the implementer either consciously leave it or note it as deliberately deferred.
   (`instruction-model.md`, which *is* in scope via Task 3, correctly carries both a See-Also footer and a
   prev/next nav line that Tasks 3/8 will remove.)

### Positive Notes

- Terminology block is exceptionally well-sourced — rare to see a docs plan where every technical assertion
  survives a code check. This sharply reduces the risk of the rewrite re-introducing stale model details.
- Task dependencies form a clean chain (1→2→3→4→5→6→7, then 8 as a consistency sweep), which matches the
  natural information dependency (core model → bio/schema/protocol → stats → reconcile).
- Explicitly scoping out `configuration.md` and `biometric-aggregation.md` while still requiring a
  contradiction check (Task 8) is the right call — it bounds the blast radius without ignoring cross-doc drift.
- Conventions correctly preserve the Russian-language requirement and the "current state only / no был-стал
  narrative" rule, consistent with this repo's documentation memory.

## Verdict

The plan is solid and implementation-ready. The two findings are wording/scope nuances the implementing
agent can absorb while reading the same source files; neither requires a plan revision.

PLAN_REVIEW_PASS
