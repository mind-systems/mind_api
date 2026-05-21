import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBciDevicesTable1779369537954 implements MigrationInterface {
  name = 'AddBciDevicesTable1779369537954';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bci_devices" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    uuid NOT NULL,
        "serial"     character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bci_devices_id"           PRIMARY KEY ("id"),
        CONSTRAINT "UQ_bci_devices_user_serial"   UNIQUE ("user_id", "serial"),
        CONSTRAINT "FK_bci_devices_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_bci_devices_user_id" ON "bci_devices" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bci_devices"`);
  }
}
