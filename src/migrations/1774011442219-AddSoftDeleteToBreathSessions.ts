import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteToBreathSessions1774011442219 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "breath_sessions" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "breath_sessions" DROP COLUMN "deletedAt"`,
    );
  }
}
