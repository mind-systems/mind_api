import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeditationNotesTable1780461720539 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meditation_notes" (
        "id"         uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    uuid        NOT NULL,
        "session_id" uuid,
        "pose_name"  varchar     NOT NULL,
        "note_text"  text        NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meditation_notes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_meditation_notes_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_meditation_notes_session_id" FOREIGN KEY ("session_id")
          REFERENCES "module_sessions"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_meditation_notes_user_id" ON "meditation_notes" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_meditation_notes_session_id" ON "meditation_notes" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_meditation_notes_session" ON "meditation_notes" ("session_id") WHERE "session_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_meditation_notes_session"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meditation_notes_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meditation_notes_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "meditation_notes"`);
  }
}
