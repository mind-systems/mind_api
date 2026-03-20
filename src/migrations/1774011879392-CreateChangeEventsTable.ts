import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChangeEventsTable1774011879392 implements MigrationInterface {
  name = 'CreateChangeEventsTable1774011879392';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "change_events" (
        "id"        SERIAL PRIMARY KEY,
        "entity"    VARCHAR NOT NULL,
        "refId"     UUID NOT NULL,
        "action"    VARCHAR NOT NULL,
        "userId"    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_change_events_userId_id" ON "change_events" ("userId", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "change_events"`);
  }
}
