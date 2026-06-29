# Plan Review 2: Migration — backfill synthetic roots 1:1 + repoint bio

**Plan:** `.ai-factory/plans/17-migration-backfill-synthetic-roots-1-1-repoint-bio.md`
**Files reviewed:** plan, prior review (`...-plan-review-1.md`), `database.config.ts`, `src/config/typeorm.config.ts`, migrations (`AddRootActivityType`, `AddRootSessionLink`, `AddBioSessionSamplesTable`, `AddMeditationActivityType`), `module-session.entity.ts`, `activity-type.enum.ts`, `session-status.enum.ts`, `src/sessions/sessions.service.ts`, TypeORM 0.3.27 type defs.
**Risk Level:** 🟢 Low — all prior critical/major findings resolved; two non-blocking polish items remain.

---

## Context Gates

- **Architecture (ARCHITECTURE.md):** PASS. One-time raw-SQL migration under `src/migrations/`, set-based, single per-migration transaction. No module-boundary or entity-ownership violation introduced.
- **Rules (RULES.md):** PASS. The plan explicitly forbids the `!` operator and supplies guard-style pseudocode (`typeof res?.affected === 'number' ? res.affected : 0`). Logging is minimal; no PII. Matches the verified rules file.
- **Roadmap (ROADMAP.md):** PASS (per review 1, line 53 linkage unchanged).

---

## Verification of Review-1 Fixes

All four substantive findings from review 1 are correctly addressed and were re-checked against the actual code:

- **C1 (enum `55P04`) — RESOLVED.** Task 1 sets `migrationsTransactionMode: 'each'` in both `database.config.ts` (runtime factory, currently has no such key → defaults to `'all'`, confirmed) and `src/config/typeorm.config.ts` (CLI `DataSource`, also absent). The option key and its `"all" | "none" | "each"` domain are confirmed valid in TypeORM 0.3.27 (`BaseDataSourceOptions.d.ts:49`), and `'each'` runs each migration in its own transaction — so `AddRootActivityType` commits before this migration's body uses `'root'`. `AddRootActivityType` uses `ADD VALUE IF NOT EXISTS 'root'`, and the precedent `AddMeditationActivityType` follows the same pattern, so PG12+ in-transaction `ADD VALUE` is already assumed by the codebase. The Task 1 "before flipping" note correctly flags the global-setting risk (each current migration is self-contained DDL/data — spot-check confirmed).
- **M1 (`down()` deletes/mis-repoints app-created roots) — RESOLVED.** `up()` tags synthetic roots `'{"backfill":"synthetic-root-v1"}'::jsonb`; every `down()` statement filters on `metadata->>'backfill' = 'synthetic-root-v1'`. Since tagged roots are strictly 1:1, `down()` step 1's `WHERE s.rootSessionId = b.moduleSessionId` matches exactly one child per root → deterministic. `metadata` is a nullable `jsonb` column (`module-session.entity.ts:50-51`), confirmed.
- **M2 (batch loop affected count) — RESOLVED.** Plan uses `queryRunner.query(sql, undefined, true)` → `QueryResult { records, affected, raw }`. Signature confirmed (`QueryRunner.d.ts:101`); `affected?` is optional (`QueryResult.d.ts`) and the plan's `typeof … === 'number'` guard handles that correctly.
- **m1 / m2 — RESOLVED.** Batching rationale corrected; post-`up()` invariant assertion added (but see I2 below).

Also re-verified: `'root'` and `'completed'` are valid enum members; NOT NULL coverage (`userId`, `activityType`, `status`, `startedAt`, `lastActivityAt`) is complete with `createdAt`/`activityRefId` correctly omitted; the reader at `src/sessions/sessions.service.ts:174-177` matches the plan's series-preservation argument exactly (`bioSessionIds = [session.id, session.rootSessionId]`, windowed by `startedAt…endedAt`).

---

## Minor Issues (non-blocking)

### I1. `down()` step 1 is described as "batched" but the example SQL is not batched

Task 4 step 1 says *"batched the same way as `up()` step 4, structured-result loop"*, but the SQL block shown has **no `ctid`-bounded `LIMIT` sub-select** — it is a single full-table `UPDATE`. An implementer who copies the example verbatim gets one large statement, not the chunked loop the prose promises, and the structured-result `affected` loop has nothing to iterate. Pick one and make the plan internally consistent: either add the same `WHERE b.ctid IN (SELECT … LIMIT 10000)` bound to the `down()` SQL (matching `up()` step 4), or drop the "batched … structured-result loop" wording for `down()` and state it as a single statement. (Functionally either works; this is about not shipping contradictory instructions.)

### I2. Post-`up()` invariant assertion (Task 3 step 5) contradicts the advertised idempotency on manual re-run

The plan states the `WHERE "activityType" != 'root' AND "rootSessionId" IS NULL` guard makes a re-run a clean no-op — *"a re-run finds no rows … so every step no-ops."* That holds for steps 1–4, but **step 5 does not no-op**:

- On a re-run, `_root_map` is empty (0 rows, all children already linked).
- The first assertion ("any qualifying child still has `rootSessionId IS NULL`") passes — none qualify.
- The second assertion fires: `count(*) WHERE activityType='root' AND metadata->>'backfill'='synthetic-root-v1'` equals **N** (the roots created by the first run), and `N ≠ 0` (the `_root_map` count) → the migration **raises and rolls back on the re-run**.

So the assertion turns the "idempotent, safe to re-run" property into a hard failure on the second invocation. In the normal TypeORM flow this is harmless (the migrations table prevents re-execution of a committed `up()`), so impact is low — but the plan explicitly sells idempotency as a safety property, and the idempotency guard's whole stated purpose is to support defensive re-runs. **Fix:** short-circuit step 5 when `_root_map` has zero rows (skip both assertions on a no-op run), or compare the tagged-root count against the number of children linked *in this run* rather than the absolute count. One guard line preserves the stated invariant without weakening the check on a real first run.

---

## Positive Notes

- **Every review-1 finding is addressed with a concrete, verifiable mechanism**, not hand-waving — the `'each'` mode fix, the metadata tag, and the structured-result loop all check out against the installed TypeORM version and the actual schema.
- **Series-preservation argument is sound and matches the live reader** (`src/sessions/sessions.service.ts:174-200`): 1:1 roots mirroring `startedAt`/`endedAt` keep the windowed `[session.id, rootSessionId]` read returning the identical series.
- **RULES.md `!`-free guard is spelled out in pseudocode**, removing the review-1 WARN.
- **`down()` ordering vs. the self-referential `ON DELETE CASCADE`** (bio→child, null child link, delete roots) is correct, and now correctly scoped to tagged rows.
- **Process rule honored:** CLI-generated migration, no hand-crafted timestamp.

---

## Verdict

The plan is implementable as written. C1/M1/M2 are genuinely fixed and verified against the codebase. The two remaining items (I1 — batched-vs-shown-SQL inconsistency in `down()`; I2 — step-5 assertion vs. idempotency claim) are minor polish that the implementer should reconcile but neither blocks implementation nor risks data loss in the normal one-shot migration path. Recommend tightening both, then proceed.
