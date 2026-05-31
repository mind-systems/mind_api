import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthCodeAttemptTracking1780245770180
  implements MigrationInterface
{
  name = 'AddAuthCodeAttemptTracking1780245770180';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_codes" ADD "failedAttempts" smallint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_codes" ADD "lockedUntil" TIMESTAMP NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_codes" DROP COLUMN "lockedUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_codes" DROP COLUMN "failedAttempts"`,
    );
  }
}
