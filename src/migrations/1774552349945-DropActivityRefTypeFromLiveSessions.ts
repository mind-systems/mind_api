import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropActivityRefTypeFromLiveSessions1774552349945 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_sessions" DROP COLUMN "activityRefType"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_sessions" ADD "activityRefType" character varying`,
    );
  }
}
