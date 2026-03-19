import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePersonalAccessTokensTable1773909111537
  implements MigrationInterface
{
  name = 'CreatePersonalAccessTokensTable1773909111537';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "personal_access_tokens" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"      uuid NOT NULL,
        "tokenHash"   character varying NOT NULL,
        "name"        character varying NOT NULL,
        "lastUsedAt"  TIMESTAMP DEFAULT NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_personal_access_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_personal_access_tokens_tokenHash" UNIQUE ("tokenHash")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_personal_access_tokens_userId" ON "personal_access_tokens" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "personal_access_tokens"`);
  }
}
