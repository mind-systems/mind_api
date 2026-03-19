import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMaxCompletedComplexity1773945801918 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user_stats" ADD COLUMN "maxCompletedComplexity" double precision NOT NULL DEFAULT 0`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user_stats" DROP COLUMN "maxCompletedComplexity"`,
        );
    }

}
