# Plan Review: Migration — backfill synthetic roots 1:1 + repoint bio

**Plan:** `.ai-factory/plans/17-migration-backfill-synthetic-roots-1-1-repoint-bio.md`
**Spec note:** `.ai-factory/notes/11-migration-backfill-roots.md`
**Files reviewed:** 9 (plan, spec note, 3 prior migrations, 2 entities, 2 enums, `sessions.service.ts`, `database.config.ts`)
**Risk Level:** 🔴 High — one critical correctness bug that fails on every fresh `migration:run`

---

## Context Gates

- **Architecture (ARCHITECTURE.md):** PASS. Raw-SQL one-time migration under `src/migrations/`, set-based, single transaction. No module boundary violation; entity ownership respected (no cross-module repo injection introduced).
- **Rules (RULES.md):** WARN. The JS driver loop in `up()`/`down()` must obey the project rule *"NEVER use the non-null assertion operator `!`"*. Read the affected-row count with an explicit check, not `result!.affected`. Non-blocking but call it out for the implementer. Logging rule ("minimal" / no PII) is fine — a migration logs IDs/counts at most.
- **Roadmap (ROADMAP.md):** PASS. Linked to line 53 *"Migration: backfill synthetic roots 1:1 + repoint bio"*, and consistent with the milestone preamble (line 27) "migration is 1:1 (one synthetic root per existing session)".

---

## Critical Issues

### C1. Enum value `'root'` is used in the SAME transaction that adds it — fails on any fresh `migration:run`

This is the headline defect, and it is inherited from a **factually wrong statement in the spec note** (§"Dependency / ordering"):

> "TypeORM runs each migration in its own transaction (`migrationsTransactionMode` defaults to `"all"`)."

That sentence is self-contradictory. `migrationsTransactionMode: "all"` (the TypeORM default, confirmed *not* overridden in `database.config.ts` — there is no `migrationsTransactionMode` key, and `migrationsRun: true`) wraps **all pending migrations in ONE shared transaction**. The mode where each migration gets its own transaction is `"each"`, not `"all"`.

Consequence: on any environment where `AddRootActivityType1782658908789` (the `ALTER TYPE ... ADD VALUE 'root'`) and `BackfillRootSessions` are *both pending in the same run* — i.e. fresh CI, fresh e2e DB, a brand-new dev box, and the **first production deploy of `feature/root-session`** (all these migrations are unreleased commits on the same branch) — they execute inside one `BEGIN…COMMIT`. Postgres then rejects every reference to `'root'` in this migration:

```
ERROR: unsafe use of new value "root" of enum type activity_type_enum  (SQLSTATE 55P04)
```

This bites both the `WHERE "activityType" != 'root'` guard and the `INSERT … 'root'` value. Putting the `ADD VALUE` in a *separate migration file* (the plan's and spec's stated mitigation) is **not sufficient** under `"all"` — separate files still share the one transaction. The mitigation only works under `"each"`.

Note the trap: on an incrementally-migrated dev box where `AddRootActivityType` was already applied (and committed) in an *earlier* `migration:run`, only `BackfillRootSessions` is pending, so it runs in a fresh transaction and succeeds. Classic "works on my machine" — and **Task 4's own verification path explicitly defeats the workaround**: restoring a prod snapshot (which predates this whole branch) and running `migration:run` applies all three together → 55P04. So the plan's verification step would fail before reaching any of the checks it lists.

There is also a real tension the plan never resolves: it *wants* everything in one transaction for atomic backfill (Task 2 leans on `migrationsTransactionMode: "all"`), but that same mode is what breaks the enum usage.

**Fix (pick one, decide explicitly in the plan):**
1. **Preferred — set `migrationsTransactionMode: 'each'`** in `database.config.ts` (and the CLI `typeorm.config.ts` path if used to run migrations). Under `"each"`, `AddRootActivityType` commits before this migration starts, *and* this migration's `up()`/`down()` body still runs atomically in its own transaction — satisfying both constraints. Verify no other migration in the chain relies on cross-migration atomicity before flipping this global setting.
2. Guarantee by deploy process that `AddRootActivityType` is applied in a strictly earlier, already-committed release than this backfill — and document that fresh-from-empty runs (CI/e2e) are therefore unsupported for this migration. (Fragile; contradicts Task 4.)
3. Make this migration tolerant of the value not yet being committed (e.g. compare against the enum's text form via a cast that doesn't require the committed label) — awkward and not worth it versus option 1.

Whichever is chosen, correct the spec note's false claim so the next reader doesn't re-derive the wrong safety argument.

---

## Major Issues

### M1. `down()` is not selective to synthetic roots — it deletes/mis-repoints app-created roots too

`up()` sets `metadata = NULL` on the synthetic roots, making them **indistinguishable** from the lazy roots that the new application code (commit `ac96c2c` "Lazy root creation + child linking") creates at runtime — both have `activityType = 'root'` and `metadata = NULL`. Every `down()` step targets *all* roots:

- Step 1 repoints bio by `b."moduleSessionId" IN (SELECT id … WHERE activityType='root')`.
- Step 2 nulls `rootSessionId` for **all** children of **all** roots.
- Step 3 `DELETE FROM module_sessions WHERE activityType='root'`.

