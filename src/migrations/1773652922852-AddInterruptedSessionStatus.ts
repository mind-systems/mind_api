import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInterruptedSessionStatus1773652922852 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const result = await queryRunner.query(
            `SELECT 1 FROM pg_type WHERE typname = 'live_sessions_status_enum'`
        );
        if (result.length > 0) {
            await queryRunner.query(`ALTER TYPE "live_sessions_status_enum" ADD VALUE IF NOT EXISTS 'interrupted'`);
        }
        // If the enum doesn't exist yet, it will be created with 'interrupted' included
        // by the migration that creates the live_sessions table.
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Postgres does not support ALTER TYPE ... DROP VALUE.
        // To roll back: recreate the column with a new enum type excluding 'interrupted'.
    }

}
