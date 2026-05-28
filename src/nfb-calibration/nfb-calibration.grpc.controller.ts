import { Controller } from '@nestjs/common';
import { NfbCalibrationService } from './nfb-calibration.service';

@Controller()
export class NfbCalibrationGrpcController {
  constructor(private readonly service: NfbCalibrationService) {}
}
