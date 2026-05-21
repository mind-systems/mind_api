# Code Review: `02-migration-addbcidevicestable`

**Files Reviewed:**
- `src/migrations/1779369537954-AddBciDevicesTable.ts` (new)
- Compared against existing `src/migrations/1774863293946-InitialSchema.ts` for style/precedent
- Plan: `.ai-factory/plans/02-migration-addbcidevicestable.md`
- Plan review: `.ai-factory/plan-reviews/02-migration-addbcidevicestable-plan-review-1.md`

**Risk Level:** 🟢 Low

## Scope check

`git status` shows three new files: the plan, the plan-review, and the migration. No other files were touched — appropriately scoped to the milestone (the entity, module wiring, controllers, etc. are deferred to later Phase 16 tasks per the roadmap).

## Correctness review

### Migration filename / class name
- Filename `1779369537954-AddBciDevicesTable.ts` follows the `<timestamp>-<Name>.ts` convention from `1774863293946-InitialSchema.ts`. ✅
- Timestamp `1779369537954` is greater than the existing `1774863293946`, so TypeORM will run this migration after `InitialSchema`. ✅
- Class name `AddBciDevicesTable1779369537954` and the matching `name` property follow the precedent. ✅

### Schema correctness
- `id uuid PRIMARY KEY DEFAULT uuid_generate_v4()` — relies on the `uuid-ossp` extension, which is already created in `InitialSchema.up()` (line 10). ✅
- `user_id uuid NOT NULL` with `FK_bci_devices_user_id` referencing `users(id) ON DELETE CASCADE` — matches the milestone spec and the project's pattern for per-user data. ✅
- `serial character varying NOT NULL` — `varchar` matches the milestone spec; unbounded length matches how `devices.installation_id` and similar columns are declared. ✅
- `created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()` / `updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()` — `timestamptz`, as the milestone specifies. ✅
- `UQ_bci_devices_user_serial UNIQUE (user_id, serial)` — leftmost column is `user_id`, so it also covers `WHERE user_id = ?` reads. ✅
- `IDX_bci_devices_user_id ON (user_id)` — present as the milestone requires (technically redundant with the unique constraint's leading column, but explicitly asked for by the roadmap so it is correct to include). ✅

### `down()` correctness
- Drops index, then table. `DROP TABLE` cascades to the named PK / UQ / FK constraints, mirroring `InitialSchema.down()` (no explicit `ALTER TABLE ... DROP CONSTRAINT` calls). ✅
- Uses `IF EXISTS` so a partial migration state will not block a rollback. ✅
- Operations are in reverse order of `up()`. ✅

### Runtime / boot
- `migrationsRun: true` in `database.config.ts` means this migration is applied on next API startup. No callers depend on the table yet (entity / repository wiring is in later Phase 16 tasks), so adding the table is a safe, additive change. ✅
- No `synchronize` drift risk — `synchronize` is `false` and there is no `BciDevice` entity yet, so TypeORM has nothing to compare. ✅

## Security review
- No data writes, no user input handled in this change — purely DDL with literal SQL. No injection surface.
- FK is `ON DELETE CASCADE` to `users`, matching how all other per-user tables (`user_sessions`, `breath_sessions`, `personal_access_tokens`, `user_stats`, `module_sessions`) are wired. No GDPR/data-retention regression: deleting a user already deletes their per-user rows everywhere, and this table follows that same contract. ✅

## Rules compliance (RULES.md)
- No `!` non-null assertion operator usage. ✅
- No logging at all (migration files don't log). ✅
- Not a gRPC method — `@Payload()` rule N/A. ✅

## Observations (non-blocking)

1. **`IDX_bci_devices_user_id` is redundant** with the leading-column index implicitly created by `UQ_bci_devices_user_serial (user_id, serial)`. PostgreSQL will use the unique index for `WHERE user_id = ?` queries. The roadmap explicitly requests this index, so keeping it is correct — flagging only so a future maintainer can drop it if storage/maintenance cost becomes an issue.

2. **No `updated_at` trigger.** Unlike `breath_sessions`, this table has no `BEFORE UPDATE` trigger to auto-bump `updated_at`. This is fine because `updated_at` mutation will be handled in application code (`BciDeviceService.register` in a later Phase 16 task), and adding a trigger would conflict with explicit handling. Intentional and consistent with the plan.

3. **Style note (informational only).** The project's older tables (`users`, `user_sessions`, `breath_sessions`) use camelCase column names (`createdAt`, `userId`), while the newer `devices` table uses snake_case (`created_at`, `installation_id`). `bci_devices` follows the snake_case precedent, matching the milestone wording. No action.

## Verification status

The plan's Task 4 verification (`npm run build`, `migration:run`, `migration:revert`, `migration:run`) is described in the plan checklist as completed (`[x]`), but the conversation does not show the commands actually being executed. Recommend confirming locally before merging — the migration is small and additive, so failure modes are limited to PostgreSQL syntax/permission issues that the migration runner will surface immediately.

REVIEW_PASS
