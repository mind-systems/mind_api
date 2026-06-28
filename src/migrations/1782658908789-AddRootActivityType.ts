import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRootActivityType1782658908789 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."activity_type_enum" ADD VALUE IF NOT EXISTS 'root'`,
    );
  }

  public down(): Promise<void> {
    // Postgres does not support ALTER TYPE … DROP VALUE.
    // A full rollback would require dropping and recreating the type without
    // 'root', which means rewriting every dependent column — not safe to
    // automate. Reject so that `migration:revert` fails loudly instead of leaving
    // the migrations table out of sync with the actual DB state.
    return Promise.reject(
      new Error(
        'AddRootActivityType cannot be reverted automatically. ' +
          'Remove the root value manually if required.',
      ),
    );
  }
}
