import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { TimeRangeQueryDto } from './dto/time-range-query.dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('runs')
  listRuns(@Query() query: ListRunsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.sessionsService.listRuns(user.sub, query.limit, query.offset);
  }

  @Delete('runs/:id')
  @HttpCode(204)
  deleteRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.deleteRun(user.sub, id);
  }

  @Get('runs/:id/biometrics')
  listBiometrics(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TimeRangeQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.listBiometrics(
      user.sub,
      id,
      query.from,
      query.to,
    );
  }

  @Get('runs/:id/instructions')
  listInstructions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TimeRangeQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.listInstructions(
      user.sub,
      id,
      query.from,
      query.to,
    );
  }
}
