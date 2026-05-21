import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BciDevice } from './entities/bci-device.entity';

@Injectable()
export class BciDeviceService {
  constructor(
    @InjectRepository(BciDevice)
    private readonly bciDevicesRepo: Repository<BciDevice>,
  ) {}
}
