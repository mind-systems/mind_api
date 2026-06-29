# Plan Review 3 — Migration: backfill synthetic roots 1:1 + repoint bio

**Plan:** `17-migration-backfill-synthetic-roots-1-1-repoint-bio.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — all prior review items (C1, M1, M2, m1, m2, I1, I2, RULES.md) verified as genuinely addressed against the codebase.

## Verification performed

Every load-bearing claim in the plan was checked against the actual source, not taken on faith:

| Claim | Source checked | Result |
|---|---|---|
| `'root'` enum committed in `1782658908789-AddRootActivityType` with `IF NOT EXISTS`, `down()` rejects | migration file | ✅ exact match |
| `rootSessionId uuid` + self-referential FK `FK_module_sessions_rootSessionId ON DELETE CASCADE` | `1782658936664-AddRootSessionLink` | ✅ confirmed (also creates `IDX_module_sessions_rootSessionId`) |
| Bio FK `FK_bio_session_samples_moduleSessionId ON DELETE CASCADE` | `1779990145496-AddBioSessionSamplesTable` | ✅ confirmed |
| `migrationsTransactionMode` unset in both configs → defaults to `"all"` | `database.config.ts`, `src/config/typeorm.config.ts` | ✅ neither sets it; `'each'` is a valid enum value (`"all" \| "none" \| "each"`) |
| `uuid_generate_v4()` extension available | `InitialSchema` (`CREATE EXTENSION "uuid-ossp"`) | ✅ confirmed |
| INSERT column list vs NOT NULL constraints | `module-session.entity.ts` | ✅ all NOT NULL cols populated (`userId`, `activityType`, `status`, `startedAt`, `lastActivityAt`); `createdAt` omitted → `@CreateDateColumn` default; `activityRefId`/`disconnectedAt`/`endedAt`/`metadata`/`rootSessionId` nullable |
| `status = 'completed'` is a valid enum value | `session-status.enum.ts` | ✅ `COMPLETED = 'completed'` exists |
| `metadata` is nullable `jsonb` | entity `:50-51` | ✅ confirmed |
| Tolerant bio read `[session.id, session.rootSessionId]` windowed by `startedAt…endedAt` | `sessions.service.ts:174-200` | ✅ exact match; window defaults to child's own `startedAt`/`endedAt` (`:199-200`) |
| `queryRunner.query(sql, undefined, true)` returns structured `QueryResult` with `.affected` | typeorm `0.3.30` `QueryRunner.d.ts:101`, `QueryResult.d.ts`, `PostgresQueryRunner.js:196` (`result.affected = raw.rowCount`) | ✅ signature and `affected = rowCount` for UPDATE both confirmed |

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** present. The migration touches only `module_sessions` and `bio_session_samples` — entities owned by the realtime module — via raw SQL inside a migration file. No module-boundary violation (migrations are infrastructure, not cross-module imports). **Pass.**
- **Rules (`.ai-factory/RULES.md`):** the no-`!` rule is the binding one; the batch-loop pseudocode (Task 3 step 4) uses an explicit `typeof res?.affected === 'number' ? res.affected : 0` guard instead of `res!.affected`. **Pass.** Other rules (no sensitive logging, lean logs, gRPC decorators) are not in scope for a data migration.
- **Roadmap (`.ai-factory/ROADMAP.md`):** present. This is migration work backing the root-session feature line (spec note `11-migration-backfill-roots.md` + notes 02/09/10). Linkage is explicit via the spec note. **Pass (WARN-free).**

## Correctness analysis of the migration logic

- **Idempotency** — guard is `WHERE "activityType" != 'root' AND "rootSessionId" IS NULL` populating `_root_map`. A re-run finds zero qualifying rows; steps 2–4 no-op, step 5 assertion is skipped (`mapped = 0`). Convergent and correct.
- **`up()` bio repoint loop** — `ctid`-bounded `LIMIT 10000` sub-select joined to `_root_map`; updated rows flip `moduleSessionId` to `rootId` and stop matching `m2."childId"`, so the join shrinks and the `affected`-driven `do/while` terminates. Reads the structured `affected`, not array length (M2). Correct.
- **`down()` ordering** — load-bearing because the self-referential FK is `ON DELETE CASCADE`: (1) repoint bio back to child via `s."rootSessionId" = b."moduleSessionId"`, (2) null children's `rootSessionId`, (3) delete tagged roots. Step 1 correctly runs before step 2 (it depends on `rootSessionId` still pointing at the root). Strict 1:1 tagging makes the child lookup in step 1 deterministic. Correct.
- **`down()` scoping** — every statement filters `metadata->>'backfill' = 'synthetic-root-v1'`, so live app-created roots (potentially multi-child) are untouched (M1). The jsonb operator and tag value match the `up()` insert exactly. Correct.
- **Transaction-mode fix** — under `'each'`, `AddRootActivityType` commits before this migration begins, so the `'root'` reference no longer raises `55P04`, while this migration's body stays atomic in its own transaction. This is the correct and standard TypeORM remedy for new-enum-value usage. Correct.

## Observations (non-blocking, no action required)

1. **Global side effect of Task 1 is correctly flagged.** Setting `migrationsTransactionMode: 'each'` changes behavior for *all* migrations, not just this one — a failure in migration N now leaves `< N` committed. The plan explicitly calls this out and asks the implementer to spot-check that no existing migration relies on cross-migration atomicity. Each current migration under `src/migrations/` is self-contained DDL/data, so the switch is safe. Good that this is surfaced rather than buried.

2. **Spec-note vs plan inconsistency on batching rationale (already reconciled in the plan).** The spec note (`11-migration-backfill-roots.md:93`) still states chunking "keeps lock duration and WAL bounded." The plan's m1 correction is the accurate version: under a single transaction, lock/WAL are held until COMMIT regardless of chunk size — batching instead bounds planner/executor + snapshot memory and smooths dead-tuple churn. The plan is the authoritative, corrected statement; the stale spec-note line is cosmetic and does not affect implementation.

3. **PG version assumption (implicit, holds).** `ALTER TYPE … ADD VALUE` inside a transaction requires PostgreSQL ≥ 12 (and that the enum was not created in the same transaction — it was created back in `InitialSchema`). The project targets modern Postgres, so this is fine; worth keeping in mind only if a very old PG were ever in play.

## Positive Notes

- Exceptionally precise: column lists, enum values, FK names, service line numbers, and the typeorm structured-result API were all stated correctly and matched the code on inspection.
- The M2 fix is a real, subtle bug avoided — a non-`RETURNING` `UPDATE` via `queryRunner.query` returns `[]`, so a length-based loop would silently under-migrate after one batch. The structured-result loop is the right call.
- Idempotency, rollback scoping, and the post-`up()` invariant assertion (with the re-run skip for I2) together make this safe to run, re-run, and revert on a one-shot prod migration with no automated test.
- Honors both project rules that apply (no `!`; CLI-generated timestamp).

PLAN_REVIEW_PASS
