# Plan Review: Add `rootSessionId` + `root` activity type with migration

**Plan:** `07-add-rootsessionid-root-activity-type-with-migration.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — additive, well-grounded in the codebase, no blocking issues.

## Verification Against Codebase

Every concrete claim in the plan was checked against the actual source. All correct:

| Plan claim | Verified |
|---|---|
| `ActivityType` enum has `BREATH`/`MEDITATION` at `enums/activity-type.enum.ts` | ✅ confirmed (2 members, lines 2–3) |
| `ModuleSession` has `@Index(['userId'])`/`@Index(['status'])` at lines 12–13 | ✅ confirmed |
| `userId` at lines 20–21, nullable `activityRefId` shape at 26–27 | ✅ confirmed (`@Column({type:'uuid', nullable:true})`) |
| `ActivityState` interface fields | ✅ confirmed (no `rootSessionId` yet) |
| Postgres enum type is `"public"."activity_type_enum"`, created `ENUM('breath')` in InitialSchema:33 | ✅ confirmed |
| `AddMeditationActivityType` reject-on-`down()` pattern at lines 10–22 | ✅ confirmed verbatim |
| InitialSchema `module_sessions` FK/index style (lines 260–282) | ✅ confirmed — manual `IDX_module_sessions_<col>` + `FK_module_sessions_<col>` names, `@Index` on entity is decorative |
| `mapProtoActivityType` throws on non-breath/meditation | ✅ confirmed (controller lines 35–58, has exhaustiveness `never` guard) |

The `@Index`-on-entity + manually-named-index-in-migration pattern the plan prescribes is exactly the existing precedent for `userId`/`status`, so it will not produce a duplicate index. The plain-`@Column` (not `@ManyToOne`) decision correctly mirrors the existing `userId` pattern and is why the self-FK must be written by hand in the migration — the plan calls this out explicitly. Good.

The transaction-mode gotcha (TypeORM defaults to `migrationsTransactionMode: "all"`, so `ALTER TYPE ... ADD VALUE 'root'` must not share a tx with any write of a `'root'` row) is correctly handled by isolating the enum extension in its own migration (Task 4) and deferring any `'root'` row writes to a later phase. This matches the proven `AddMeditationActivityType` precedent.

## Context Gates

- **Architecture (`ARCHITECTURE.md` present):** No boundary violation. The change stays entirely inside the `realtime` module's own entity/enum/interface, and the migration follows the established `src/migrations/` convention. `synchronize:false` + explicit migration files honored. **PASS.**
- **Rules (`RULES.md` present):** No migration/enum/FK-specific rules to violate. CLI-generated timestamps mandated by `mind_api/CLAUDE.md` are respected (plan forbids hand-crafted timestamps in both Tasks 4 and 5). **PASS.**
- **Roadmap (`ROADMAP.md` present):** Strong linkage. The plan implements the first task of the "Continuous bio timeline" section verbatim (ROADMAP line 31), including the "do **not** add `ROOT` to the proto enum" and "purely additive, existing rows valid" constraints. The 1:1 synthetic-root backfill is correctly deferred to Phase 58 (ROADMAP line 53), and the plan explicitly forbids backfilling here. `ON DELETE CASCADE` matches the roadmap's locked decision. **PASS.**

## Critical Issues

None.

## Minor Observations (non-blocking, WARN)

1. **Type-annotation inconsistency.** The plan declares `rootSessionId: string | null;` (required-but-nullable) while the sibling `activityRefId?: string;` uses optional-without-null, and the `ActivityState` field is `rootSessionId?: string | null;`. All three compile and TypeORM treats them identically at the DB layer, so this is cosmetic. If strict consistency with `activityRefId` is desired, `rootSessionId?: string | null;` on the entity would align the two. Not a defect — just flagging the asymmetry.

2. **Migration round-trip in Task 6 cannot fully auto-revert.** Because Task 4's `down()` rejects by design (Postgres has no `DROP VALUE`), `npm run migration:revert` run twice will revert Task 5 cleanly but the second revert (Task 4) will throw, leaving the migrations table with Task 4 still applied and the `'root'` enum value still present. The plan acknowledges this ("expected to reject by design… acknowledge the loud failure"). Worth restating in the implementer's mind: the verification goal is "up applies cleanly + Task 5 reverts cleanly," not a symmetric double round-trip. The leftover `'root'` enum value after a partial revert is harmless (unused).

3. **CASCADE blast radius.** `ON DELETE CASCADE` on a self-referential FK means deleting a root deletes all child sessions (and, in a later phase, their bio). This is the explicitly locked decision (note 02 §Change step 4, ROADMAP line 27) and is required by the Phase 57 reaping/`deleteRun` tasks, so it is correct here — noted only so the implementer doesn't second-guess it.

## Positive Notes

- Exceptionally well-researched: every file path, line number, enum/type name, and SQL identifier was confirmed accurate against the source. The backing note (`notes/02-root-session-schema.md`) even verified the `migrationsTransactionMode` default by inspecting both config files.
- Correct separation of the enum-add migration from the column/FK migration, with explicit timestamp-ordering guidance — avoids the real PG transaction hazard.
- Properly scoped as additive-only: nullable column, no backfill, no proto change, no runtime-behavior change. Existing rows remain valid.
- Single atomic commit grouping the entity column with its migration is the right call (entity/schema must deploy together).

PLAN_REVIEW_PASS
