import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameSessionStreamSampleLiveSessionId1774778297835
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_session_stream_samples_liveSessionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_stream_samples" RENAME COLUMN "liveSessionId" TO "moduleSessionId"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_session_stream_samples_moduleSessionId" ON "session_stream_samples" ("moduleSessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_session_stream_samples_moduleSessionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_stream_samples" RENAME COLUMN "moduleSessionId" TO "liveSessionId"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_session_stream_samples_liveSessionId" ON "session_stream_samples" ("liveSessionId")`,
    );
  }
}
