import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameToModuleSessionNotes1782448540748 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE meditation_notes RENAME TO module_session_notes`);
        await queryRunner.query(`ALTER TABLE module_session_notes DROP COLUMN pose_id`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE module_session_notes ADD COLUMN pose_id varchar NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE module_session_notes RENAME TO meditation_notes`);
    }

}
