import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNfbCalibrationRecordsTable1779993063433 implements MigrationInterface {
  name = 'AddNfbCalibrationRecordsTable1779993063433';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "nfb_calibration_records" (
        "id"                                    uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"                               uuid NOT NULL,
        "device_serial"                         character varying NOT NULL,
        "calibrated_at"                         TIMESTAMP WITH TIME ZONE NOT NULL,
        "is_valid"                              boolean NOT NULL,
        "fail_reason"                           character varying DEFAULT NULL,
        "individual_frequency"                  double precision NOT NULL,
        "individual_peak_frequency_power"       double precision NOT NULL,
        "individual_peak_frequency_suppression" double precision NOT NULL,
        "individual_bandwidth"                  double precision NOT NULL,
        "individual_normalized_power"           double precision NOT NULL,
        "lower_frequency"                       double precision NOT NULL,
        "upper_frequency"                       double precision NOT NULL,
        "created_at"                            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_nfb_calibration_records_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_nfb_calibration_records_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_nfb_calibration_records_user_device"
        ON "nfb_calibration_records" ("user_id", "device_serial")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_nfb_calibration_records_user_device"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "nfb_calibration_records"`);
  }
}
