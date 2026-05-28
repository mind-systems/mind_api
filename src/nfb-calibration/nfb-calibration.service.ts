import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NfbCalibrationRecord } from './entities/nfb-calibration-record.entity';
import { RecordNfbCalibrationRequest } from '../../proto/generated/nfb_calibration';

@Injectable()
export class NfbCalibrationService {
  constructor(
    @InjectRepository(NfbCalibrationRecord)
    private readonly repo: Repository<NfbCalibrationRecord>,
  ) {}

  async record(userId: string, req: RecordNfbCalibrationRequest): Promise<NfbCalibrationRecord> {
    const entity = this.repo.create({
      userId,
      deviceSerial: req.deviceSerial,
      calibratedAt: new Date(req.calibratedAt),
      isValid: req.isValid,
      failReason: req.failReason || null,
      individualFrequency: req.individualFrequency,
      individualPeakFrequencyPower: req.individualPeakFrequencyPower,
      individualPeakFrequencySuppression: req.individualPeakFrequencySuppression,
      individualBandwidth: req.individualBandwidth,
      individualNormalizedPower: req.individualNormalizedPower,
      lowerFrequency: req.lowerFrequency,
      upperFrequency: req.upperFrequency,
    });
    return this.repo.save(entity);
  }

  async list(userId: string, deviceSerial: string, limit: number): Promise<NfbCalibrationRecord[]> {
    return this.repo.find({
      where: { userId, deviceSerial },
      order: { createdAt: 'DESC' },
      take: limit || 50,
    });
  }
}
