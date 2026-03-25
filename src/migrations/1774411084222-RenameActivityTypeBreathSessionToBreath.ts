import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameActivityTypeBreathSessionToBreath1774411084222 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."activity_type_enum" RENAME VALUE 'breath_session' TO 'breath'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."activity_type_enum" RENAME VALUE 'breath' TO 'breath_session'`,
    );
  }
}
