import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBioSessionSamplesTable1779990145496 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bio_session_samples" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "moduleSessionId" uuid NOT NULL,
        "samples"         jsonb NOT NULL,
        "flushedAt"       TIMESTAMP NOT NULL,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bio_session_samples_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bio_session_samples_moduleSessionId" FOREIGN KEY ("moduleSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_bio_session_samples_moduleSessionId" ON "bio_session_samples" ("moduleSessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bio_session_samples_moduleSessionId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "bio_session_samples"`);
  }
}