If a revert is ever run after the app has created legitimate roots (which it will the moment the service is live), `down()` will:
- Delete real, app-created roots — **data loss**, not a clean rollback.
- For any root with **multiple children** (the explicit point of this whole feature — concurrent activities share a root), step 1's `UPDATE … FROM module_sessions s WHERE s.rootSessionId = b.moduleSessionId` has **multiple matching `s` rows**; Postgres picks an arbitrary one, so bio gets repointed to a *non-deterministic* single child. The 1:1 assumption baked into `down()` is only valid for the rows *this migration* created, not for the roots the app creates later.

**Recommendation:** tag the synthetic roots in `up()` — e.g. `metadata = '{"backfill": "synthetic-root-v1"}'::jsonb` — and scope every `down()` statement to that tag (`WHERE metadata->>'backfill' = 'synthetic-root-v1'`). This also hardens `up()` idempotency and makes the rows auditable. If tagging is rejected, the plan must at minimum state loudly that `down()` is only safe to run before the application has created any roots, and is otherwise destructive.

### M2. The batch loop's termination condition (`affected rows`) is not available by default from `queryRunner.query`

Task 2 step 4 says: drive the loop with `do { result = await queryRunner.query(...) } while (result rowcount > 0)`, "reading the affected-row count to decide when to stop." With TypeORM 0.3.x + `pg`, `queryRunner.query(sql)` for a non-`RETURNING` `UPDATE` returns the **rows array** (empty `[]`), *not* an affected count. So `result.length` is always `0` → the loop stops after the **first batch**, silently leaving the vast majority of `bio_session_samples` still pointed at the child. (Depending on how it's coded, it could instead never terminate.) Either way the migration "succeeds" while doing the wrong thing — the worst failure mode for a data migration.

**Fix:** read the structured result — `const { affected } = await queryRunner.query(sql, params, true)` (the third `useStructuredResult` arg returns `{ records, affected, raw }`), and loop while `affected > 0`. Spell this out in the plan so it isn't implemented as `result.length`. The same applies to the `down()` step-1 batch loop.

---

## Minor Issues

### m1. Batching rationale is inaccurate under single-transaction mode

The plan justifies 10 000-row chunking as bounding "lock duration and WAL growth." Inside one transaction (`migrationsTransactionMode: "all"`), **all row locks are held until the single COMMIT and all WAL is retained until COMMIT** — chunking does not bound either. What chunking *does* legitimately buy: it avoids one giant statement's planner/executor memory, temp, and snapshot cost, and smooths dead-tuple/bloat spikes. Keep the batching, but fix the stated reason. (Under option C1.1 — `"each"` mode — the migration is still one transaction internally, so this still holds.) The `ctid`-bounded sub-select loop itself is correct: updated rows no longer match the `moduleSessionId = childId` join, so each pass consumes a fresh 10 000 and the loop converges.

### m2. Consider asserting the 1:1 invariant post-`up()`

Cheap insurance: after `up()`, a sanity `SELECT count(*) FROM module_sessions WHERE activityType='root'` should equal the `_root_map` row count, and no qualifying child should remain with `rootSessionId IS NULL`. A failed `ASSERT`/raised exception inside the transaction rolls everything back — far better than a half-migrated prod table. Optional, but this is a one-shot prod migration with no automated test (Task 4 is manual-only), so a built-in guard is worth the few lines.

---

## Positive Notes

- **1:1 design verified against the actual reader.** `sessions.service.ts:174-200` builds `bioSessionIds = [session.id, session.rootSessionId]` and windows by `session.startedAt … endedAt`. Because each synthetic root mirrors the child's `startedAt`/`endedAt` exactly and is strictly 1:1, repointing bio to the root returns the identical series via the root branch. The series-preservation claim holds.
- **Idempotency guard is correct.** `activityType != 'root' AND rootSessionId IS NULL` cleanly skips both roots and already-linked children on re-run; the temp table comes up empty and all steps no-op.
- **`down()` ordering vs the self-referential `ON DELETE CASCADE` is right** (bio→child, null child link, then delete roots) — for the rows this migration owns. The hazard is scope (M1), not order.
- **NOT NULL coverage is complete and accurate.** `userId`, `activityType`, `status`, `startedAt`, `lastActivityAt` all populated; `createdAt` (DB `now()`) and `activityRefId` (nullable, root has no ref) correctly omitted — matches `module-session.entity.ts`.
- **No collision with downstream root machinery.** Run-history (`sessions.service.ts:91`) and stats already exclude `activityType='root'`; each synthetic root has exactly one child, so the childless-root janitor won't reap them.
- **Process rule honored:** CLI-generated migration, no hand-crafted timestamp (matches `feedback_migrations` and `mind_api/CLAUDE.md`).

---

## Verdict

Do not implement as written. **C1 will fail the first real deployment and the plan's own verification step**, and its root cause is a wrong assumption copied from the spec note — fix the spec too. **M1** turns `down()` from a rollback into a data-loss operation once the app is live, and **M2** can make `up()` silently under-migrate. Address C1, M1, M2 (and ideally tag synthetic roots, m1's wording, and m2's guard), then re-review.
