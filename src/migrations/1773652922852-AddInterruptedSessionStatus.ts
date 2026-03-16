import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInterruptedSessionStatus1773652922852 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "live_sessions_status_enum" ADD VALUE IF NOT EXISTS 'interrupted'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Postgres does not support ALTER TYPE ... DROP VALUE.
        // To roll back: recreate the column with a new enum type excluding 'interrupted'.
    }

}
