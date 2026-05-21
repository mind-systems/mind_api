# Plan Review: `02-migration-addbcidevicestable`

**Files Reviewed:** 1 plan + 1 existing migration (`1774863293946-InitialSchema.ts`) + ROADMAP.md (Phase 16) + RULES.md + CLAUDE.md
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (ARCHITECTURE.md / CLAUDE.md):** ✅ No boundary concerns. This task only adds a migration file; module wiring is deferred to a later milestone (Phase 16, Task 3). The plan correctly does not touch any module code.
- **Rules (RULES.md):** ✅ No rule violations in scope — no logging, no gRPC signatures, no `!` assertions.
- **Roadmap (ROADMAP.md, Phase 16, Task 2):** ✅ The plan implements the milestone verbatim:
  - CLI-generated timestamp (no hand-crafting) — matches the project memory feedback (`feedback_migrations.md`).
  - Columns `id uuid PK`, `user_id uuid NOT NULL`, `serial varchar NOT NULL`, `created_at timestamptz`, `updated_at timestamptz`.
  - FK `user_id → users(id) ON DELETE CASCADE`.
  - Unique `UQ_bci_devices_user_serial (user_id, serial)`.
  - Index `IDX_bci_devices_user_id (user_id)`.
  - Both `up` and `down`.

## Critical Issues

None.

## Suggestions / Minor Observations

### 1. `IDX_bci_devices_user_id` is technically redundant with the unique constraint
The unique constraint `UQ_bci_devices_user_serial (user_id, serial)` creates a btree index whose leftmost column is `user_id`. Queries filtering by `WHERE user_id = ?` (i.e. the `List` RPC) will use that index without needing a separate `IDX_bci_devices_user_id`. PostgreSQL will pick the unique index just fine for the leading-column scan.

**Not a blocker** — the roadmap milestone explicitly demands this index, so the plan correctly follows it. If you want to optimize later, this index can be dropped without affecting `List` performance. Worth a one-line code comment in the migration noting the redundancy so future maintainers don't wonder.

### 2. `npm run build` step in Task 4 is not strictly needed
The verification step says "run `npm run build` — confirm TypeScript compiles." Migrations are executed via `ts-node` (see `package.json`: `"typeorm": "TS_NODE_PROJECT=tsconfig.cli.json node -r tsconfig-paths/register -r ts-node/register ./node_modules/typeorm/cli.js"`), so a missing JS build will not block `migration:run`. Running `npm run build` is harmless and catches TypeScript errors early, so keep it — just note that the migration would still execute via ts-node even without it.

### 3. Style consistency vs. mixed-case neighbour tables
Existing tables in `InitialSchema` are inconsistent — `users`, `user_sessions`, `breath_sessions`, etc. use camelCase column names (`createdAt`, `updatedAt`, `userId`), while `devices` uses snake_case (`installation_id`, `created_at`). The plan chose snake_case, which matches the milestone wording verbatim and the `devices` precedent (the most recently added table). ✅ No action needed — the choice is internally consistent with the entity plan in Phase 16 Task 3 (`@Column({ name: 'user_id' }) userId: string`).

### 4. No DB trigger to auto-bump `updated_at`
`breath_sessions` has an `update_breath_sessions_updated_at` trigger that auto-bumps `updatedAt` on every row update. The plan deliberately omits a trigger for `bci_devices`. ✅ This is correct because Phase 16 Task 4 (`BciDeviceService.register`) explicitly handles the bump in application code (either via `repo.update(..., { updatedAt: () => 'CURRENT_TIMESTAMP' })` or a manual assignment). Adding a trigger would conflict with that explicit handling and was intentionally avoided.

### 5. `down()` correctness
The `down()` step only drops the index and the table. ✅ Matches the pattern from `InitialSchema.down()` — `DROP TABLE` cascades to its PK/UQ/FK constraints, so no separate `ALTER TABLE … DROP CONSTRAINT` calls are needed.

## Positive Notes

- The plan explicitly references the existing `1774863293946-InitialSchema.ts` for style precedent (named constraints, `uuid_generate_v4()` default, snake_case columns for the newer `devices`-style tables).
- Correctly notes that the `uuid-ossp` extension is already created by `InitialSchema` and does not need to be re-created.
- Correctly forbids hand-crafted timestamps and points to the CLI command — directly addresses the long-standing `feedback_migrations.md` lesson.
- Verification step covers the full `run → revert → run` cycle, ensuring `down()` is actually exercised before the next agent touches the schema.
- Class-name format (`AddBciDevicesTable<timestamp>`) is correctly described and matches what the CLI actually produces.

PLAN_REVIEW_PASS
