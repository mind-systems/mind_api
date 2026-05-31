import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { NfbCalibrationRecord } from './entities/nfb-calibration-record.entity';
import { RecordNfbCalibrationRequest } from '../../proto/generated/nfb_calibration';

@Injectable()
export class NfbCalibrationService {
  constructor(
    @InjectRepository(NfbCalibrationRecord)
    private readonly repo: Repository<NfbCalibrationRecord>,
  ) {}

  async record(
    userId: string,
    req: RecordNfbCalibrationRequest,
  ): Promise<NfbCalibrationRecord> {
    const calibratedAt = new Date(req.calibratedAt);
    if (Number.isNaN(calibratedAt.getTime())) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'Invalid calibratedAt timestamp',
      });
    }

    const entity = this.repo.create({
      userId,
      deviceSerial: req.deviceSerial,
      calibratedAt,
      isValid: req.isValid,
      failReason: req.failReason || null,
      individualFrequency: req.individualFrequency,
      individualPeakFrequencyPower: req.individualPeakFrequencyPower,
      individualPeakFrequencySuppression:
        req.individualPeakFrequencySuppression,
      individualBandwidth: req.individualBandwidth,
      individualNormalizedPower: req.individualNormalizedPower,
      lowerFrequency: req.lowerFrequency,
      upperFrequency: req.upperFrequency,
    });
    return this.repo.save(entity);
  }

  async list(
    userId: string,
    deviceSerial?: string,
    limit = 50,
    offset = 0,
  ): Promise<[NfbCalibrationRecord[], number]> {
    const where: FindOptionsWhere<NfbCalibrationRecord> = { userId };
    if (deviceSerial && deviceSerial.length > 0) {
      where.deviceSerial = deviceSerial;
    }
    const take = Math.min(limit && limit > 0 ? limit : 50, 200);
    return this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take,
      skip: offset,
    });
  }
}
