## Plan Review Summary

**Plan:** Restore type-safety on state commands + de-dup endActivity warn
**Files Reviewed:** 3 (controller, engine service, generated proto) + ROADMAP/RULES gates
**Risk Level:** 🟢 Low

### Context Gates

- **Architecture (`ARCHITECTURE.md`):** WARN — no boundary impact. The change stays inside the Realtime module (controller + engine service), respects "controllers are thin" (the cast removal touches only request-field reads, no logic moved), and introduces no cross-module imports. No concern.
- **Rules (`RULES.md`):** PASS — no non-null assertions introduced; no `!` operators. The two reworded warn messages log only `userId` and `sid` (IDs, not PII), consistent with "Log IDs and outcomes only." No new log statements are added — existing `warn` text is edited in place, so the "keep logs lean" rule is preserved.
- **Roadmap (`ROADMAP.md`):** PASS — directly linked to the open item at `ROADMAP.md:102` ("Restore type-safety on state commands + de-dup endActivity warn"), under the "Cleanup + race fix — completed-work audit" milestone. Plan content matches the roadmap entry verbatim (same five line numbers, same two message strings, same "keep both guards" constraint, same spec note 39).

### Verification Performed

Every factual claim in the plan was checked against the codebase:

- **Five casts confirmed** at exactly `:386, :443, :484, :526, :562` in `module-state.grpc.controller.ts` — `grep` returns precisely these five and no others, so nothing is missed and none are over-claimed.
- **Proto types confirmed** in `proto/generated/module_state.ts`:
  - `ActivityStartCmd.clientActivityId?: string | undefined` (`:68`)
  - `ActivityEndCmd.sessionId?` (`:81`), `ActivityStopCmd.sessionId?` (`:87`), `ActivityPauseCmd.sessionId?` (`:92`), `ActivityResumeCmd.sessionId?` (`:97`)
  - Each handler's `cmd` parameter is typed with the matching interface (`handleActivityStart(... cmd: ActivityStartCmd ...)`, etc.), so `cmd.clientActivityId` / `cmd.sessionId` will type-check after the cast is removed. The removal is genuinely behavior-preserving — the runtime read is identical.
- **Duplicate warn confirmed** in `activity-engine.service.ts`: the `!sid` guard (`:174-179`) and the `!state` guard (`:181-187`) both log the identical string `endActivity: no active session in memory for userId=${userId}`. The plan's claim that `!state` is load-bearing is correct — the code at `:189-197` and the DB path below dereference `state`, so both guards must stay. Both branches `return null`; control flow is unchanged by a string-only edit.
- **No test depends on the changed text:** searched `*.spec.ts` for the old/new message strings — no spec asserts the warn text. Specs that reference `clientActivityId`/`sessionId` only construct command objects with those fields (valid proto fields), unaffected by removing the cast.
- **No migration / no proto change** — correctly stated. This is a pure source edit; `synchronize` is false and no schema is touched.

### Critical Issues

None.

### Minor Notes (non-blocking)

- **Task 1, line 386 spans three lines** in the source (`const clientActivityId = (cmd as any).clientActivityId as | string | undefined;`). The plan's suggested replacement (`const clientActivityId = cmd.clientActivityId;`) collapses the redundant `as string | undefined` annotation, which the plan itself flags as "harmless either way." Implementer should simply ensure the resulting declaration still compiles (it does — the field is already typed `string | undefined`). No action needed beyond awareness that the edit covers a multi-line span, not a single line.
- **Task 3 build check is the real safety net.** Since the entire correctness argument rests on the proto fields being declared, `npm run build` passing is the proof. The plan correctly makes this the gate. Good.

### Positive Notes

- Line numbers, file paths, and proto field names are all accurate — no fantasy references.
- The plan correctly identifies and protects the load-bearing `!state` guard rather than naively "de-duplicating" by deleting one branch, which would have been a real bug.
- Scope is tight and genuinely behavior-preserving; the build+test gate is the correct verification for a type-safety restoration.
- Tight traceability to ROADMAP and spec note 39.

PLAN_REVIEW_PASS
