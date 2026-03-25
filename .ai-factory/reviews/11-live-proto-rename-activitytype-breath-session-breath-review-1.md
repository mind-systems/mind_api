## Code Review Summary

**Files Reviewed:** 7
**Risk Level:** Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural concerns; change is scoped to a single enum rename within the `realtime` module boundary. No cross-module dependency violations.
- **RULES.md:** WARN — no violations. No non-null assertions, no sensitive data logged, logs remain lean.
- **ROADMAP.md:** WARN — roadmap item "live.proto — rename ActivityType.BREATH_SESSION -> BREATH" correctly marked `[x]`. Aligned.

### Files

| File | Verdict |
|------|---------|
| `proto/live.proto` | OK |
| `src/realtime/enums/activity-type.enum.ts` | OK |
| `src/migrations/1774411084222-RenameActivityTypeBreathSessionToBreath.ts` | OK |
| `src/realtime/gateways/live.gateway.spec.ts` | OK |
| `src/realtime/gateways/telemetry.gateway.spec.ts` | OK |
| `src/realtime/services/activity-engine.service.spec.ts` | OK |
| `src/realtime/services/startup-recovery.service.spec.ts` | OK |

### Analysis

**Proto contract** — `BREATH_SESSION = 1` renamed to `BREATH = 1`. Numeric tag is unchanged, so the change is wire-compatible for existing clients until they regenerate stubs. Correct.

**TypeScript enum** — key `BREATH_SESSION` and string value `'breath_session'` both changed to `BREATH` / `'breath'`. The string value is what TypeORM persists to the PostgreSQL `activity_type_enum` column. The migration must run before the new code writes values, which is guaranteed by `migrationsRun: true` in `database.config.ts` (migrations execute at bootstrap before any request).

**Migration** — `ALTER TYPE "public"."activity_type_enum" RENAME VALUE 'breath_session' TO 'breath'` is the correct PostgreSQL 10+ syntax. `RENAME VALUE` updates all existing rows in-place with no separate `UPDATE` needed. The `down` method correctly reverses the operation. Migration timestamp `1774411084222` orders after the original `1773469567000-AddLiveSession.ts` migration that creates the enum. The original migration is correctly untouched.

**Scope correctness** — grepped the entire `src/` tree for remaining `BREATH_SESSION` and `breath_session` occurrences. All are unrelated to `ActivityType`:
- `ChangeEntity.BREATH_SESSION = 'breath_session'` in `src/changelog/changelog.enums.ts` — sync entity type, correctly untouched.
- `event.activityRefType === 'breath_session'` in `src/stats/stats.service.ts` — checks the `activityRefType` string field (references the `breath_sessions` table), not the `ActivityType` enum. Correctly untouched.
- Table/entity names (`breath_sessions`, `breath_session_settings`) in entity files and older migrations — table names, not enum values. Correctly untouched.

No production source files (outside specs and the enum definition) referenced `ActivityType.BREATH_SESSION` directly — all production code accesses the value through `dto.activityType` or `saved.activityType` which are typed as `ActivityType` and work regardless of the enum member name.

**Entity compatibility** — `live-session.entity.ts` declares `@Column({ type: 'enum', enum: ActivityType })`. After the rename, TypeORM will emit `'breath'` on insert/query, matching the DB enum post-migration. No entity changes needed.

**Spec files** — mechanical rename of `ActivityType.BREATH_SESSION` to `ActivityType.BREATH` across 4 spec files (~22 occurrences). No logic changes. All occurrences replaced consistently.

### Positive Notes

- Clean separation: the plan correctly identified that `ChangeEntity.BREATH_SESSION` is a completely separate enum and excluded it from changes.
- Migration uses `RENAME VALUE` instead of drop/recreate, preserving existing data safely.
- Original migration left untouched per project conventions.

REVIEW_PASS
