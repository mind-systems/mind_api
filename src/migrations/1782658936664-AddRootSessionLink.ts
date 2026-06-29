import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRootSessionLink1782658936664 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "module_sessions" ADD COLUMN "rootSessionId" uuid DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "module_sessions"
        ADD CONSTRAINT "FK_module_sessions_rootSessionId"
        FOREIGN KEY ("rootSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_module_sessions_rootSessionId" ON "module_sessions" ("rootSessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_module_sessions_rootSessionId"`);
    await queryRunner.query(
      `ALTER TABLE "module_sessions" DROP CONSTRAINT "FK_module_sessions_rootSessionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "module_sessions" DROP COLUMN "rootSessionId"`,
    );
  }
}
