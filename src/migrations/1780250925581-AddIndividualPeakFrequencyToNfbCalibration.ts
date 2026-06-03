import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndividualPeakFrequencyToNfbCalibration1780250925581 implements MigrationInterface {
  name = 'AddIndividualPeakFrequencyToNfbCalibration1780250925581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nfb_calibration_records" ADD COLUMN "individual_peak_frequency" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nfb_calibration_records" DROP COLUMN "individual_peak_frequency"`,
    );
  }
}
