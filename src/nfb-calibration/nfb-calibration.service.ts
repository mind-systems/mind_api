import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NfbCalibrationRecord } from './entities/nfb-calibration-record.entity';

@Injectable()
export class NfbCalibrationService {
  constructor(
    @InjectRepository(NfbCalibrationRecord)
    private readonly repo: Repository<NfbCalibrationRecord>,
  ) {}
}
