import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('nfb_calibration_records')
@Index(['userId', 'deviceSerial'])
export class NfbCalibrationRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column({ name: 'device_serial' })
  deviceSerial: string;

  @Column({ name: 'calibrated_at', type: 'timestamptz' })
  calibratedAt: Date;

  @Column({ name: 'is_valid' })
  isValid: boolean;

  @Column({ name: 'fail_reason', type: 'varchar', nullable: true })
  failReason: string | null;

  @Column({ name: 'individual_frequency', type: 'double precision' })
  individualFrequency: number;

  @Column({ name: 'individual_peak_frequency_power', type: 'double precision' })
  individualPeakFrequencyPower: number;

  @Column({ name: 'individual_peak_frequency_suppression', type: 'double precision' })
  individualPeakFrequencySuppression: number;

  @Column({ name: 'individual_bandwidth', type: 'double precision' })
  individualBandwidth: number;

  @Column({ name: 'individual_normalized_power', type: 'double precision' })
  individualNormalizedPower: number;

  @Column({ name: 'lower_frequency', type: 'double precision' })
  lowerFrequency: number;

  @Column({ name: 'upper_frequency', type: 'double precision' })
  upperFrequency: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
