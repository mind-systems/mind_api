import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { NfbCalibrationService } from './nfb-calibration.service';
import { ListNfbCalibrationsQueryDto } from './dto/list-nfb-calibrations-query.dto';

@Controller('nfb-calibrations')
@UseGuards(JwtAuthGuard)
export class NfbCalibrationRestController {
  constructor(private readonly nfbCalibrationService: NfbCalibrationService) {}

  @Get()
  async list(
    @Query() query: ListNfbCalibrationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const [records, total] = await this.nfbCalibrationService.list(
      user.sub,
      query.deviceSerial,
      query.limit,
      query.offset,
    );
    return { records, total };
  }
}
