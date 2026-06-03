import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeditationPosesTable1780508172536 implements MigrationInterface {
  name = 'AddMeditationPosesTable1780508172536';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meditation_poses" (
        "id"            uuid     NOT NULL DEFAULT uuid_generate_v4(),
        "slug"          character varying NOT NULL,
        "display_order" smallint NOT NULL,
        CONSTRAINT "PK_meditation_poses_id"   PRIMARY KEY ("id"),
        CONSTRAINT "UQ_meditation_poses_slug" UNIQUE ("slug")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "meditation_poses" ("slug", "display_order") VALUES
        ('easy',       1),
        ('lotus',      2),
        ('half_lotus', 3),
        ('seiza',      4),
        ('chair',      5),
        ('savasana',   6)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meditation_poses"`);
  }
}
