# Code Review: Migration — backfill synthetic roots 1:1 + repoint bio

**Plan:** `.ai-factory/plans/17-migration-backfill-synthetic-roots-1-1-repoint-bio.md`
**Code changes reviewed (full):**
- `src/migrations/1782703116805-BackfillRootSessions.ts` (new)
- `database.config.ts` (+`migrationsTransactionMode: 'each'`)
- `src/config/typeorm.config.ts` (+`migrationsTransactionMode: 'each'`)
- Doc/plan/roadmap edits (`.ai-factory/*`, `notes/11-migration-backfill-roots.md`) — non-code, not assessed for correctness beyond consistency.

**Verification performed:** read the migration in full; cross-checked enum members, the bio-read reader, and the installed TypeORM 0.3.x postgres driver behavior; ran `tsc --noEmit`.

**Risk level:** 🟢 Low — implementation faithfully matches the thrice-reviewed plan; no correctness, security, or data-loss defect found. Three informational/non-blocking notes below.

---

## Correctness verification (the things most likely to break at runtime)

1. **Batch loop termination (`affected`) — VERIFIED CORRECT.** This was review-1's M2 risk: a non-`RETURNING` `UPDATE` via `queryRunner.query(sql)` returns `[]`, so a `result.length` loop would stop after one batch and silently under-migrate. The code uses the structured form `queryRunner.query(bioUpSql, undefined, true)` and reads `res.affected`. Confirmed against the installed driver `node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:195-196` — for an `UPDATE` it sets `result.affected = raw.rowCount`, and `useStructuredResult=true` returns the `QueryResult`. So `affected` is the real updated-row count; the loop on `affected > 0` converges. The `typeof res === 'object' && typeof res.affected === 'number'` guard is `!`-free (RULES.md) and degrades to `0` (loop exit) if the shape is ever unexpected.

2. **Batch loops converge (no infinite loop, no premature stop).** `up()` step 4: each pass repoints up to 10 000 bio rows from a child id to the new root id; updated rows no longer satisfy the `moduleSessionId = m."childId"` join, so the candidate set strictly shrinks and the `ctid` re-scan never reselects them. `down()` step 1 is symmetric — after a row is repointed to the child, it no longer points at a tagged root, so it drops out of the subselect. Both terminate in ⌈N/10000⌉ passes. The first pass over an empty table yields `affected = 0` and exits immediately.

3. **Enum literals valid.** `'root'` ∈ `ActivityType` and `'completed'` ∈ `SessionStatus` (`src/realtime/enums/*`). The `CASE WHEN s."endedAt" IS NOT NULL THEN 'completed' ELSE s.status END` mixes an unknown literal with the enum column — Postgres coerces the literal to the column's enum type; both branches resolve to the same type. NOT NULL coverage is complete (`userId`, `activityType`, `status`, `startedAt`, `lastActivityAt`); `createdAt` (DB `now()` default) and `activityRefId` (nullable) correctly omitted.

4. **`down()` ordering vs. self-referential `ON DELETE CASCADE` — correct.** Bio is fully repointed back to children (loop drains to `affected = 0`) **before** step 2 nulls `rootSessionId` and step 3 deletes the roots. Because the repoint runs while children still reference their roots, the `s."rootSessionId" = b."moduleSessionId"` join resolves the (strictly 1:1) child deterministically. Deleting tagged roots only after the child links are nulled means the cascade has nothing to follow.

5. **Idempotency / no-op re-run — correct, and the invariant guard no longer breaks it (review-2 I2).** The `WHERE "activityType" != 'root' AND "rootSessionId" IS NULL` populate is the guard; on a re-run `_root_map` is empty, `mapped === 0`, and the migration early-returns before steps 2–5. The step-5 assertions only run when `mapped > 0` and compare roots created **in this run** (joined through `_root_map`), not the absolute tagged-root count — so they do not false-fire. (In normal TypeORM flow the migrations table prevents `up()` re-execution anyway; this just keeps the advertised property honest.)

6. **`down()` scoped to tagged synthetic roots only (review-1 M1) — correct.** Every `down()` statement filters `metadata->>'backfill' = 'synthetic-root-v1'`, so app-created lazy roots (which can be multi-child) are untouched; the deterministic 1:1 repoint is valid only for the tagged rows, which is exactly what is targeted.

7. **Series preservation holds.** Each synthetic root mirrors the child's `startedAt`/`endedAt`, and the reader (`src/sessions/sessions.service.ts:174-200`, `bioSessionIds = [session.id, session.rootSessionId]` windowed by `[startedAt, endedAt]`) returns the identical series via the root branch.

8. **`uuid_generate_v4()` available** — already used as the `bio_session_samples.id` default (`1779990145496-AddBioSessionSamplesTable`), so the `uuid-ossp` extension is present for the `_root_map` default.

9. **No injection / security surface** — fully static SQL, no interpolated user input.

---

## Informational / Non-blocking notes

### N1. `migrationsTransactionMode: 'each'` is a global change to the whole migration suite
This is the correct and necessary fix for the `55P04` enum-in-same-transaction defect (it lets `AddRootActivityType` commit `'root'` before this migration's body uses it), and it is applied consistently to both the runtime factory and the CLI `DataSource`. Be aware it also changes failure semantics for **every** migration on a fresh run: previously (`'all'` default) a failure rolled back the entire batch; now each migration commits independently, so a mid-suite failure leaves earlier migrations applied. Every current migration under `src/migrations/` is self-contained DDL/data with no cross-migration atomicity dependency (spot-checked), so this is safe — but it warrants conscious sign-off since it affects more than this one migration. The migration body itself remains atomic (one transaction per migration under `'each'`), so the backfill is still all-or-nothing.

### N2. `tsc --noEmit` reports pre-existing errors in an unrelated spec — not introduced here
`tsc --noEmit` fails on `src/realtime/services/biometric-stream-engine.service.spec.ts` (TS2352 cast mismatches). These files are **not** part of this change and the errors are unrelated to the migration. The new migration and both config edits compile clean (no diagnostics reference them), and `npm run build` (nest/`tsconfig.build.json`, which excludes `*.spec.ts`) is unaffected. Flagging only so the green/red signal isn't misattributed to this change.

### N3. Edge case — a childless tagged synthetic root at revert time loses its bio via cascade
`down()` step 1 repoints bio back only where a child still references the root. If, before a revert, a tagged synthetic root were left childless (e.g. its child was deleted post-migration), its bio would not be repointed and step 3's `DELETE` would cascade-delete that bio. This is benign in practice — the orphaned-root cleanup (`deleteRun`) and the childless-root janitor already remove such roots (and their bio) during normal operation, and if the original child is gone there is nowhere to repoint to. No action needed; noting for completeness.

---

## Verdict
The code is correct, secure, and matches the plan and spec. The review-1 (C1/M1/M2) and review-2 (I1/I2) findings are all genuinely implemented and were re-verified against the installed TypeORM driver and the live schema. The three notes above are advisory, not defects.

REVIEW_PASS
