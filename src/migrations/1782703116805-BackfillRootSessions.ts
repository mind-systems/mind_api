import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillRootSessions1782703116805 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Build 1:1 child→root id map in a temp table.
    // ON COMMIT DROP ensures the temp table is scoped to this transaction.
    // The WHERE is the idempotency guard — rows with a non-null rootSessionId
    // are already migrated and will not appear here on a re-run.
    await queryRunner.query(`
      CREATE TEMP TABLE _root_map (
        "childId" uuid PRIMARY KEY,
        "rootId"  uuid NOT NULL DEFAULT uuid_generate_v4()
      ) ON COMMIT DROP
    `);

    await queryRunner.query(`
      INSERT INTO _root_map ("childId")
        SELECT id FROM module_sessions
        WHERE "activityType" != 'root' AND "rootSessionId" IS NULL
    `);

    // Capture the count of mapped children so we can skip invariant checks on
    // a no-op re-run (empty _root_map = nothing to validate, I2 compliance).
    const countRes = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt FROM _root_map`,
    );
    const mapped: number =
      Array.isArray(countRes) && countRes.length > 0
        ? (countRes[0].cnt ?? 0)
        : 0;

    if (mapped === 0) {
      // No qualifying rows — this is a no-op re-run; skip all subsequent steps.
      return;
    }

    // Step 2: Insert one synthetic root per mapped child, tagged with a
    // backfill marker so down() can target exactly these rows.
    await queryRunner.query(`
      INSERT INTO module_sessions
        (id, "userId", "activityType", status, "startedAt", "disconnectedAt", "endedAt", "lastActivityAt", metadata, "rootSessionId")
      SELECT
        m."rootId",
        s."userId",
        'root',
        CASE WHEN s."endedAt" IS NOT NULL THEN 'completed' ELSE s.status END,
        s."startedAt",
        NULL,
        s."endedAt",
        s."lastActivityAt",
        '{"backfill":"synthetic-root-v1"}'::jsonb,
        NULL
      FROM _root_map m
      JOIN module_sessions s ON s.id = m."childId"
    `);

    // Step 3: Link each child to its synthetic root.
    await queryRunner.query(`
      UPDATE module_sessions s
        SET "rootSessionId" = m."rootId"
      FROM _root_map m
      WHERE s.id = m."childId"
    `);

    // Step 4: Repoint bio rows child→root, batched at 10 000 rows/batch.
    // ctid-bounded sub-select ensures each pass picks a fresh chunk.
    // Updated rows stop matching the join (moduleSessionId changes to rootId),
    // so the loop converges naturally.
    // queryRunner.query(sql, undefined, true) returns a structured result
    // { records, affected, raw } — we loop on affected (not result.length which
    // would be 0 for non-RETURNING UPDATE — M2 fix, RULES.md: no ! operator).
    const bioUpSql = `
      UPDATE bio_session_samples b
        SET "moduleSessionId" = m."rootId"
      FROM _root_map m
      WHERE b.ctid IN (
        SELECT b2.ctid
        FROM bio_session_samples b2
        JOIN _root_map m2 ON b2."moduleSessionId" = m2."childId"
        LIMIT 10000
      )
      AND b."moduleSessionId" = m."childId"
    `;

    let affected = 0;
    do {
      const res = await queryRunner.query(bioUpSql, undefined, true);
      affected =
        res !== null &&
        typeof res === 'object' &&
        typeof res.affected === 'number'
          ? res.affected
          : 0;
    } while (affected > 0);

    // Step 5: Post-up() invariant assertion.
    // Only runs when this is NOT a no-op re-run (mapped > 0, guarded above).

    // 5a: Verify every child mapped in this run now has rootSessionId set.
    const orphanRes = await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt
      FROM module_sessions s
      JOIN _root_map m ON s.id = m."childId"
      WHERE s."rootSessionId" IS NULL
    `);
    const orphans: number =
      Array.isArray(orphanRes) && orphanRes.length > 0
        ? (orphanRes[0].cnt ?? 0)
        : 0;
    if (orphans > 0) {
      throw new Error(
        `BackfillRootSessions invariant violated: ${orphans} child row(s) still have rootSessionId IS NULL after up()`,
      );
    }

    // 5b: Verify the number of synthetic roots created in this run equals mapped.
    // Compare against roots joined through _root_map (not the absolute tagged-root
    // count — that would include roots from prior runs and false-fire on re-run).
    const rootCountRes = await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt
      FROM module_sessions r
      JOIN _root_map m ON r.id = m."rootId"
      WHERE r."activityType" = 'root'
    `);
    const rootsCreated: number =
      Array.isArray(rootCountRes) && rootCountRes.length > 0
        ? (rootCountRes[0].cnt ?? 0)
        : 0;
    if (rootsCreated !== mapped) {
      throw new Error(
        `BackfillRootSessions invariant violated: expected ${mapped} synthetic root(s), found ${rootsCreated}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Repoint bio rows back to their original child, batched the same
    // way as up() step 4 to bound executor memory.
    // Only targets bio rows currently pointing at a synthetic root (M1 fix).
    const bioDownSql = `
      UPDATE bio_session_samples b
        SET "moduleSessionId" = s.id
      FROM module_sessions s
      WHERE b.ctid IN (
        SELECT b2.ctid
        FROM bio_session_samples b2
        JOIN module_sessions r ON b2."moduleSessionId" = r.id
        WHERE r."activityType" = 'root'
          AND r.metadata->>'backfill' = 'synthetic-root-v1'
        LIMIT 10000
      )
      AND s."rootSessionId" = b."moduleSessionId"
      AND s."rootSessionId" IS NOT NULL
    `;

    let affected = 0;
    do {
      const res = await queryRunner.query(bioDownSql, undefined, true);
      affected =
        res !== null &&
        typeof res === 'object' &&
        typeof res.affected === 'number'
          ? res.affected
          : 0;
    } while (affected > 0);

    // Step 2: Null the children's rootSessionId to break the self-referential FK
    // before deleting the synthetic root rows (prevents CASCADE child deletion).
    await queryRunner.query(`
      UPDATE module_sessions
        SET "rootSessionId" = NULL
      WHERE "rootSessionId" IN (
        SELECT id FROM module_sessions
        WHERE "activityType" = 'root'
          AND metadata->>'backfill' = 'synthetic-root-v1'
      )
    `);

    // Step 3: Delete only the tagged synthetic roots.
    // App-created roots (no backfill tag) are untouched (M1 fix).
    await queryRunner.query(`
      DELETE FROM module_sessions
      WHERE "activityType" = 'root'
        AND metadata->>'backfill' = 'synthetic-root-v1'
    `);

    // Note: down() does NOT attempt to remove the 'root' enum value —
    // Postgres has no ALTER TYPE … DROP VALUE. That is owned by
    // AddRootActivityType, which already rejects revert.
  }
}
