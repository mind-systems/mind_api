import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameToModuleSessions1774779899323 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "live_sessions" RENAME TO "module_sessions"`);
        await queryRunner.query(`ALTER TYPE "session_status_enum" RENAME TO "module_sessions_status_enum"`);
        await queryRunner.query(`DROP INDEX "IDX_live_sessions_userId"`);
        await queryRunner.query(`DROP INDEX "IDX_live_sessions_status"`);
        await queryRunner.query(`CREATE INDEX "IDX_module_sessions_userId" ON "module_sessions" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_module_sessions_status" ON "module_sessions" ("status")`);
        await queryRunner.query(`ALTER TABLE "module_sessions" RENAME CONSTRAINT "PK_live_sessions_id" TO "PK_module_sessions_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "module_sessions" RENAME CONSTRAINT "PK_module_sessions_id" TO "PK_live_sessions_id"`);
        await queryRunner.query(`DROP INDEX "IDX_module_sessions_status"`);
        await queryRunner.query(`DROP INDEX "IDX_module_sessions_userId"`);
        await queryRunner.query(`CREATE INDEX "IDX_live_sessions_status" ON "module_sessions" ("status")`);
        await queryRunner.query(`CREATE INDEX "IDX_live_sessions_userId" ON "module_sessions" ("userId")`);
        await queryRunner.query(`ALTER TYPE "module_sessions_status_enum" RENAME TO "session_status_enum"`);
        await queryRunner.query(`ALTER TABLE "module_sessions" RENAME TO "live_sessions"`);
    }

}
