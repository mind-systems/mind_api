import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePoseNameToPoseIdInMeditationNotes1780524587785 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE meditation_notes RENAME COLUMN pose_name TO pose_id`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE meditation_notes RENAME COLUMN pose_id TO pose_name`,
    );
  }
}
