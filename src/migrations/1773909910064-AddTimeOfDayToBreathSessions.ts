import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimeOfDayToBreathSessions1773909910064
  implements MigrationInterface
{
  name = 'AddTimeOfDayToBreathSessions1773909910064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."breath_sessions_timeOfDay_enum" AS ENUM('morning', 'midday', 'evening')
    `);
    await queryRunner.query(`
      ALTER TABLE "breath_sessions"
        ADD COLUMN "timeOfDay" "public"."breath_sessions_timeOfDay_enum" DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "breath_sessions" DROP COLUMN "timeOfDay"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."breath_sessions_timeOfDay_enum"`,
    );
  }
}
