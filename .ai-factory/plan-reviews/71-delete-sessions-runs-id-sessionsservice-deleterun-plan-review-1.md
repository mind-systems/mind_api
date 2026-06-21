# Plan Review: DELETE /sessions/runs/:id + SessionsService.deleteRun

**Plan:** `71-delete-sessions-runs-id-sessionsservice-deleterun.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — all critical assumptions verified against the codebase.

## Verification Summary

Every load-bearing claim in the plan was checked against the actual source:

| Plan assumption | Verified | Evidence |
|---|---|---|
| `assertSessionOwnership(userId, sessionId)` exists, private, throws `NotFoundException`/`ForbiddenException` | ✅ | `sessions.service.ts:102-115` |
| `ModuleSession` has no `@DeleteDateColumn` (hard delete is correct) | ✅ | `module-session.entity.ts` — only `@CreateDateColumn` |
| FK `ON DELETE CASCADE` on `session_stream_samples.moduleSessionId` | ✅ | `InitialSchema` migration line 293 |
| FK `ON DELETE CASCADE` on `bio_session_samples.moduleSessionId` | ✅ | `AddBioSessionSamplesTable` migration line 13 |
| Constructor injection order `(moduleSessionRepo, bioSampleRepo, streamSampleRepo)` matches the test's `new SessionsService(...)` | ✅ | `sessions.service.ts:31-38` |
| Controller is REST, already `@UseGuards(JwtAuthGuard)`; `Param`/`ParseUUIDPipe`/`CurrentUser`/`JwtPayload` imported; `Delete`/`HttpCode` NOT yet imported (plan adds them) | ✅ | `sessions.controller.ts:1-19` |
| `JwtPayload.sub` exists | ✅ | `users/interfaces/auth.interface.ts:3` |
| `module_sessions` is NOT in the sync/changelog journal (only `breath_session`) → no sync event needed | ✅ | `changelog.enums.ts` — `ChangeEntity` has only `BREATH_SESSION` |
| No migration required (no schema change) | ✅ | Cascade already exists; pure code addition |
| Reference spec style uses direct `new Service(...)` with `jest.fn()` mocks | ✅ | `breath-session-settings.service.spec.ts:23-28` |
| `src/sessions/sessions.service.spec.ts` does not yet exist (plan creates it new) | ✅ | No `*.spec.ts` under `src/sessions/` |

## Context Gates

- **Architecture (`ARCHITECTURE.md` / module pattern):** PASS. The change stays inside `SessionsModule`, reusing already-injected `moduleSessionRepo`. No cross-module internal imports, no new providers. Cascade is delegated to the DB FK rather than reaching into `RealtimeModule` entities — consistent with the modular-monolith boundary rules.
- **Rules (`RULES.md`):** PASS. Plan's code uses no non-null assertion (`!`). Logging is lean (single business-outcome line, IDs only — no PII; userId/sessionId are UUIDs, not sensitive). gRPC `@Payload()` rule is N/A (REST route). Logger instantiated as `new Logger(SessionsService.name)` per the project logging mandate.
- **Roadmap (`ROADMAP.md`):** PASS — strong linkage. The plan is a faithful 1:1 expansion of the open milestone at Phase 45 (line 261), and matches spec note `55-delete-module-session.md` on every guard (breath_sessions untouched, user_stats untouched, meditation_notes survive via SET NULL, no sync event).

## Critical Issues

None.

## Minor Notes (non-blocking)

1. **`user_stats unchanged` is asserted by argument, not by test (WARN).** The ROADMAP milestone lists four test cases: `owned→delete`, `foreign→403`, `missing→404`, and `user_stats unchanged`. The plan's Task 3 implements the first three and covers the fourth with an explanatory comment rather than an assertion. This is defensible — `SessionsService` injects no stats repository, so there is structurally no path from `deleteRun` to `user_stats` and nothing to assert at the unit level. Acceptable as-is; if you want literal milestone parity, the comment satisfies the intent. No change required.

2. **`@HttpCode(204)` overrides NestJS's DELETE default (200).** Correct and intentional — the handler returns `void`/`Promise<void>`, so 204 No Content is the right status. Just flagging that the explicit decorator is load-bearing here (without it NestJS would emit 200 with an empty body). The plan includes it. ✅

3. **Idempotency of repeated deletes.** A second `DELETE` on the same id returns 404 (via `assertSessionOwnership` → `findOne` null). This is the conventional REST behavior and matches the milestone's `missing→404` case — noted only for awareness, not a defect.

## Positive Notes

- Correctly identifies that the cascade is **DB-level**, and the test explicitly asserts the bio/stream repos' `delete` is NOT called — this prevents a future maintainer from "helpfully" adding redundant manual child deletes.
- Reuses the existing ownership guard instead of duplicating the 404/403 logic — keeps the security boundary in one place.
- Correctly scopes out migration/proto/gRPC/module changes, matching the spec.
- File paths, import deltas, and method signatures all match the real files exactly — no drift.
- The test instantiation pattern and reference spec are accurate; the plan even improves on the spec note (which loosely referenced a non-existent "existing SessionsService spec" — the plan correctly points to the breath-settings spec as the style template).

PLAN_REVIEW_PASS
